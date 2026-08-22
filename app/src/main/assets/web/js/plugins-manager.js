/**
 * 插件管理模块 - 安装(上传/URL) / 启停 / 卸载
 */
const PluginsManagerModule = {
    init() {
        this.list();
        const fileInput = document.getElementById('plugin-file-input');
        if (fileInput) fileInput.addEventListener('change', e => {
            if (e.target.files.length > 0) this.upload(e.target.files[0]);
        });
        const urlBtn = document.getElementById('plugin-install-url-btn');
        if (urlBtn) urlBtn.onclick = () => this.installFromUrl();
    },

    async list() {
        const container = document.getElementById('plugin-list');
        const countEl = document.getElementById('plugin-count');
        if (!container) return;
        try {
            const data = await Api.get('/api/plugins');
            const plugins = Array.isArray(data) ? data : [];
            if (countEl) countEl.textContent = plugins.length + ' 个';
            if (plugins.length === 0) {
                container.innerHTML = '<p style="color: var(--text-sub); font-size: 13px;">尚未安装任何插件，请上传 .owpkg 文件或从 URL 安装。</p>';
                return;
            }
            container.innerHTML = plugins.map(p => `
                <div style="padding: 12px 0; border-bottom: 1px solid var(--border-color);">
                    <div style="display:flex; flex-wrap:wrap; align-items:center; gap:8px;">
                        <div style="flex:1 1 100%; min-width:0;">
                            <b>${escapeHtml(p.icon || '🧩')} ${escapeHtml(p.name || p.id)}</b>
                            <span style="font-size:11px; color:var(--text-sub);"> v${escapeHtml(p.version || '?')} · ${escapeHtml(p.id)} ${p.signed ? '<span style="color:var(--success);">✅ 已签名</span>' : '<span style="color:#faad14;">⚠️ 未签名</span>'}</span>
                            <div style="font-size:12px; color:var(--text-sub); margin-top:2px; word-break:break-all;">${escapeHtml(p.description || '')}</div>
                        </div>
                        <div style="display:flex; gap:6px; flex-wrap:wrap;">
                            <button class="badge" style="border:none; cursor:pointer;" onclick="PluginsManagerModule.run('${p.id}','start')">▶ 启动</button>
                            <button class="badge" style="border:none; cursor:pointer;" onclick="PluginsManagerModule.run('${p.id}','stop')">⏹ 停止</button>
                            <button class="badge" style="background:var(--danger); color:#fff; border:none; cursor:pointer;" onclick="PluginsManagerModule.uninstall('${p.id}')">🗑 卸载</button>
                        </div>
                    </div>
                </div>
            `).join('');
        } catch (e) {
            container.innerHTML = '<p style="color: var(--danger); font-size: 13px;">获取插件列表失败</p>';
        }
    },

    async upload(file) {
        this.setInstalling(true, '正在上传并安装插件，请稍候...');
        const form = new FormData();
        form.append('file', file);
        const headers = {};
        const token = sessionStorage.getItem('authToken');
        if (token) headers['X-Auth-Token'] = token;
        try {
            const resp = await fetch('/api/plugins/install', { method: 'POST', headers, body: form });
            const res = await resp.json();
            this.setInstalling(false);
            if (res.result === 'success') {
                await showAlert(`插件 <b>${escapeHtml(res.plugin?.name || '')}</b> 安装成功！` + this.outputHtml(res));
            } else {
                await showAlert('安装失败: ' + escapeHtml(res.msg || '未知错误'));
            }
        } catch (e) {
            this.setInstalling(false);
            await showAlert('安装请求失败: ' + escapeHtml(e.message));
        }
        this.list();
        if (typeof window.renderPluginNav === 'function') window.renderPluginNav();
        const fileInput = document.getElementById('plugin-file-input');
        if (fileInput) fileInput.value = '';
    },

    async installFromUrl() {
        const url = (document.getElementById('plugin-url-input')?.value || '').trim();
        if (!url) {
            await showAlert('请输入插件下载 URL');
            return;
        }
        this.setInstalling(true, '正在下载并安装插件，请稍候...');
        try {
            const res = await Api.post('/api/plugins/install-url', { url });
            this.setInstalling(false);
            if (res.result === 'success') {
                await showAlert(`插件 <b>${escapeHtml(res.plugin?.name || '')}</b> 安装成功！` + this.outputHtml(res));
            } else {
                await showAlert('安装失败: ' + escapeHtml(res.msg || ''));
            }
        } catch (e) {
            this.setInstalling(false);
            await showAlert('安装请求失败: ' + escapeHtml(e.message));
        }
        this.list();
        if (typeof window.renderPluginNav === 'function') window.renderPluginNav();
    },

    /** 安装期间显示状态条并禁用操作 */
    setInstalling(active, text) {
        const box = document.getElementById('plugin-install-status');
        const txt = document.getElementById('plugin-install-status-text');
        const fileInput = document.getElementById('plugin-file-input');
        const urlBtn = document.getElementById('plugin-install-url-btn');
        if (box) box.style.display = active ? 'block' : 'none';
        if (txt) txt.textContent = text || '正在安装...';
        if (fileInput) fileInput.disabled = active;
        if (urlBtn) urlBtn.disabled = active;
    },

    /** 安装脚本输出（install.sh 的回显），转成弹窗里的 pre 展示 */
    outputHtml(res) {
        if (!res || !res.output || !res.output.trim()) return '';
        return `<div style="margin-top:10px; text-align:left;"><pre style="max-height:180px; overflow:auto; background:#000; color:#00ff00; font-size:11px; padding:10px; border-radius:6px;">${escapeHtml(res.output)}</pre></div>`;
    },

    async run(id, action) {
        await Api.post(`/api/plugins/${id}/${action}`);
    },

    async uninstall(id) {
        const ok = await showConfirm(`确定卸载插件 <b>${escapeHtml(id)}</b>？此操作不可恢复。`);
        if (!ok) return;
        const res = await Api.post(`/api/plugins/${id}/uninstall`);
        await showAlert(res.result === 'success' ? '已卸载' : '卸载失败: ' + escapeHtml(res.msg || ''));
        this.list();
        if (typeof window.renderPluginNav === 'function') window.renderPluginNav();
    }
};
