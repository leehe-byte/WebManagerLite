# OpenGW 插件开发指南

插件系统为 OpenGW 提供了类 OpenWrt/LuCI 的扩展能力：**外部安装、免重启、热更新**。插件包是一个 `.owpkg` 文件（本质是 zip 压缩包），安装后即可向管理页添加侧边栏菜单、独立页面、状态总览卡片，并调用系统通用能力 API。

一个最简可用的示例见 `examples/demo-plugin/`，发布态插件示例见 `releases/mihomo/`。

---

## 1. 插件包结构

```
my-plugin.owpkg  (zip)
├── manifest.json    # 必填：插件元数据（id 与 entryJs 为硬性要求）
├── www/             # 前端资源：页面 html、逻辑 js、css、图片
│   ├── page.html
│   └── plugin.js    # 入口脚本（entryJs），调用 PluginRegistry.register()
├── bin/             # 可选：可执行二进制，安装时自动 chmod 755
├── files/           # 可选：需写入系统的文件（由 install.sh 负责落盘）
└── scripts/         # 可选：生命周期脚本
    ├── install.sh   # 安装时执行（root），如部署二进制/配置到系统目录
    ├── remove.sh    # 卸载时执行（root）
    ├── start.sh     # 手动启动（插件管理页「▶ 启动」）
    ├── stop.sh      # 手动停止（「⏹ 停止」）
    └── boot.sh      # 开机自启（APK 后台服务启动时执行，应自行判断是否真正需要自启）
```

## 2. manifest.json

```json
{
  "id": "my-plugin",              // 必填，仅 [A-Za-z0-9_-]
  "name": "我的插件",
  "version": "1.0.0",
  "icon": "🧩",
  "description": "一句话描述",
  "requiresRoot": true,           // 是否需要 root 权限
  "menu": { "section": "应用服务", "order": 1 },  // 侧边栏分组（同名自动合并）+ 组内排序
  "page": "page.html",            // 插件独立页面（相对 www/ 的路径）
  "entryJs": "plugin.js",         // 必填：入口脚本，将动态加载并执行
  "cards": [                      // 可选：状态总览卡片
    { "id": "status", "title": "运行状态", "icon": "🛡️", "refreshMs": 5000 }
  ],
  "scripts": {
    "install": "scripts/install.sh",
    "remove": "scripts/remove.sh",
    "start": "scripts/start.sh",
    "stop": "scripts/stop.sh",
    "boot": "scripts/boot.sh"
  }
}
```

## 3. 前端入口（entryJs）

入口脚本通过 `PluginRegistry.register()` 注册自身。注册后核心框架会自动处理侧边栏菜单、页面加载与卡片刷新。

```js
PluginRegistry.register({
    id: 'my-plugin',
    title: '我的插件',
    icon: '🧩',
    menu: { section: '应用服务', order: 1 },
    page: 'page.html',

    // 独立页面初始化（页面 HTML 注入后由框架调用）
    init() {
        // 可访问全局: Api, ApiExtra, startPolling, showAlert, showConfirm, escapeHtml 等
    },

    // 状态总览卡片
    cards: [
        {
            id: 'status', title: '运行状态', icon: '🛡️', refreshMs: 5000,
            render() {
                const el = document.getElementById('plugin-card-body-my-plugin-status');
                if (el) el.textContent = '...';
            }
        }
    ]
});
```

要点：

- 菜单分组 `menu.section` 与现有分组同名会自动合并（如「应用服务」），否则在侧边栏底部新建；`menu: false` 可完全隐藏。
- 卡片容器 id 约定为 `plugin-card-body-{pluginId}-{cardId}`，`render()` 在 overview 页按 `refreshMs` 轮询调用。
- 页面内联 `<script>` 会自动执行（框架手动补挂载），但推荐把逻辑都放入口脚本。

## 4. 通用能力 API

插件前端通过以下接口调用系统能力，前缀为 `/api/plugins/{id}/`：

| 接口 | 方法 | 说明 |
|---|---|---|
| `/exec` | POST `{"command":"..."}` | **root** 执行命令，返回 `{result, output}`；cwd 限定为插件目录 |
| `/config` | GET / POST `{"k":"v"}` | 插件 KV 配置（存于插件目录 config.json） |
| `/file` | GET `?path=` / POST `{"path","content"}` | 读写插件私有目录内的文件（防路径穿越） |
| `/start` `/stop` `/restart` | POST | 执行对应生命周期脚本 |
| `/uninstall` | POST | 执行 remove.sh 并删除插件目录 |

```js
// 例：执行 root 命令
const res = await Api.post('/api/plugins/my-plugin/exec', { command: 'uname -a' });
console.log(res.output);

// 例：读写配置
await Api.post('/api/plugins/my-plugin/config', { note: 'hello' });
const cfg = await Api.get('/api/plugins/my-plugin/config');
```

### 静态资源

`www/` 目录下的文件通过 `GET /plugins/{id}/www/*` 提供访问。

## 5. 生命周期脚本

- 均在 **root** 下执行，由 `sh <script>` 调用。
- `install.sh` 中可通过 `${0%/*}` 向上定位插件目录：`PLUGIN_DIR=$(dirname $(dirname $0))`。
- `boot.sh` 应在 **父脚本立即退出、逻辑放后台子 shell**，避免阻塞 APK 服务启动：

  ```sh
  #!/system/bin/sh
  {
      # 等系统启动完成后按需启动...
      if [ -f /data/my-plugin/on ]; then
          sh /data/my-plugin/bin/run.sh start
      fi
  } > /dev/null 2>&1 &
  exit 0
  ```

## 6. 打包与安装

```bash
# 用 zip 工具把 manifest.json / www / bin / files / scripts 打包为 .owpkg
zip -r my-plugin.owpkg manifest.json www bin files scripts
```

安装方式：

1. 管理页「插件管理」→ 上传 `.owpkg` 文件；
2. 或填写 URL 远程拉取安装。

安装时会校验扩展名 `.owpkg` 与 `manifest.json`（必须含 `id`、`entryJs`），随后执行 install.sh 完成部署。

## 7. 注意事项

- **鉴权**：exec / config / file / install 等敏感接口要求请求头携带 `X-Auth-Token`（框架的 `Api` 会自动附加）。
- **安全**：`/exec` 是 root 级命令执行，插件应做好命令参数校验；`/file` 已被限定在插件目录内。
- **路径**：插件安装于 `filesDir/plugins/<id>/`，安装包内路径请使用正斜杠。
- **免重启**：部署通过 root 直接落盘，不依赖 Magisk 挂载，无需重启。
