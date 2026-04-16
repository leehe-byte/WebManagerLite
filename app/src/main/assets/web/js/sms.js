/**
 * SMS Management Module v3.0 - 聊天聚合版
 */
const SmsModule = {
    async init() {
        console.log("SMS Module Initializing...");
        const container = document.getElementById('sms-list-container');
        if (!container) {
            setTimeout(() => this.init(), 100);
            return;
        }
        await this.fetchSms();
    },

    async fetchSms() {
        const container = document.getElementById('sms-list-container');
        try {
            const url = `/api/proxy/goform/goform_get_cmd_process?isTest=false&cmd=sms_data_total&page=0&data_per_page=500&mem_store=1&tags=10&order_by=order%20by%20id%20desc&_=${Date.now()}`;
            const data = await Api.get(url);

            if (data && data.messages) {
                // 按号码聚合
                const threads = this.groupMessages(data.messages);
                this.renderSmsThreads(threads);
            } else {
                container.innerHTML = '<p style="text-align:center; color:#999; padding:40px;">未获取到有效短信数据</p>';
            }
        } catch (e) {
            console.error("Fetch SMS failed:", e);
            if (container) {
                container.innerHTML = `<p style="text-align:center; color:red; padding:20px;">获取短信失败: ${e.message}</p>`;
            }
        }
    },

    groupMessages(messages) {
        const groups = {};
        messages.forEach(msg => {
            if (!groups[msg.number]) {
                groups[msg.number] = [];
            }
            groups[msg.number].push(msg);
        });
        // 转换为数组并按最新一条短信的时间排序
        return Object.keys(groups).map(number => ({
            number: number,
            messages: groups[number].sort((a, b) => this.parseDate(a.date) - this.parseDate(b.date)) // 号码内从小到大（聊天流）
        })).sort((a, b) => {
            // 对话列表按最后一条短信倒序
            const lastA = a.messages[a.messages.length - 1];
            const lastB = b.messages[b.messages.length - 1];
            return this.parseDate(lastB.date) - this.parseDate(lastA.date);
        });
    },

    renderSmsThreads(threads) {
        const container = document.getElementById('sms-list-container');
        const countBadge = document.getElementById('sms-total-count');
        if (!container) return;
        
        countBadge.textContent = `${threads.length} 个会话`;

        container.innerHTML = threads.map(thread => {
            const lastMsg = thread.messages[thread.messages.length - 1];
            
            return `
                <div class="sms-thread-card">
                    <div class="sms-thread-header" onclick="this.parentElement.classList.toggle('expanded')">
                        <div class="sms-thread-info">
                            <span class="sms-number">${thread.number}</span>
                            <span class="sms-count-tag">${thread.messages.length} 条</span>
                        </div>
                        <span class="sms-date">${this.formatSmsDate(lastMsg.date)}</span>
                    </div>
                    <div class="sms-chat-body">
                        ${thread.messages.map(msg => this.renderBubble(msg)).join('')}
                    </div>
                </div>
            `;
        }).join('');
    },

    renderBubble(msg) {
        const content = this.safeBase64Decode(msg.content);
        const otp = this.extractOTP(content);
        const dateStr = this.formatSmsDate(msg.date);

        return `
            <div class="chat-bubble-wrap">
                <div class="chat-bubble">
                    <div class="bubble-content">${content}</div>
                    ${otp ? `
                        <div class="otp-box">
                            <span class="otp-code">${otp}</span>
                            <button class="btn-copy-otp" onclick="SmsModule.copyText('${otp}', this)">复制</button>
                        </div>
                    ` : ''}
                    <div class="bubble-footer">${dateStr}</div>
                </div>
            </div>
        `;
    },

    extractOTP(text) {
        // 匹配 4-8 位纯数字，通常出现在包含“验证码”字样的短信中
        if (/(验证码|校验码|动态码|code|验证码为)/i.test(text)) {
            const match = text.match(/\b\d{4,8}\b/);
            return match ? match[0] : null;
        }
        return null;
    },

    copyText(text, btn) {
        //内部函数：传统的复制方案（兼容 HTTP）
        const fallbackCopy = (val) => {
            const textArea = document.createElement("textarea");
            textArea.value = val;
            // 确保不可见但可选中
            textArea.style.position = "fixed";
            textArea.style.left = "-9999px";
            textArea.style.top = "0";
            document.body.appendChild(textArea);
            textArea.select();
            let success = false;
            try {
                success = document.execCommand('copy');
            } catch (err) {
                console.error('Fallback copy failed', err);
            }
            document.body.removeChild(textArea);
            return success;
        };

        // 内部函数：更新按钮 UI 反馈
        const updateUI = () => {
            const originalText = btn.textContent;
            btn.textContent = '已复制';
            btn.classList.add('success'); // 对应 style.css 中的绿色背景
            setTimeout(() => {
                btn.textContent = originalText;
                btn.classList.remove('success');
            }, 2000);
        };


        // 优先使用现代 API，如果失败则使用传统 API
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text)
                .then(updateUI)
                .catch(() => {
                    if (fallbackCopy(text)) updateUI();
                });
        } else {
            if (fallbackCopy(text)) updateUI();
        }
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
            return atob(base64);
        }
    },

    parseDate(dateStr) {
        // "26,03,09,09,54,29,+0800"
        const p = dateStr.split(',');
        return new Date(`20${p[0]}-${p[1]}-${p[2]}T${p[3]}:${p[4]}:${p[5].substring(0,2)}`);
    },

    formatSmsDate(dateStr) {
        if (!dateStr) return "";
        const p = dateStr.split(',');
        return `${p[1]}-${p[2]} ${p[3]}:${p[4]}`;
    }
};
