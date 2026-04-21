package com.opengw.manager

import android.content.Context
import android.os.Build
import android.util.Log
import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.cio.*
import io.ktor.server.engine.*
import io.ktor.server.plugins.callloging.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import io.ktor.server.websocket.*
import io.ktor.websocket.*
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.consumeEach
import org.slf4j.event.Level
import java.io.InputStream
import java.util.*
import org.json.JSONObject
import android.app.ActivityManager
import android.os.Environment
import android.os.StatFs
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager

/**
 * 终极高性能 Ktor 服务器 - 诊断与投屏增强版 (v1.9.4)
 */
class CoreWebServer(private val context: Context, private val port: Int) {
    private val TAG = "TRAFFIC_SNIFFER"
    private val bridge = BridgeProtocol(context)
    private val mihomo = MihomoManager() 
    private val adb = AdbManager() 
    private val ttyd = TtydManager()
    private val atManager = AtManager()
    private val remote = RemoteControlManager()
    private val scrcpy = ScrcpyManager(context)
    private val batteryStats = BatteryStatsManager(context)
    private val sysStats = SystemStatsManager() // 引入高性能系统统计
    private var server: ApplicationEngine? = null

    fun start() {
        server = embeddedServer(CIO, port = port, host = "0.0.0.0") {
            install(CallLogging) { level = Level.INFO }
            install(WebSockets) {
                pingPeriod = java.time.Duration.ofSeconds(15)
                timeout = java.time.Duration.ofSeconds(30)
                maxFrameSize = 10 * 1024 * 1024
                masking = false
            }

            routing {
                get("/api/status") {
                    val status = JSONObject().apply {
                        put("model", Build.MODEL)
                        put("manufacturer", Build.MANUFACTURER)
                        put("kernel", System.getProperty("os.version") ?: "Unknown")
                        put("android_ver", Build.VERSION.RELEASE)
                        put("uptime", getAndroidUptime())
                        
                        val batteryIntent = this@CoreWebServer.context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
                        val level = batteryIntent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
                        val scale = batteryIntent?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
                        val temp = batteryIntent?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0) ?: 0
                        val batStatus = batteryIntent?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
                        val isCharging = batStatus == BatteryManager.BATTERY_STATUS_CHARGING || batStatus == BatteryManager.BATTERY_STATUS_FULL
                        
                        val batteryPct = if (level != -1 && scale != -1) (level * 100 / scale.toFloat()).toInt() else 0
                        put("battery_level", batteryPct)
                        put("battery_temp", temp / 10.0) 
                        put("is_charging", isCharging)
                        
                        batteryStats.updateStats(batteryPct, isCharging)
                        
                        val memInfo = ActivityManager.MemoryInfo()
                        (this@CoreWebServer.context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(memInfo)
                        val totalMem = memInfo.totalMem / (1024 * 1024)
                        val availMem = memInfo.availMem / (1024 * 1024)
                        put("mem_total", totalMem)
                        put("mem_used", totalMem - availMem)
                        put("memory_usage", ((totalMem - availMem) * 100 / totalMem).toInt())
                        
                        val stat = StatFs(Environment.getDataDirectory().path)
                        val totalStorage = (stat.blockCountLong * stat.blockSizeLong) / (1024 * 1024)
                        val availStorage = (stat.availableBlocksLong * stat.blockSizeLong) / (1024 * 1024)
                        put("storage_total", totalStorage)
                        put("storage_used", totalStorage - availStorage)
                        put("storage_usage", ((totalStorage - availStorage) * 100 / totalStorage).toInt())
                        put("cpu_usage", sysStats.getDetailedStats().optJSONObject("cpu")?.optInt("total_usage", 5) ?: 5)
                    }
                    call.respondText(status.toString(), ContentType.Application.Json)
                }

                // 高精度性能详情 API
                get("/api/system/details") {
                    call.respondText(sysStats.getDetailedStats().toString(), ContentType.Application.Json)
                }

                get("/api/battery/history") {
                    call.respondText(batteryStats.getHistory(), ContentType.Application.Json)
                }

                webSocket("/api/remote/control") {
                    try {
                        remote.startStreaming(this)
                        incoming.consumeEach { frame ->
                            if (frame is Frame.Text) {
                                val json = JSONObject(frame.readText())
                                remote.injectInput(
                                    action = json.optString("action"),
                                    x = json.optInt("x"),
                                    y = json.optInt("y"),
                                    x2 = json.optInt("x2", 0),
                                    y2 = json.optInt("y2", 0),
                                    key = json.optString("key", null)
                                )
                            }
                        }
                    } catch (e: Exception) {
                        Log.e("WS_DEBUG", "WS Error: ${e.message}")
                    } finally {
                        remote.stopStreaming()
                    }
                }

                webSocket("/ws/scrcpy") {
                    try {
                        scrcpy.startServer()
                        scrcpy.handleWebSocket(this)
                    } catch (e: Exception) {
                        Log.e("WS_SCRCPY", "Error: ${e.message}")
                    }
                }

                get("/api/scrcpy/start") {
                    scrcpy.startServer()
                    call.respondText("{\"result\":\"Command sent\"}", ContentType.Application.Json)
                }

                get("/api/at/send") {
                    val cmd = call.request.queryParameters["cmd"] ?: ""
                    val phoneId = call.request.queryParameters["n"]?.toIntOrNull() ?: 0
                    val result = withContext(Dispatchers.IO) { atManager.sendAt(cmd, phoneId) }
                    call.respondText(JSONObject().apply { put("result", result) }.toString(), ContentType.Application.Json)
                }

                route("/api/proxy/{...}") {
                    handle {
                        val path = call.request.uri.removePrefix("/api/proxy")
                        val method = call.request.httpMethod.value
                        val query = call.request.queryString()
                        val postData = if (method == "POST") call.receiveText() else null
                        val response = withContext(Dispatchers.IO) { bridge.dispatch(path, method, if (query.isEmpty()) null else query, postData) }
                        val ct = response.contentType?.let { ContentType.parse(it) } ?: ContentType.Application.OctetStream
                        call.respondBytes(response.bytes, ct)
                    }
                }

                get("/api/mihomo/status") { call.respondText(mihomo.getStatus().toString(), ContentType.Application.Json) }
                post("/api/mihomo/action") { 
                    val res = mihomo.doAction(call.request.queryParameters["action"] ?: "", call.request.queryParameters["sub"])
                    call.respondText(JSONObject().apply { put("result", res) }.toString(), ContentType.Application.Json) 
                }
                get("/api/mihomo/log") { call.respondText(mihomo.getLogs(), ContentType.Text.Plain) }
                get("/api/adb/status") { call.respondText(adb.getStatus().toString(), ContentType.Application.Json) }
                post("/api/adb/action") { call.respondText(JSONObject().apply { put("result", adb.doAction(call.request.queryParameters["action"] ?: "")) }.toString(), ContentType.Application.Json) }
                get("/api/ttyd/status") { call.respondText(ttyd.getStatus().toString(), ContentType.Application.Json) }
                post("/api/ttyd/start") { call.respondText(JSONObject().apply { put("result", ttyd.start()) }.toString(), ContentType.Application.Json) }
                post("/api/ttyd/stop") { call.respondText(JSONObject().apply { put("result", ttyd.stop()) }.toString(), ContentType.Application.Json) }
                post("/api/auth/login") {
                    val pass = call.request.queryParameters["password"] ?: ""
                    val result = withContext(Dispatchers.IO) { bridge.doLogin(pass) }
                    call.respondText(if (result == "SUCCESS") "{\"result\":0, \"token\":\"session-ok\"}" else "{\"result\":-1, \"msg\":\"$result\"}", ContentType.Application.Json)
                }
                get("{...}") {
                    val rawPath = call.request.path().removePrefix("/")
                    val path = if (rawPath.isBlank()) "index.html" else rawPath
                    try {
                        val inputStream: InputStream = this@CoreWebServer.context.assets.open("web/$path")
                        call.respondBytes(inputStream.readBytes(), ContentType.parse(getMimeType(path)))
                    } catch (e: Exception) { call.respond(HttpStatusCode.NotFound) }
                }
            }
        }.start(wait = false)
    }

    private fun getAndroidUptime(): String {
        val uptimeMillis = android.os.SystemClock.elapsedRealtime()
        val days = uptimeMillis / (24 * 60 * 60 * 1000)
        val hours = (uptimeMillis % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000)
        val minutes = (uptimeMillis % (60 * 60 * 1000)) / (60 * 1000)
        return if (days > 0) "${days}d ${hours}h ${minutes}m" else "${hours}h ${minutes}m"
    }

    private fun getMimeType(path: String): String {
        return when {
            path.endsWith(".css") -> "text/css"
            path.endsWith(".js") -> "application/javascript"
            path.endsWith(".html") -> "text/html"
            path.endsWith(".svg") -> "image/svg+xml"
            path.endsWith(".png") -> "image/png"
            else -> "text/plain"
        }
    }

    fun stop() { 
        server?.stop(1000, 2000) 
        scrcpy.stopServer()
    }
}
