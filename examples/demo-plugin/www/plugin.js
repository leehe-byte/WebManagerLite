/**
 * 示例插件入口（manifest.json 的 entryJs 指向本文件）
 * 调用 PluginRegistry.register() 注册：侧边栏菜单 / 页面 / overview 卡片。
 * 通用能力 API 前缀固定为 /api/plugins/{id}/：
 *   POST /api/plugins/{id}/exec    {"command":"..."}  root 执行（cwd 为插件目录）
 *   GET  /api/plugins/{id}/config  读取 KV 配置
 *   POST /api/plugins/{id}/config  {"key":"value"}   保存 KV 配置
 *   GET  /api/plugins/{id}/file?path=...             读取插件私有文件
 *   POST /api/plugins/{id}/file    {"path":"...","content":"..."}
 */
PluginRegistry.register({
    id: 'demo',
    title: '示例插件',
    icon: '🧪',
    menu: { section: '插件', order: 1 },
    page: 'page.html',

    cards: [
        {
            id: 'status',
            title: '设备信息',
            icon: '📊',
            refreshMs: 5000,
            render() {
                Api.get('/api/status').then(s => {
                    const el = document.getElementById('plugin-card-body-demo-status');
                    if (!el) return;
                    el.innerHTML = `
                        <table class="info-table">
                            <tr><td>设备</td><td>${escapeHtml(s.model || '--')}</td></tr>
                            <tr><td>系统</td><td>Android ${escapeHtml(s.android_ver || '--')}</td></tr>
                            <tr><td>电量</td><td>${s.battery_level || '--'}% ${s.is_charging ? '⚡ 充电中' : ''}</td></tr>
                        </table>`;
                }).catch(() => {});
            }
        }
    ],

    init() {
        const btn = document.getElementById('demo-run-btn');
        if (btn) btn.onclick = () => this.runCommand();
        this.loadConfig();
    },

    async runCommand() {
        const out = document.getElementById('demo-output');
        if (out) out.textContent = '执行中...';
        try {
            const res = await Api.post('/api/plugins/demo/exec', { command: 'uname -a && uptime' });
            if (out) out.textContent = res.output || '(无输出)';
        } catch (e) {
            if (out) out.textContent = '执行失败: ' + e.message;
        }
    },

    async loadConfig() {
        try {
            const cfg = await Api.get('/api/plugins/demo/config');
            const note = document.getElementById('demo-config-note');
            if (note) note.textContent = cfg.note || '(未设置，可在本插件页面下保存)';
        } catch (e) {}
    }
});
