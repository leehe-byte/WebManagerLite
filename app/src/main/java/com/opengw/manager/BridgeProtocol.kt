package com.opengw.manager

import android.content.Context
import android.util.Log
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.net.NetworkInterface
import java.net.URLDecoder
import java.security.MessageDigest
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

    private var activeCookie: String? = null
    private var waVer: String = ""
    private var crVer: String = ""

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
                if (waVer.isEmpty() || crVer.isEmpty()) loadDeviceMeta()
                val rdRes = fetch("/goform/goform_get_cmd_process?isTest=false&cmd=RD&_=${System.currentTimeMillis()}")
                val rd = JSONObject(String(rdRes.bytes)).optString("RD")
                val ad = sha256(sha256(waVer + crVer) + rd)

                val paramList = mutableListOf<String>()
                paramList.add("isTest=false") 
                if (postData.startsWith("postData=")) {
                    val jsonStr = URLDecoder.decode(postData.substring(9), "UTF-8")
                    val json = JSONObject(jsonStr)
                    if (json.has("goformId")) paramList.add("goformId=${json.get("goformId")}")
                    val keys = json.keys()
                    while (keys.hasNext()) {
                        val key = keys.next()
                        if (key != "goformId" && key != "isTest") paramList.add("$key=${json.get(key)}")
                    }
                } else {
                    paramList.add(postData)
                }
                paramList.add("AD=$ad")
                post(path, paramList.joinToString("&"))
            } else {
                val fullPath = if (!query.isNullOrEmpty()) "$path?$query" else path
                fetch(fullPath)
            }
        } catch (e: Exception) {
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
}
