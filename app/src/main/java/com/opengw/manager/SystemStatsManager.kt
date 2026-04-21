package com.opengw.manager

import android.os.Environment
import android.os.StatFs
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

class SystemStatsManager {
    private var lastCpuStats = mutableMapOf<String, LongArray>()
    private var cachedCpuModel: String? = null

    /**
     * 获取详细系统负载
     */
    fun getDetailedStats(): JSONObject {
        return JSONObject().apply {
            put("cpu", getCpuUsagePerCore())
            put("memory", getMemInfo())
            put("thermal", getThermalInfo())
            put("cpu_model", getCpuModelName())
            put("storage", getStorageInfo())
        }
    }

    private fun getCpuModelName(): String {
        if (cachedCpuModel != null) return cachedCpuModel!!
        try {
            File("/proc/cpuinfo").readLines().forEach { line ->
                if (line.contains("Hardware") || line.contains("model name") || line.contains("Processor")) {
                    val model = line.split(":")[1].trim()
                    if (model.isNotEmpty()) {
                        cachedCpuModel = model
                        return model
                    }
                }
            }
        } catch (e: Exception) {}
        return "Generic ARM Processor"
    }

    private fun getCpuUsagePerCore(): JSONObject {
        val currentStats = mutableMapOf<String, LongArray>()
        val result = JSONObject()
        val cores = JSONArray()

        try {
            File("/proc/stat").forEachLine { line ->
                if (line.startsWith("cpu")) {
                    val parts = line.split(Regex("\\s+"))
                    if (parts.size >= 5) {
                        val name = parts[0]
                        val user = parts[1].toLong()
                        val nice = parts[2].toLong()
                        val system = parts[3].toLong()
                        val idle = parts[4].toLong()
                        val iowait = parts.getOrNull(5)?.toLong() ?: 0L
                        val irq = parts.getOrNull(6)?.toLong() ?: 0L
                        val softirq = parts.getOrNull(7)?.toLong() ?: 0L

                        val active = user + nice + system + irq + softirq
                        val total = active + idle + iowait
                        currentStats[name] = longArrayOf(active, total)

                        val last = lastCpuStats[name]
                        if (last != null) {
                            val diffActive = active - last[0]
                            val diffTotal = total - last[1]
                            val usage = if (diffTotal > 0) (diffActive * 100 / diffTotal).toInt() else 0
                            
                            if (name == "cpu") {
                                result.put("total_usage", usage)
                            } else {
                                cores.put(JSONObject().apply {
                                    put("id", name.replace("cpu", ""))
                                    put("usage", usage)
                                })
                            }
                        } else {
                            // 第一次调用，初始化 0 避免前端报错
                            if (name == "cpu") {
                                result.put("total_usage", 0)
                            } else {
                                cores.put(JSONObject().apply {
                                    put("id", name.replace("cpu", ""))
                                    put("usage", 0)
                                })
                            }
                        }
                    }
                }
            }
            lastCpuStats = currentStats
        } catch (e: Exception) {}
        
        result.put("cores", cores)
        return result
    }

    private fun getMemInfo(): JSONObject {
        val mem = JSONObject()
        try {
            val info = File("/proc/meminfo").readLines().associate { line ->
                val parts = line.split(Regex(":\\s+"))
                parts[0] to (parts.getOrNull(1)?.replace(Regex("[^0-9]"), "")?.toLongOrNull() ?: 0L)
            }
            val total = info["MemTotal"] ?: 1L
            val avail = info["MemAvailable"] ?: info["MemFree"] ?: 0L
            val swapTotal = info["SwapTotal"] ?: 0L
            val swapFree = info["SwapFree"] ?: 0L

            mem.put("total", total / 1024)
            mem.put("used", (total - avail) / 1024)
            mem.put("usage", ((total - avail) * 100 / total).toInt())
            mem.put("swap_total", swapTotal / 1024)
            mem.put("swap_used", (swapTotal - swapFree) / 1024)
        } catch (e: Exception) {}
        return mem
    }

    private fun getStorageInfo(): JSONObject {
        val storage = JSONObject()
        try {
            val stat = StatFs(Environment.getDataDirectory().path)
            val total = (stat.blockCountLong * stat.blockSizeLong) / (1024 * 1024)
            val avail = (stat.availableBlocksLong * stat.blockSizeLong) / (1024 * 1024)
            val used = total - avail
            storage.put("total", total)
            storage.put("used", used)
            storage.put("usage", if (total > 0) (used * 100 / total).toInt() else 0)
        } catch (e: Exception) {}
        return storage
    }

    private fun getThermalInfo(): Int {
        val priorityZones = listOf("soc-thmzone", "apcpu0-thmzone", "board-thmzone", "chg-thmzone", "cpu-thermal")
        try {
            val zones = File("/sys/class/thermal/").listFiles { f -> f.name.startsWith("thermal_zone") }
            val zoneMap = zones?.associate { z ->
                try {
                    val type = File(z, "type").readText().trim()
                    val temp = File(z, "temp").readText().trim().toIntOrNull() ?: 0
                    type to temp
                } catch (e: Exception) { "" to 0 }
            }
            for (key in priorityZones) {
                if (zoneMap?.containsKey(key) == true) return zoneMap[key]!! / 1000
            }
            return zoneMap?.values?.maxOrNull()?.div(1000) ?: 0
        } catch (e: Exception) { return 0 }
    }
}
