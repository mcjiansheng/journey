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
- 旅程创建、目的地时区查询、邀请预览与加入；行程、地图、费用、管理四个页面。
- 活动按天编辑，支持灵活/精确时间、跨日结束、地点、备注、链接、前后预留时间和排序；日期调整保留范围外安排。
- 共享路程支持起终点、步行/驾车/骑行/公交、自动查询及手动分钟；输入变化会清除旧估算。
- 费用按币种统计，金额按币种小数位换算，支持预计/已支付、日期与关联活动。
- 原生地图地点搜索、收藏、长按选点、加入行程和路线；高德地点坐标与地图坐标在显示边界转换。
- 成员管理、邀请分享与撤销、个人归档、退出旅程、删除/恢复表态、昵称和主题设置。

`JourneyStore` 是状态与写入队列的唯一持有者。每个后端与账号分别保存快照、草稿和队列，文件通过 `AtomicFile` 写入。操作先落盘再关闭编辑器，后台按旅程顺序上传；一个旅程的阻塞不会暂停其他旅程。前台每 12 秒验证会话并刷新。重新启动后不复用内存中的时间租约；没有可信时间依据的新编辑留在本机，用户可明确重新应用。未知回执保留原操作标识与正文，只允许先重试确认。

`Theme.kt` 统一管理浅色、深色的页面、卡片、文字、选中态与操作颜色；页面使用薄荷、蓝灰和奶油色的轻渐变，深色使用近黑绿背景。系统栏随外观切换，底部导航保留原生 Material 交互并使用悬浮圆角容器。

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
