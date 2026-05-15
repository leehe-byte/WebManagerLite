package com.opengw.manager

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.net.NetworkInterface
import java.net.URLDecoder
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import java.util.concurrent.TimeUnit

/**
 * 代理响应包装类
 */
data class ProxyResponse(val bytes: ByteArray, val contentType: String?)

/**
 * 核心协议处理器：严格匹配原厂参数顺序与格式
 */
class BridgeProtocol(private val context: Context) {
    private val TAG = "U30_BRIDGE_CORE"
    private val PORT = "8080"
    private val client = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.SECONDS)
        .build()

    companion object {
        private var activeCookie: String? = null
        private var waVer: String = ""
        private var crVer: String = ""
        private var encryptedPassword: String? = null

        /**
         * 检查是否已保存密码（用于外部判断是否需要主动登录）
         */
        fun getEncryptedPassword(): String? = encryptedPassword
    }
    private val KEYSTORE_ALIAS = "bridge_protocol_pwd_key"

    private fun getGatewayIp(): String {
        try {
            val interfaces = NetworkInterface.getNetworkInterfaces()
            while (interfaces.hasMoreElements()) {
                val iface = interfaces.nextElement()
                val addresses = iface.inetAddresses
                while (addresses.hasMoreElements()) {
                    val addr = addresses.nextElement()
                    if (!addr.isLoopbackAddress && addr.address.size == 4) {
                        if (iface.name == "br0") return addr.hostAddress ?: "192.168.0.1"
                    }
                }
            }
            val interfaces2 = NetworkInterface.getNetworkInterfaces()
            while (interfaces2.hasMoreElements()) {
                val iface = interfaces2.nextElement()
                val addresses = iface.inetAddresses
                while (addresses.hasMoreElements()) {
                    val addr = addresses.nextElement()
                    if (!addr.isLoopbackAddress && addr.address.size == 4) return addr.hostAddress ?: "192.168.0.1"
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Get IP failed", e)
        }
        return "192.168.0.1"
    }

    fun doLogin(password: String): String {
        try {
            val ldRes = fetch("/goform/goform_get_cmd_process?isTest=false&cmd=LD&_=${System.currentTimeMillis()}")
            val ldStr = String(ldRes.bytes)
            if (ldStr.isEmpty()) return "LD_EMPTY"
            val ld = JSONObject(ldStr).optString("LD")
            val hash = sha256(sha256(password) + ld)
            val body = "isTest=false&goformId=LOGIN&user=admin&password=$hash"
            val loginRes = post("/goform/goform_set_cmd_process", body)
            val loginStr = String(loginRes.bytes)
            if (loginStr.contains("\"result\":0") || loginStr.contains("\"result\":\"0\"")) {
                loadDeviceMeta()
                // 尝试用 KeyStore 加密保存密码，如果失败则用 Base64 编码作为 fallback
                val encrypted = encryptPassword(password)
                encryptedPassword = encrypted ?: Base64.encodeToString(password.toByteArray(), Base64.NO_WRAP)
                Log.d(TAG, "[LOGIN] 登录成功, 密码已保存 (encrypted=${encrypted != null})")
                return "SUCCESS"
            }
            return "AUTH_FAILED: $loginStr"
        } catch (e: Exception) {
            return "ERROR: ${e.message}"
        }
    }

    fun dispatch(path: String, method: String, query: String?, postData: String?): ProxyResponse {
        return try {
            if (method == "POST" && postData != null) {
                Log.d(TAG, "[DISPATCH] POST $path | postData=$postData | waVer=$waVer crVer=$crVer | cookie=${activeCookie?.take(20)}...")
                if (waVer.isEmpty() || crVer.isEmpty()) {
                    Log.d(TAG, "[DISPATCH] waVer/crVer 为空，调用 loadDeviceMeta()")
                    loadDeviceMeta()
                    Log.d(TAG, "[DISPATCH] loadDeviceMeta 后: waVer=$waVer crVer=$crVer")
                }
                var rdRes = fetch("/goform/goform_get_cmd_process?isTest=false&cmd=RD&_=${System.currentTimeMillis()}")
                var rdStr = String(rdRes.bytes)
                Log.d(TAG, "[DISPATCH] 获取 RD 响应: ${rdStr.take(100)}")
                // 检测会话是否过期（RD 返回空或登录页面）
                if (rdStr.isBlank() || rdStr.contains("login") || rdStr.contains("Login")) {
                    Log.w(TAG, "[DISPATCH] Session expired, re-logging in...")
                    val savedPwd = decryptPassword()
                    if (savedPwd != null) {
                        val loginResult = doLogin(savedPwd)
                        Log.d(TAG, "[DISPATCH] 重登录结果: $loginResult, cookie=${activeCookie?.take(20)}...")
                        if (loginResult != "SUCCESS") {
                            return ProxyResponse("{\"error\":\"session_expired\",\"msg\":\"re-login failed: $loginResult\"}".toByteArray(), "application/json")
                        }
                        // 重新获取 RD
                        rdRes = fetch("/goform/goform_get_cmd_process?isTest=false&cmd=RD&_=${System.currentTimeMillis()}")
                        rdStr = String(rdRes.bytes)
                        Log.d(TAG, "[DISPATCH] 重登录后 RD 响应: ${rdStr.take(100)}")
                        if (rdStr.isBlank() || rdStr.contains("login")) {
                            return ProxyResponse("{\"error\":\"session_expired\",\"msg\":\"RD still empty after re-login\"}".toByteArray(), "application/json")
                        }
                    }
                }
                val rd = JSONObject(rdStr).optString("RD")
                val ad = sha256(sha256(waVer + crVer) + rd)
                Log.d(TAG, "[DISPATCH] RD=$rd, AD=$ad")

                val paramList = mutableListOf<String>()
                paramList.add("isTest=false") 
                if (postData.startsWith("postData=")) {
                    val decodedStr = URLDecoder.decode(postData.substring(9), "UTF-8")
                    // 尝试解析为 JSON，如果失败则视为 form-urlencoded 格式
                    try {
                        val json = JSONObject(decodedStr)
                        if (json.has("goformId")) paramList.add("goformId=${json.get("goformId")}")
                        val keys = json.keys()
                        while (keys.hasNext()) {
                            val key = keys.next()
                            if (key != "goformId" && key != "isTest") paramList.add("$key=${json.get(key)}")
                        }
                    } catch (e: Exception) {
                        // 不是 JSON 格式，直接作为 form-urlencoded 参数追加
                        paramList.add(decodedStr)
                    }
                } else {
                    paramList.add(postData)
                }
                paramList.add("AD=$ad")
                val finalBody = paramList.joinToString("&")
                Log.d(TAG, "[DISPATCH] >>> 发送 POST, body=$finalBody")
                val response = post(path, finalBody)
                // 检测 POST 响应是否也是过期（空或登录页面）
                val respStr = String(response.bytes)
                Log.d(TAG, "[DISPATCH] <<< POST 响应: ${respStr.take(200)}")
                if (respStr.isBlank() || (respStr.contains("login") && respStr.contains("password"))) {
                    Log.w(TAG, "[DISPATCH] POST response indicates session expired, retrying with re-login...")
                    val savedPwd = decryptPassword()
                    if (savedPwd != null) {
                        val loginResult = doLogin(savedPwd)
                        Log.d(TAG, "[DISPATCH] 重登录结果: $loginResult, cookie=${activeCookie?.take(20)}...")
                        if (loginResult == "SUCCESS") {
                            // 重新获取 RD 和 AD
                            val rdRes3 = fetch("/goform/goform_get_cmd_process?isTest=false&cmd=RD&_=${System.currentTimeMillis()}")
                            val rdStr3 = String(rdRes3.bytes)
                            Log.d(TAG, "[DISPATCH] 重试获取 RD 响应: ${rdStr3.take(100)}")
                            val rd3 = JSONObject(rdStr3).optString("RD")
                            val ad3 = sha256(sha256(waVer + crVer) + rd3)
                            Log.d(TAG, "[DISPATCH] 重试: RD=$rd3, AD=$ad3, waVer=$waVer, crVer=$crVer")
                            val paramList2 = mutableListOf<String>()
                            paramList2.add("isTest=false")
                            if (postData.startsWith("postData=")) {
                                val decodedStr2 = URLDecoder.decode(postData.substring(9), "UTF-8")
                                try {
                                    val json = JSONObject(decodedStr2)
                                    if (json.has("goformId")) paramList2.add("goformId=${json.get("goformId")}")
                                    val keys = json.keys()
                                    while (keys.hasNext()) {
                                        val key = keys.next()
                                        if (key != "goformId" && key != "isTest") paramList2.add("$key=${json.get(key)}")
                                    }
                                } catch (e: Exception) {
                                    paramList2.add(decodedStr2)
                                }
                            } else {
                                paramList2.add(postData)
                            }
                            paramList2.add("AD=$ad3")
                            val retryBody = paramList2.joinToString("&")
                            Log.d(TAG, "[DISPATCH] >>> 重试发送 POST, body=$retryBody")
                            val retryRes = post(path, retryBody)
                            val retryStr = String(retryRes.bytes)
                            Log.i(TAG, "[DISPATCH] <<< 重试 POST 响应: ${retryStr.take(200)}")
                            return retryRes
                        }
                    }
                }
                return response
            } else {
                val fullPath = if (!query.isNullOrEmpty()) "$path?$query" else path
                Log.d(TAG, "[DISPATCH] GET $fullPath | cookie=${activeCookie?.take(20)}...")
                val res = fetch(fullPath)
                Log.d(TAG, "[DISPATCH] GET 响应: ${String(res.bytes).take(200)}")
                res
            }
        } catch (e: Exception) {
            Log.e(TAG, "[DISPATCH] 异常: ${e.message}", e)
            ProxyResponse("{\"error\":\"${e.message}\"}".toByteArray(), "application/json")
        }
    }

    private fun loadDeviceMeta() {
        try {
            val resRes = fetch("/goform/goform_get_cmd_process?isTest=false&cmd=wa_inner_version,cr_version&multi_data=1")
            val res = JSONObject(String(resRes.bytes))
            waVer = res.optString("wa_inner_version")
            crVer = res.optString("cr_version")
        } catch (e: Exception) {}
    }

    private fun fetch(path: String): ProxyResponse {
        val currentIp = getGatewayIp()
        val url = if (path.startsWith("http")) path else "http://$currentIp:$PORT${if (path.startsWith("/")) "" else "/"}$path"
        val req = Request.Builder()
            .url(url)
            .header("Host", currentIp)
            .header("Referer", "http://$currentIp/index.html")
            .header("User-Agent", "Mozilla/5.0")
            .apply { activeCookie?.let { header("Cookie", it) } }
            .get()
            .build()
        return execute(req)
    }

    private fun post(path: String, body: String): ProxyResponse {
        val currentIp = getGatewayIp()
        val url = if (path.startsWith("http")) path else "http://$currentIp:$PORT${if (path.startsWith("/")) "" else "/"}$path"
        val req = Request.Builder()
            .url(url)
            .header("Host", currentIp)
            .header("Referer", "http://$currentIp/index.html")
            .post(body.toRequestBody("application/x-www-form-urlencoded".toMediaType()))
            .apply { activeCookie?.let { header("Cookie", it) } }
            .build()
        return execute(req)
    }

    private fun execute(req: Request): ProxyResponse {
        return try {
            client.newCall(req).execute().use { res ->
                res.header("Set-Cookie")?.let { activeCookie = it.split(";")[0] }
                val bytes = res.body?.bytes() ?: ByteArray(0)
                val contentType = res.header("Content-Type")
                ProxyResponse(bytes, contentType)
            }
        } catch (e: Exception) {
            ProxyResponse("{}".toByteArray(), "application/json")
        }
    }

    private fun sha256(input: String): String {
        if (input.isEmpty()) return ""
        val bytes = MessageDigest.getInstance("SHA-256").digest(input.toByteArray())
        return bytes.joinToString("") { "%02x".format(it) }.uppercase()
    }

    /**
     * 使用 Android KeyStore + AES-GCM 加密密码
     * 密钥存储在硬件安全模块（TEE）中，即使 root 也无法提取
     */
    private fun encryptPassword(password: String): String? {
        return try {
            val secretKey = getOrCreateKey()
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, secretKey)
            val iv = cipher.iv
            val encrypted = cipher.doFinal(password.toByteArray(Charsets.UTF_8))
            // 格式: Base64(IV + 密文)
            val combined = iv + encrypted
            Base64.encodeToString(combined, Base64.NO_WRAP)
        } catch (e: Exception) {
            Log.e(TAG, "Encrypt password failed", e)
            null
        }
    }

    /**
     * 使用 Android KeyStore + AES-GCM 解密密码
     */
    private fun decryptPassword(): String? {
        val encrypted = encryptedPassword ?: return null
        // 先尝试用 KeyStore AES-GCM 解密
        try {
            val secretKey = getOrCreateKey()
            val combined = Base64.decode(encrypted, Base64.NO_WRAP)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            val iv = combined.copyOfRange(0, 12)
            val encryptedData = combined.copyOfRange(12, combined.size)
            val spec = GCMParameterSpec(128, iv)
            cipher.init(Cipher.DECRYPT_MODE, secretKey, spec)
            val decrypted = cipher.doFinal(encryptedData)
            return String(decrypted, Charsets.UTF_8)
        } catch (e: Exception) {
            Log.d(TAG, "[DECRYPT] KeyStore 解密失败，尝试 Base64 fallback: ${e.message}")
        }
        // fallback: 如果 KeyStore 不可用，尝试用 Base64 解码（兼容之前用 Base64 保存的密码）
        return try {
            String(Base64.decode(encrypted, Base64.NO_WRAP), Charsets.UTF_8)
        } catch (e: Exception) {
            Log.e(TAG, "[DECRYPT] Base64 fallback 也失败", e)
            null
        }
    }

    /**
     * 从 Android KeyStore 获取或创建 AES 密钥
     * 密钥存储在 TEE 中，应用只能使用不能导出
     */
    private fun getOrCreateKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore")
        keyStore.load(null)
        keyStore.getEntry(KEYSTORE_ALIAS, null)?.let {
            return (it as KeyStore.SecretKeyEntry).secretKey
        }
        val keyGenerator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            "AndroidKeyStore"
        )
        val spec = KeyGenParameterSpec.Builder(
            KEYSTORE_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build()
        keyGenerator.init(spec)
        return keyGenerator.generateKey()
    }
}
