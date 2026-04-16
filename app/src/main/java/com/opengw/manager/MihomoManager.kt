package com.opengw.manager

import android.util.Log
import org.json.JSONObject
import java.io.BufferedReader
import java.io.DataOutputStream
import java.io.InputStreamReader

class MihomoManager {
    private val TAG = "MihomoManager"
    private val SCRIPT_PATH = "/system/bin/mihomo"
    private val CONFIG_PATH = "/data/mihomo/config.yaml"
    private val LOG_PATH = "/sdcard/mihomo.log"

    fun getStatus(): JSONObject {
        val res = JSONObject()
        try {
            val runningOut = runRootCommand("$SCRIPT_PATH status")
            res.put("running", runningOut.contains("已经在运行") || runningOut.contains("PID"))

            // 修复点：更精确地判断自启动状态，避免“未被设置”包含“已设置”的问题
            val bootOut = runRootCommand("$SCRIPT_PATH boot status")
            val isBootEnabled = bootOut.contains("已被设置") && !bootOut.contains("未")
            res.put("boot", isBootEnabled)

            val config = JSONObject()
            val yamlContent = runRootCommand("cat $CONFIG_PATH")
            if (yamlContent.isNotEmpty() && !yamlContent.contains("No such file")) {
                config.put("port", grepValue(yamlContent, "port:"))
                config.put("socks_port", grepValue(yamlContent, "socks-port:"))
                config.put("mixed_port", grepValue(yamlContent, "mixed-port:"))
                config.put("mi_tun", grepValue(yamlContent, "device:"))
                config.put("mode", grepValue(yamlContent, "mode:"))
                config.put("external_controller", grepValue(yamlContent, "external-controller:"))
                config.put("secret", grepValue(yamlContent, "secret:"))
            }
            res.put("config", config)
        } catch (e: Exception) {
            Log.e(TAG, "getStatus Error", e)
        }
        return res
    }

    fun doAction(action: String, sub: String?): String {
        val cmd = if (sub.isNullOrEmpty()) "$SCRIPT_PATH $action" else "$SCRIPT_PATH $action $sub"
        return runRootCommand(cmd)
    }

    fun getLogs(): String {
        return runRootCommand("tail -n 100 $LOG_PATH")
    }

    private fun runRootCommand(command: String): String {
        var process: Process? = null
        var os: DataOutputStream? = null
        var isInput: BufferedReader? = null
        try {
            process = Runtime.getRuntime().exec("su")
            os = DataOutputStream(process.outputStream)
            isInput = BufferedReader(InputStreamReader(process.inputStream))
            os.writeBytes("$command\n")
            os.writeBytes("exit\n")
            os.flush()
            val output = StringBuilder()
            var line: String?
            while (isInput.readLine().also { line = it } != null) {
                output.append(line).append("\n")
            }
            process.waitFor()
            return output.toString().trim()
        } catch (e: Exception) {
            return ""
        } finally {
            try { os?.close(); isInput?.close(); process?.destroy() } catch (e: Exception) {}
        }
    }

    private fun grepValue(content: String, key: String): String {
        val line = content.lines().firstOrNull { it.trim().startsWith(key, ignoreCase = true) }
        return line?.split(":")?.drop(1)?.joinToString(":")?.trim()
            ?.replace("'", "")?.replace("\"", "") ?: "--"
    }
}
