package com.opengw.manager

import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Samba 管理器 - 仅负责读写 smb.conf 配置
 * 启停控制由前端通过 goform API 完成
 */
class SambaManager {
    private val SAMBA_DIR = "/data/samba"
    private val CONFIG_PATH = "$SAMBA_DIR/etc/smb.conf"

    /**
     * 获取 Samba 配置状态
     */
    fun getStatus(): JSONObject {
        return JSONObject().apply {
            put("config", readConfig())
            put("shares", getShares())
        }
    }

    /**
     * 读取 smb.conf 内容
     */
    fun readConfig(): String {
        return try {
            val file = File(CONFIG_PATH)
            if (file.exists()) file.readText() else ""
        } catch (e: Exception) { "" }
    }

    /**
     * 写入 smb.conf
     */
    fun writeConfig(content: String): String {
        return try {
            val file = File(CONFIG_PATH)
            file.parentFile?.mkdirs()
            file.writeText(content)
            "{\"result\":\"saved\"}"
        } catch (e: Exception) {
            "{\"result\":\"error\",\"error\":\"${e.message}\"}"
        }
    }

    /**
     * 获取所有共享目录配置
     */
    fun getShares(): JSONArray {
        val shares = JSONArray()
        try {
            val content = readConfig()
            if (content.isBlank()) return shares

            val lines = content.split("\n")
            var currentShare: JSONObject? = null
            var inGlobal = false

            for (line in lines) {
                val trimmed = line.trim()
                if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
                    val name = trimmed.substring(1, trimmed.length - 1)
                    if (name == "global") {
                        inGlobal = true
                        currentShare = null
                    } else {
                        inGlobal = false
                        currentShare = JSONObject().apply {
                            put("name", name)
                            put("comment", "")
                            put("path", "")
                            put("browseable", "yes")
                            put("writable", "yes")
                            put("public", "yes")
                            put("valid_users", "")
                        }
                        shares.put(currentShare)
                    }
                } else if (!inGlobal && currentShare != null) {
                    val eqIdx = trimmed.indexOf("=")
                    if (eqIdx > 0) {
                        val key = trimmed.substring(0, eqIdx).trim().lowercase()
                        val value = trimmed.substring(eqIdx + 1).trim()
                        when (key) {
                            "comment" -> currentShare.put("comment", value)
                            "path" -> currentShare.put("path", value)
                            "browseable" -> currentShare.put("browseable", value)
                            "writable" -> currentShare.put("writable", value)
                            "public" -> currentShare.put("public", value)
                            "valid users" -> currentShare.put("valid_users", value)
                        }
                    }
                }
            }
        } catch (e: Exception) {}
        return shares
    }

    /**
     * 更新共享配置
     */
    fun updateShares(shares: JSONArray): String {
        return try {
            val global = extractGlobalConfig()
            val sb = StringBuilder()
            sb.append("[global]\n")
            for ((key, value) in global) {
                sb.append("\t$key = $value\n")
            }
            sb.append("\n")

            for (i in 0 until shares.length()) {
                val share = shares.getJSONObject(i)
                val name = share.optString("name", "Share")
                sb.append("[$name]\n")
                sb.append("\tcomment = ${share.optString("comment", "Android Server")}\n")
                sb.append("\tpath = ${share.optString("path", "/sdcard")}\n")
                sb.append("\tbrowseable = ${share.optString("browseable", "yes")}\n")
                sb.append("\twritable = ${share.optString("writable", "yes")}\n")
                sb.append("\tpublic = ${share.optString("public", "yes")}\n")
                val validUsers = share.optString("valid_users", "")
                if (validUsers.isNotBlank()) {
                    sb.append("\tvalid users = $validUsers\n")
                }
                sb.append("\n")
            }

            writeConfig(sb.toString())
            "{\"result\":\"saved\"}"
        } catch (e: Exception) {
            "{\"result\":\"error\",\"error\":\"${e.message}\"}"
        }
    }

    /**
     * 添加新共享
     */
    fun addShare(name: String, path: String, comment: String = ""): String {
        return try {
            val shares = getShares()
            for (i in 0 until shares.length()) {
                if (shares.getJSONObject(i).optString("name") == name) {
                    return "{\"result\":\"exists\"}"
                }
            }
            val newShare = JSONObject().apply {
                put("name", name)
                put("path", path)
                put("comment", comment.ifBlank { "Android Server" })
                put("browseable", "yes")
                put("writable", "yes")
                put("public", "yes")
                put("valid_users", "")
            }
            shares.put(newShare)
            updateShares(shares)
        } catch (e: Exception) {
            "{\"result\":\"error\",\"error\":\"${e.message}\"}"
        }
    }

    /**
     * 删除共享
     */
    fun removeShare(name: String): String {
        return try {
            val shares = getShares()
            val newShares = JSONArray()
            for (i in 0 until shares.length()) {
                val share = shares.getJSONObject(i)
                if (share.optString("name") != name) {
                    newShares.put(share)
                }
            }
            updateShares(newShares)
        } catch (e: Exception) {
            "{\"result\":\"error\",\"error\":\"${e.message}\"}"
        }
    }

    /**
     * 提取 [global] 配置
     */
    private fun extractGlobalConfig(): Map<String, String> {
        val config = mutableMapOf(
            "workgroup" to "SAMBA",
            "netbios name" to "Android",
            "server string" to "Android Samba Server",
            "security" to "user",
            "passdb backend" to "smbpasswd:/data/samba/etc/smbpasswd",
            "map to guest" to "bad user"
        )
        try {
            val content = readConfig()
            if (content.isBlank()) return config

            val lines = content.split("\n")
            var inGlobal = false
            for (line in lines) {
                val trimmed = line.trim()
                if (trimmed.startsWith("[global]")) {
                    inGlobal = true
                    continue
                } else if (trimmed.startsWith("[")) {
                    break
                }
                if (inGlobal) {
                    val eqIdx = trimmed.indexOf("=")
                    if (eqIdx > 0) {
                        val key = trimmed.substring(0, eqIdx).trim().lowercase()
                        val value = trimmed.substring(eqIdx + 1).trim()
                        config[key] = value
                    }
                }
            }
        } catch (e: Exception) {}
        return config
    }
}
