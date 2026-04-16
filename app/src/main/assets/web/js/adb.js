/**
 * ADB Management Module
 */
const AdbModule = {
    init: function() {
        this.syncStatus();
        const toggle = document.getElementById('adb-toggle');
        if (toggle) {
            toggle.onclick = () => {
                const action = toggle.checked ? 'start' : 'stop';
                this.action(action);
            };
        }
    },

    syncStatus: async function() {
        try {
            const res = await Api.get('/api/adb/status');
            if (!res) return;

            const badge = document.getElementById('adb-status-badge');
            const statusText = document.getElementById('adb-status-text');
            const toggle = document.getElementById('adb-toggle');
            const addressBox = document.getElementById('adb-address-box');
            const connectCmd = document.getElementById('adb-connect-cmd');
            const outputArea = document.getElementById('adb-output-area');

            if (res.enabled) {
                if (badge) { badge.textContent = '已开启'; badge.style.cssText = 'background:#f6ffed; border-color:#b7eb8f; color:#52c41a;'; }
                if (statusText) statusText.textContent = '网络 ADB 已就绪';
                if (toggle) toggle.checked = true;
                if (addressBox) addressBox.style.display = 'flex';
                if (connectCmd) connectCmd.textContent = `adb connect ${res.address || '...:5555'}`;
            } else {
                if (badge) { badge.textContent = '未开启'; badge.style.cssText = 'background:#fff1f0; border-color:#ffa39e; color:#f5222d;'; }
                if (statusText) statusText.textContent = '网络 ADB 已关闭';
                if (toggle) toggle.checked = false;
                if (addressBox) addressBox.style.display = 'none';
            }

            if (outputArea && res.output) {
                outputArea.textContent = res.output;
            }
        } catch (e) {
            console.error("ADB Sync Error:", e);
        }
    },

    action: async function(act) {
        const res = await Api.post(`/api/adb/action?action=${act}`);
        if (res) {
            this.syncStatus();
        }
    },

    copyCmd: function() {
        const cmd = document.getElementById('adb-connect-cmd').textContent;
        navigator.clipboard.writeText(cmd).then(() => {
            alert('命令已复制到剪贴板');
        });
    }
};
