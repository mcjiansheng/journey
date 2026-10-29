# 同行 · 原生客户端

Android 使用 Kotlin、Jetpack Compose 和 Material 3；iOS 使用 SwiftUI。两个工程直接连接 Journey 的 Express 服务，沿用网页端账号、旅程、成员、收藏和账本。

页面延续现有「我的旅程 → 行程 / 地图 / 费用 / 管理」结构，沿用暖灰底色与墨绿色强调色；日期选择、表单、弹层、分享和导航使用各平台原生控件。

## 工程

- `android/`：Android Studio / Gradle 工程。
- `ios/`：Xcode / SwiftUI 工程。
- `tools/dev-server.mjs`：原生客户端验收后端，复用 `app/server/index.mjs`，数据库独立存放于 `.local/mobile-acceptance/`。

默认服务地址为 `https://journey.jscloud.wang`。客户端使用现有 Cookie 会话、Origin 和 CSRF 协议，接口与字段以 `app/server/model.mjs`、`app/server/index.mjs` 和 `app/CONTRACT.md` 为依据。

## 本地联调

先安装现有后端依赖，再从仓库根目录启动：

```sh
cd app
npm ci
cd ..
node mobile/tools/dev-server.mjs --seed
```

服务监听 `http://127.0.0.1:4188`。`--seed` 通过真实注册、创建旅程和操作接口生成一组本地验收数据，账号与旅程信息写入 `.local/mobile-acceptance/fixture.json`。不带该参数时只启动服务。

iOS 模拟器直接访问上述地址。Android 模拟器或 USB 设备先执行 `adb reverse tcp:4188 tcp:4188`，再用相同地址构建调试版；这样请求的 Origin 也与本地服务配置一致。

## 构建

Android 需要 JDK 17 和 Android SDK 35：

```sh
cd mobile/android
./gradlew testDebugUnitTest lintDebug assembleDebug
```

调试安装包输出到 `mobile/android/app/build/outputs/apk/debug/app-debug.apk`。连接本地后端时增加 `-PjourneyBaseUrl=http://127.0.0.1:4188`；默认构建连接正式服务。

iOS 使用 Xcode 打开 `mobile/ios/Journey.xcodeproj`，选择 `Journey` scheme 和目标设备。命令行构建模拟器版本：

```sh
xcodebuild build -project mobile/ios/Journey.xcodeproj -scheme Journey \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath .local/ios CODE_SIGNING_ALLOWED=NO
```

模拟器 `.app` 位于 `.local/ios/Build/Products/Debug-iphonesimulator/Journey.app`。在 Xcode 的 Run 环境变量中设置 `JOURNEY_SERVER_URL=http://127.0.0.1:4188` 可连接本地后端。真机安装在 Signing & Capabilities 中选择开发团队，由 Xcode 生成开发签名。

CI 工作流 `.github/workflows/mobile.yml` 分别执行 Android 单元测试、Lint、APK 构建，以及 iOS 单元测试和模拟器构建，并保存构建产物。

本轮测试结果、交付方式和功能范围见[验收记录](ACCEPTANCE.md)。平台细节见 [Android](android/README.md) 和 [iOS](ios/README.md)。

## 地图

iOS 使用 [MapKit for SwiftUI](https://developer.apple.com/documentation/mapkit/mapkit-for-swiftui)，Android 使用 [MapLibre Native](https://maplibre.org/maplibre-native/android/examples/getting-started/)。地点搜索复用服务端高德代理，地图密钥保持由服务端管理。高德地点保存为 GCJ-02；原生地图展示时转换坐标，读写仍遵循现有 Place 格式。

## 开发与发布

开发在 `dev` 分支进行，检查后提交并推送 `origin/dev`。原生安装包与网页发布分别构建。合并 `main` 仍需用户确认并通过 Pull Request。
