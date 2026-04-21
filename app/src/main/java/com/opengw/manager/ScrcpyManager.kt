package com.opengw.manager

import android.content.Context
import android.net.LocalSocket
import android.net.LocalSocketAddress
import android.util.Log
import io.ktor.server.websocket.*
import io.ktor.websocket.*
import kotlinx.coroutines.*
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.util.concurrent.atomic.AtomicBoolean

class ScrcpyManager(private val context: Context) {
    private val TAG = "ScrcpyManager"
    private var serverProcess: Process? = null
    private val isStarting = AtomicBoolean(false)
    private val serverPath = "/data/local/tmp/scrcpy-server-v3.3.4"

    private fun isProcessAlive(): Boolean {
        return try {
            serverProcess?.exitValue()
            false
        } catch (e: IllegalThreadStateException) {
            true
        } catch (e: Exception) {
            false
        }
    }

    /**
     * 自动部署 scrcpy-server 文件到 /data/local/tmp
     */
    private fun deployServerIfNeeded() {
        try {
            // 1. 检查目标文件是否存在 (通过 su 检查，因为普通 app 可能没权限 ls /data/local/tmp)
            val checkProcess = Runtime.getRuntime().exec(arrayOf("su", "-c", "[ -f $serverPath ] && echo 'EXISTS'"))
            val result = checkProcess.inputStream.bufferedReader().readText().trim()
            
            if (result == "EXISTS") {
                Log.d(TAG, "scrcpy-server already exists at $serverPath")
                return
            }

            Log.i(TAG, "Deploying scrcpy-server from assets...")

            // 2. 从 assets 读取并写入到 App 私有目录
            val assetName = "scrcpy-server-v3.3.4"
            val tempFile = File(context.cacheDir, assetName)
            
            context.assets.open(assetName).use { input ->
                FileOutputStream(tempFile).use { output ->
                    input.copyTo(output)
                }
            }

            // 3. 使用 su 拷贝到 /data/local/tmp 并设置权限
            val deployCmd = """
                cp ${tempFile.absolutePath} $serverPath && 
                chmod 755 $serverPath && 
                rm ${tempFile.absolutePath}
            """.trimIndent()
            
            Runtime.getRuntime().exec(arrayOf("su", "-c", deployCmd)).waitFor()
            Log.i(TAG, "scrcpy-server deployed successfully to $serverPath")

        } catch (e: Exception) {
            Log.e(TAG, "Failed to deploy scrcpy-server: ${e.message}")
        }
    }

    fun startServer() {
        if (isProcessAlive()) return
        if (isStarting.getAndSet(true)) return
        
        CoroutineScope(Dispatchers.IO).launch {
            try {
                // 启动前先确保文件已部署
                deployServerIfNeeded()

                Log.d(TAG, "Cleaning up potential zombie scrcpy-server...")
                Runtime.getRuntime().exec(arrayOf("su", "-c", "pkill -9 -f scrcpy-server")).waitFor()
                delay(300)

                val cmd = "export CLASSPATH=$serverPath && app_process / com.genymobile.scrcpy.Server 3.3.4 tunnel_forward=true audio=false control=true cleanup=false send_device_meta=false send_frame_meta=false send_codec_meta=false send_dummy_byte=false"
                
                Log.i(TAG, "Starting scrcpy-server...")
                serverProcess = Runtime.getRuntime().exec(arrayOf("su", "shell", "-c", cmd))
                
                launch {
                    serverProcess?.inputStream?.bufferedReader()?.forEachLine { Log.d(TAG, "[STDOUT] $it") }
                }
                launch {
                    serverProcess?.errorStream?.bufferedReader()?.forEachLine { Log.e(TAG, "[STDERR] $it") }
                }
                
                serverProcess?.waitFor()
                Log.w(TAG, "scrcpy-server process exited")
            } catch (e: Exception) {
                Log.e(TAG, "Process error: ${e.message}")
            } finally {
                serverProcess = null
                isStarting.set(false)
            }
        }
    }

    suspend fun handleWebSocket(session: DefaultWebSocketServerSession) {
        var videoSocket: LocalSocket? = null
        var controlSocket: LocalSocket? = null
        
        try {
            session.send(Frame.Text("HANDSHAKE_OK"))
            videoSocket = connectWithRetry("scrcpy")
            controlSocket = connectWithRetry("scrcpy")

            val videoInput = videoSocket.inputStream
            val controlOutput = controlSocket.outputStream

            coroutineScope {
                val videoJob = launch(Dispatchers.IO) {
                    val buffer = ByteArray(128 * 1024)
                    try {
                        while (isActive && session.isActive) {
                            val read = videoInput.read(buffer)
                            if (read <= 0) break
                            session.send(Frame.Binary(true, buffer.copyOfRange(0, read)))
                        }
                    } catch (e: Exception) {}
                }

                val controlJob = launch(Dispatchers.IO) {
                    try {
                        for (frame in session.incoming) {
                            if (frame is Frame.Binary) {
                                synchronized(controlOutput) {
                                    controlOutput.write(frame.data)
                                    controlOutput.flush()
                                }
                            }
                        }
                    } catch (e: Exception) {}
                }

                while(session.isActive && videoJob.isActive && controlJob.isActive) {
                    delay(500)
                }
                videoJob.cancel()
                controlJob.cancel()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Session Error: ${e.message}")
        } finally {
            videoSocket?.close()
            controlSocket?.close()
        }
    }

    private suspend fun connectWithRetry(name: String, retries: Int = 20): LocalSocket {
        var lastError: Exception? = null
        repeat(retries) { i ->
            try {
                val socket = LocalSocket()
                socket.connect(LocalSocketAddress(name, LocalSocketAddress.Namespace.ABSTRACT))
                return socket
            } catch (e: Exception) {
                lastError = e
                delay(500)
            }
        }
        throw Exception("Socket @$name fail: ${lastError?.message}")
    }

    fun stopServer() {
        serverProcess?.destroy()
        serverProcess = null
        CoroutineScope(Dispatchers.IO).launch {
            Runtime.getRuntime().exec(arrayOf("su", "-c", "pkill -9 -f scrcpy-server"))
        }
    }
}
