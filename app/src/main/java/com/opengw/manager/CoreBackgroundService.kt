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
            checkUsbAndSwitchWifi()
        }, 0, 2, TimeUnit.SECONDS)
    }

    /**
     * 检测 usb0 状态并自动开关 WiFi
     * 
     * 逻辑非常简单：
     * 1. 一直检查 usb0 状态
     * 2. usb0 UP → 发 SwitchOption=0 关 WiFi
     * 3. usb0 DOWN → 查 queryAccessPointInfo 看哪个 AP 的 AccessPointSwitchStatus=1
     *    然后发 ChipEnum=chip1/chip2 开对应频段
     */
    private fun checkUsbAndSwitchWifi() {
        try {
            // 检测 usb0 状态
            val operstateFile = java.io.File("/sys/class/net/usb0/operstate")
            val isUp = try {
                operstateFile.readText().trim() == "up"
            } catch (e: Exception) {
                false
            }

            if (lastUsb0Up == isUp) return // 状态未变化，跳过
            lastUsb0Up = isUp

            Log.i(TAG, "[USB_WIFI] usb0 状态变化: ${if (isUp) "UP" else "DOWN"}")

            // 使用单例 BridgeProtocol
            if (bridgeProtocol == null) {
                bridgeProtocol = BridgeProtocol(this)
            }
            val bridge = bridgeProtocol!!

            if (isUp) {
                // usb0 UP → 关闭 WiFi（仿照 wifi.js 中 SwitchOption=0）
                Log.d(TAG, "[USB_WIFI] >>> 发送关闭 WiFi: goformId=switchWiFiModule&SwitchOption=0")
                val res = bridge.dispatch("/goform/goform_set_cmd_process", "POST", null, "goformId=switchWiFiModule&SwitchOption=0")
                Log.i(TAG, "[USB_WIFI] <<< 关闭 WiFi 响应: ${String(res.bytes).take(200)}")
            } else {
                // usb0 DOWN → 查询当前哪个 AP 开着，恢复对应频段
                Log.d(TAG, "[USB_WIFI] >>> 查询 WiFi 频段信息...")
                val infoRes = bridge.dispatch("/goform/goform_get_cmd_process", "GET", "isTest=false&cmd=queryAccessPointInfo&multi_data=1", null)
                val infoStr = String(infoRes.bytes)
                val info = org.json.JSONObject(infoStr)
                val list = info.optJSONArray("ResponseList")
                var chip = "chip1" // 默认 2.4G
                if (list != null && list.length() >= 2) {
                    val ap0 = list.getJSONObject(0)
                    val ap1 = list.getJSONObject(1)
                    val ap0Status = ap0.optString("AccessPointSwitchStatus")
                    val ap1Status = ap1.optString("AccessPointSwitchStatus")
                    Log.d(TAG, "[USB_WIFI] AP0(2.4G) status=$ap0Status, AP1(5G) status=$ap1Status")
                    if (ap1Status == "1") chip = "chip2"
                }
                Log.d(TAG, "[USB_WIFI] >>> 发送开启 WiFi: goformId=switchWiFiChip&ChipEnum=$chip&GuestEnable=0")
                val res = bridge.dispatch("/goform/goform_set_cmd_process", "POST", null, "goformId=switchWiFiChip&ChipEnum=$chip&GuestEnable=0")
                Log.i(TAG, "[USB_WIFI] <<< 开启 WiFi 响应: ${String(res.bytes).take(200)}")
            }
        } catch (e: Exception) {
            Log.e(TAG, "[USB_WIFI] 异常", e)
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
