/**
 * Samba Module
 */
const SambaModule = {
    init() {
        this.syncStatus();
    },

    async syncStatus() {
        try {
            const data = await Api.get('/api/proxy/goform/goform_get_cmd_process?isTest=false&cmd=samba_switch&_=' + Date.now());
            if (data && data.samba_switch !== undefined) {
                const sambaSwitch = document.getElementById('samba-switch');
                const statusTxt = document.getElementById('samba-status-text');
                const isEnabled = data.samba_switch === "1";

                if (sambaSwitch) {
                    sambaSwitch.checked = isEnabled;
                    if (!sambaSwitch.dataset.bound) {
                        sambaSwitch.dataset.bound = "true";
                        sambaSwitch.onchange = async () => {
                            const targetVal = sambaSwitch.checked ? "1" : "0";
                            const res = await Api.post('/api/proxy/goform/goform_set_cmd_process', {
                                goformId: 'SAMBA_SETTING',
                                isTest: 'false',
                                samba_switch: targetVal,
                                AD: '6843369B3BD55899E4087F0F6DE4FDA6541AB6AF0B2BCC3829591E420BE853D5'
                            });
                            if (res && res.result === 'success') {
                                if (statusTxt) {
                                    statusTxt.textContent = sambaSwitch.checked ? "服务已运行" : "服务已关闭";
                                    statusTxt.style.color = sambaSwitch.checked ? "var(--success)" : "var(--text-sub)";
                                }
                            } else {
                                showAlert("Samba 设置失败");
                                sambaSwitch.checked = !sambaSwitch.checked;
                            }
                        };
                    }
                }
                if (statusTxt) {
                    statusTxt.textContent = isEnabled ? "服务已运行" : "服务已关闭";
                    statusTxt.style.color = isEnabled ? "var(--success)" : "var(--text-sub)";
                }
            }
        } catch (e) {
            console.error("Sync Samba status failed", e);
        }
    }
};
