package com.opengw.manager

import android.util.Log
import java.io.BufferedReader
import java.io.DataOutputStream
import java.io.InputStreamReader
import org.json.JSONObject

class AtManager {
    private val TAG = "AtManager"
    private val SENDAT_BIN = "/system/bin/sendat"

    /**
     * 执行 AT 命令并返回原始输出
     */
    fun sendAt(command: String, phoneId: Int = 0): String {
        // 命令格式: sendat -c <command> -n <phoneId>
        val cmd = "$SENDAT_BIN -c \"$command\" -n $phoneId"
        Log.i(TAG, "Executing AT: $cmd")
        return runRootCommand(cmd)
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
            Log.e(TAG, "Root command error: ${e.message}")
            return ""
        } finally {
            try { os?.close(); isInput?.close(); process?.destroy() } catch (e: Exception) {}
        }
    }
}
