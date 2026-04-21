/**
 * NetInfo 模块 - 网络详情、设备管理、黑名单及高级网络设置
 */
const NetInfoModule = {
    timer: null,

    init() {
        this.sync();
        if (this.timer) clearInterval(this.timer);
        this.timer = setInterval(() => this.sync(), 3000);

        // 延迟执行一次性初始化逻辑
        setTimeout(() => {
            this.bindEvents();
            this.checkFeatures();
            this.checkDualSim();
            this.fetchUsbStatus();
            this.syncNfcStatus();
        }, 100);
    },

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    },

    async sync() {
        try {
            const combinedNetCmds = 'network_information,Lte_ca_status,station_list,network_provider_fullname,network_provider,wan_ipaddr,ipv6_wan_ipaddr,ppp_status,roam_setting_option,sim_slot,queryDeviceAccessControlList,network_net_select,net_select,web_wifi_nfc_switch';
            const data = await Api.get(`/api/proxy/goform/goform_get_cmd_process?isTest=false&cmd=${encodeURIComponent(combinedNetCmds)}&multi_data=1&_=${Date.now()}`);
            if (data) {
                // 1. 设备列表
                const listBody = document.getElementById('device-list-body');
                if (listBody && data.station_list) {
                    setText('device-count-badge', `${data.station_list.length} 台设备`);
                    listBody.innerHTML = data.station_list.map(dev => `
                        <tr>
                            <td style="padding: 12px 0;">
                                <div style="font-weight: 500;">${dev.hostname || '未知设备'}</div>
                                <div style="font-size: 10px; color: #999;">${dev.mac_addr.toUpperCase()}</div>
                            </td>
                            <td><code>${dev.ip_addr}</code></td>
                            <td style="text-align: right;">
                                <button class="badge" style="background:#fff1f0; color:#f5222d; border-color:#ffa39e; cursor:pointer;" onclick="NetInfoModule.addToBlacklist('${dev.mac_addr}', '${dev.hostname}')">拉黑</button>
                            </td>
                        </tr>
                    `).join('') || '<tr><td colspan="3" style="text-align:center; padding:20px;">暂无连接设备</td></tr>';
                }

                // 2. 黑名单
                if (data.BlackMacList !== undefined) {
                    dataStore.blackMacs = data.BlackMacList;
                    dataStore.blackNames = data.BlackNameList;
                    const macs = data.BlackMacList.split(';').filter(x => x);
                    const names = data.BlackNameList.split(';').filter(x => x);
                    setText('blacklist-count-badge', `${macs.length} 台`);
                    const blackBody = document.getElementById('blacklist-body');
                    if (blackBody) {
                        if (macs.length === 0) {
                            blackBody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:20px; color:#999;">无黑名单记录</td></tr>';
                        } else {
                            blackBody.innerHTML = macs.map((mac, i) => `
                                <tr>
                                    <td>${names[i] || '未知'}</td>
                                    <td><code style="font-size:11px;">${mac.toUpperCase()}</code></td>
                                    <td style="text-align: right;">
                                        <button class="badge" style="background:#f6ffed; color:#52c41a; border-color:#b7eb8f; cursor:pointer;" onclick="NetInfoModule.removeFromBlacklist('${mac}', '${names[i] || ""}')">移出</button>
                                    </td>
                                </tr>
                            `).join('');
                        }
                    }
                }

                // 3. 数据连接状态
                const dataSwitch = document.getElementById('ctrl-data-switch');
                const dataStatusTxt = document.getElementById('ctrl-data-status');
                const roamSwitch = document.getElementById('ctrl-roam-switch');
                if (dataSwitch) {
                    const pppStatus = data.ppp_status || "";
                    const isConnected = pppStatus.includes('connected') && !pppStatus.includes('disconnected');
                    dataSwitch.checked = isConnected;
                    if (dataStatusTxt) {
                        dataStatusTxt.textContent = isConnected ? "已连接" : "已断开";
                        dataStatusTxt.style.color = isConnected ? "var(--success)" : "var(--text-sub)";
                    }
                }
                if (roamSwitch) roamSwitch.checked = data.roam_setting_option === 'on' || data.dial_roam_setting_option === 'on';
                
                // 4. SIM 卡槽
                if (data.sim_slot !== undefined) {
                    const slot = parseInt(data.sim_slot);
                    document.getElementById('sim-btn-0')?.classList.toggle('active', slot === 0);
                    document.getElementById('sim-btn-1')?.classList.toggle('active', slot === 1);
                }

                // 5. 网络模式
                const netSelect = data.network_net_select || data.net_select || "";
                if (netSelect) {
                    const pickerBtn = document.getElementById('net-mode-picker-btn');
                    if (pickerBtn && pickerBtn.dataset.pending !== "true") {
                        pickerBtn.dataset.value = netSelect;
                        const labels = {
                            'WL_AND_5G': '5G/4G/3G',
                            'LTE_AND_5G': '仅 5G NSA',
                            'Only_5G': '仅 5G SA',
                            'WCDMA_AND_LTE': '4G/3G',
                            'Only_LTE': '仅 4G',
                            'Only_WCDMA': '仅 3G'
                        };
                        pickerBtn.textContent = labels[netSelect] || netSelect;
                    }
                }

                // 6. 蜂窝详情
                const is5G = netSelect.includes('5G');
                const isSA = netSelect.includes('Only_5G');
                let typeTag = is5G ? (isSA ? "5G SA" : "5G NSA") : "4G";
                let modeText = is5G ? "NR" : "LTE-Advanced";
                setText('det-net-type-tag', typeTag);
                setText('det-net-mode', modeText);
                const band = is5G ? (data.Nr_bands || data.Lte_bands) : data.Lte_bands;
                const fcn = is5G ? (data.Nr_fcn || data.Lte_fcn) : data.Lte_fcn;
                const pci = is5G ? (data.Nr_pci || data.Lte_pci) : data.Lte_pci;
                const cellId = is5G ? (data.Nr_cell_id || data.Lte_cell_id) : data.Lte_cell_id;
                const bw = is5G ? (data.Nr_band_widths || data.Lte_bands_widths) : data.Lte_bands_widths;
                setText('det-band', band);
                setText('det-fcn', fcn);
                setText('det-pci', pci);
                setText('det-cell-id', cellId);
                setText('det-bandwidth', bw ? (parseInt(bw)/1000 + " MHz") : null);
                
                const rsrp = parseInt(is5G ? (data.nr_rsrp || data.lte_rsrp) : data.lte_rsrp) || -140;
                const rssi = parseInt(is5G ? (data.Nr_signal_strength || data.Lte_signal_strength) : data.Lte_signal_strength) || -140;
                const rsrq = parseFloat(is5G ? (data.nr_rsrq || data.lte_rsrq) : data.lte_rsrq) || -20;
                const sinr = parseFloat(is5G ? (data.Nr_snr || data.Lte_snr) : data.Lte_snr) || -10;
                
                this.updateSignalBar('rsrp', rsrp, -140, -40, 'dBm');
                this.updateSignalBar('rssi', rssi, -120, -30, 'dBm');
                this.updateSignalBar('rsrq', rsrq, -20, -3, 'dB');
                this.updateSignalBar('sinr', sinr, -10, 30, 'dB');

                document.getElementById('row-cell-id').style.display = cellId ? 'table-row' : 'none';
                document.getElementById('row-bandwidth').style.display = bw ? 'table-row' : 'none';
                document.getElementById('row-rssi').style.display = (rssi !== -140) ? 'table-row' : 'none';

                if (dataStore.qos_loaded) {
                    setText('det-qci', dataStore.last_qci);
                    setText('det-qos-dl', dataStore.last_qos_dl);
                    setText('det-qos-ul', dataStore.last_qos_ul);
                } else {
                    this.queryQosRate();
                }
            }
        } catch (e) {
            console.error("Sync NetInfo failed", e);
        }
    },

    updateSignalBar(id, val, min, max, unit) {
        const txt = document.getElementById(`txt-${id}`);
        const bar = document.getElementById(`bar-${id}`);
        if (!txt || !bar) return;
        let percent = ((val - min) / (max - min)) * 100;
        percent = Math.min(Math.max(percent, 0), 100);
        let status = "";
        if (id === 'rsrp') {
            if (val > -80) status = "优";
            else if (val > -95) status = "好";
            else if (val > -110) status = "中";
            else status = "差";
        }
        txt.textContent = `${val}${unit} ${status}`;
        bar.style.width = percent + "%";
    },

    async queryQosRate() {
        if (dataStore.qos_loading || dataStore.qos_loaded) return;
        dataStore.qos_loading = true;
        try {
            const res = await Api.get('/api/at/send?cmd=AT%2BCGEQOSRDP%3D1');
            if (res && res.result) {
                if (res.result.includes('ERROR')) return;
                const match = res.result.match(/\+*CGEQOSRDP:.*?,(\d+),.*?,.*?,.*?,.*?,(\d+),(\d+)/);
                if (match) {
                    const qci = parseInt(match[1]);
                    const dl = parseInt(match[2]);
                    const ul = parseInt(match[3]);
                    dataStore.last_qci = (qci).toString(16).toUpperCase();
                    dataStore.last_qos_dl = (dl / 1000).toFixed(1) + " Mbps";
                    dataStore.last_qos_ul = (ul / 1000).toFixed(1) + " Mbps";
                    setText('det-qci', dataStore.last_qci);
                    setText('det-qos-dl', dataStore.last_qos_dl);
                    setText('det-qos-ul', dataStore.last_qos_ul);
                    dataStore.qos_loaded = true;
                }
            }
        } catch (e) {} finally {
            dataStore.qos_loading = false;
        }
    },

    bindEvents() {
        const dataSwitch = document.getElementById('ctrl-data-switch');
        if (dataSwitch && !dataSwitch.dataset.bound) {
            dataSwitch.dataset.bound = "true";
            dataSwitch.onchange = async () => {
                const goformId = dataSwitch.checked ? 'CONNECT_NETWORK' : 'DISCONNECT_NETWORK';
                await Api.post('/api/proxy/goform/goform_set_cmd_process', { isTest: 'false', notCallback: 'true', goformId: goformId });
                setTimeout(() => this.sync(), 1000);
            };
        }
        const roamSwitch = document.getElementById('ctrl-roam-switch');
        if (roamSwitch && !roamSwitch.dataset.bound) {
            roamSwitch.dataset.bound = "true";
            roamSwitch.onchange = async () => {
                const val = roamSwitch.checked ? 'on' : 'off';
                await Api.post('/api/proxy/goform/goform_set_cmd_process', { isTest: 'false', goformId: 'SET_CONNECTION_MODE', ConnectionMode: 'auto_dial', dial_roam_setting_option: val });
                setTimeout(() => this.sync(), 1000);
            };
        }
    },

    async checkFeatures() {
        try {
            const data = await Api.get('/api/status');
            const isF50 = data && data.model === "F50";
            const nfcSection = document.getElementById('nfc-section');
            if (nfcSection) nfcSection.style.display = isF50 ? 'none' : 'flex';
            const sleepSection = document.getElementById('sleep-section');
            if (sleepSection) sleepSection.style.display = isF50 ? 'none' : 'block';
        } catch (e) {}
    },

    async checkDualSim() {
        try {
            const statusData = await Api.get('/api/status');
            const isF50 = statusData && statusData.model === "F50";
            if (isF50) {
                const container = document.getElementById('ctrl-sim-container');
                if (container) container.style.display = 'none';
                return;
            }
            const data = await Api.get('/api/proxy/goform/goform_get_cmd_process?isTest=false&cmd=dual_sim_support&_=' + Date.now());
            if (data && data.dual_sim_support === "1") {
                const container = document.getElementById('ctrl-sim-container');
                if (container) container.style.display = 'flex';
            }
        } catch (e) {}
    },

    // USB 协议
    async fetchUsbStatus() {
        try {
            const data = await Api.get('/api/proxy/goform/goform_get_cmd_process?isTest=false&multi_data=1&cmd=usb_network_protocal&_=' + Date.now());
            if (data && data.usb_network_protocal !== undefined) {
                const btn = document.getElementById('usb-picker-btn');
                if (btn && btn.dataset.pending === "true") return;
                dataStore.usb_proto = String(data.usb_network_protocal);
                this.updateUsbLabel(dataStore.usb_proto);
            }
        } catch (e) {}
    },

    updateUsbLabel(val) {
        const labels = { "0": "自动", "1": "RNDIS", "2": "CDC-ECM" };
        setText('usb-picker-btn', labels[val] || "未知");
    },

    showUsbPicker() {
        const options = [{ label: '自动', value: '0' }, { label: 'RNDIS', value: '1' }, { label: 'CDC-ECM', value: '2' }];
        ApiExtra.showPicker('选择 USB 上网协议', options, dataStore.usb_proto, (val, label) => {
            dataStore.usb_proto = val;
            this.updateUsbLabel(val);
            const btn = document.getElementById('usb-picker-btn');
            btn.dataset.pending = "true";
            btn.style.borderColor = "var(--warning)";
        });
    },

    async applyUsbSetting() {
        const labels = { "0": "自动", "1": "RNDIS", "2": "CDC-ECM" };
        const label = labels[dataStore.usb_proto];
        if (await showConfirm(`确认将协议切换为【${label}】吗？设置后设备将立即重启以生效。`)) {
            const res = await Api.post('/api/proxy/goform/goform_set_cmd_process', { isTest: 'false', goformId: 'SET_USB_NETWORK_PROTOCAL', usb_network_protocal: dataStore.usb_proto });
            if (res && res.result === 'success') {
                const btn = document.getElementById('usb-picker-btn');
                btn.removeAttribute('data-pending');
                btn.style.borderColor = "var(--border-color)";
                await Api.post('/api/proxy/goform/goform_set_cmd_process', { isTest: 'false', goformId: 'REBOOT_DEVICE' });
                showAlert("设置成功，设备正在重启...", "成功");
            }
        }
    },

    // NFC
    async syncNfcStatus() {
        try {
            const data = await Api.get('/api/proxy/goform/goform_get_cmd_process?isTest=false&cmd=web_wifi_nfc_switch&multi_data=1&_=' + Date.now());
            if (data && data.web_wifi_nfc_switch !== undefined) {
                const nfcSwitch = document.getElementById('ctrl-nfc-switch');
                const nfcStatusTxt = document.getElementById('ctrl-nfc-status');
                const isEnabled = data.web_wifi_nfc_switch === "1";
                if (nfcSwitch) {
                    nfcSwitch.checked = isEnabled;
                    if (!nfcSwitch.dataset.bound) {
                        nfcSwitch.dataset.bound = "true";
                        nfcSwitch.onchange = async () => {
                            const targetVal = nfcSwitch.checked ? "1" : "0";
                            const res = await Api.post('/api/proxy/goform/goform_set_cmd_process', { isTest: 'false', goformId: 'WIFI_NFC_SET', web_wifi_nfc_switch: targetVal, AD: '54B9A0BCB161006EFDA2D75489402B11C2E76BC8306D424860D34E591141F68C' });
                            if (res && res.result === 'success') {
                                if (nfcStatusTxt) {
                                    nfcStatusTxt.textContent = nfcSwitch.checked ? "已开启" : "已关闭";
                                    nfcStatusTxt.style.color = nfcSwitch.checked ? "var(--success)" : "var(--text-sub)";
                                }
                            } else {
                                showAlert("NFC 设置失败");
                                nfcSwitch.checked = !nfcSwitch.checked;
                            }
                        };
                    }
                }
                if (nfcStatusTxt) {
                    nfcStatusTxt.textContent = isEnabled ? "已开启" : "已关闭";
                    nfcStatusTxt.style.color = isEnabled ? "var(--success)" : "var(--text-sub)";
                }
            }
        } catch (e) {}
    },

    // 网络模式
    showNetModePicker() {
        const btn = document.getElementById('net-mode-picker-btn');
        const current = btn.dataset.value;
        const options = [{ label: '5G/4G/3G', value: 'WL_AND_5G' }, { label: '仅 5G NSA', value: 'LTE_AND_5G' }, { label: '仅 5G SA', value: 'Only_5G' }, { label: '4G/3G', value: 'WCDMA_AND_LTE' }, { label: '仅 4G', value: 'Only_LTE' }, { label: '仅 3G', value: 'Only_WCDMA' }];
        ApiExtra.showPicker('选择网络模式', options, current, (val, label) => {
            btn.dataset.value = val;
            btn.textContent = label;
            btn.dataset.pending = "true";
            btn.style.borderColor = "var(--warning)";
        });
    },

    async applyNetMode() {
        const btn = document.getElementById('net-mode-picker-btn');
        const val = btn.dataset.value;
        const label = btn.textContent;
        if (await showConfirm(`确定要将网络模式切换为【${label}】吗？设备网络将重新初始化。`)) {
            const res = await Api.post('/api/proxy/goform/goform_set_cmd_process', { isTest: 'false', goformId: 'SET_BEARER_PREFERENCE', BearerPreference: val });
            if (res && res.result === 'success') {
                btn.removeAttribute('data-pending');
                btn.style.borderColor = "var(--border-color)";
                showAlert("指令已下发，请稍候...");
                setTimeout(() => this.sync(), 2000);
            }
        }
    },

    // 卡槽切换
    async switchSim(targetSlot) {
        const msg = targetSlot === 1 ? "确认切换到【内置卡】吗？" : "确认切换到【插拔卡】吗？";
        if (await showConfirm(msg)) {
            const res = await Api.post('/api/proxy/goform/goform_set_cmd_process', { isTest: 'false', goformId: 'SET_SIM_SLOT', sim_slot: targetSlot });
            if (res && res.result === 'success') {
                showAlert("切换指令已发送，设备网络将重新初始化");
                setTimeout(() => this.sync(), 2000);
            }
        }
    },

    // 黑名单操作
    async addToBlacklist(mac, name) {
        if (!await showConfirm(`确定要拉黑设备【${name || mac}】吗？拉黑后该设备将无法连接 WiFi。`)) return;
        let newMacs = dataStore.blackMacs + mac + ";";
        let newNames = dataStore.blackNames + (name || "Unknown") + ";";
        this.submitBlacklist(newMacs, newNames);
    },

    async removeFromBlacklist(mac, name) {
        if (!await showConfirm(`确定要将设备【${name || mac}】从黑名单中移出吗？`)) return;
        let newMacs = dataStore.blackMacs.replace(mac + ";", "");
        let newNames = dataStore.blackNames.replace((name || "Unknown") + ";", "");
        this.submitBlacklist(newMacs, newNames);
    },

    async submitBlacklist(macs, names) {
        const res = await Api.post('/api/proxy/goform/goform_set_cmd_process', { goformId: 'setDeviceAccessControlList', isTest: 'false', AclMode: '2', WhiteMacList: '', BlackMacList: macs, WhiteNameList: '', BlackNameList: names });
        if (res && res.result === 'success') {
            showAlert("操作成功，设置已应用");
            setTimeout(() => this.sync(), 1000);
        } else {
            showAlert("操作失败，请检查连接");
        }
    }
};

// 全局暴露以供 HTML 调用
window.showUsbPicker = () => NetInfoModule.showUsbPicker();
window.applyUsbSetting = () => NetInfoModule.applyUsbSetting();
window.showNetModePicker = () => NetInfoModule.showNetModePicker();
window.applyNetMode = () => NetInfoModule.applyNetMode();
window.switchSim = (slot) => NetInfoModule.switchSim(slot);
window.addToBlacklist = (mac, name) => NetInfoModule.addToBlacklist(mac, name);
window.removeFromBlacklist = (mac, name) => NetInfoModule.removeFromBlacklist(mac, name);
