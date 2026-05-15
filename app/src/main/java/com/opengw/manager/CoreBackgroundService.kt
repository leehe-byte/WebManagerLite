package com.opengw.manager

import android.app.*
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

class CoreBackgroundService : Service() {
    private val TAG = "保活服务"
    private val CHANNEL_ID = "WebManagerLite_Service"
    private val NOTIFICATION_ID = 1001
    
    private var webServer: CoreWebServer? = null
    private var wakeLockManager: WakeLockManager? = null
    private var heartbeatScheduler: ScheduledExecutorService? = null
    private var usbDetectScheduler: ScheduledExecutorService? = null

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "服务创建中...")
        wakeLockManager = WakeLockManager(this)
        wakeLockManager?.acquire("CoreService")
        
        startForegroundService()
        startWebServer()
        startHeartbeat()
        startUsbDetect()
    }

    private fun startForegroundService() {
        val channelName = "网关管理后台服务"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val chan = NotificationChannel(CHANNEL_ID, channelName, NotificationManager.IMPORTANCE_LOW)
            chan.lightColor = Color.BLUE
            chan.lockscreenVisibility = Notification.VISIBILITY_PRIVATE
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(chan)
        }

        val notificationIntent = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, notificationIntent,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
        )

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setOngoing(true)
            .setSmallIcon(android.R.drawable.ic_menu_compass)
            .setContentTitle("网关管理服务运行中")
            .setContentText("正在监控网络状态并提供 Web 服务")
            .setCategory(Notification.CATEGORY_SERVICE)
            .setContentIntent(pendingIntent)
            .build()

        startForeground(NOTIFICATION_ID, notification)
    }

    private fun startWebServer() {
        if (webServer == null) {
            val sp = getSharedPreferences("server_config", Context.MODE_PRIVATE)
            val port = sp.getInt("server_port", 8000)
            webServer = CoreWebServer(this, port)
            webServer?.start()
            Log.i(TAG, "Ktor 服务器已在服务中启动 (端口: $port)")
        }
    }

    private var lastUsb0Up: Boolean? = null
    private var wifiAutoSwitchEnabled: Boolean = false
    private var bridgeProtocol: BridgeProtocol? = null

    private fun startHeartbeat() {
        heartbeatScheduler = Executors.newSingleThreadScheduledExecutor()
        heartbeatScheduler?.scheduleAtFixedRate({
            Log.d(TAG, "💓 心跳检查: 服务存活中，网关状态正常")
        }, 0, 30, TimeUnit.SECONDS)
    }

    private fun startUsbDetect() {
        usbDetectScheduler = Executors.newSingleThreadScheduledExecutor()
        usbDetectScheduler?.scheduleAtFixedRate({
            checkAutoWifiSwitch()
        }, 0, 2, TimeUnit.SECONDS)
    }

    /**
     * 检测 usb0 状态并自动开关 WiFi
     * 当有设备通过 USB (RNDIS/ECM) 连接时关闭 WiFi，断开时重新打开 WiFi
     */
    private fun checkAutoWifiSwitch() {
        try {
            // 读取配置（使用应用私有目录）
            val configFile = java.io.File(this.filesDir, "auto_wifi_switch.json")
            if (!configFile.exists()) {
                Log.d(TAG, "[USB_WIFI] 配置文件不存在，跳过")
                return
            }
            val config = org.json.JSONObject(configFile.readText())
            if (!config.optBoolean("enabled", false)) {
                Log.d(TAG, "[USB_WIFI] 功能未开启，跳过")
                return
            }

            // 检测 usb0 状态
            val operstateFile = java.io.File("/sys/class/net/usb0/operstate")
            val isUp = try {
                operstateFile.readText().trim() == "up"
            } catch (e: Exception) {
                Log.d(TAG, "[USB_WIFI] 读取 usb0 状态失败: ${e.message}")
                false
            }

            Log.d(TAG, "[USB_WIFI] 当前 usb0=${if (isUp) "UP" else "DOWN"}, lastUsb0Up=$lastUsb0Up")
            if (lastUsb0Up == isUp) return // 状态未变化，跳过
            lastUsb0Up = isUp

            Log.i(TAG, "[USB_WIFI] USB0 状态变化: ${if (isUp) "UP" else "DOWN"}, 开始处理...")

            // 使用单例 BridgeProtocol，避免每次新建实例导致 Cookie/密码丢失
            if (bridgeProtocol == null) {
                bridgeProtocol = BridgeProtocol(this)
                Log.d(TAG, "[USB_WIFI] 创建 BridgeProtocol 单例 (hash=${System.identityHashCode(bridgeProtocol)})")
            }
            val bridge = bridgeProtocol!!
            Log.d(TAG, "[USB_WIFI] 使用 BridgeProtocol 单例 (hash=${System.identityHashCode(bridge)})")

            // 确保已登录：如果 encryptedPassword 为 null，说明从未登录过，先登录一次
            // 密码从 SharedPreferences 中读取（前端登录时保存的）
            if (BridgeProtocol.getEncryptedPassword() == null) {
                Log.d(TAG, "[USB_WIFI] encryptedPassword 为空，尝试从 SharedPreferences 读取密码并登录...")
                val sp = getSharedPreferences("bridge_config", Context.MODE_PRIVATE)
                val savedPwd = sp.getString("password", null)
                if (savedPwd != null) {
                    val loginResult = bridge.doLogin(savedPwd)
                    Log.d(TAG, "[USB_WIFI] 主动登录结果: $loginResult")
                } else {
                    Log.w(TAG, "[USB_WIFI] SharedPreferences 中也没有密码，跳过登录")
                }
            }

            // 获取当前 WiFi 频段信息，确定用哪个 chip
            Log.d(TAG, "[USB_WIFI] 开始获取 WiFi 频段信息...")
            val infoRes = bridge.dispatch("/goform/goform_get_cmd_process", "GET", "isTest=false&cmd=queryAccessPointInfo&multi_data=1", null)
            val infoStr = String(infoRes.bytes)
            Log.d(TAG, "[USB_WIFI] WiFi 信息响应: ${infoStr.take(200)}")
            val info = org.json.JSONObject(infoStr)
            val responseList = info.optJSONArray("ResponseList")
            var currentChip = "chip1" // 默认 2.4G
            if (responseList != null && responseList.length() >= 2) {
                val ap0 = responseList.getJSONObject(0)
                val ap1 = responseList.getJSONObject(1)
                val ap0Status = ap0.optString("AccessPointSwitchStatus")
                val ap1Status = ap1.optString("AccessPointSwitchStatus")
                Log.d(TAG, "[USB_WIFI] AP0(2.4G) status=$ap0Status, AP1(5G) status=$ap1Status")
                if (ap1Status == "1") {
                    currentChip = "chip2" // 5G
                }
            }
            Log.d(TAG, "[USB_WIFI] 当前频段: $currentChip")

            if (isUp) {
                // USB 已连接 → 关闭 WiFi
                val payload = "goformId=switchWiFiModule&SwitchOption=0"
                Log.d(TAG, "[USB_WIFI] >>> 发送关闭 WiFi 请求, payload=$payload")
                val res = bridge.dispatch("/goform/goform_set_cmd_process", "POST", null, payload)
                val resStr = String(res.bytes)
                Log.i(TAG, "[USB_WIFI] <<< 关闭 WiFi 响应: ${resStr.take(200)}")
                // 如果响应为空，可能是会话问题，再试一次
                if (resStr.isBlank()) {
                    Log.w(TAG, "[USB_WIFI] 关闭 WiFi 响应为空，1秒后重试...")
                    Thread.sleep(1000)
                    val retryRes = bridge.dispatch("/goform/goform_set_cmd_process", "POST", null, payload)
                    val retryStr = String(retryRes.bytes)
                    Log.i(TAG, "[USB_WIFI] <<< 重试关闭 WiFi 响应: ${retryStr.take(200)}")
                }
                Log.i(TAG, "[USB_WIFI] USB 设备连接，已关闭 WiFi")
            } else {
                // USB 断开 → 打开 WiFi（恢复之前频段）
                val payload = "goformId=switchWiFiChip&ChipEnum=$currentChip&GuestEnable=0"
                Log.d(TAG, "[USB_WIFI] >>> 发送开启 WiFi 请求, payload=$payload")
                val res = bridge.dispatch("/goform/goform_set_cmd_process", "POST", null, payload)
                val resStr = String(res.bytes)
                Log.i(TAG, "[USB_WIFI] <<< 开启 WiFi 响应: ${resStr.take(200)}")
                // 如果响应为空，可能是会话问题，再试一次
                if (resStr.isBlank()) {
                    Log.w(TAG, "[USB_WIFI] 开启 WiFi 响应为空，1秒后重试...")
                    Thread.sleep(1000)
                    val retryRes = bridge.dispatch("/goform/goform_set_cmd_process", "POST", null, payload)
                    val retryStr = String(retryRes.bytes)
                    Log.i(TAG, "[USB_WIFI] <<< 重试开启 WiFi 响应: ${retryStr.take(200)}")
                }
                Log.i(TAG, "[USB_WIFI] USB 设备断开，已恢复 WiFi ($currentChip)")
            }
        } catch (e: Exception) {
            Log.e(TAG, "[USB_WIFI] Auto WiFi switch failed", e)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.i(TAG, "服务指令接收: START_STICKY")
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        Log.w(TAG, "服务正在销毁，尝试释放资源")
        heartbeatScheduler?.shutdownNow()
        usbDetectScheduler?.shutdownNow()
        webServer?.stop()
        wakeLockManager?.release()
        super.onDestroy()
    }
}
