package com.opengw.manager

import android.util.Log
import java.io.BufferedReader
import java.io.DataOutputStream
import java.io.InputStreamReader
import org.json.JSONObject

class TtydManager {
    private val TAG = "TtydManager"
    private val TTYD_BIN = "/system/bin/ttyd.aarch64"
    private val PORT = 7681

    fun getStatus(): JSONObject {
        val res = JSONObject()
        val check = runRootCommand("ps -A | grep ttyd")
        res.put("running", check.contains("ttyd"))
        res.put("port", PORT)
        return res
    }

    fun start(): String {
        stop()
        Thread.sleep(500)

        val shellCmd = if (runRootCommand("which bash").contains("/")) "bash" else "/system/bin/sh"
        
        val cmd = "export TERMINFO=/system/etc/terminfo; " +
                "nohup $TTYD_BIN -p $PORT -i 0.0.0.0 -W -T linux -t cursorBlink=true $shellCmd > /dev/null 2>&1 &"

        Log.i(TAG, "Starting ttyd: $cmd")
        return runRootCommand(cmd)
    }

    fun stop(): String {
        return runRootCommand("pkill -9 -f ttyd")
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
            try {
                os?.close()
                isInput?.close()
                process?.destroy()
            } catch (e: Exception) {}
        }
    }
}
