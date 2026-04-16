/**
 * AT Command Terminal Module
 */
const AtCommandModule = {
    init: function() {
        console.log("AtCommandModule Initializing...");
        const input = document.getElementById('at-input');
        if (input) {
            input.onkeydown = (e) => {
                if (e.key === 'Enter') this.execute();
            };
            input.focus();
        }
    },

    fill: function(cmd) {
        const input = document.getElementById('at-input');
        if (input) {
            input.value = cmd;
            input.focus();
        }
    },

    execute: async function() {
        const input = document.getElementById('at-input');
        const resultArea = document.getElementById('at-result-area');
        const btn = document.getElementById('at-exec-btn');
        
        const cmd = input.value.trim();
        if (!cmd) return;

        // 状态切换
        btn.disabled = true;
        btn.textContent = '执行中...';
        resultArea.textContent = `> 发送命令: ${cmd}\n正在等待调制解调器响应...`;
        resultArea.style.color = '#00ff00';

        try {
            // 调用后端 AT 接口
            const res = await Api.get(`/api/at/send?cmd=${encodeURIComponent(cmd)}`);
            
            if (res && res.result) {
                resultArea.textContent = res.result;
                // 如果包含 ERROR 字样，变更为黄色提示
                if (res.result.includes('ERROR')) {
                    resultArea.style.color = '#faad14';
                }
            } else {
                resultArea.textContent = "未收到有效响应。";
                resultArea.style.color = '#ff4d4f';
            }
        } catch (e) {
            resultArea.textContent = "执行失败: " + e.message;
            resultArea.style.color = '#ff4d4f';
        } finally {
            btn.disabled = false;
            btn.textContent = '执行';
            input.select();
        }
    }
};
