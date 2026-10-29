# 原生客户端验收 · 2026-10-29

Android 使用 Jetpack Compose / Material 3，最低 Android 8.0；iOS 使用 SwiftUI，最低 iOS 17。两端沿用现有页面结构和暖灰、墨绿配色，直接使用同一套账号和协作 API。

## 检查记录

| 范围 | 结果 |
| --- | --- |
| 现有 Web 项目 | `npm run check`：89 项测试通过、1 项跳过，生产构建通过 |
| Android 领域与接口 | 14 项 JVM 测试通过，包含本地真实后端的密码登录、Cookie/CSRF 和操作重放 |
| Android 原生交互 | Android 15 ARM64 模拟器真实登录、四页切换、活动与费用保存通过，运行跨过前台刷新周期；地图截图已确认城区瓦片和标记正常 |
| Android 构建 | APK 与测试 APK 构建通过，`lintDebug` 通过 |
| iOS 领域与同步 | 14 项 XCTest 通过，包含离线投影、时钟、账号缓存损坏隔离、未知回执恢复、路线签名 |
| iOS 原生交互 | iPhone 17 Pro 模拟器真实登录、打开旅程、四页切换、保存活动、共享路程和费用通过 |
| iOS 构建 | 模拟器 Debug 和 iPhoneOS ARM64 Release 构建通过 |
| iOS 真机安装与单元测试 | iPhone 17 Pro Max / iOS 27.0.1 无线配对、开发签名、安装和启动通过；14 项 XCTest 全部通过 |
| iOS 真机页面验收 | 已打开登录页；XCTest UI runner 两次在建立控制连接时以 code 74 退出。手动验收未完成登录，随后无线连接断开，按用户要求停止 |
| 独立代码复查 | 已修复检查中发现的账号隔离、过时快照、离线状态代次、恢复并发和过期路线估算问题 |

联调服务由 `mobile/tools/dev-server.mjs --seed` 启动，使用现有后端实现和独立 SQLite 数据库。界面测试通过正常登录访问该服务。正式服务的 `/api/health` 读取返回正常。

路线签名的四组样例由现有 `app/src/domain.js` 生成，覆盖中文、引号、斜线、整数坐标、极小坐标和负零；两种原生实现都读取 `mobile/fixtures/routes.json` 校验接口兼容性。

## 交付方式

- Android 提供连接正式服务的调试 APK。
- iOS 提供 Xcode 工程、模拟器应用和 iPhoneOS 编译产物。本次已注册真机并生成开发描述文件，签名应用已无线安装到 iPhone 17 Pro Max。
- 构建产物存放于仓库的 `releases/mobile/`，不提交 Git。源代码在 `dev` 分支开发。

## 功能范围

已支持账号、创建与加入旅程、按天安排、活动编辑与排序、地点收藏和搜索、路程、费用、成员与邀请管理、删除恢复表态、离线保存和前台同步。

邀请二维码扫描、推送通知、后台同步及网页中的部分外观偏好尚未迁移。地图离线包未提供；真实多人长时间使用和真机登录后的页面验收尚未完成。

## 本次真机测试环境

Xcode 27.1，通过局域网连接 iOS 27.0.1。测试后端使用独立 SQLite 数据库。单元测试的路线样例现随测试 bundle 打包；UI 测试支持通过 `JOURNEY_FIXTURE_JSON` 接收 Mac 上生成的测试账号配置。

构建目录使用 `/private/tmp/journey-ios-iphone-20261029`。仓库位于 iCloud Documents，直接在仓库内生成 `.app` 会被加上 `com.apple.FinderInfo`，导致 codesign 报 `resource fork, Finder information, or similar detritus not allowed`。

本次未验证真机登录、四页操作及保存结果。测试结束后已停止本地后端。测试日志保存在 `.local/ios-iphone-test-run3.log`、`.local/ios-iphone-ui-run4.log`，单元测试结果保存在 `.local/iphone-acceptance/results-run3.xcresult`。

恢复调试时，Xcode 仍显示手机 `unavailable`，主动读取设备 App 列表返回 CoreDevice error 4016，尚未建立可信设备服务连接。账号输入框已指定邮箱键盘并标记为用户名输入，避免默认中文键盘影响邮箱输入；修改后的签名真机构建通过，尚未安装到手机验证。构建日志保存在 `.local/ios-iphone-test-build-resume.log`。
