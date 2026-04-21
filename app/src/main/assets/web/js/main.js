/**
 * BridgeLink Manager v2.0.3 - 核心框架逻辑
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
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
        if (localStorage.getItem('theme') === 'auto') applyTheme('auto');
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
    
    // 清理所有模块的定时器
    if (activeTimer) clearInterval(activeTimer);
    if (typeof OverviewModule !== 'undefined') OverviewModule.stop();
    if (typeof NetInfoModule !== 'undefined') NetInfoModule.stop();

    try {
        const response = await fetch(`pages/${pageId}.html`);
        if (!response.ok) throw new Error('Page not found');
        const html = await response.text();
        contentArea.innerHTML = html;

        updateActiveNavItem(pageId);
        initPageLogic(pageId);
        
        if (window.location.hash !== '#' + pageId) window.location.hash = pageId;
    } catch (e) {
        contentArea.innerHTML = `<div class="card"><p style="color:red">页面加载失败: ${pageId}</p></div>`;
    }
}

function initPageLogic(pageId) {
    if (pageId === 'overview' && typeof OverviewModule !== 'undefined') {
        OverviewModule.init();
    } else if (pageId === 'net-info' && typeof NetInfoModule !== 'undefined') {
        NetInfoModule.init();
    } else if (pageId === 'lan' && typeof LanModule !== 'undefined') {
        LanModule.init();
    } else if (pageId === 'mihomo' && typeof MihomoModule !== 'undefined') {
        MihomoModule.init();
        activeTimer = setInterval(() => MihomoModule.syncStatus(), 3000);
    } else if (pageId === 'samba' && typeof SambaModule !== 'undefined') {
        SambaModule.init();
        activeTimer = setInterval(() => SambaModule.syncStatus(), 3000);
    } else if (pageId === 'adb' && typeof AdbModule !== 'undefined') {
        AdbModule.init();
        activeTimer = setInterval(() => AdbModule.syncStatus(), 3000);
    } else if (pageId === 'wifi' && typeof WifiModule !== 'undefined') {
        WifiModule.init();
    } else if (pageId === 'sms' && typeof SmsModule !== 'undefined') {
        SmsModule.init();
        activeTimer = setInterval(() => SmsModule.syncStatus(), 3000);
    } else if (pageId === 'at-command' && typeof AtCommandModule !== 'undefined') {
        AtCommandModule.init();
    } else if (pageId === 'remote' && typeof initRemoteScrcpy === 'function') {
        initRemoteScrcpy();
    } else if (pageId === 'power' && typeof PowerModule !== 'undefined') {
        PowerModule.init();
    } else if (pageId === 'terminal' && typeof TerminalModule !== 'undefined') {
        TerminalModule.init();
    } else if (pageId === 'about') {
        AboutModule.init();
    }
}

// --- 通用工具函数 ---
function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val || '--';
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

// --- UI 组件逻辑 ---
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

const AboutModule = {
    init() {
        const saved = localStorage.getItem('default_start_page') || 'overview';
        const labels = { 'overview': '状态总览', 'net-info': '网络详情', 'power': '电源管理', 'remote': '远程控制', 'sms': '短信列表' };
        setText('start-page-picker', labels[saved] || '状态总览');
    },
    showStartPagePicker() {
        const options = [{ label: '状态总览', value: 'overview' }, { label: '网络详情', value: 'net-info' }, { label: '电源管理', value: 'power' }, { label: '远程控制', value: 'remote' }, { label: '短信列表', value: 'sms' }];
        const current = localStorage.getItem('default_start_page') || 'overview';
        ApiExtra.showPicker('设置默认启动页', options, current, (val, label) => {
            localStorage.setItem('default_start_page', val);
            setText('start-page-picker', label);
            showAlert("设置已保存，下次登录生效");
        });
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

window.showSignalHelp = (type) => {
    let content = type === 'rsrp' ? `<b>RSRP (参考信号接收功率)</b><br><br>这是衡量网络覆盖的核心指标。<br>-80dBm 以上: 信号极强<br>-80 至 -95: 信号良好<br>-95 至 -110: 信号一般<br>-110dBm 以下: 信号较差` : `<b>RSSI (接收信号强度指示)</b><br><br>反映整个频段的总能量强度。`;
    showAlert(content, "参数说明");
}
