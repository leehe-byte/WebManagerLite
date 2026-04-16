package com.opengw.manager

import android.util.Log
import io.ktor.server.websocket.*
import io.ktor.websocket.*
import kotlinx.coroutines.*
import java.io.OutputStream

class RemoteControlManager {
    private val TAG = "RemoteControl"
    private var streamingJob: Job? = null
    private var inputProcess: Process? = null
    private var inputWriter: OutputStream? = null
    private var isStreaming = false

    init {
        startPersistentShell()
    }

    private fun startPersistentShell() {
        try {
            inputProcess = Runtime.getRuntime().exec("su")
            inputWriter = inputProcess?.outputStream
        } catch (e: Exception) {
            Log.e(TAG, "Root Shell Error: ${e.message}")
        }
    }

    fun startStreaming(session: DefaultWebSocketServerSession) {
        if (isStreaming) return
        isStreaming = true
        
        streamingJob = CoroutineScope(Dispatchers.IO).launch {
            Log.i(TAG, "Streaming Started (Stable Mode)")
            try {
                while (isActive && session.isActive && isStreaming) {
                    val startTime = System.currentTimeMillis()
                    
                    // 使用 -p 虽然慢一点，但它直接输出 PNG，我们直接透传，不再在 Java 层创建 Bitmap
                    // 这样可以彻底避免内存溢出导致的闪退
                    val process = Runtime.getRuntime().exec(arrayOf("su", "-c", "screencap -p"))
                    val bytes = process.inputStream.readBytes() 
                    process.destroy()

                    if (bytes.isNotEmpty() && session.isActive) {
                        session.send(Frame.Binary(true, bytes))
                    }

                    val elapsed = System.currentTimeMillis() - startTime
                    // 限制帧率，降低内存波动
                    val wait = if (elapsed < 200) 200 - elapsed else 10L
                    delay(wait)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Streaming Error: ${e.message}")
            } finally {
                isStreaming = false
            }
        }
    }

    fun stopStreaming() {
        isStreaming = false
        streamingJob?.cancel()
    }

    fun injectInput(action: String, x: Int, y: Int, x2: Int = 0, y2: Int = 0, key: String? = null) {
        val cmd = when (action) {
            "tap" -> "input tap $x $y\n"
            "swipe" -> "input swipe $x $y $x2 $y2 250\n"
            "key" -> when(key) {
                "HOME" -> "input keyevent 3\n"
                "BACK" -> "input keyevent 4\n"
                "APP_SWITCH" -> "input keyevent 187\n"
                else -> ""
            }
            else -> ""
        }
        if (cmd.isNotEmpty()) {
            try {
                inputWriter?.write(cmd.toByteArray())
                inputWriter?.flush()
            } catch (e: Exception) { 
                startPersistentShell() 
            }
        }
    }
}
