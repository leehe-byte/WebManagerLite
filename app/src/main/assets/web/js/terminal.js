/**
 * ttyd Terminal Module Integration v2.0
 */
const TerminalModule = {
    init: async function() {
        const frame = document.getElementById('ttyd-frame');
        const loader = document.getElementById('ttyd-loader');
        const status = document.getElementById('ttyd-status');

        if (!frame) return;

        try {
            status.textContent = "Checking ttyd...";
            let res = await Api.get('/api/ttyd/status');
            
            if (!res.running) {
                status.textContent = "Starting ttyd (bash)...";
                await Api.post('/api/ttyd/start');
                // 给予 bash 启动更充足的时间
                await new Promise(r => setTimeout(r, 2000));
                res = await Api.get('/api/ttyd/status');
            }

            if (res.running) {
                const host = window.location.hostname;
                // 强制添加时间戳，防止 iframe 缓存导致连接不到新进程
                frame.src = `http://${host}:${res.port}/?_=${Date.now()}`;
                
                frame.onload = () => {
                    loader.style.display = 'none';
                    frame.style.display = 'block';
                    status.textContent = "Bash Session Ready";
                    status.style.color = "#52c41a";
                    
                    // 关键：由于是 iframe，需要确保焦点进入才能接收按键
                    setTimeout(() => {
                        frame.contentWindow.focus();
                    }, 500);
                };
            } else {
                loader.textContent = "无法启动 bash 终端，请确保 Magisk bash 已安装。";
                status.textContent = "Launch Error";
            }
        } catch (e) {
            loader.textContent = "Terminal Error: " + e.message;
        }
    }
};
