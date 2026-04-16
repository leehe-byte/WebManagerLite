/**
 * LAN 页面专用逻辑 - MTU 增强版
 */
const LanModule = {
    async init() {
        console.log("LAN Module Initializing...");
        this.bindEvents();
        await this.fetchData();
    },

    bindEvents() {
        // DHCP 开关逻辑
        const dhcpSwitch = document.getElementById('dhcp-server-switch');
        const dhcpSection = document.getElementById('dhcp-config-section');
        if (dhcpSwitch) {
            dhcpSwitch.onchange = () => {
                dhcpSection.style.display = dhcpSwitch.checked ? 'block' : 'none';
            };
        }

        // DHCP 保存按钮
        const applyLanBtn = document.getElementById('apply-lan-settings');
        if (applyLanBtn) {
            applyLanBtn.onclick = async () => {
                await this.saveLanSettings();
            };
        }

        // MTU 保存按钮
        const applyMtuBtn = document.getElementById('apply-mtu-settings');
        if (applyMtuBtn) {
            applyMtuBtn.onclick = async () => {
                await this.saveMtuSettings();
            };
        }
    },

    async fetchData() {
        try {
            const cmd = 'lan_ipaddr,lan_netmask,mac_address,dhcpEnabled,dhcpStart,dhcpEnd,dhcpLease_hour,mtu,tcp_mss';
            const data = await Api.get(`/api/proxy/goform/goform_get_cmd_process?isTest=false&cmd=${encodeURIComponent(cmd)}&multi_data=1&_=${Date.now()}`);
            if (data) {
                this.updateUI(data);
            }
        } catch (e) {
            console.error("Fetch LAN data failed:", e);
        }
    },

    updateUI(data) {
        // DHCP UI
        setVal('lan-ip-input', data.lan_ipaddr);
        setVal('lan-mask-input', data.lan_netmask);
        
        const dhcpSwitch = document.getElementById('dhcp-server-switch');
        const dhcpSection = document.getElementById('dhcp-config-section');
        if (dhcpSwitch) {
            const isEnabled = data.dhcpEnabled === '1';
            dhcpSwitch.checked = isEnabled;
            if (dhcpSection) dhcpSection.style.display = isEnabled ? 'block' : 'none';
        }

        setVal('dhcp-start-ip', data.dhcpStart);
        setVal('dhcp-end-ip', data.dhcpEnd);
        const leaseValue = data.dhcpLease_hour ? data.dhcpLease_hour.replace(/[^\d]/g, '') : '24';
        setVal('dhcp-lease-input', leaseValue);

        // MTU UI
        setVal('mtu-input', data.mtu);
        setVal('mss-input', data.tcp_mss);
    },

    // --- 逻辑校验 ---
    isValidIp(ip) {
        return /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(ip);
    },

    isSameSubnet(ip1, ip2, mask) {
        const ip1Parts = ip1.split('.').map(Number);
        const ip2Parts = ip2.split('.').map(Number);
        const maskParts = mask.split('.').map(Number);
        for (let i = 0; i < 4; i++) {
            if ((ip1Parts[i] & maskParts[i]) !== (ip2Parts[i] & maskParts[i])) return false;
        }
        return true;
    },

    // --- 保存局域网/DHCP 设置 ---
    async saveLanSettings() {
        const lanIp = document.getElementById('lan-ip-input').value;
        const lanMask = document.getElementById('lan-mask-input').value;
        const dhcpStart = document.getElementById('dhcp-start-ip').value;
        const dhcpEnd = document.getElementById('dhcp-end-ip').value;
        const dhcpLease = document.getElementById('dhcp-lease-input').value;
        const dhcpEnabled = document.getElementById('dhcp-server-switch').checked;

        if (!this.isValidIp(lanIp) || !this.isValidIp(lanMask)) {
            await showAlert("请输入有效的局域网 IP 地址和子网掩码");
            return;
        }

        if (dhcpEnabled) {
            if (!this.isValidIp(dhcpStart) || !this.isValidIp(dhcpEnd)) {
                await showAlert("请输入有效的 DHCP 地址池范围");
                return;
            }
            if (!this.isSameSubnet(lanIp, dhcpStart, lanMask) || !this.isSameSubnet(lanIp, dhcpEnd, lanMask)) {
                await showAlert("局域网 IP 与 DHCP 地址池必须在同一网段！");
                return;
            }
        }

        const msg = "您的设置将在设备重启后生效。您要继续吗？<br/><br/><b>注意：</b>选择确定将提交请求并重启设备。";
        const confirmed = await showConfirm(msg, "更改局域网设置");
        if (!confirmed) return;

        const btn = document.getElementById('apply-lan-settings');
        btn.disabled = true;
        btn.textContent = '处理中...';

        try {
            const params = {
                goformId: 'DHCP_SETTING',
                lanIp: lanIp,
                lanNetmask: lanMask,
                lanDhcpType: dhcpEnabled ? 'SERVER' : 'DISABLE',
                dhcpStart: dhcpStart,
                dhcpEnd: dhcpEnd,
                dhcpLease: dhcpLease,
                dhcp_reboot_flag: '1',
                mac_ip_reset: '1'
            };
            const res = await Api.post('/api/proxy/goform/goform_set_cmd_process', params);
            if (res && res.result === 'success') {
                await showAlert("设置成功！设备正在重启，请稍后使用新 IP 访问。", "操作成功");
            } else {
                await showAlert("保存失败: " + (res?.msg || "网关未响应"));
            }
        } catch (e) {
            await showAlert("网络异常: " + e.message);
        } finally {
            btn.disabled = false;
            btn.textContent = '保存并应用';
        }
    },

    // --- 保存 MTU 设置 ---
    async saveMtuSettings() {
        const mtu = document.getElementById('mtu-input').value;
        const mss = document.getElementById('mss-input').value;

        if (!mtu || mtu < 576 || mtu > 1500) {
            await showAlert("MTU 范围通常在 576 - 1500 之间");
            return;
        }

        const msg = "MTU 大小与运营商的网络设置有关。除非您非常熟悉网络参数，否则不建议对其进行修改。<br/><br/>修改后设备将重启，是否继续？";
        const confirmed = await showConfirm(msg, "更改 MTU 设置");
        if (!confirmed) return;

        const btn = document.getElementById('apply-mtu-settings');
        btn.disabled = true;
        btn.textContent = '处理中...';

        try {
            const params = {
                goformId: 'SET_DEVICE_MTU',
                mtu: mtu,
                tcp_mss: mss
            };
            const res = await Api.post('/api/proxy/goform/goform_set_cmd_process', params);
            if (res && res.result === 'success') {
                await showAlert("MTU 设置已应用，设备正在重启。", "操作成功");
            } else {
                await showAlert("设置失败: " + (res?.msg || "网关未响应"));
            }
        } catch (e) {
            await showAlert("网络异常: " + e.message);
        } finally {
            btn.disabled = false;
            btn.textContent = '保存 MTU 设置';
        }
    }
};

function setVal(id, val) { 
    const el = document.getElementById(id); 
    if (el && val !== undefined) el.value = val; 
}
