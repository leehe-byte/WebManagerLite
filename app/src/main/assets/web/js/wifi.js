/**
 * WiFi Management Module v5.1 - 适配自定义选择器 (Picker)
 */
const WifiModule = {
    apData: [],
    currentMode: 'off',
    currentAuth: 'WPA2PSK',

    async init() {
        console.log("WiFi Module Initializing...");
        await this.fetchData();
    },

    async fetchData() {
        try {
            const url = `/api/proxy/goform/goform_get_cmd_process?isTest=false&cmd=queryAccessPointInfo&_=${Date.now()}`;
            const data = await Api.get(url);
            if (data && data.ResponseList) {
                this.apData = data.ResponseList;
                this.updateUI();
            }
        } catch (e) {
            console.error("Fetch WiFi data failed:", e);
        }
    },

    updateUI() {
        const ap0 = this.apData[0];
        const ap1 = this.apData[1];
        if (!ap0 || !ap1) return;

        // 1. 识别并同步模式
        if (ap0.AccessPointSwitchStatus === "1") this.currentMode = '2.4';
        else if (ap1.AccessPointSwitchStatus === "1") this.currentMode = '5';
        else this.currentMode = 'off';

        const modeBtn = document.getElementById('wifi-mode-picker-btn');
        if (modeBtn) {
            const modeLabels = { 'off': '关闭 WiFi', '2.4': '开启 2.4GHz', '5': '开启 5GHz' };
            modeBtn.textContent = modeLabels[this.currentMode];
            modeBtn.dataset.value = this.currentMode;
        }

        // 2. 填充表单内容
        const activeAp = (this.currentMode === '5') ? ap1 : ap0;
        this.currentAuth = activeAp.AuthMode;
        this.fillFormFields(activeAp);
        this.refreshStatusDisplay();
    },

    fillFormFields(ap) {
        if (!ap) return;
        setVal('wifi-ssid', ap.SSID);
        setVal('wifi-max-station', ap.ApMaxStationNumber);
        
        // 同步加密模式按钮显示
        const authBtn = document.getElementById('wifi-auth-picker-btn');
        if (authBtn) {
            const authLabels = { 'OPEN': '无密码 (OPEN)', 'WPA2PSK': 'WPA2-PSK', 'WPA3PSK': 'WPA3-SAE', 'WPA2PSKWPA3PSK': 'WPA2/WPA3 混合' };
            authBtn.textContent = authLabels[ap.AuthMode] || ap.AuthMode;
            authBtn.dataset.value = ap.AuthMode;
        }

        const broadcastCheckbox = document.getElementById('wifi-broadcast');
        if (broadcastCheckbox) broadcastCheckbox.checked = ap.ApBroadcastDisabled === "0";

        const passInput = document.getElementById('wifi-password');
        if (passInput && ap.Password) {
            try { passInput.value = atob(ap.Password); } catch (e) { passInput.value = ap.Password; }
        }
    },

    // --- 唤起自定义选择器 ---
    showModePicker() {
        const options = [
            { label: '关闭 WiFi', value: 'off' },
            { label: '开启 2.4GHz', value: '2.4' },
            { label: '开启 5GHz', value: '5' }
        ];
        ApiExtra.showPicker('选择 WiFi 模式', options, this.currentMode, (val, label) => {
            const btn = document.getElementById('wifi-mode-picker-btn');
            btn.textContent = label;
            btn.dataset.value = val;
            this.onModeChange(val);
        });
    },

    showAuthPicker() {
        const options = [
            { label: '无密码 (OPEN)', value: 'OPEN' },
            { label: 'WPA2-PSK', value: 'WPA2PSK' },
            { label: 'WPA3-SAE', value: 'WPA3PSK' },
            { label: 'WPA2/WPA3 混合', value: 'WPA2PSKWPA3PSK' }
        ];
        ApiExtra.showPicker('选择加密模式', options, this.currentAuth, (val, label) => {
            const btn = document.getElementById('wifi-auth-picker-btn');
            btn.textContent = label;
            btn.dataset.value = val;
            this.currentAuth = val;
            this.markAsDirty();
        });
    },

    refreshStatusDisplay() {
        const statusEl = document.getElementById('wifi-global-status');
        const fieldsArea = document.getElementById('wifi-config-fields');
        if (this.currentMode === 'off') {
            statusEl.textContent = "WiFi 已关闭";
            statusEl.style.color = "var(--text-sub)";
            if (fieldsArea) fieldsArea.style.opacity = "0.5";
        } else {
            statusEl.textContent = `${this.currentMode}GHz 已开启`;
            statusEl.style.color = "var(--success)";
            if (fieldsArea) fieldsArea.style.opacity = "1";
        }
    },

    onModeChange(newMode) {
        this.currentMode = newMode;
        if (newMode === '5' && this.apData[1]) this.fillFormFields(this.apData[1]);
        else if (newMode === '2.4' && this.apData[0]) this.fillFormFields(this.apData[0]);
        this.refreshStatusDisplay();
        this.markAsDirty();
    },

    markAsDirty() {
        const saveBtn = document.getElementById('wifi-save-btn');
        if (saveBtn) {
            saveBtn.textContent = "保存并生效 (待提交)";
            saveBtn.style.background = "var(--warning)";
        }
    },

    togglePass() {
        const input = document.getElementById('wifi-password');
        const icon = input.nextElementSibling;
        if (input.type === 'password') {
            input.type = 'text'; icon.textContent = '🔓';
        } else {
            input.type = 'password'; icon.textContent = '🔒';
        }
    },

    async save() {
        const confirmed = await showConfirm("修改 WiFi 将导致无线连接断开，是否继续？");
        if (!confirmed) return;

        const btn = document.getElementById('wifi-save-btn');
        btn.disabled = true;
        btn.textContent = '正在提交...';

        try {
            const targetChip = (this.currentMode === '5') ? 1 : 0;
            const authMode = this.currentAuth;
            const rawPass = document.getElementById('wifi-password').value;

            const params = {
                goformId: 'setAccessPointInfo',
                isTest: 'false',
                ChipIndex: targetChip.toString(),
                AccessPointIndex: '0',
                SSID: document.getElementById('wifi-ssid').value,
                ApIsolate: '0',
                AuthMode: authMode,
                ApBroadcastDisabled: document.getElementById('wifi-broadcast').checked ? '0' : '1',
                ApMaxStationNumber: document.getElementById('wifi-max-station').value,
                EncrypType: (authMode === 'OPEN') ? 'NONE' : 'CCMP',
                Password: btoa(rawPass)
            };

            const res = await Api.post('/api/proxy/goform/goform_set_cmd_process', params);
            if (res && (res.result === 'success' || res.result === '0')) {
                await showAlert("WiFi 设置已提交！请等待无线服务重启。", "保存成功");
                setTimeout(() => location.reload(), 2000);
            } else {
                await showAlert("保存失败: " + (res?.result || "未知错误"));
            }
        } catch (e) {
            await showAlert("网络异常: " + e.message);
        } finally {
            btn.disabled = false;
            btn.textContent = '保存 WiFi 修改';
            btn.style.background = "var(--primary)";
        }
    }
};
