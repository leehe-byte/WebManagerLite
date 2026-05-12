/**
 * Mihomo (Clash) Management Module v3.1 - 完整配置管理
 */
const MihomoModule = {
    config: {},
    subs: [],
    uas: [],
    webuiList: [],
    logTimer: null,
    logAutoRefresh: true,

    init: function() {
        console.log("MihomoModule v3.1 Initializing...");
        this.syncStatus();
        this.loadConfig();
        this.loadLog();

        const toggle = document.getElementById('mi-toggle');
        if (toggle) {
            toggle.onclick = () => {
                const action = toggle.checked ? 'start' : 'stop';
                this.action(action);
            };
        }

        this.startLogAutoRefresh();
    },

    // ===== 状态同步 =====

    syncStatus: async function() {
        try {
            const res = await Api.get('/api/mihomo/status');
            if (!res) return;

            const badge = document.getElementById('mi-status-badge');
            const runningText = document.getElementById('mi-running-text');
            const toggle = document.getElementById('mi-toggle');
            const bootToggle = document.getElementById('mi-boot-toggle');

            if (res.running) {
                if (badge) { badge.textContent = '运行中'; badge.style.cssText = 'background:#f6ffed; border-color:#b7eb8f; color:#52c41a;'; }
                if (runningText) runningText.textContent = 'Mihomo 内核已启动';
                if (toggle) toggle.checked = true;
            } else {
                if (badge) { badge.textContent = '未运行'; badge.style.cssText = 'background:#fff1f0; border-color:#ffa39e; color:#f5222d;'; }
                if (runningText) runningText.textContent = '内核未运行';
                if (toggle) toggle.checked = false;
            }

            if (bootToggle) bootToggle.checked = !!res.boot;
        } catch (e) {
            console.error("Mihomo Sync Error:", e);
        }
    },

    // ===== 加载完整配置 =====

    loadConfig: async function() {
        try {
            const res = await Api.get('/api/mihomo/config');
            if (!res || res.error) {
                console.warn("Config load failed:", res?.error);
                return;
            }

            // 更新 this.config 供其他方法使用
            this.config = res;

            this.setText('mi-mode', res.mode || '--');
            this.setText('mi-port', res.mixed_port || res.port || '--');
            this.setText('mi-tun', res.tun?.device || '--');
            this.setText('mi-log-level', res.log_level || '--');
            this.setText('mi-external-ui', res.external_ui || '--');

            const secretInput = document.getElementById('mi-secret-input');
            if (secretInput) secretInput.value = res.secret || '';

            const controllerInput = document.getElementById('mi-controller-input');
            if (controllerInput) controllerInput.value = res.external_controller || '';

            // UA 列表
            this.uas = res.user_agents || [];
            this.renderUA();

            // 订阅列表
            this.subs = res.subscriptions || [];
            this.renderSubs();

            this.loadWebUIList();

        } catch (e) {
            console.error("Load config error:", e);
        }
    },

    loadWebUIList: async function() {
        try {
            const res = await Api.get('/api/mihomo/webui-list');
            this.webuiList = Array.isArray(res) ? res : [];
        } catch (e) {}
    },

    // ===== 基础设置保存 =====

    saveSettings: async function() {
        const secret = document.getElementById('mi-secret-input')?.value || '';
        const controller = document.getElementById('mi-controller-input')?.value || '';

        let hasError = false;

        if (secret !== (this.config.secret || '')) {
            const r = await Api.post('/api/mihomo/setting?action=secret&value=' + encodeURIComponent(secret));
            if (r?.result !== 'success') hasError = true;
        }

        if (controller !== (this.config.external_controller || '')) {
            const r = await Api.post('/api/mihomo/setting?action=controller&value=' + encodeURIComponent(controller));
            if (r?.result !== 'success') hasError = true;
        }

        if (hasError) {
            showAlert('部分设置保存失败，请检查后重试');
        } else {
            showAlert('基础设置已保存，重启内核后生效');
            this.config.secret = secret;
            this.config.external_controller = controller;
        }
    },

    // ===== 运行模式选择 =====

    showModePicker: function() {
        const current = this.config.mode || 'rule';
        const options = [
            { label: '规则模式 (Rule)', value: 'rule' },
            { label: '全局模式 (Global)', value: 'global' },
            { label: '直连模式 (Direct)', value: 'direct' }
        ];
        ApiExtra.showPicker('选择运行模式', options, current, async (val) => {
            const r = await Api.post('/api/mihomo/setting?action=mode&value=' + val);
            if (r?.result === 'success') {
                this.config.mode = val;
                this.setText('mi-mode', val);
                showAlert('运行模式已修改，重启内核后生效');
            }
        });
    },

    // ===== 日志级别选择 =====

    showLogLevelPicker: function() {
        const current = this.config.log_level || 'info';
        const options = [
            { label: '调试 (debug)', value: 'debug' },
            { label: '信息 (info)', value: 'info' },
            { label: '警告 (warn)', value: 'warn' },
            { label: '错误 (error)', value: 'error' },
            { label: '静默 (silent)', value: 'silent' }
        ];
        ApiExtra.showPicker('选择日志级别', options, current, async (val) => {
            const r = await Api.post('/api/mihomo/setting?action=log-level&value=' + val);
            if (r?.result === 'success') {
                this.config.log_level = val;
                this.setText('mi-log-level', val);
                showAlert('日志级别已修改，重启内核后生效');
            }
        });
    },

    // ===== External-UI 选择 =====

    showUIPicker: function() {
        if (this.webuiList.length === 0) {
            showAlert('未检测到可用的 Web UI，请确认 /data/mihomo/webui/ 目录下有 UI 文件夹');
            return;
        }
        const current = this.config.external_ui?.replace('webui/', '') || '';
        const options = this.webuiList.map(name => ({ label: name, value: name }));
        ApiExtra.showPicker('选择 External-UI', options, current, async (val) => {
            const r = await Api.post('/api/mihomo/setting?action=external-ui&value=' + encodeURIComponent(val));
            if (r?.result === 'success') {
                this.config.external_ui = 'webui/' + val;
                this.setText('mi-external-ui', 'webui/' + val);
                showAlert('External-UI 已修改，重启内核后生效');
            }
        });
    },

    // ===== User-Agent 管理 =====

    renderUA: function() {
        const container = document.getElementById('mi-ua-list');
        if (!container) return;
        if (this.uas.length === 0) {
            container.innerHTML = '<div style="padding:12px; text-align:center; color:var(--text-sub); background:var(--bg); border-radius:6px; border:1px dashed var(--border-color);">暂无自定义 UA，点击"添加"按钮新增</div>';
            return;
        }
        container.innerHTML = `
            <table class="info-table" style="margin-bottom:0;">
                <thead>
                    <tr style="background:var(--bg);">
                        <th style="padding:8px 12px; text-align:left; font-size:12px; color:var(--text-sub); font-weight:500; border-bottom:1px solid var(--border-color);">#</th>
                        <th style="padding:8px 12px; text-align:left; font-size:12px; color:var(--text-sub); font-weight:500; border-bottom:1px solid var(--border-color);">User-Agent</th>
                        <th style="padding:8px 12px; text-align:right; font-size:12px; color:var(--text-sub); font-weight:500; border-bottom:1px solid var(--border-color);">操作</th>
                    </tr>
                </thead>
                <tbody>
                    ${this.uas.map((ua, i) => `
                        <tr>
                            <td style="padding:8px 12px; font-size:12px; color:var(--text-sub); width:30px;">${i + 1}</td>
                            <td style="padding:8px 12px; font-size:12px; word-break:break-all; font-family:monospace;">${ua}</td>
                            <td style="padding:8px 12px; text-align:right; width:40px;">
                                <span style="cursor:pointer; color:var(--danger); font-size:16px;" onclick="MihomoModule.removeUA(${i})" title="删除">×</span>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    },

    addUA: function() {
        const input = prompt('请输入新的 User-Agent：');
        if (input && input.trim()) {
            this.uas.push(input.trim());
            this.renderUA();
        }
    },

    removeUA: function(index) {
        this.uas.splice(index, 1);
        this.renderUA();
    },

    saveUA: async function() {
        const r = await Api.post('/api/mihomo/ua', { user_agents: this.uas });
        if (r?.result === 'success') {
            showAlert('User-Agent 列表已保存');
        } else {
            showAlert('保存失败: ' + (r?.msg || '未知错误'));
        }
    },

    // ===== 订阅管理 =====

    renderSubs: function() {
        const container = document.getElementById('mi-sub-list');
        if (!container) return;
        if (this.subs.length === 0) {
            container.innerHTML = '<div style="text-align:center; padding:30px; color:var(--text-sub);">暂无订阅配置</div>';
            return;
        }
        container.innerHTML = this.subs.map((sub, i) => `
            <div style="border:1px solid var(--border-color); border-radius:8px; margin-bottom:10px; overflow:hidden;">
                <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 12px; background:var(--bg); cursor:pointer; flex-wrap:nowrap; gap:6px;" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none'">
                    <div style="display:flex; align-items:center; gap:6px; min-width:0; flex-shrink:1; overflow:hidden;">
                        <span style="font-weight:600; color:var(--text-main); white-space:nowrap;">${sub.name}</span>
                        <span class="badge" style="background:rgba(24,144,255,0.1); color:var(--primary); flex-shrink:0;">${sub.type || 'http'}</span>
                    </div>
                    <span style="color:var(--text-sub); font-size:10px; min-width:0; flex-shrink:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:right; max-width:180px;" title="${sub.url || ''}">${sub.url ? sub.url.substring(0, 30) + '...' : '无 URL'}</span>
                </div>
                <div style="display:none; padding:10px 12px; border-top:1px solid var(--border-color);">
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; font-size:11px; margin-bottom:8px;">
                        <div style="grid-column:1/-1;"><span style="color:var(--text-sub);">URL:</span> <code style="font-size:10px; word-break:break-all;">${sub.url || '--'}</code></div>
                        <div><span style="color:var(--text-sub);">UA:</span> ${sub.ua || '默认'}</div>
                        <div><span style="color:var(--text-sub);">更新间隔:</span> ${sub.interval || 86400}s</div>
                    </div>
                    <div style="display:flex; gap:6px;">
                        <button onclick="MihomoModule.editSubUrl(${i})" class="badge" style="cursor:pointer; border:none; padding:4px 10px;">编辑 URL</button>
                        <button onclick="MihomoModule.removeSub(${i})" class="badge" style="cursor:pointer; background:#fff1f0; color:#f5222d; border:none; padding:4px 10px;">删除</button>
                    </div>
                </div>
            </div>
        `).join('');
    },

    showAddSubDialog: function() {
        const modal = document.getElementById('custom-modal');
        if (!modal) return;
        document.getElementById('modal-title').textContent = '新增订阅';
        document.getElementById('modal-content').innerHTML = `
            <div class="form-group">
                <label>名称 <span class="required">*</span></label>
                <input id="sub-name-input" class="modern-input" placeholder="如 机场4" style="margin-top:4px;">
            </div>
            <div class="form-group">
                <label>订阅 URL <span class="required">*</span></label>
                <input id="sub-url-input" class="modern-input" placeholder="https://example.com/sub" style="margin-top:4px;">
            </div>
            <div class="form-group">
                <label>User-Agent (可选)</label>
                <input id="sub-ua-input" class="modern-input" placeholder="留空则使用默认 UA" style="margin-top:4px;">
                <div class="input-desc">可选的 UA，不填则使用 User-Agent 列表中的第一个</div>
            </div>
        `;
        document.getElementById('modal-cancel').style.display = 'inline-block';
        document.getElementById('modal-cancel').onclick = () => modal.classList.remove('active');
        document.getElementById('modal-confirm').onclick = async () => {
            const name = document.getElementById('sub-name-input').value.trim();
            const url = document.getElementById('sub-url-input').value.trim();
            const ua = document.getElementById('sub-ua-input').value.trim();
            if (!name || !url) {
                showAlert('名称和 URL 不能为空');
                return;
            }
            modal.classList.remove('active');
            const r = await Api.post(`/api/mihomo/sub/add?name=${encodeURIComponent(name)}&url=${encodeURIComponent(url)}&ua=${encodeURIComponent(ua)}`);
            if (r?.result === 'success') {
                showAlert('订阅已添加，正在重新加载配置...');
                this.loadConfig();
            } else {
                showAlert('添加失败: ' + (r?.msg || '未知错误'));
            }
        };
        modal.classList.add('active');
    },

    editSubUrl: async function(index) {
        const sub = this.subs[index];
        if (!sub) return;
        const newUrl = prompt('编辑订阅 URL：', sub.url || '');
        if (newUrl && newUrl.trim()) {
            const r = await Api.post(`/api/mihomo/sub/update?name=${encodeURIComponent(sub.name)}&url=${encodeURIComponent(newUrl.trim())}`);
            if (r?.result === 'success') {
                showAlert('URL 已更新');
                this.loadConfig();
            }
        }
    },

    removeSub: async function(index) {
        const sub = this.subs[index];
        if (!sub) return;
        if (!await showConfirm(`确定要删除订阅【${sub.name}】吗？`)) return;
        const r = await Api.post(`/api/mihomo/sub/remove?name=${encodeURIComponent(sub.name)}`);
        if (r?.result === 'success') {
            showAlert('订阅已删除');
            this.loadConfig();
        }
    },

    updateAllSubs: async function() {
        if (!await showConfirm('确定要更新所有订阅吗？这将从远程服务器拉取最新配置。')) return;
        const r = await Api.post('/api/mihomo/sub/update-all');
        showAlert('更新指令已发送，请查看日志了解进度');
        setTimeout(() => this.loadLog(), 2000);
    },

    // ===== 日志管理 =====

    loadLog: async function() {
        const logArea = document.getElementById('mi-log-area');
        if (!logArea) return;
        try {
            const res = await fetch('/api/mihomo/log/latest?lines=50');
            logArea.textContent = await res.text();
            logArea.scrollTop = logArea.scrollHeight;
        } catch (e) {
            logArea.textContent = '读取日志失败: ' + e.message;
        }
    },

    toggleLogAutoRefresh: function() {
        this.logAutoRefresh = document.getElementById('mi-log-auto-refresh')?.checked ?? true;
        if (this.logAutoRefresh) {
            this.startLogAutoRefresh();
        } else {
            this.stopLogAutoRefresh();
        }
    },

    startLogAutoRefresh: function() {
        this.stopLogAutoRefresh();
        this.logTimer = setInterval(() => {
            if (this.logAutoRefresh) this.loadLog();
        }, 3000);
    },

    stopLogAutoRefresh: function() {
        if (this.logTimer) {
            clearInterval(this.logTimer);
            this.logTimer = null;
        }
    },

    // ===== 操作 =====

    action: async function(act, sub = '') {
        const res = await Api.post(`/api/mihomo/action?action=${act}&sub=${sub}`);
        if (res) {
            this.syncStatus();
            setTimeout(() => this.loadLog(), 1000);
        }
    },

    toggleBoot: function(isChecked) {
        const subAction = isChecked ? 'on' : 'OFF';
        this.action('boot', subAction);
    },

    editRawConfig: async function() {
        // 获取原始 YAML 内容
        try {
            const res = await fetch('/api/mihomo/raw-config');
            const yaml = await res.text();
            
            const modal = document.getElementById('custom-modal');
            if (!modal) return;
            
            document.getElementById('modal-title').textContent = '编辑 config.yaml';
            document.getElementById('modal-content').innerHTML = `
                <div class="form-group">
                    <label>直接编辑配置文件 <span class="required">*</span></label>
                    <textarea id="raw-config-editor" style="width:100%; height:400px; font-family:monospace; font-size:11px; padding:10px; border:1px solid var(--border-color); border-radius:4px; background:#1e1e1e; color:#d4d4d4; resize:vertical; white-space:pre; overflow:auto; tab-size:2;">${this.escapeHtml(yaml)}</textarea>
                    <div class="input-desc">💡 修改后点击"保存"将覆盖原文件（自动备份为 config.yaml.bak）</div>
                </div>
            `;
            document.getElementById('modal-cancel').style.display = 'inline-block';
            document.getElementById('modal-cancel').onclick = () => modal.classList.remove('active');
            document.getElementById('modal-confirm').textContent = '保存';
            document.getElementById('modal-confirm').onclick = async () => {
                const content = document.getElementById('raw-config-editor').value;
                if (!content.trim()) {
                    showAlert('内容不能为空');
                    return;
                }
                modal.classList.remove('active');
                document.getElementById('modal-confirm').textContent = '确定';
                
                const r = await Api.post('/api/mihomo/config', { content: content });
                if (r?.result === 'success') {
                    showAlert('配置文件已保存，正在重新加载...');
                    this.loadConfig();
                } else {
                    showAlert('保存失败: ' + (r?.msg || '未知错误'));
                }
            };
            modal.classList.add('active');
        } catch (e) {
            showAlert('读取配置文件失败: ' + e.message);
        }
    },

    escapeHtml: function(text) {
        return text.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"');
    },

    openDashboard: function() {
        const wrap = document.getElementById('mi-dashboard-wrap');
        const iframe = document.getElementById('mi-iframe');
        
        const controller = this.config.external_controller || '';
        if (!controller || controller === '--') {
            showAlert('未检测到 external-controller 配置');
            return;
        }

        let host = window.location.hostname;
        let port = "9090";
        if (controller.includes(':')) {
            const parts = controller.split(':');
            port = parts[parts.length - 1];
        }

        /*http://192.168.9.1:7788/ui/?t=123456*/

        const secret = this.config.secret || "";
        const dashboardUrl = `http://${host}:${port}/ui/?t=${secret}`;
        
        if (wrap && iframe) {
            iframe.src = dashboardUrl;
            wrap.style.display = 'block';
            wrap.scrollIntoView({ behavior: 'smooth' });
        }
    },

    // ===== 工具 =====

    setText: function(id, val) {
        const el = document.getElementById(id);
        if (el) el.textContent = val || '--';
    }
};
