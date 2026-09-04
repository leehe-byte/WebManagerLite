/**
 * ADB 控制模块：USB 调试端口（原厂 goform）+ 网络 ADB（root setprop）
 */
const UsbPortModule = {
    init: function() {
        this.syncStatus();
        const usbToggle = document.getElementById('adb-usb-toggle');
        if (usbToggle) usbToggle.onchange = () => this.setUsbPort(usbToggle.checked ? '1' : '0');
        const netToggle = document.getElementById('adbnet-toggle');
        if (netToggle) netToggle.onchange = () => this.setNetAdb(netToggle.checked);
        const applyBtn = document.getElementById('adbnet-apply');
        if (applyBtn) applyBtn.onclick = () => this.applyPort();
    },

    syncStatus: async function() {
        try {
            // USB 调试端口状态（原厂 goform）
            const usbRes = await Api.get('/api/proxy/goform/goform_get_cmd_process?isTest=false&cmd=usb_port_switch&_=' + Date.now());
            const usbOn = !!(usbRes && usbRes.usb_port_switch === '1');
            const usbToggle = document.getElementById('adb-usb-toggle');
            if (usbToggle) usbToggle.checked = usbOn;

            // 网络 ADB 状态
            const netRes = await Api.get('/api/adb-net/status');
            const netOn = !!(netRes && netRes.enabled);
            const netToggle = document.getElementById('adbnet-toggle');
            const portInput = document.getElementById('adbnet-port');
            const desc = document.getElementById('adbnet-desc');
            if (netToggle) netToggle.checked = netOn;
            if (portInput && netRes && netRes.port > 0) portInput.value = netRes.port;
            if (desc) {
                desc.textContent = netOn
                    ? `已开启 · adb connect ${window.location.hostname}:${(netRes && netRes.port) || 5555}`
                    : '开启后可通过 adb connect 连接';
            }

            const badge = document.getElementById('adb-status-badge');
            if (badge) {
                const st = usbOn && netOn ? 'USB + 网络' : (usbOn ? '仅 USB' : (netOn ? '仅网络' : '已关闭'));
                badge.textContent = st;
                badge.style.cssText = (usbOn || netOn)
                    ? 'background:#f6ffed; border-color:#b7eb8f; color:#52c41a;'
                    : 'background:#fff1f0; border-color:#ffa39e; color:#f5222d;';
            }
        } catch (e) {
            console.error("ADB Sync Error:", e);
        }
    },

    setUsbPort: async function(value) {
        try {
            const res = await Api.post('/api/proxy/goform/goform_set_cmd_process', {
                goformId: 'USB_PORT_SETTING', isTest: 'false', usb_port_switch: value
            });
            if (!(res && res.result === 'success')) {
                showAlert('USB 调试端口操作失败: ' + (res?.result || '未知错误'));
            }
        } catch (e) {
            showAlert('操作请求失败: ' + e.message);
        }
        this.syncStatus();
    },

    currentPort: function() {
        const el = document.getElementById('adbnet-port');
        const v = el ? parseInt(el.value, 10) : 5555;
        return (v >= 1 && v <= 65535) ? v : 5555;
    },

    setNetAdb: async function(enable) {
        try {
            const res = await Api.post('/api/adb-net/action', { enable, port: this.currentPort() });
            if (res && res.result === 'success') {
                showAlert(enable ? '网络 ADB 已开启' : '网络 ADB 已关闭');
            } else {
                showAlert('网络 ADB 操作失败');
            }
        } catch (e) {
            showAlert('操作请求失败: ' + e.message);
        }
        this.syncStatus();
    },

    applyPort: async function() {
        const netToggle = document.getElementById('adbnet-toggle');
        const enable = !!(netToggle && netToggle.checked);
        try {
            const res = await Api.post('/api/adb-net/action', { enable, port: this.currentPort() });
            showAlert(res && res.result === 'success' ? '端口已应用' : '端口应用失败');
        } catch (e) {
            showAlert('操作请求失败: ' + e.message);
        }
        this.syncStatus();
    }
};
