# 同行 Android

Kotlin / Jetpack Compose Material 3 原生客户端，Android 8.0（API 26）及以上。地图使用 MapLibre Native 和 OpenStreetMap 瓦片。

## 构建

使用 JDK 17、Android SDK Platform 35 与 Build Tools 35.0.0：

```sh
./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
```

默认后端为 `https://journey.jscloud.wang`。开发包可指定本地后端：

```sh
adb reverse tcp:4188 tcp:4188
./gradlew -PjourneyBaseUrl=http://127.0.0.1:4188 :app:assembleDebug
```

调试配置只允许 localhost、127.0.0.1、10.0.2.2 使用 HTTP。Release 配置要求 HTTPS，签名由正式发布环境提供。`assembleDebug` 产物为 `app/build/outputs/apk/debug/app-debug.apk`。

## 实现

- 密码注册、登录、Cookie 会话恢复；Origin 与 CSRF 按现有后端合同发送。
- 旅程创建、目的地时区查询、邀请预览与加入；行程、地图、费用、旅程设置四个页面。
- 活动按天编辑，支持灵活/精确时间、跨日结束、地点、备注、链接、前后预留时间和排序；日期调整保留范围外安排。
- 共享路程支持起终点、步行/驾车/骑行/公交、自动查询及手动分钟；输入变化会清除旧估算。
- 费用按币种统计，金额按币种小数位换算，支持预计/已支付、日期与关联活动。
- 原生地图地点搜索、收藏、长按选点、加入行程和路线；高德地点坐标与地图坐标在显示边界转换。
- 成员管理、邀请分享与撤销、个人归档、退出旅程、删除/恢复表态、昵称和主题设置。

`JourneyStore` 是状态与写入队列的唯一持有者。每个后端与账号分别保存快照、草稿和队列，文件通过 `AtomicFile` 写入。操作先落盘再关闭编辑器，后台按旅程顺序上传；一个旅程的阻塞不会暂停其他旅程。前台每 12 秒验证会话并刷新。重新启动后不复用内存中的时间租约；没有可信时间依据的新编辑留在本机，用户可明确重新应用。未知回执保留原操作标识与正文，只允许先重试确认。

`Theme.kt` 从生成的 `DesignTokens.palette` 读取森林绿、海图蓝两套浅色/深色调色板。账号偏好中的 `palette`、`theme` 在网页和原生端共用。“我的设置”按外观、辅助功能、通知与提示、保存与同步、账号分类，外观用真实颜色的预览卡片，选择后直接保存。

森林绿和海图蓝都使用各自的环境渐变；开启“减少透明效果”后，两套主题都使用不透明卡片和导航，移除渐变、高光及阴影，并保留选中底色。Android 由应用内开关控制。“减少动态效果”支持跟随系统动画设置、关、开，控制地图定位的移动动画。通知与提示页跳转 Android 系统通知设置；地图没有桌面侧栏，不展示自动收起选项。顶栏头像在旅程内外都能打开我的设置，同步图标直接打开保存与同步。

## 测试

JVM 测试覆盖坐标往返、精确活动槽位、币种金额、目的地时区、跨夏令时自然日、离线生命周期/表态/改期投影、与网页完全相同的路程签名，以及 Cookie、Origin、CSRF 与无法解析的回执。

真实 API 测试通过环境变量 `JOURNEY_TEST_BASE_URL`、`JOURNEY_TEST_IDENTIFIER`、`JOURNEY_TEST_PASSWORD`、`JOURNEY_TEST_TRIP_ID` 注入独立验收账号；未提供时只跳过该项。

模拟器验收通过 instrumentation runner 参数 `identifier`、`password`、`tripName` 注入账号。测试执行真实登录、切换四页、添加活动/费用、等待一个前台刷新周期，并将页面截图保存在应用外部文件目录的 `acceptance/` 下：

```sh
./gradlew -PjourneyBaseUrl=http://127.0.0.1:4188 \
  -Pandroid.testInstrumentationRunnerArguments.identifier="$JOURNEY_TEST_IDENTIFIER" \
  -Pandroid.testInstrumentationRunnerArguments.password="$JOURNEY_TEST_PASSWORD" \
  -Pandroid.testInstrumentationRunnerArguments.tripName="南京周末" \
  :app:connectedDebugAndroidTest
```

### 双主题与纯平模式截图

用本地验收后端生成账号 fixture 后，先在本目录编译连接该后端的应用与测试包：

```sh
./gradlew -PjourneyBaseUrl=http://127.0.0.1:4188 \
  :app:assembleDebug :app:assembleDebugAndroidTest
```

启动一台 Android 模拟器，在仓库根目录运行：

```sh
python3 mobile/android/scripts/capture-palettes.py \
  --fixture .local/mobile-acceptance/fixture.json \
  --app-apk mobile/android/app/build/outputs/apk/debug/app-debug.apk \
  --test-apk mobile/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk \
  --output docs/实施记录/2026-11-02-双主题与设置修复/android \
  --shutdown
```

脚本从 fixture 读取账号，不输出凭据；自动安装、清除应用数据、设置 `adb reverse`，只执行 `palettesAndFlatSettingsScreenshots`。默认设备是 `emulator-5554`、旅程名是“南京周末”，分别可用 `--serial`、`--trip-name` 指定。SDK 默认读取 `ANDROID_HOME`，也可传 `--sdk`；APK 从临时目录构建时，传入对应路径即可。`--shutdown` 会在执行结束后关闭模拟器。

验收覆盖森林绿/海图蓝与浅色/深色四种组合的首页、行程、分类设置、外观预览、纯平行程和旅程设置，截图与 `instrumentation.log` 一起保存到输出目录。
