/**
 * USB 端口切换模块
 * 通过原厂 goform 桥接控制 usb_port_switch（BridgeProtocol 会自动附加 AD 校验参数）
 */
const UsbPortModule = {
    init: function() {
        this.syncStatus();
        const toggle = document.getElementById('usb-toggle');
        if (toggle) {
            toggle.onclick = () => {
                this.setPort(toggle.checked ? '1' : '0');
            };
        }
    },

    syncStatus: async function() {
        try {
            const res = await Api.get('/api/proxy/goform/goform_get_cmd_process?isTest=false&cmd=usb_port_switch&_=' + Date.now());
            const on = !!(res && res.usb_port_switch === '1');

            const badge = document.getElementById('usb-status-badge');
            const statusText = document.getElementById('usb-status-text');
            const toggle = document.getElementById('usb-toggle');

            if (on) {
                if (badge) { badge.textContent = '已开启'; badge.style.cssText = 'background:#f6ffed; border-color:#b7eb8f; color:#52c41a;'; }
                if (statusText) statusText.textContent = 'USB 调试端口已开启';
                if (toggle) toggle.checked = true;
            } else {
                if (badge) { badge.textContent = '已关闭'; badge.style.cssText = 'background:#fff1f0; border-color:#ffa39e; color:#f5222d;'; }
                if (statusText) statusText.textContent = 'USB 调试端口已关闭';
                if (toggle) toggle.checked = false;
            }
        } catch (e) {
            console.error("USB Port Sync Error:", e);
        }
    },

    setPort: async function(value) {
        try {
            const res = await Api.post('/api/proxy/goform/goform_set_cmd_process', {
                goformId: 'USB_PORT_SETTING',
                isTest: 'false',
                usb_port_switch: value
            });
            if (res && res.result === 'success') {
                showAlert(value === '1' ? 'USB 调试端口已开启' : 'USB 调试端口已关闭');
            } else {
                showAlert('操作失败: ' + (res?.result || '未知错误'));
            }
        } catch (e) {
            showAlert('操作请求失败: ' + e.message);
        }
        this.syncStatus();
    }
};
