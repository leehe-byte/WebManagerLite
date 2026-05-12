package com.opengw.manager

import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.DataOutputStream
import java.io.InputStreamReader

class MihomoManager {
    private val TAG = "MihomoManager"
    private val SCRIPT_PATH = "/system/bin/mihomo"
    private val CONFIG_PATH = "/data/mihomo/config.yaml"
    private val LOG_PATH = "/sdcard/mihomo.log"
    private val WEBUI_DIR = "/data/mihomo/webui"

    fun getStatus(): JSONObject {
        val res = JSONObject()
        try {
            val runningOut = runRootCommand("$SCRIPT_PATH status")
            res.put("running", runningOut.contains("已经在运行") || runningOut.contains("PID"))

            val bootOut = runRootCommand("$SCRIPT_PATH boot status")
            val isBootEnabled = bootOut.contains("已被设置") && !bootOut.contains("未")
            res.put("boot", isBootEnabled)
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

    /**
     * 获取最新 N 行日志（用于轮询刷新）
     */
    fun getLogs(lines: Int): String {
        return runRootCommand("tail -n $lines $LOG_PATH")
    }

    /**
     * 读取完整 config.yaml 内容
     */
    fun readRawConfig(): String {
        return runRootCommand("cat $CONFIG_PATH")
    }

    /**
     * 将 config.yaml 解析为 JSON 返回前端
     */
    fun getConfigJson(): String {
        val yaml = readRawConfig()
        if (yaml.isEmpty() || yaml.contains("No such file")) {
            return JSONObject().apply { put("error", "配置文件不存在") }.toString()
        }
        return parseYamlToJson(yaml)
    }

    /**
     * 保存完整 config.yaml（前端传整个文件内容回来）
     * 使用 dd 命令通过临时文件写入，避免中文乱码问题
     */
    fun saveRawConfig(content: String): String {
        runRootCommand("cp $CONFIG_PATH ${CONFIG_PATH}.bak")
        // 将内容写入临时文件，然后用 root 权限复制到目标位置
        val tmpPath = "/data/local/tmp/mihomo_config_tmp.yaml"
        try {
            // 先删除旧临时文件
            runRootCommand("rm -f $tmpPath")
            // 用 base64 方式写入（兼容中文）
            val base64Content = android.util.Base64.encodeToString(content.toByteArray(Charsets.UTF_8), android.util.Base64.NO_WRAP)
            val result = runRootCommand("echo '$base64Content' | base64 -d > $tmpPath && chmod 644 $tmpPath && cp $tmpPath $CONFIG_PATH && rm -f $tmpPath")
            if (result.contains("error") || result.contains("No such") || result.contains("not found")) {
                // 如果 base64 不可用，用 printf + 重定向方式
                runRootCommand("rm -f $tmpPath")
                // 分块写入避免 shell 参数长度限制
                val chunkSize = 200
                val lines_list = content.chunked(chunkSize)
                for (chunk in lines_list) {
                    val escaped = chunk
                        .replace("\\", "\\\\")
                        .replace("'", "'\\''")
                        .replace("\n", "\\n")
                        .replace("\r", "\\r")
                    runRootCommand("printf '%s' '$escaped' >> $tmpPath")
                }
                val result2 = runRootCommand("chmod 644 $tmpPath && cp $tmpPath $CONFIG_PATH && rm -f $tmpPath")
                return if (result2.contains("error") || result2.contains("No such")) {
                    "{\"result\":\"error\",\"msg\":\"$result2\"}"
                } else {
                    "{\"result\":\"success\"}"
                }
            } else {
                return "{\"result\":\"success\"}"
            }
        } catch (e: Exception) {
            return "{\"result\":\"error\",\"msg\":\"${e.message}\"}"
        }
    }

    /**
     * 扫描 webui 目录获取可用 UI 列表
     */
    fun getWebUIList(): String {
        try {
            val output = runRootCommand("ls -1 $WEBUI_DIR 2>/dev/null")
            if (output.isEmpty() || output.contains("No such")) {
                return JSONArray().toString()
            }
            val list = output.lines().filter { it.isNotBlank() }
            val arr = JSONArray()
            list.forEach { arr.put(it.trim()) }
            return arr.toString()
        } catch (e: Exception) {
            return JSONArray().toString()
        }
    }

    /**
     * 修改基础设置
     * action: external-ui / secret / controller / log-level / mode
     */
    fun updateSetting(action: String, value: String): String {
        return when (action) {
            "external-ui" -> {
                runRootCommand("sed -i 's|^external-ui:.*|external-ui: webui/$value|' $CONFIG_PATH")
                "{\"result\":\"success\"}"
            }
            "secret" -> {
                val safeVal = value.replace("'", "'\\''")
                runRootCommand("sed -i \"s/^secret:.*/secret: \\\"$safeVal\\\"/\" $CONFIG_PATH")
                "{\"result\":\"success\"}"
            }
            "controller" -> {
                runRootCommand("sed -i \"s/^external-controller:.*/external-controller: $value/\" $CONFIG_PATH")
                "{\"result\":\"success\"}"
            }
            "log-level" -> {
                runRootCommand("sed -i \"s/^log-level:.*/log-level: $value/\" $CONFIG_PATH")
                "{\"result\":\"success\"}"
            }
            "mode" -> {
                runRootCommand("sed -i \"s/^mode:.*/mode: $value/\" $CONFIG_PATH")
                "{\"result\":\"success\"}"
            }
            else -> "{\"result\":\"error\",\"msg\":\"未知设置: $action\"}"
        }
    }

    /**
     * 修改 User-Agent 列表
     */
    fun updateUserAgents(uas: JSONArray): String {
        val yaml = readRawConfig()
        if (yaml.isEmpty()) return "{\"result\":\"error\",\"msg\":\"无法读取配置\"}"
        
        val lines = yaml.lines().toMutableList()
        var inHeader = false
        var uaStart = -1
        var uaEnd = -1
        
        for (i in lines.indices) {
            val line = lines[i]
            if (line.trimStart().startsWith("header:")) {
                inHeader = true
                continue
            }
            if (inHeader) {
                if (line.trimStart().startsWith("User-Agent:")) {
                    uaStart = i
                } else if (uaStart >= 0 && (line.trimStart().startsWith("- ") || line.trimStart().startsWith("#"))) {
                    // 继续收集 UA 列表行
                } else if (uaStart >= 0) {
                    uaEnd = i
                    break
                }
            }
        }
        
        if (uaStart < 0) return "{\"result\":\"error\",\"msg\":\"未找到 User-Agent 配置\"}"
        if (uaEnd < 0) uaEnd = lines.size
        
        val newUaLines = mutableListOf<String>()
        newUaLines.add("      User-Agent:  # 使用注释法由上到下 默认使用第一个")
        for (i in 0 until uas.length()) {
            newUaLines.add("        - \"${uas.getString(i)}\"")
        }
        
        lines.subList(uaStart, uaEnd).clear()
        lines.addAll(uaStart, newUaLines)
        
        val newContent = lines.joinToString("\n")
        return saveRawConfig(newContent)
    }

    /**
     * 获取订阅列表（proxy-providers）
     * 典型格式:
     * proxy-providers:
     *   机场A:
     *     type: http
     *     url: "https://..."
     *     interval: 86400
     *     path: ./proxies/机场A.yaml
     *   机场B:
     *     ...
     */
    fun getSubscriptions(): String {
        val yaml = readRawConfig()
        if (yaml.isEmpty()) return JSONArray().toString()
        
        val result = JSONArray()
        val lines = yaml.lines()
        var current: JSONObject? = null
        var inProviders = false
        var providerIndent = -1  // proxy-providers 的缩进级别
        
        for (line in lines) {
            val trimmed = line.trimStart()
            if (trimmed.isEmpty() || trimmed.startsWith("#")) continue
            
            if (trimmed.startsWith("proxy-providers:") && !trimmed.startsWith("proxy-providers-group")) {
                inProviders = true
                providerIndent = line.length - trimmed.length  // 记录缩进
                continue
            }
            
            if (inProviders) {
                // 遇到其他顶级 key 则退出
                val indent = line.length - trimmed.length
                if (indent <= providerIndent && !trimmed.startsWith("-")) {
                    if (current != null) result.put(current)
                    break
                }
                
                // 检测新的订阅条目: 缩进比 providerIndent 多 2 格，且以 "name:" 结尾
                if (indent == providerIndent + 2 && trimmed.endsWith(":") && !trimmed.startsWith("-")) {
                    if (current != null) result.put(current)
                    current = JSONObject()
                    current.put("name", trimmed.removeSuffix(":").trim())
                    current.put("type", "")
                    current.put("url", "")
                    current.put("ua", "")
                    current.put("interval", 86400)
                    continue
                }
                
                if (current != null) {
                    when {
                        trimmed.startsWith("type:") -> current.put("type", trimmed.substringAfter(":").trim())
                        trimmed.startsWith("url:") -> current.put("url", trimmed.substringAfter(":").trim().removeSurrounding("\""))
                        trimmed.startsWith("interval:") -> current.put("interval", trimmed.substringAfter(":").trim().toIntOrNull() ?: 86400)
                        trimmed.startsWith("User-Agent:") -> {
                            val idx = lines.indexOf(line)
                            if (idx + 1 < lines.size) {
                                val nextLine = lines[idx + 1].trim()
                                if (nextLine.startsWith("- ")) {
                                    current.put("ua", nextLine.removePrefix("- ").trim().removeSurrounding("\""))
                                }
                            }
                        }
                    }
                }
            }
        }
        
        // 处理最后一个
        if (current != null) result.put(current)
        
        return result.toString()
    }

    /**
     * 新增订阅
     */
    fun addSubscription(name: String, url: String, ua: String, interval: Int): String {
        val yaml = readRawConfig()
        if (yaml.isEmpty()) return "{\"result\":\"error\",\"msg\":\"无法读取配置\"}"
        
        val lines = yaml.lines().toMutableList()
        
        var insertPos = -1
        for (i in lines.indices) {
            val trimmed = lines[i].trimStart()
            if (trimmed.startsWith("profile:")) {
                insertPos = i
                break
            }
        }
        
        if (insertPos < 0) return "{\"result\":\"error\",\"msg\":\"未找到插入位置\"}"
        
        val newBlock = mutableListOf(
            "",
            "  $name: # 新增订阅",
            "    <<: *p",
            "    override:",
            "      additional-prefix: \"$name\"",
            "    path: ./proxies/$name.yaml",
            "    url: \"$url\""
        )
        if (ua.isNotBlank()) {
            newBlock.add("    header:")
            newBlock.add("      User-Agent:")
            newBlock.add("        - \"$ua\"")
        }
        
        lines.addAll(insertPos, newBlock)
        
        val newContent = lines.joinToString("\n")
        return saveRawConfig(newContent)
    }

    /**
     * 删除订阅
     */
    fun removeSubscription(name: String): String {
        val yaml = readRawConfig()
        if (yaml.isEmpty()) return "{\"result\":\"error\",\"msg\":\"无法读取配置\"}"
        
        val lines = yaml.lines().toMutableList()
        val newLines = mutableListOf<String>()
        var skipBlock = false
        
        for (i in lines.indices) {
            val line = lines[i]
            val trimmed = line.trimStart()
            
            if (!line.startsWith(" ") && trimmed.endsWith(":") && trimmed.removeSuffix(":").trim() == name) {
                skipBlock = true
                continue
            }
            
            if (skipBlock) {
                if (!line.startsWith(" ") || trimmed.startsWith("profile:") || trimmed.startsWith("proxy-groups:")) {
                    skipBlock = false
                } else {
                    continue
                }
            }
            
            newLines.add(line)
        }
        
        return saveRawConfig(newLines.joinToString("\n"))
    }

    /**
     * 更新单个订阅的 URL
     */
    fun updateSubscriptionUrl(name: String, url: String): String {
        val yaml = readRawConfig()
        if (yaml.isEmpty()) return "{\"result\":\"error\",\"msg\":\"无法读取配置\"}"
        
        val lines = yaml.lines().toMutableList()
        var inTarget = false
        
        for (i in lines.indices) {
            val line = lines[i]
            val trimmed = line.trimStart()
            
            if (!line.startsWith(" ") && trimmed.endsWith(":") && trimmed.removeSuffix(":").trim() == name) {
                inTarget = true
                continue
            }
            
            if (inTarget) {
                if (!line.startsWith(" ")) break
                if (trimmed.startsWith("url:")) {
                    lines[i] = line.substringBefore(trimmed) + "url: \"$url\""
                    break
                }
            }
        }
        
        return saveRawConfig(lines.joinToString("\n"))
    }

    /**
     * 更新所有订阅（调用 mihomo 升级命令）
     */
    fun updateAllSubscriptions(): String {
        return runRootCommand("$SCRIPT_PATH upgrade")
    }

    /**
     * 简易 YAML 转 JSON - 只解析顶级 key
     * 通过缩进判断：顶级 key 的缩进为 0（行首无空格）
     */
    private fun parseYamlToJson(yaml: String): String {
        val root = JSONObject()
        try {
            val lines = yaml.lines()
            
            // 只解析顶级 key（行首无空格）
            // key 映射：YAML 中的连字符格式 -> 前端使用的下划线格式
            val keyMapping = mapOf(
                "port" to "port",
                "socks-port" to "socks_port",
                "mixed-port" to "mixed_port",
                "mode" to "mode",
                "log-level" to "log_level",
                "external-controller" to "external_controller",
                "secret" to "secret",
                "external-ui" to "external_ui",
                "ipv6" to "ipv6",
                "allow-lan" to "allow_lan",
                "unified-delay" to "unified_delay",
                "tcp-concurrent" to "tcp_concurrent",
                "find-process-mode" to "find_process_mode",
                "global-client-fingerprint" to "global_client_fingerprint"
            )
            
            for (line in lines) {
                val trimmed = line.trimStart()
                if (trimmed.isEmpty() || trimmed.startsWith("#")) continue
                // 只处理顶级 key（行首无空格）
                if (line.startsWith(" ")) continue
                
                for ((yamlKey, jsonKey) in keyMapping) {
                    if (trimmed.startsWith("$yamlKey:", ignoreCase = true)) {
                        val value = trimmed.substringAfter(":").trim()
                            .removeSurrounding("\"").removeSurrounding("'")
                        if (value.isNotEmpty()) {
                            root.put(jsonKey, value)
                        }
                        break
                    }
                }
            }
            
            // 解析 User-Agent 列表 - 使用正则从原始 YAML 中提取
            // 匹配 header: 下 User-Agent: 后面的 - "xxx" 列表
            val uas = JSONArray()
            try {
                val uaRegex = Regex("""header:[\s\S]*?User-Agent:[\s\S]*?(?=\n\S|\Z)""")
                val match = uaRegex.find(yaml)
                if (match != null) {
                    val block = match.value
                    val itemRegex = Regex("""-\s*"([^"]*)"|-\s*'([^']*)'|-\s+(\S+)""")
                    for (m in itemRegex.findAll(block)) {
                        val value = m.groupValues.drop(1).firstOrNull { it.isNotEmpty() }
                        if (value != null) uas.put(value)
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "UA parse error", e)
            }
            root.put("user_agents", uas)
            
            // 订阅列表
            root.put("subscriptions", JSONArray(getSubscriptions()))
            
            // proxy-groups 列表
            val groups = JSONArray()
            var inGroups = false
            for (line in lines) {
                val trimmed = line.trimStart()
                if (trimmed == "proxy-groups:") { inGroups = true; continue }
                if (inGroups) {
                    if (trimmed.startsWith("rule-anchor:") || trimmed.startsWith("rule-providers:") || trimmed.startsWith("rules:")) break
                    // proxy-groups 下的条目缩进 2 格
                    val indent = line.length - trimmed.length
                    if (indent == 2 && trimmed.endsWith(":") && !trimmed.startsWith("-")) {
                        val g = JSONObject()
                        g.put("name", trimmed.removeSuffix(":").trim())
                        groups.put(g)
                    }
                }
            }
            root.put("proxy_groups", groups)
            
            // DNS 配置
            val dns = JSONObject()
            var inDns = false
            for (line in lines) {
                val trimmed = line.trimStart()
                if (trimmed == "dns:") { inDns = true; continue }
                if (inDns) {
                    if (trimmed.startsWith("tun:") || trimmed.startsWith("proxies:") || trimmed.startsWith("proxy-groups:") || trimmed.startsWith("rule-anchor:")) break
                    if (trimmed.contains(":") && !trimmed.startsWith("-")) {
                        dns.put(trimmed.substringBefore(":").trim(), trimmed.substringAfter(":").trim())
                    }
                }
            }
            root.put("dns", dns)
            
            // TUN 配置
            val tun = JSONObject()
            var inTun = false
            for (line in lines) {
                val trimmed = line.trimStart()
                if (trimmed == "tun:") { inTun = true; continue }
                if (inTun) {
                    if (trimmed.startsWith("dns:") || trimmed.startsWith("proxies:") || trimmed.startsWith("proxy-groups:")) break
                    if (trimmed.contains(":") && !trimmed.startsWith("-")) {
                        tun.put(trimmed.substringBefore(":").trim(), trimmed.substringAfter(":").trim())
                    }
                }
            }
            root.put("tun", tun)
            
        } catch (e: Exception) {
            Log.e(TAG, "parseYamlToJson error", e)
            root.put("error", e.message)
        }
        return root.toString()
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
