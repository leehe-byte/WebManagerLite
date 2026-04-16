/**
 * Mihomo (Clash) Management Module v2.0 - 增强自启动控制
 */
const MihomoModule = {
    config: {},

    init: function() {
        console.log("MihomoModule Initializing...");
        this.syncStatus();
        this.loadLog();

        // 内核运行开关
        const toggle = document.getElementById('mi-toggle');
        if (toggle) {
            toggle.onclick = () => {
                const action = toggle.checked ? 'start' : 'stop';
                this.action(action);
            };
        }
    },

    syncStatus: async function() {
        try {
            const res = await Api.get('/api/mihomo/status');
            if (!res) return;

            if (res.config) this.config = res.config;

            const badge = document.getElementById('mi-status-badge');
            const runningText = document.getElementById('mi-running-text');
            const toggle = document.getElementById('mi-toggle');
            const bootToggle = document.getElementById('mi-boot-toggle');

            // 1. 同步运行状态
            if (res.running) {
                if (badge) { badge.textContent = '运行中'; badge.style.cssText = 'background:#f6ffed; border-color:#b7eb8f; color:#52c41a;'; }
                if (runningText) runningText.textContent = 'Mihomo 内核已启动';
                if (toggle) toggle.checked = true;
            } else {
                if (badge) { badge.textContent = '未运行'; badge.style.cssText = 'background:#fff1f0; border-color:#ffa39e; color:#f5222d;'; }
                if (runningText) runningText.textContent = '内核未运行';
                if (toggle) toggle.checked = false;
            }

            // 2. 同步自启动开关状态
            if (bootToggle) {
                bootToggle.checked = !!res.boot;
            }

            // 3. 同步配置详情
            if (res.config) {
                this.setText('mi-mode', res.config.mode);
                this.setText('mi-port', res.config.mixed_port || res.config.port);
                this.setText('mi-controller', res.config.external_controller);
                this.setText('mi-tun', res.config.mi_tun);
            }
        } catch (e) {
            console.error("Mihomo Sync Error:", e);
        }
    },

    action: async function(act, sub = '') {
        const res = await Api.post(`/api/mihomo/action?action=${act}&sub=${sub}`);
        if (res) {
            this.syncStatus();
            setTimeout(() => this.loadLog(), 1000);
        }
    },

    toggleBoot: function(isChecked) {
        const subAction = isChecked ? 'on' : 'OFF';
        console.log("Setting Mihomo boot to:", subAction);
        this.action('boot', subAction);
    },

    loadLog: async function() {
        const logArea = document.getElementById('mi-log-area');
        if (!logArea) return;
        try {
            const res = await fetch('/api/mihomo/log');
            logArea.textContent = await res.text();
            logArea.scrollTop = logArea.scrollHeight;
        } catch (e) {
            logArea.textContent = '读取日志失败: ' + e.message;
        }
    },

    openDashboard: function() {
        const wrap = document.getElementById('mi-dashboard-wrap');
        const iframe = document.getElementById('mi-iframe');
        
        if (!this.config.external_controller || this.config.external_controller === '--') {
            alert('未检测到 external-controller 配置');
            return;
        }

        let addr = this.config.external_controller;
        let port = "9090";
        if (addr.includes(':')) {
            const parts = addr.split(':');
            port = parts[parts.length - 1];
        }

        const host = window.location.hostname;
        const secret = this.config.secret || "";
        const dashboardUrl = `http://${host}:${port}/ui/?host=${host}&port=${port}&secret=${secret}`;
        
        if (wrap && iframe) {
            iframe.src = dashboardUrl;
            wrap.style.display = 'block';
            wrap.scrollIntoView({ behavior: 'smooth' });
        }
    },

    setText: function(id, val) {
        const el = document.getElementById(id);
        if (el) el.textContent = val || '--';
    }
};
