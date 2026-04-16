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
            webServer = CoreWebServer(this, 8000)
            webServer?.start()
            Log.i(TAG, "Ktor 服务器已在服务中启动")
        }
    }

    private fun startHeartbeat() {
        scheduler = Executors.newSingleThreadScheduledExecutor()
        scheduler?.scheduleAtFixedRate({
            Log.d(TAG, "💓 心跳检查: 服务存活中，网关状态正常")
        }, 0, 20, TimeUnit.SECONDS)
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
