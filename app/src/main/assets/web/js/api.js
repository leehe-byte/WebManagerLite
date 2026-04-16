/**
 * BridgeLink API 驱动框架
 */
const Api = {
    // 通用请求
    async request(uri, method = 'GET', data = null) {
        const headers = {
            'X-Requested-With': 'XMLHttpRequest'
        };

        let body = null;
        if (data && method === 'POST') {
            headers['Content-Type'] = 'application/x-www-form-urlencoded';
            body = 'postData=' + encodeURIComponent(typeof data === 'string' ? data : JSON.stringify(data));
        }

        try {
            const response = await fetch(uri, { method, headers, body });
            
            if (response.status === 401) {
                sessionStorage.clear();
                window.location.href = 'login.html';
                return null;
            }

            return await response.json();
        } catch (error) {
            console.error('API Error:', error);
            throw error;
        }
    },

    async get(uri) { return this.request(uri, 'GET'); },
    async post(uri, data) { return this.request(uri, 'POST', data); },

    // 登录
    async login(password) {
        try {
            const response = await fetch('/api/auth/login?password=' + encodeURIComponent(password), { method: 'POST' });
            const data = await response.json();
            if (data.result === 0) {
                sessionStorage.setItem('isLoggedIn', 'true');
                return true;
            }
            return false;
        } catch (e) {
            return false;
        }
    }
};
