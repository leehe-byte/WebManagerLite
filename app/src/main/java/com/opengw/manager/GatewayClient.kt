package com.opengw.manager

import android.util.Log
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.net.NetworkInterface
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

class GatewayClient {
    private val TAG = "GW_BRIDGE_CLIENT"

    private val ip = getGatewayIp()
    private val BASE_URL = "http://$ip:8080"
    
    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.SECONDS)
        .build()

    private var sessionCookie: String? = null
    private var hardwareId: String = ""
    private var softwareId: String = ""

    private fun getGatewayIp(): String {
        try {
            val interfaces = NetworkInterface.getNetworkInterfaces()
            while (interfaces.hasMoreElements()) {
                val iface = interfaces.nextElement()
                val addresses = iface.inetAddresses
                while (addresses.hasMoreElements()) {
                    val addr = addresses.nextElement()
                    if (!addr.isLoopbackAddress && addr.address.size == 4) {
                        return addr.hostAddress ?: "192.168.0.1"
                    }
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Get IP failed", e)
        }
        return "192.168.0.1"
    }

    /**
     * 执行原厂双重令牌登录
     */
    fun performHandshake(password: String): JSONObject {
        try {
            // 1. 获取挑战令牌 (原 LD)
            val challengeJson = executeDirect("/goform/goform_get_cmd_process?isTest=false&cmd=LD&_=${System.currentTimeMillis()}")
            val challenge = challengeJson.optString("LD")
            
            // 2. 计算安全哈希: SHA256(SHA256(pwd) + Token)
            val secureHash = computeHash(computeHash(password) + challenge)

            // 3. 提交登录
            val payload = "isTest=false&goformId=LOGIN&user=admin&password=$secureHash"
            val response = executeRawPost("/goform/goform_set_cmd_process", payload)
            
            if (response.contains("\"result\":0") || response.contains("\"result\":\"0\"")) {
                // 4. 提取会话
                loadSystemVersions()
                return JSONObject().put("status", "success").put("msg", "Authenticated")
            }
            return JSONObject().put("status", "fail").put("msg", response)
        } catch (e: Exception) {
            return JSONObject().put("status", "error").put("msg", e.message)
        }
    }

    /**
     * 智能代理：自动处理动作验证码 (原 AD)
     */
    fun proxyRequest(path: String, method: String, params: Map<String, String>?, body: String?): String {
        return if (method == "POST") {
            // 获取动态随机数 (原 RD)
            val nonceJson = executeDirect("/goform/goform_get_cmd_process?isTest=false&cmd=RD&_=${System.currentTimeMillis()}")
            val nonce = nonceJson.optString("RD")
            
            // 计算动作校验码: SHA256(SHA256(HW+SW) + Nonce)
            val verifier = computeHash(computeHash(hardwareId + softwareId) + nonce)
            val finalBody = "${body ?: ""}&isTest=false&AD=$verifier"
            executeRawPost(path, finalBody)
        } else {
            val query = params?.entries?.joinToString("&") { "${it.key}=${it.value}" }
            executeRawGet(path + if (query != null) "?$query" else "")
        }
    }

    private fun loadSystemVersions() {
        val res = executeDirect("/goform/goform_get_cmd_process?isTest=false&cmd=wa_inner_version,cr_version&multi_data=1")
        this.hardwareId = res.optString("wa_inner_version")
        this.softwareId = res.optString("cr_version")
    }

    private fun executeDirect(path: String): JSONObject {
        return JSONObject(executeRawGet(path))
    }

    private fun executeRawGet(path: String): String {
        val request = buildBaseRequest(path).get().build()
        return performCall(request)
    }

    private fun executeRawPost(path: String, body: String): String {
        val request = buildBaseRequest(path)
            .post(body.toRequestBody("application/x-www-form-urlencoded".toMediaType()))
            .build()
        return performCall(request)
    }

    private fun buildBaseRequest(path: String): Request.Builder {
        val url = if (path.startsWith("http")) path else "$BASE_URL$path"
        return Request.Builder()
            .url(url)
            .header("Host", ip)
            .header("Referer", "http://$ip/index.html")
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            .apply {
                sessionCookie?.let { header("Cookie", it) }
            }
    }

    private fun performCall(request: Request): String {
        httpClient.newCall(request).execute().use { response ->
            // 更新 Cookie
            response.header("Set-Cookie")?.let { 
                sessionCookie = it.split(";")[0] 
            }
            return response.body?.string() ?: ""
        }
    }

    private fun computeHash(input: String): String {
        val bytes = MessageDigest.getInstance("SHA-256").digest(input.toByteArray())
        return bytes.joinToString("") { "%02x".format(it) }.uppercase()
    }
}
