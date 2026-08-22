# OpenGW (WebManagerLite自用)

一个运行在某兴安卓随身 WiFi 上的网关管理工具，用来替换原厂简陋受限的 Web 管理页面。本人自用，不是什么大作品，顺手分享出来，同款设备的朋友喜欢的话可以拿去用。

[OpenGW-mobile](https://github.com/leehe-byte/WebManagerLite-mobile)：远程免登录管理版本，可切换官方与自用web

---

## 🌟 核心优势
- **极速投屏**：支持 Web 远程控制，深度优化实时预览，体验更流畅。
- **系统性能中心**：全新的 Windows 资源管理器风格性能面板，支持多核 CPU、内存、Swap 及存储实时监控。
- **桥接协议**：深度劫持并重构原厂 GoForm 协议，解锁隐藏的网络参数与控制权限。
- **极客工具**：支持 Mihomo 代理（插件安装）、ttyd 全功能终端、Samba 存储共享、自定义 AT 指令下发。

---

## 🛠️ 当前功能矩阵 (Current Version: v2.8.0)

### ✅ 已稳定实现 (Stable)
- **模块化架构**：全站逻辑实现 JS 模块化解耦（Overview, NetInfo 等），加载更高效，维护更简单。
- **性能实时监控**：Windows 风格实时 Canvas 核心波形图，支持 8 核/多核动态适配，新增存储条监控。
- **黑暗模式**：全系统级别的深色/浅色/自动切换，完美适配移动端与 PC 端。
- **远程桌面**：Web 端直接操作 Android 界面，内置仿真虚拟导航栏，支持滑动与长按手势。
- **网络详情**：支持 5G SA/NSA 识别，RSSI/RSRP 可视化进度条，集成 WiFi 黑名单管理。
- **蜂窝控制**：支持 SIM 卡槽切换及 5G/4G/3G 频段模式锁定。
- **USB 自动关 WiFi**：USB 设备连接时自动关闭 WiFi，断开后自动恢复，支持手动开关。
- **插件系统**：外部可安装 `.owpkg` 插件（免重启），支持侧边栏菜单、独立页面、overview 卡片与通用能力 API。开发指南见 [docs/PLUGIN_DEV.md](docs/PLUGIN_DEV.md)，最小示例见 `examples/demo-plugin`。

### ⏳ 持续演进中 (Roadmap)
- [ ] **网络调试**：集成 Ping、Traceroute、Iperf3 等诊断工具。
- [ ] **文件管理**：内置 Web 端文件浏览器，支持上传下载与解压。
- [ ] **自动化脚本**：支持根据电池、时间等条件自动执行网络切换。

---

## 🤝 致谢
特别感谢 [UFI-TOOLS](https://github.com/kanoqwq/UFI-TOOLS) 项目及其作者 **kanoqwq**。本项目深受其启发，并使用了其中 `sendat` 二进制文件。
Webshell部分使用了tsl0922的[ttyd](https://github.com/tsl0922/ttyd.git)项目。

---

## 🛡️ 安装要求
- **系统**：某兴 u30air / f50（其他同平台设备可能需自行适配）。
- **权限**：必须具备 **Root 权限**（Magisk 或 KernelSU）。
- **基础依赖**：`/system/bin/` 下需存在 `ttyd.aarch64`、`sendat` 等工具。

## 📄 注意事项
本工具专为本人自用。修改关键网络参数导致设备连接中断，请在熟悉 Root 操作的前提下使用。
