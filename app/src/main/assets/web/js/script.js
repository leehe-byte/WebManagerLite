/**
 * BridgeLink Manager v2.0.3 - 修复默认启动页与选择器样式
 */
document.addEventListener('DOMContentLoaded', () => {
	if (sessionStorage.getItem('isLoggedIn') !== 'true') {
		window.location.href = 'login.html';
		return;
	}
	initAppEngine();
});

let activeTimer = null;
let dataStore = {
	blackMacs: "",
	blackNames: "",
	qos_loaded: false,
	last_qci: "--",
	last_qos_dl: "-- Mbps",
	last_qos_ul: "-- Mbps"
};

async function initAppEngine() {
	initNavigation();
	initMobileEvents();
	initModalControls();
    initThemeControl();

	// 默认启动页重定向
	const savedStartPage = localStorage.getItem('default_start_page') || 'overview';
	const initialPage = window.location.hash.replace('#', '') || savedStartPage;

	loadPage(initialPage);

	window.onhashchange = () => {
		const pageId = window.location.hash.replace('#', '') || 'overview';
		const currentActive = document.querySelector('.nav-item.active')?.getAttribute('data-page');
		if (pageId !== currentActive) loadPage(pageId);
	};
	document.getElementById('logout-btn').onclick = () => {
		sessionStorage.clear();
		window.location.href = 'login.html';
	};
}

function initThemeControl() {
    const themeBtn = document.getElementById('theme-btn');
    if (!themeBtn) return;
    
    themeBtn.onclick = () => {
        const current = localStorage.getItem('theme') || 'auto';
        const options = [
            { label: '浅色模式', value: 'light' },
            { label: '深色模式', value: 'dark' },
            { label: '跟随系统', value: 'auto' }
        ];
        ApiExtra.showPicker('切换主题', options, current, (val) => {
            localStorage.setItem('theme', val);
            applyTheme(val);
        });
    };

    // 监听系统主题变化
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
        if (localStorage.getItem('theme') === 'auto') {
            applyTheme('auto');
        }
    });
}

function applyTheme(theme) {
    if (theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.setAttribute('data-theme', 'dark');
    } else {
        document.documentElement.removeAttribute('data-theme');
    }
}

async function loadPage(pageId) {
	const contentArea = document.getElementById('content');
	if (!contentArea) return;
	if (activeTimer) clearInterval(activeTimer);
	try {
		const response = await fetch(`pages/${pageId}.html`);
		if (!response.ok) throw new Error('Page not found');
		const html = await response.text();
		contentArea.innerHTML = html;

		updateActiveNavItem(pageId);

		const activeItem = document.querySelector(`.nav-item[data-page="${pageId}"]`);
		if (activeItem) {
			const parentGroup = activeItem.closest('.section-content');
			if (parentGroup) {
				const header = parentGroup.previousElementSibling;
				if (header && header.classList.contains('collapsible')) {
					header.classList.remove('closed');
				}
			}
		}

		initPageLogic(pageId);
		if (window.location.hash !== '#' + pageId) window.location.hash = pageId;
	} catch (e) {
		contentArea.innerHTML = `<div class="card"><p style="color:red">页面加载失败: ${pageId}</p></div>`;
	}
}

function initPageLogic(pageId) {
	if (pageId === 'overview') {
		syncOverview();
		activeTimer = setInterval(syncOverview, 3000);
	} else if (pageId === 'lan') {
		if (typeof LanModule !== 'undefined') LanModule.init();
	} else if (pageId === 'mihomo') {
		if (typeof MihomoModule !== 'undefined') {
			MihomoModule.init();
			activeTimer = setInterval(() => MihomoModule.syncStatus(), 3000);
		}
	} else if (pageId === 'samba') {
		if (typeof SambaModule !== 'undefined') {
			SambaModule.init();
			activeTimer = setInterval(() => SambaModule.syncStatus(), 3000);
		}
	} else if (pageId === 'adb') {
		if (typeof AdbModule !== 'undefined') {
			AdbModule.init();
			activeTimer = setInterval(() => AdbModule.syncStatus(), 3000);
		}
	} else if (pageId === 'wifi') {
		if (typeof WifiModule !== 'undefined') WifiModule.init();
	} else if (pageId === 'sms') {
		if (typeof SmsModule !== 'undefined') {
			SmsModule.init();
			activeTimer = setInterval(() => SmsModule.syncStatus(), 3000);
		}
	} else if (pageId === 'at-command') {
		if (typeof AtCommandModule !== 'undefined') AtCommandModule.init();
	} else if (pageId === 'remote') {
		if (typeof RemoteControlModule !== 'undefined') RemoteControlModule.init();
	} else if (pageId === 'power') {
		if (typeof PowerModule !== 'undefined') PowerModule.init();
	} else if (pageId === 'terminal') {
        if (typeof TerminalModule !== 'undefined') TerminalModule.init();
	} else if (pageId === 'about') {
		AboutModule.init();
	} else if (pageId === 'net-info') {
		syncNetInfo();
		activeTimer = setInterval(syncNetInfo, 3000);
		setTimeout(() => {
			bindNetCtrlEvents();
			checkDualSimSupport();
			fetchUsbStatus(); // 初始化 USB 状态
			syncNfcStatus();  // 初始化 NFC 状态
		}, 100);
	}
}

// --- 信号强度帮助提示 ---
window.showSignalHelp = (type) => {
    let content = "";
    if (type === 'rsrp') {
        content = `<b>RSRP (参考信号接收功率)</b><br><br>
        这是衡量网络覆盖的核心指标。<br>
        -80dBm 以上: 信号极强<br>
        -80 至 -95: 信号良好<br>
        -95 至 -110: 信号一般<br>
        -110dBm 以下: 信号较差`;
    } else if (type === 'rssi') {
        content = `<b>RSSI (接收信号强度指示)</b><br><br>
        反映整个频段的总能量强度，包含有用信号、干扰和热噪声。<br>
        与 RSRP 配合看，如果 RSSI 很高但 RSRP 很低，说明当前环境干扰很大。`;
    }
    showAlert(content, "参数说明");
}

// --- About 页面逻辑 ---
const AboutModule = {
	init() {
		const saved = localStorage.getItem('default_start_page') || 'overview';
		const labels = {
			'overview': '状态总览',
			'net-info': '网络详情',
			'power': '电源管理',
			'remote': '远程控制',
			'sms': '短信列表'
		};
		setText('start-page-picker', labels[saved] || '状态总览');
	},
	showStartPagePicker() {
		const options = [{
				label: '状态总览',
				value: 'overview'
			},
			{
				label: '网络详情',
				value: 'net-info'
			},
			{
				label: '电源管理',
				value: 'power'
			},
			{
				label: '远程控制',
				value: 'remote'
			},
			{
				label: '短信列表',
				value: 'sms'
			}
		];
		const current = localStorage.getItem('default_start_page') || 'overview';
		ApiExtra.showPicker('设置默认启动页', options, current, (val, label) => {
			localStorage.setItem('default_start_page', val);
			setText('start-page-picker', label);
			showAlert("设置已保存，下次登录生效");
		});
	}
};

// --- NFC 碰一碰逻辑 ---
async function syncNfcStatus() {
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
                        const res = await Api.post('/api/proxy/goform/goform_set_cmd_process', {
                            isTest: 'false',
                            goformId: 'WIFI_NFC_SET',
                            web_wifi_nfc_switch: targetVal,
                            AD: '54B9A0BCB161006EFDA2D75489402B11C2E76BC8306D424860D34E591141F68C'
                        });
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
    } catch (e) {
        console.error("Sync NFC status failed", e);
    }
}

// --- USB 协议逻辑 ---
async function fetchUsbStatus() {
	try {
		const data = await Api.get('/api/proxy/goform/goform_get_cmd_process?isTest=false&multi_data=1&cmd=usb_network_protocal&_=' + Date.now());
		if (data && data.usb_network_protocal !== undefined) {
            const btn = document.getElementById('usb-picker-btn');
            if (btn && btn.dataset.pending === "true") return;

			dataStore.usb_proto = String(data.usb_network_protocal);
			updateUsbPickerLabel(dataStore.usb_proto);
		}
	} catch (e) {
        console.error("Fetch USB status failed", e);
    }
}

function updateUsbPickerLabel(val) {
	const labels = {
		"0": "自动",
		"1": "RNDIS",
		"2": "CDC-ECM"
	};
	setText('usb-picker-btn', labels[val] || "未知");
}

window.showUsbPicker = () => {
    const btn = document.getElementById('usb-picker-btn');
	const options = [{
		label: '自动',
		value: '0'
	}, {
		label: 'RNDIS',
		value: '1'
	}, {
		label: 'CDC-ECM',
		value: '2'
	}];
	ApiExtra.showPicker('选择 USB 上网协议', options, dataStore.usb_proto, (val, label) => {
		dataStore.usb_proto = val;
		updateUsbPickerLabel(val);
        btn.dataset.pending = "true";
        btn.style.borderColor = "var(--warning)";
	});
};

window.applyUsbSetting = async () => {
    const btn = document.getElementById('usb-picker-btn');
	const labels = {
		"0": "自动",
		"1": "RNDIS",
		"2": "CDC-ECM"
	};
	const label = labels[dataStore.usb_proto];
	if (await showConfirm(`确认将协议切换为【${label}】吗？设置后设备将立即重启以生效。`)) {
		const res = await Api.post('/api/proxy/goform/goform_set_cmd_process', {
			isTest: 'false',
			goformId: 'SET_USB_NETWORK_PROTOCAL',
			usb_network_protocal: dataStore.usb_proto
		});
		if (res && res.result === 'success') {
            btn.removeAttribute('data-pending');
            btn.style.borderColor = "var(--border-color)";
			await Api.post('/api/proxy/goform/goform_set_cmd_process', {
				isTest: 'false',
				goformId: 'REBOOT_DEVICE'
			});
			showAlert("设置成功，设备正在重启...", "成功");
		}
	}
};

// --- 全局自定义选择器逻辑 (Picker) ---
const ApiExtra = {
	showPicker: function(title, options, currentVal, callback) {
		const picker = document.getElementById('custom-picker');
		const list = document.getElementById('picker-list');
		document.getElementById('picker-title').textContent = title;

		list.innerHTML = options.map(opt => `
            <div class="picker-item ${opt.value == currentVal ? 'selected' : ''}" onclick="ApiExtra.handlePick('${opt.value}', '${opt.label}')">
                ${opt.label}
            </div>
        `).join('');

		this.currentCallback = callback;
		picker.classList.add('active');
	},
	handlePick: function(val, label) {
		document.getElementById('custom-picker').classList.remove('active');
		if (this.currentCallback) this.currentCallback(val, label);
	}
};

async function syncOverview() {
	try {
		const local = await Api.get('/api/status');
		if (local) {
			setText('sys-hostname', local.manufacturer);
			setText('sys-model', local.model);
			setText('sys-kernel', local.kernel);
			setText('sys-uptime', local.uptime);
			updateProgressBar('cpu', local.cpu_usage);
			updateProgressBar('memory', local.memory_usage);
			setText('mem-detail', `${local.mem_used}MB / ${local.mem_total}MB`);
			updateProgressBar('storage', local.storage_usage);
			setText('storage-detail', `${Math.round(local.storage_used/1024)}GB / ${Math.round(local.storage_total/1024)}GB`);
			setText('bat-val', local.battery_level + '%');
			if (local.battery_temp) setText('bat-temp', `${local.battery_temp}°C`);
			const batFill = document.getElementById('bat-fill');
			if (batFill) batFill.style.width = local.battery_level + '%';
			const chargingMark = document.getElementById('bat-charging-mark');
			if (chargingMark) chargingMark.style.display = local.is_charging ? 'block' : 'none';
			setText('bat-status', local.is_charging ? "⚡" : "🔋");
		}

		const combinedCmds = 'network_provider_fullname,network_provider,network_type,network_signalbar,Z5g_rsrp,network_lte_rsrp,ppp_status,flux_realtime_rx_thrpt,flux_realtime_tx_thrpt,wan_ipaddr,ipv6_wan_ipaddr,wa_inner_version,hardware_version,imei,imsi,sim_imsi,sim_iccid,sim_slot,monthly_tx_bytes,monthly_rx_bytes,sms_unread_num,queryAccessPointInfo,station_list,roam_setting_option,flux_monthly_rx_bytes,flux_monthly_tx_bytes,electron_id,model_name';
		const data = await Api.get(`/api/proxy/goform/goform_get_cmd_process?multi_data=1&isTest=false&cmd=${encodeURIComponent(combinedCmds)}&_=${Date.now()}`);

		if (data) {
			const opName = data.network_provider_fullname || data.network_provider || "未知" ;
			setText('operator', opName);
			const logoEl = document.getElementById('operator-logo');
			if (logoEl && opName !== "正在读取...") {
				if (opName.includes('电信')) logoEl.src = 'img/telecom.png';
				else if (opName.includes('移动')) logoEl.src = 'img/mobile.png';
				else if (opName.includes('联通')) logoEl.src = 'img/unicom.png';
				else logoEl.src = 'img/unknown.png';
			}

			const is5G = data.network_type == 20 || data.network_type == '5G';
			let rsrpVal = is5G ? data.Z5g_rsrp : data.network_lte_rsrp;
			const rsrp = parseInt(rsrpVal || 0);
			setText('dbm-value', rsrp + " dBm");
			let level = 0;
			if (rsrp > -85) level = 5;
			else if (rsrp > -95) level = 4;
			else if (rsrp > -105) level = 3;
			else if (rsrp > -115) level = 2;
			else level = 1;
			const sigBarContainer = document.getElementById('signal-bars');
			if (sigBarContainer) sigBarContainer.className = 'signal-bars-row sig-level-' + level;

			dataStore['wan-ip'] = data.wan_ipaddr;
			dataStore['wan-ipv6'] = data.ipv6_wan_ipaddr || "未分配";
			syncMaskedField('wan-ip');
			syncMaskedField('wan-ipv6');

			setText('net-type-badge', data.network_type);
			const pppStatus = data.ppp_status || "";
			const isConnected = pppStatus.includes('connected') && !pppStatus.includes('disconnected');
			setText('c-status', isConnected ? "已连接网络" : "已断开连接");

			setText('sim-badge', data.sim_slot == '0' ? '插拔卡' : '内置卡');
			setText('roam-status', (data.roam_setting_option === 'on' || data.dial_roam_setting_option === 'on') ? '开启' : '关闭');

			const monthlyRx = parseFloat(data.flux_monthly_rx_bytes || data.monthly_rx_bytes || 0);
			const monthlyTx = parseFloat(data.flux_monthly_tx_bytes || data.monthly_tx_bytes || 0);
			setText('monthly-rx', formatBytes(monthlyRx));
			setText('monthly-tx', formatBytes(monthlyTx));
			setText('monthly-usage', formatBytes(monthlyRx + monthlyTx));

			setText('up-speed', formatSpeed(data.flux_realtime_tx_thrpt));
			setText('down-speed', formatSpeed(data.flux_realtime_rx_thrpt));

			const unread = parseInt(data.sms_unread_num || 0);
			const smsBadge = document.getElementById('sms-unread');
			if (smsBadge) {
				smsBadge.style.display = unread > 0 ? 'inline-block' : 'none';
				smsBadge.textContent = unread;
			}
			setText('sms-text', unread > 0 ? `${unread} 条未读` : '无未读');

			setText('hw-version', data.hardware_version);
			setText('sw-version', data.wa_inner_version);
			dataStore.imei = data.imei;
			if ( local.model == "F50" ) {
			    dataStore.imsi = data.imsi;
			}
			else dataStore.imsi = data.sim_imsi;
			dataStore.iccid = data.sim_iccid;
			['imei', 'imsi', 'iccid'].forEach(syncMaskedField);

			setText('license-model-name', data.model_name);
			setText('license-electron-id', data.electron_id);

			if (data.station_list) setText('wifi-station-count', `${data.station_list.length} 台设备`);
			const activeAp = data.ResponseList?.find(ap => ap.AccessPointSwitchStatus === "1") || data.ResponseList?.[0];
			if (activeAp) {
				setText('sys-wifi-ssid', activeAp.SSID);
				dataStore['wifi-pass'] = activeAp.Password ? atob(activeAp.Password) : "--";
				syncMaskedField('wifi-pass');
				const qrImg = document.getElementById('sys-wifi-qr-img');
				const qrSection = document.getElementById('sys-wifi-qr-section');
				if (qrImg && activeAp.QrImageUrl) {
					qrImg.src = `/api/proxy${activeAp.QrImageUrl}?_=${Date.now()}`;
					qrSection.style.display = 'block';
				}
			}
		}
	} catch (e) {}
}

async function checkDualSimSupport() {
	try {
		const data = await Api.get('/api/proxy/goform/goform_get_cmd_process?isTest=false&cmd=dual_sim_support&_=' + Date.now());
		if (data && data.dual_sim_support === "1") {
			const container = document.getElementById('ctrl-sim-container');
			if (container) container.style.display = 'flex';
		}
	} catch (e) {}
}

async function syncNetInfo() {
	try {
		const combinedNetCmds = 'network_information,Lte_ca_status,station_list,network_provider_fullname,network_provider,wan_ipaddr,ipv6_wan_ipaddr,ppp_status,roam_setting_option,sim_slot,queryDeviceAccessControlList,network_net_select,net_select,web_wifi_nfc_switch';
		const data = await Api.get(`/api/proxy/goform/goform_get_cmd_process?isTest=false&cmd=${encodeURIComponent(combinedNetCmds)}&multi_data=1&_=${Date.now()}`);
		if (data) {
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
                            <button class="badge" style="background:#fff1f0; color:#f5222d; border-color:#ffa39e; cursor:pointer;" onclick="addToBlacklist('${dev.mac_addr}', '${dev.hostname}')">拉黑</button>
                        </td>
                    </tr>
                `).join('') || '<tr><td colspan="3" style="text-align:center; padding:20px;">暂无连接设备</td></tr>';
			}

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
                                    <button class="badge" style="background:#f6ffed; color:#52c41a; border-color:#b7eb8f; cursor:pointer;" onclick="removeFromBlacklist('${mac}', '${names[i] || ""}')">移出</button>
                                </td>
                            </tr>
                        `).join('');
					}
				}
			}

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
			if (data.sim_slot !== undefined) {
				const slot = parseInt(data.sim_slot);
				document.getElementById('sim-btn-0')?.classList.toggle('active', slot === 0);
				document.getElementById('sim-btn-1')?.classList.toggle('active', slot === 1);
			}

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

			// --- 基于 network_net_select 的精确 5G 判断 ---
			const is5G = netSelect.includes('5G');
            const isSA = netSelect.includes('Only_5G');
            
			let typeTag = is5G ? (isSA ? "5G SA" : "5G NSA") : "4G";
			let modeText = is5G ? "NR" : "LTE-Advanced";
			
			setText('det-net-type-tag', typeTag);
			setText('det-net-mode', modeText);
			
			// 动态字段提取
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

			// 信号强度处理 (RSRP + RSSI)
			const rsrp = parseInt(is5G ? (data.nr_rsrp || data.lte_rsrp) : data.lte_rsrp) || -140;
            const rssi = parseInt(is5G ? (data.Nr_signal_strength || data.Lte_signal_strength) : data.Lte_signal_strength) || -140;
			const rsrq = parseFloat(is5G ? (data.nr_rsrq || data.lte_rsrq) : data.lte_rsrq) || -20;
			const sinr = parseFloat(is5G ? (data.Nr_snr || data.Lte_snr) : data.Lte_snr) || -10;

			updateSignalBar('rsrp', rsrp, -140, -40, 'dBm');
            updateSignalBar('rssi', rssi, -120, -30, 'dBm');
			updateSignalBar('rsrq', rsrq, -20, -3, 'dB');
			updateSignalBar('sinr', sinr, -10, 30, 'dB');

			// 智能行显示控制
			document.getElementById('row-cell-id').style.display = cellId ? 'table-row' : 'none';
			document.getElementById('row-bandwidth').style.display = bw ? 'table-row' : 'none';
			document.getElementById('row-rssi').style.display = (rssi !== -140) ? 'table-row' : 'none';

			if (dataStore.qos_loaded) {
				setText('det-qci', dataStore.last_qci);
				setText('det-qos-dl', dataStore.last_qos_dl);
				setText('det-qos-ul', dataStore.last_qos_ul);
			} else {
				queryQosRate();
			}
		}
	} catch (e) {
		console.error("Sync NetInfo failed", e);
	}
}

window.showNetModePicker = () => {
	const btn = document.getElementById('net-mode-picker-btn');
	const current = btn.dataset.value;
	const options = [{
			label: '5G/4G/3G',
			value: 'WL_AND_5G'
		},
		{
			label: '仅 5G NSA',
			value: 'LTE_AND_5G'
		},
		{
			label: '仅 5G SA',
			value: 'Only_5G'
		},
		{
			label: '4G/3G',
			value: 'WCDMA_AND_LTE'
		},
		{
			label: '仅 4G',
			value: 'Only_LTE'
		},
		{
			label: '仅 3G',
			value: 'Only_WCDMA'
		}
	];
	ApiExtra.showPicker('选择网络模式', options, current, (val, label) => {
		btn.dataset.value = val;
		btn.textContent = label;
        btn.dataset.pending = "true";
        btn.style.borderColor = "var(--warning)";
	});
};

window.applyNetMode = async () => {
	const btn = document.getElementById('net-mode-picker-btn');
	const val = btn.dataset.value;
	const label = btn.textContent;
	if (await showConfirm(`确定要将网络模式切换为【${label}】吗？设备网络将重新初始化。`)) {
		const res = await Api.post('/api/proxy/goform/goform_set_cmd_process', {
			isTest: 'false',
			goformId: 'SET_BEARER_PREFERENCE',
			BearerPreference: val
		});
		if (res && res.result === 'success') {
            btn.removeAttribute('data-pending');
            btn.style.borderColor = "var(--border-color)";
			showAlert("指令已下发，请稍候...");
			setTimeout(syncNetInfo, 2000);
		}
	}
};

window.switchSim = async (targetSlot) => {
	const msg = targetSlot === 1 ? "确认切换到【内置卡】吗？" : "确认切换到【插拔卡】吗？";
	if (await showConfirm(msg)) {
		const res = await Api.post('/api/proxy/goform/goform_set_cmd_process', {
			isTest: 'false',
			goformId: 'SET_SIM_SLOT',
			sim_slot: targetSlot
		});
		if (res && res.result === 'success') {
			showAlert("切换指令已发送，设备网络将重新初始化");
			setTimeout(syncNetInfo, 2000);
		}
	}
};

function bindNetCtrlEvents() {
	const dataSwitch = document.getElementById('ctrl-data-switch');
	if (dataSwitch && !dataSwitch.dataset.bound) {
		dataSwitch.dataset.bound = "true";
		dataSwitch.onchange = async () => {
			const goformId = dataSwitch.checked ? 'CONNECT_NETWORK' : 'DISCONNECT_NETWORK';
			await Api.post('/api/proxy/goform/goform_set_cmd_process', {
				isTest: 'false',
				notCallback: 'true',
				goformId: goformId
			});
			setTimeout(syncNetInfo, 1000);
		};
	}
	const roamSwitch = document.getElementById('ctrl-roam-switch');
	if (roamSwitch && !roamSwitch.dataset.bound) {
		roamSwitch.dataset.bound = "true";
		roamSwitch.onchange = async () => {
			const val = roamSwitch.checked ? 'on' : 'off';
			await Api.post('/api/proxy/goform/goform_set_cmd_process', {
				isTest: 'false',
				goformId: 'SET_CONNECTION_MODE',
				ConnectionMode: 'auto_dial',
				dial_roam_setting_option: val
			});
			setTimeout(syncNetInfo, 1000);
		};
	}
}

window.addToBlacklist = async (mac, name) => {
	if (!await showConfirm(`确定要拉黑设备【${name || mac}】吗？拉黑后该设备将无法连接 WiFi。`)) return;
	let newMacs = dataStore.blackMacs + mac + ";";
	let newNames = dataStore.blackNames + (name || "Unknown") + ";";
	submitBlacklist(newMacs, newNames);
};

window.removeFromBlacklist = async (mac, name) => {
	if (!await showConfirm(`确定要将设备【${name || mac}】从黑名单中移出吗？`)) return;
	let newMacs = dataStore.blackMacs.replace(mac + ";", "");
	let newNames = dataStore.blackNames.replace((name || "Unknown") + ";", "");
	submitBlacklist(newMacs, newNames);
};

async function submitBlacklist(macs, names) {
	const res = await Api.post('/api/proxy/goform/goform_set_cmd_process', {
		goformId: 'setDeviceAccessControlList',
		isTest: 'false',
		AclMode: '2',
		WhiteMacList: '',
		BlackMacList: macs,
		WhiteNameList: '',
		BlackNameList: names
	});
	if (res && res.result === 'success') {
		showAlert("操作成功，设置已应用");
		setTimeout(syncNetInfo, 1000);
	} else {
		showAlert("操作失败，请检查连接");
	}
}

async function queryQosRate() {
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
}

function updateSignalBar(id, val, min, max, unit) {
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
}

function syncMaskedField(target) {
	const el = document.querySelector(`[data-target="${target}"]`);
	if (el && !el.textContent.includes('*')) el.textContent = dataStore[target] || '--';
}

window.toggleVisibility = (target) => {
	const el = document.querySelector(`[data-target="${target}"]`);
	if (!el) return;
	const iconEl = el.nextElementSibling;
	if (el.textContent.includes('*')) {
		el.textContent = dataStore[target] || '--';
		if (iconEl) iconEl.textContent = '🔓';
	} else {
		el.textContent = '***********';
		if (iconEl) iconEl.textContent = '🔒';
	}
};

function initModalControls() {
	const modal = document.getElementById('custom-modal');
	if (modal) {
		document.getElementById('modal-cancel').onclick = () => modal.classList.remove('active');
		document.getElementById('modal-confirm').onclick = () => modal.classList.remove('active');
	}
}

function showAlert(content, title = '提示') {
	const modal = document.getElementById('custom-modal');
	if (!modal) return;
	document.getElementById('modal-title').textContent = title;
	document.getElementById('modal-content').innerHTML = content;
	document.getElementById('modal-cancel').style.display = 'none';
	modal.classList.add('active');
	return new Promise(resolve => {
		document.getElementById('modal-confirm').onclick = () => {
			modal.classList.remove('active');
			resolve(true);
		};
	});
}

function showConfirm(content, title = '请确认') {
	const modal = document.getElementById('custom-modal');
	if (!modal) return;
	document.getElementById('modal-title').textContent = title;
	document.getElementById('modal-content').innerHTML = content;
	document.getElementById('modal-cancel').style.display = 'inline-block';
	modal.classList.add('active');
	return new Promise(resolve => {
		document.getElementById('modal-cancel').onclick = () => {
			modal.classList.remove('active');
			resolve(false);
		};
		document.getElementById('modal-confirm').onclick = () => {
			modal.classList.remove('active');
			resolve(true);
		};
	});
}

function initNavigation() {
	document.querySelectorAll('.nav-item').forEach(link => {
		link.onclick = () => {
			const pageId = link.getAttribute('data-page');
			if (pageId) loadPage(pageId);
			document.body.classList.remove('sidebar-open');
		};
	});
}

function updateActiveNavItem(pageId) {
	document.querySelectorAll('.nav-item').forEach(l => l.classList.toggle('active', l.getAttribute('data-page') === pageId));
}

function initMobileEvents() {
	const toggle = document.getElementById('menu-toggle');
	const overlay = document.getElementById('sidebar-overlay');
	if (toggle) toggle.onclick = () => document.body.classList.toggle('sidebar-open');
	if (overlay) overlay.onclick = () => document.body.classList.remove('sidebar-open');
}

function setText(id, val) {
	const el = document.getElementById(id);
	if (el) el.textContent = val || '--';
}

function setVal(id, val) {
	const el = document.getElementById(id);
	if (el && val !== undefined) el.value = val;
}

function updateProgressBar(id, val) {
	const el = document.getElementById(id + '-bar');
	if (el) el.style.width = (val || 0) + '%';
	const txt = document.getElementById(id + '-text');
	if (txt) txt.textContent = (val || 0) + '%';
}

function formatBytes(b) {
	if (b < 1024) return b + ' B';
	if (b < 1048576) return (b / 1024).toFixed(2) + ' KB';
	if (b < 1073741824) return (b / 1048576).toFixed(2) + ' MB';
	return (b / 1073741824).toFixed(2) + ' GB';
}

function formatSpeed(v) {
	return formatBytes(parseFloat(v || 0)) + '/s';
}

function formatIpv6(v) {
	return v || "未分配";
}