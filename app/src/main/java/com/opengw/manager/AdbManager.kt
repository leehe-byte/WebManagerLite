package com.opengw.manager

import android.util.Log
import java.io.BufferedReader
import java.io.DataOutputStream
import java.io.InputStreamReader
import org.json.JSONObject

class AdbManager {
    private val TAG = "AdbManager"
    private val SCRIPT_PATH = "/system/bin/adb-tcp.sh"

    fun getStatus(): JSONObject {
        val res = JSONObject()
        try {
            val output = runRootCommand("sh $SCRIPT_PATH status")
            res.put("enabled", output.contains("已启用"))
            res.put("output", output.trim())
            
            // 提取连接地址
            if (output.contains("连接地址:")) {
                val address = output.substringAfter("连接地址:").trim()
                res.put("address", address)
            }
        } catch (e: Exception) {
            Log.e(TAG, "getStatus Error", e)
            res.put("error", e.message)
        }
        return res
    }

    fun doAction(action: String): String {
        Log.i(TAG, "ADB Action: $action")
        return runRootCommand("sh $SCRIPT_PATH $action")
    }

    private fun runRootCommand(command: String): String {
        var process: Process? = null
        var os: DataOutputStream? = null
        var isInput: BufferedReader? = null
        try {
            process = Runtime.getRuntime().exec("su")
            os = DataOutputStream(process.outputStream)
            isInput = BufferedReader(InputStreamReader(process.inputStream))

            os.writeBytes("$command 2>&1\n")
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
            Log.e(TAG, "Root execution exception: ${e.message}")
            return "Error: ${e.message}"
        } finally {
            try { os?.close() } catch (e: Exception) {}
            try { isInput?.close() } catch (e: Exception) {}
            process?.destroy()
        }
    }
}
