/**
 * SMS Management Module v4.1 - 深度定制聊天版
 */
const SmsModule = {
    allThreads: [],
    isDetailView: false,
    activeNumber: null,

    async init() {
        this.isDetailView = false;
        this.activeNumber = null;
        await this.fetchSms();
    },

    // 供 main.js 定时调用
    async syncStatus() {
        await this.fetchSms();
    },

    async fetchSms() {
        try {
            const url = `/api/proxy/goform/goform_get_cmd_process?isTest=false&cmd=sms_data_total&page=0&data_per_page=500&mem_store=1&tags=10&order_by=order%20by%20id%20desc&_=${Date.now()}`;
            const data = await Api.get(url);

            if (data && data.messages) {
                this.allThreads = this.groupMessages(data.messages);
                
                if (this.isDetailView && this.activeNumber) {
                    this.updateDetailView();
                } else {
                    this.renderThreads();
                }
            }
        } catch (e) {
            console.error("Fetch SMS failed:", e);
        }
    },

    groupMessages(messages) {
        const groups = {};
        messages.forEach(msg => {
            if (!groups[msg.number]) groups[msg.number] = [];
            groups[msg.number].push(msg);
        });

        return Object.keys(groups).map(number => {
            const msgs = groups[number].sort((a, b) => parseInt(a.id) - parseInt(b.id));
            return {
                number: number,
                messages: msgs,
                lastDate: msgs[msgs.length - 1].date,
                hasUnread: msgs.some(m => m.tag === "1"),
                unreadCount: msgs.filter(m => m.tag === "1").length
            };
        }).sort((a, b) => this.parseDate(b.lastDate) - this.parseDate(a.lastDate));
    },

    renderThreads() {
        const container = document.getElementById('sms-threads-container');
        const countBadge = document.getElementById('sms-total-count');
        if (!container || this.isDetailView) return;

        countBadge.textContent = `${this.allThreads.length} 个会话`;
        
        container.innerHTML = this.allThreads.map(thread => {
            const lastMsg = thread.messages[thread.messages.length - 1];
            const content = this.safeBase64Decode(lastMsg.content);
            return `
                <div class="sms-thread-item" onclick="SmsModule.openThread('${thread.number}')">
                    ${thread.hasUnread ? '<div class="unread-dot"></div>' : ''}
                    <div class="sms-thread-avatar">${thread.number.substring(0, 1)}</div>
                    <div class="sms-thread-main">
                        <div class="sms-thread-top">
                            <span class="sms-thread-number">${thread.number} ${thread.unreadCount > 0 ? `<span style="color:#ff4d4f; font-size:12px;">(${thread.unreadCount})</span>` : ''}</span>
                            <span class="sms-thread-time">${this.formatSimpleTime(lastMsg.date)}</span>
                        </div>
                        <div class="sms-thread-snippet">${content}</div>
                    </div>
                </div>
            `;
        }).join('');
    },

    openThread(number) {
        this.activeNumber = number;
        this.isDetailView = true;
        
        document.getElementById('sms-list-view').style.display = 'none';
        document.getElementById('sms-detail-view').style.display = 'block';
        
        this.updateDetailView(true); // true 表示需要强制滚动到底部
    },

    updateDetailView(forceScroll = false) {
        const thread = this.allThreads.find(t => t.number === this.activeNumber);
        if (!thread) return;

        document.getElementById('detail-number').textContent = this.activeNumber;
        document.getElementById('detail-count').textContent = `共 ${thread.messages.length} 条记录`;

        const chatContainer = document.getElementById('chat-flow-container');
        const oldHeight = chatContainer.scrollHeight;
        
        chatContainer.innerHTML = thread.messages.map(msg => this.renderBubble(msg)).join('');

        // 仅在初次进入或有新消息时滚动
        if (forceScroll || chatContainer.scrollHeight > oldHeight) {
            setTimeout(() => {
                chatContainer.scrollTop = chatContainer.scrollHeight;
            }, 50);
        }

        // 处理已读
        const unreadIds = thread.messages.filter(m => m.tag === "1").map(m => m.id);
        if (unreadIds.length > 0) {
            this.markAsRead(unreadIds);
            thread.hasUnread = false;
            thread.unreadCount = 0;
            thread.messages.forEach(m => m.tag = "0");
        }
    },

    async markAsRead(ids) {
        try {
            const idStr = ids.join(';') + ';';
            const payload = `isTest=false&goformId=SET_MSG_READ&msg_id=${encodeURIComponent(idStr)}&tag=0`;
            await Api.post('/api/proxy/goform/goform_set_cmd_process', payload);
        } catch (e) {
            console.error("Mark as read failed:", e);
        }
    },

    backToList() {
        this.isDetailView = false;
        this.activeNumber = null;
        document.getElementById('sms-detail-view').style.display = 'none';
        document.getElementById('sms-list-view').style.display = 'block';
        this.renderThreads();
    },

    renderBubble(msg) {
        const content = this.safeBase64Decode(msg.content);
        const otp = this.extractOTP(content);
        const dateStr = this.formatFullDate(msg.date);

        return `
            <div class="chat-bubble-wrap">
                <div class="chat-bubble">
                    <div class="chat-content">${content}</div>
                    ${otp ? `
                        <div class="otp-card">
                            <span class="otp-val">${otp}</span>
                            <button class="btn-copy-sm" onclick="event.stopPropagation(); SmsModule.copyText('${otp}', this)">复制</button>
                        </div>
                    ` : ''}
                </div>
                <div class="chat-time">${dateStr}</div>
            </div>
        `;
    },

    extractOTP(text) {
        if (/(验证码|校验码|动态码|code|验证码为)/i.test(text)) {
            const match = text.match(/\b\d{4,8}\b/);
            return match ? match[0] : null;
        }
        return null;
    },

    copyText(text, btn) {
        const updateUI = () => {
            const oldText = btn.textContent;
            btn.textContent = '已复制';
            btn.style.background = '#52c41a';
            setTimeout(() => {
                btn.textContent = oldText;
                btn.style.background = '';
            }, 2000);
        };

        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(updateUI).catch(() => {
                this.fallbackCopy(text) && updateUI();
            });
        } else {
            this.fallbackCopy(text) && updateUI();
        }
    },

    fallbackCopy(val) {
        const textArea = document.createElement("textarea");
        textArea.value = val;
        document.body.appendChild(textArea);
        textArea.select();
        const res = document.execCommand('copy');
        document.body.removeChild(textArea);
        return res;
    },

    safeBase64Decode(base64) {
        try {
            const binaryString = atob(base64);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            return new TextDecoder('utf-8').decode(bytes);
        } catch (e) {
            return "解码失败";
        }
    },

    parseDate(dateStr) {
        const p = dateStr.split(',');
        return new Date(`20${p[0]}-${p[1]}-${p[2]}T${p[3]}:${p[4]}:${p[5].substring(0,2)}`);
    },

    formatSimpleTime(dateStr) {
        const p = dateStr.split(',');
        return `${p[1]}/${p[2]} ${p[3]}:${p[4]}`;
    },

    formatFullDate(dateStr) {
        const p = dateStr.split(',');
        return `20${p[0]}-${p[1]}-${p[2]} ${p[3]}:${p[4]}:${p[5].substring(0,2)}`;
    }
};
