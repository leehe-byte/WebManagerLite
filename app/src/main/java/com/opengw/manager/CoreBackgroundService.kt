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
    private var scheduler: ScheduledExecutorService? = null

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "服务创建中...")
        wakeLockManager = WakeLockManager(this)
        wakeLockManager?.acquire("CoreService")
        
        startForegroundService()
        startWebServer()
        startHeartbeat()
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

    private fun startHeartbeat() {
        scheduler = Executors.newSingleThreadScheduledExecutor()
        scheduler?.scheduleAtFixedRate({
            Log.d(TAG, "💓 心跳检查: 服务存活中，网关状态正常")
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
            if (!configFile.exists()) return
            val config = org.json.JSONObject(configFile.readText())
            if (!config.optBoolean("enabled", false)) return

            // 检测 usb0 状态
            val operstateFile = java.io.File("/sys/class/net/usb0/operstate")
            val isUp = try {
                operstateFile.readText().trim() == "up"
            } catch (e: Exception) { false }

            if (lastUsb0Up == isUp) return // 状态未变化，跳过
            lastUsb0Up = isUp

            Log.i(TAG, "USB0 状态变化: ${if (isUp) "UP" else "DOWN"}, 自动开关WiFi")

            // 获取当前 WiFi 频段信息，确定用哪个 chip
            val bridge = BridgeProtocol(this)
            val infoRes = bridge.dispatch("/goform/goform_get_cmd_process", "GET", "isTest=false&cmd=queryAccessPointInfo&multi_data=1", null)
            val infoStr = String(infoRes.bytes)
            val info = org.json.JSONObject(infoStr)
            val responseList = info.optJSONArray("ResponseList")
            var currentChip = "chip1" // 默认 2.4G
            if (responseList != null && responseList.length() >= 2) {
                val ap0 = responseList.getJSONObject(0)
                val ap1 = responseList.getJSONObject(1)
                if (ap1.optString("AccessPointSwitchStatus") == "1") {
                    currentChip = "chip2" // 5G
                }
            }

            if (isUp) {
                // USB 已连接 → 关闭 WiFi
                // dispatch() 会自动添加 isTest=false 和 AD 参数，所以 payload 中不需要 isTest=false
                val payload = "goformId=switchWiFiModule&SwitchOption=0"
                bridge.dispatch("/goform/goform_set_cmd_process", "POST", null, payload)
                Log.i(TAG, "USB 设备连接，已关闭 WiFi")
            } else {
                // USB 断开 → 打开 WiFi（恢复之前频段）
                val payload = "goformId=switchWiFiChip&ChipEnum=$currentChip&GuestEnable=0"
                bridge.dispatch("/goform/goform_set_cmd_process", "POST", null, payload)
                Log.i(TAG, "USB 设备断开，已恢复 WiFi ($currentChip)")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Auto WiFi switch failed", e)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.i(TAG, "服务指令接收: START_STICKY")
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        Log.w(TAG, "服务正在销毁，尝试释放资源")
        scheduler?.shutdownNow()
        webServer?.stop()
        wakeLockManager?.release()
        super.onDestroy()
    }
}
