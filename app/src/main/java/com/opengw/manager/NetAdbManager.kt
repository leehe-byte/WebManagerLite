package com.opengw.manager

import android.util.Log
import org.json.JSONObject
import java.io.BufferedReader
import java.io.DataOutputStream
import java.io.InputStreamReader
import java.util.concurrent.TimeUnit

/**
 * 网络 ADB 控制：通过 root setprop 开/关网络 adb 调试端口。
 * 仅控制 service.adb.tcp.port 与 adbd，不依赖任何外部脚本/模块。
 */
class NetAdbManager {
    private val TAG = "NetAdbManager"

    fun getStatus(): JSONObject {
        val res = JSONObject()
        try {
            val port = runRoot("getprop service.adb.tcp.port").trim()
            val enabled = port.isNotEmpty() && port != "-1" && port != "0" && port != "null"
            res.put("enabled", enabled)
            res.put("port", if (enabled) port.toIntOrNull() ?: -1 else -1)
        } catch (e: Exception) {
            Log.e(TAG, "getStatus error", e)
            res.put("enabled", false).put("port", -1)
        }
        return res
    }

    fun setEnabled(enable: Boolean, port: Int): JSONObject {
        val res = JSONObject()
        val safePort = if (port in 1..65535) port else 5555
        val cmd = if (enable) {
            "setprop service.adb.tcp.port $safePort; " +
            "setprop persist.service.adb.enable 1; " +
            "stop adbd; start adbd"
        } else {
            "setprop service.adb.tcp.port -1; " +
            "setprop persist.service.adb.enable 0; " +
            "stop adbd; start adbd"
        }
        val out = runRoot(cmd)
        Log.i(TAG, "setEnabled($enable, $safePort) -> $out")
        return res.put("result", "success").put("output", out.take(300))
    }

    private fun runRoot(command: String): String {
        var process: Process? = null
        var os: DataOutputStream? = null
        var input: BufferedReader? = null
        try {
            process = Runtime.getRuntime().exec("su")
            os = DataOutputStream(process.outputStream)
            input = BufferedReader(InputStreamReader(process.inputStream))
            os.writeBytes("$command\nexit\n")
            os.flush()
            val output = StringBuilder()
            var line: String?
            while (input.readLine().also { line = it } != null) {
                output.append(line).append("\n")
            }
            if (!process.waitFor(10, TimeUnit.SECONDS)) {
                process.destroy()
                return "(timeout)"
            }
            return output.toString().trim()
        } catch (e: Exception) {
            Log.e(TAG, "Root command error: ${e.message}")
            return ""
        } finally {
            try {
                os?.close()
                input?.close()
                process?.destroy()
            } catch (e: Exception) {}
        }
    }
}
