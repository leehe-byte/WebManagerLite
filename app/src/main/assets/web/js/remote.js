/**
 * Remote Control Module v2.3 - Turbo JPEG 稳定版
 */
const RemoteControlModule = {
    ws: null,
    canvas: null,
    ctx: null,
    status: null,
    loader: null,
    
    // 手势记录
    startX: 0,
    startY: 0,
    isInteracting: false,
    startTime: 0,

    init: function() {
        this.canvas = document.getElementById('screen-canvas');
        this.status = document.getElementById('remote-status');
        this.loader = document.getElementById('screen-loader');
        
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d', { alpha: false }); // 优化渲染性能

        setTimeout(() => this.connect(), 200);
        this.bindEvents();
    },

    connect: function() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/api/remote/control?t=${Date.now()}`;
        
        this.ws = new WebSocket(wsUrl);
        this.ws.binaryType = "arraybuffer";

        this.ws.onopen = () => {
            this.status.textContent = "Turbo JPEG Active";
            this.status.style.color = "#52c41a";
            this.loader.style.display = 'none';
        };

        this.ws.onmessage = (event) => {
            if (event.data instanceof ArrayBuffer) {
                this.drawFrame(event.data);
            }
        };

        this.ws.onclose = () => {
            this.status.textContent = "Stopped";
            this.loader.style.display = 'flex';
        };
    },

    drawFrame: function(buffer) {
        const blob = new Blob([buffer], { type: 'image/jpeg' });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            // 绘制到 480x848 的 Canvas 空间
            this.ctx.drawImage(img, 0, 0, 480, 848);
            URL.revokeObjectURL(url);
        };
        img.src = url;
    },

    bindEvents: function() {
        const getCoords = (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            return {
                x: Math.floor(((clientX - rect.left) / rect.width) * 480),
                y: Math.floor(((clientY - rect.top) / rect.height) * 848)
            };
        };

        const onStart = (e) => {
            const coords = getCoords(e);
            this.startX = coords.x;
            this.startY = coords.y;
            this.startTime = Date.now();
            this.isInteracting = true;
            if (e.cancelable) e.preventDefault();
        };

        const onEnd = (e) => {
            if (!this.isInteracting) return;
            this.isInteracting = false;
            
            const ev = e.changedTouches ? e.changedTouches[0] : e;
            const rect = this.canvas.getBoundingClientRect();
            const endX = Math.floor(((ev.clientX - rect.left) / rect.width) * 480);
            const endY = Math.floor(((ev.clientY - rect.top) / rect.height) * 848);

            const duration = Date.now() - this.startTime;
            const dist = Math.sqrt(Math.pow(endX - this.startX, 2) + Math.pow(endY - this.startY, 2));
            
            if (dist < 15 && duration < 300) {
                this.sendAction('tap', this.startX, this.startY);
            } else {
                this.sendAction('swipe', this.startX, this.startY, endX, endY);
            }
        };

        this.canvas.onmousedown = onStart;
        this.canvas.onmouseup = onEnd;
        this.canvas.addEventListener('touchstart', onStart, { passive: false });
        this.canvas.addEventListener('touchend', onEnd, { passive: false });
        this.canvas.addEventListener('touchmove', (e) => { if(e.cancelable) e.preventDefault(); }, { passive: false });
    },

    sendAction: function(action, x = 0, y = 0, x2 = 0, y2 = 0, key = null) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ action, x, y, x2, y2, key }));
        }
    },

    sendKey: function(keyName) {
        this.sendAction('key', 0, 0, 0, 0, keyName);
    },

    reconnect: function() {
        if (this.ws) this.ws.close();
        this.connect();
    }
};
