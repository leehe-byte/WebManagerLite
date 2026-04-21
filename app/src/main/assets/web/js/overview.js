/**
 * Overview 模块 - 系统性能中心与概览同步逻辑
 */
const OverviewModule = {
    history: [],
    contexts: [],
    isInitialized: false,
    perfTimer: null,

    init() {
        this.isInitialized = false;
        this.history = [];
        this.contexts = [];
        this.sync();
        if (this.perfTimer) clearInterval(this.perfTimer);
        this.perfTimer = setInterval(() => this.sync(), 1000);
    },

    stop() {
        if (this.perfTimer) {
            clearInterval(this.perfTimer);
            this.perfTimer = null;
        }
    },

    initCharts(cores) {
        const grid = document.getElementById('cpu-core-grid');
        if (!grid || this.isInitialized) return;
        
        grid.innerHTML = '';
        this.history = cores.map(() => new Array(40).fill(0));
        this.contexts = [];

        cores.forEach((core, i) => {
            const wrap = document.createElement('div');
            wrap.style.cssText = 'background:rgba(0,0,0,0.02); border:1px solid var(--border-color); border-radius:4px; padding:4px;';
            wrap.innerHTML = `<div style="font-size:8px; color:var(--text-sub); margin-bottom:2px;">CORE ${i}</div><canvas width="120" height="35" style="width:100%; height:35px;"></canvas>`;
            grid.appendChild(wrap);
            this.contexts.push(wrap.querySelector('canvas').getContext('2d'));
        });
        this.isInitialized = true;
    },

    drawChart(ctx, data) {
        if (!ctx) return;
        const w = ctx.canvas.width, h = ctx.canvas.height;
        ctx.clearRect(0, 0, w, h);
        ctx.strokeStyle = 'rgba(0,0,0,0.05)'; ctx.lineWidth = 0.5;
        for(let x=0; x<w; x+=15) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
        for(let y=0; y<h; y+=10) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }
        
        ctx.beginPath(); ctx.moveTo(0, h);
        const step = w / (data.length - 1);
        data.forEach((v, i) => ctx.lineTo(i * step, h - (v/100*h)));
        ctx.lineTo(w, h); ctx.fillStyle = 'rgba(24,144,255,0.1)'; ctx.fill();
        
        ctx.beginPath(); ctx.strokeStyle = '#1890ff'; ctx.lineWidth = 1.2;
        data.forEach((v, i) => { if(i==0) ctx.moveTo(0, h-(v/100*h)); else ctx.lineTo(i * step, h-(v/100*h)); });
        ctx.stroke();
    },

    async sync() {
        try {
            // 1. 获取系统性能详情 (由 SystemStatsManager 提供)
            const localPerf = await Api.get('/api/system/details');
            if (localPerf) {
                if (localPerf.cpu_model) document.getElementById('real-cpu-model').textContent = localPerf.cpu_model;
                
                if (localPerf.cpu && localPerf.cpu.cores) {
                    if (!this.isInitialized) this.initCharts(localPerf.cpu.cores);
                    // 确保百分比文字显示
                    const cpuUsageLabel = document.getElementById('real-total-cpu-usage');
                    if (cpuUsageLabel) {
                        cpuUsageLabel.textContent = (localPerf.cpu.total_usage || 0) + '%';
                        cpuUsageLabel.style.color = 'white';
                    }

                    localPerf.cpu.cores.forEach((c, i) => {
                        if (this.history[i]) {
                            this.history[i].shift();
                            this.history[i].push(c.usage);
                            this.drawChart(this.contexts[i], this.history[i]);
                        }
                    });
                }
                
                if (localPerf.memory) {
                    const m = localPerf.memory;
                    setText('real-mem-pct', m.usage + '%');
                    const memBar = document.getElementById('real-mem-bar');
                    if (memBar) memBar.style.width = m.usage + '%';
                    setText('real-mem-val', `${m.used} / ${m.total} MB`);
                    
                    const sPct = m.swap_total > 0 ? Math.round(m.swap_used * 100 / m.swap_total) : 0;
                    setText('real-swap-pct', sPct + '%');
                    const swapBar = document.getElementById('real-swap-bar');
                    if (swapBar) swapBar.style.width = sPct + '%';
                    setText('real-swap-val', `${m.swap_used} / ${m.swap_total} MB`);
                }

                if (localPerf.thermal !== undefined) {
                    const t = document.getElementById('real-soc-temp');
                    if (t) {
                        t.textContent = localPerf.thermal + '°C';
                        t.style.color = localPerf.thermal > 65 ? '#ff4d4f' : (localPerf.thermal > 50 ? '#fa8c16' : '#52c41a');
                    }
                }
            }

            // 2. 获取网关基础状态 (包含存储信息)
            await this.updateGatewayStatus();

        } catch (e) {
            console.error('Overview sync failed:', e);
        }
    },

    async updateGatewayStatus() {
        try {
            const status = await Api.get('/api/status');
            if (status) {
                setText('sys-hostname', status.manufacturer);
                setText('sys-model', status.model);
                setText('sys-kernel', status.kernel);
                setText('sys-uptime', status.uptime);
                
                // 更新存储 (Card A 表格)
                const storageStr = `${status.storage_usage}% (${Math.round(status.storage_used/1024)}G/${Math.round(status.storage_total/1024)}G)`;
                setText('sys-storage-detail', storageStr);
                
                // 更新存储 (Card B 资源条)
                setText('real-storage-pct', status.storage_usage + '%');
                const storageBar = document.getElementById('real-storage-bar');
                if (storageBar) storageBar.style.width = status.storage_usage + '%';
                setText('real-storage-val', `${Math.round(status.storage_used/1024)}G / ${Math.round(status.storage_total/1024)}G`);

                // 更新电池
                setText('bat-val', status.battery_level + '%');
                if (status.battery_temp) setText('bat-temp', `${status.battery_temp}°C`);
                const batFill = document.getElementById('bat-fill');
                if (batFill) batFill.style.width = status.battery_level + '%';
                const chargingMark = document.getElementById('bat-charging-mark');
                if (chargingMark) chargingMark.style.display = status.is_charging ? 'block' : 'none';
            }

            // 3. 获取其他网关信息 (运营商、网速等)
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
                
                if ( status.model == "F50" || data.model_name == "F50" ) {
                    dataStore.imsi = data.imsi;
                } else {
                    dataStore.imsi = data.sim_imsi;
                }
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
        } catch (e) {
            console.error("Update gateway status failed", e);
        }
    }
};
