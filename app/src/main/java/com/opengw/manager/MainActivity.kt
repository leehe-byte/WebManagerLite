package com.opengw.manager

import android.Manifest
import android.app.AppOpsManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import java.net.NetworkInterface

class MainActivity : AppCompatActivity() {

    private val requestPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val allGranted = permissions.all { it.value }
        if (!allGranted) {
            Toast.makeText(this, "保活需要相关权限，请在设置中手动开启", Toast.LENGTH_LONG).show()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        val infoText = findViewById<TextView>(R.id.infoText)
        
        checkAndRequestPermissions()
        startCoreService()

        val ip = getLocalIpAddress()
        val verName = packageManager.getPackageInfo(packageName, 0).versionName
        
        infoText.text = """
            🚀 OpenGW Lite Manager
            -----------------------
            版本: v$verName
            状态: 服务器已启动
            
            管理地址: 
            http://$ip:8000
            
            (请保持此应用在后台运行)
        """.trimIndent()
    }

    private fun checkAndRequestPermissions() {
        val permissions = mutableListOf(Manifest.permission.READ_SMS, Manifest.permission.RECEIVE_SMS)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions.add(Manifest.permission.POST_NOTIFICATIONS)
        }
        requestPermissionLauncher.launch(permissions.toTypedArray())

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            if (!pm.isIgnoringBatteryOptimizations(packageName)) {
                try {
                    val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                        data = Uri.parse("package:$packageName")
                    }
                    startActivity(intent)
                } catch (e: Exception) {
                    val intent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
                    startActivity(intent)
                }
            }
        }

        if (!hasUsageStatsPermission()) {
            Toast.makeText(this, "请开启'使用情况访问'", Toast.LENGTH_LONG).show()
            startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
        }
    }

    private fun hasUsageStatsPermission(): Boolean {
        val appOps = getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            appOps.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, android.os.Process.myUid(), packageName)
        } else {
            appOps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, android.os.Process.myUid(), packageName)
        }
        return mode == AppOpsManager.MODE_ALLOWED
    }

    private fun startCoreService() {
        val intent = Intent(this, CoreBackgroundService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
    }

    /**
     * 优化：根据网卡名称优先级获取真实的局域网地址
     */
    fun getLocalIpAddress(): String {
        try {
            val interfaces = NetworkInterface.getNetworkInterfaces().toList()
            
            // 优先级 1: br0 (网桥，随身WiFi最常见)
            val br0 = interfaces.find { it.name == "br0" }
            br0?.inetAddresses?.toList()?.find { !it.isLoopbackAddress && it.address.size == 4 }?.let {
                return it.hostAddress
            }

            // 优先级 2: wlan0 (标准无线网卡)
            val wlan0 = interfaces.find { it.name == "wlan0" }
            wlan0?.inetAddresses?.toList()?.find { !it.isLoopbackAddress && it.address.size == 4 }?.let {
                return it.hostAddress
            }

            // 优先级 3: 兜底逻辑，排除 Meta/tun/rmnet 等虚拟或广域网卡
            for (iface in interfaces) {
                if (iface.name.contains("Meta") || iface.name.contains("tun") || iface.name.contains("rmnet")) continue
                val addr = iface.inetAddresses.toList().find { !it.isLoopbackAddress && it.address.size == 4 }
                if (addr != null) return addr.hostAddress
            }
        } catch (e: Exception) {}
        return "127.0.0.1"
    }
}
