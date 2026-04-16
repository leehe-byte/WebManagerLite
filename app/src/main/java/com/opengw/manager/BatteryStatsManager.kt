package com.opengw.manager

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject
import java.util.*

class BatteryStatsManager(context: Context) {
    private val prefs: SharedPreferences = context.getSharedPreferences("battery_stats", Context.MODE_PRIVATE)
    
    // 状态记录键名
    private val KEY_START_TIME = "start_time"
    private val KEY_HISTORY = "history_v2"
    private val LOW_BATTERY_THRESHOLD = 20

    /**
     * 更新电量状态并记录
     */
    fun updateStats(level: Int, isCharging: Boolean) {
        val startTime = prefs.getLong(KEY_START_TIME, 0L)

        if (level == 100 && !isCharging) {
            // 充满电且断开电源：标记新的统计开始
            if (startTime == 0L) {
                prefs.edit().putLong(KEY_START_TIME, System.currentTimeMillis()).apply()
            }
        } else if (isCharging) {
            // 正在充电：重置当前的统计（因为续航已被打断）
            prefs.edit().putLong(KEY_START_TIME, 0L).apply()
        } else if (startTime != 0L && level <= LOW_BATTERY_THRESHOLD) {
            // 达到低电量阈值：完成一次统计
            val durationMs = System.currentTimeMillis() - startTime
            saveToHistory(durationMs)
            prefs.edit().putLong(KEY_START_TIME, 0L).apply() // 清除当前，等待下次100%
        }
    }

    private fun saveToHistory(durationMs: Long) {
        val historyStr = prefs.getString(KEY_HISTORY, "[]")
        val array = JSONArray(historyStr)
        
        val record = JSONObject().apply {
            put("date", System.currentTimeMillis())
            put("duration", durationMs / (1000 * 60)) // 分钟
        }
        
        // 保留最近 10 条记录
        val newList = mutableListOf<JSONObject>()
        newList.add(record)
        for (i in 0 until Math.min(array.length(), 9)) {
            newList.add(array.getJSONObject(i))
        }
        
        prefs.edit().putString(KEY_HISTORY, JSONArray(newList).toString()).apply()
    }

    /**
     * 获取历史记录
     */
    fun getHistory(): String {
        return prefs.getString(KEY_HISTORY, "[]") ?: "[]"
    }
}
