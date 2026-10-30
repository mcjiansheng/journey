# 同行 iOS

SwiftUI 原生客户端，最低 iOS 17。直接打开 `Journey.xcodeproj`，选择共享的 `Journey` scheme。工程无需 CocoaPods、Swift Package 或 XcodeGen。新增源文件后可运行 `python3 mobile/ios/generate-project.py` 重建工程引用。

默认连接 `https://journey.jscloud.wang`。开发与 UI 测试可通过启动环境变量 `JOURNEY_SERVER_URL` 指定地址。HTTP 只为本地网络开发开放，线上使用 HTTPS。

## 构建与验收

从仓库根目录执行：

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project mobile/ios/Journey.xcodeproj -scheme Journey \
  -configuration Debug -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,id=41BE5356-97FF-41D6-9644-84ADDFCE2CCE' \
  -derivedDataPath .local/ios CODE_SIGNING_ALLOWED=NO test

DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project mobile/ios/Journey.xcodeproj -scheme Journey \
  -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' \
  -derivedDataPath .local/ios-device CODE_SIGNING_ALLOWED=NO build
```

真实 UI 验收先启动 `node mobile/tools/dev-server.mjs --seed`。测试读取它生成的 `.local/mobile-acceptance/fixture.json`，通过正常密码登录，打开南京周末，检查四个原生页面，保存活动、手动路程与费用。没有 fixture 时，UI 测试报告跳过；单元测试继续运行。

开发签名在 Xcode 的 Signing & Capabilities 中选择自己的团队；工程未保存个人团队标识。签名需要本 App 的开发描述文件。

### 真机与本地后端

让 Mac 与 iPhone 连接同一局域网，使用 Mac 的局域网地址启动后端，例如：

```sh
JOURNEY_TEST_HOST=0.0.0.0 JOURNEY_TEST_ORIGIN=http://192.168.1.10:4188 \
  node mobile/tools/dev-server.mjs --seed
```

`JOURNEY_TEST_HOST` 设置监听地址，`JOURNEY_TEST_ORIGIN` 设置手机访问地址、后端 Origin、seed 请求地址和 fixture 的 `serverURL`。端口可用 `JOURNEY_TEST_PORT` 修改。默认仍监听 `127.0.0.1:4188`。

选择已配对的 iPhone，签名并执行 `build-for-testing -derivedDataPath /private/tmp/journey-ios-device` 后，把生成的 `.xctestrun` 路径设为 `XCTESTRUN`。构建产物放在 iCloud Documents 外，避免 iCloud 写入 `com.apple.FinderInfo` 后触发签名错误 `resource fork, Finder information, or similar detritus not allowed`。将 fixture JSON 注入 UI 测试 runner 的 `EnvironmentVariables`：

```sh
export XCTESTRUN='/private/tmp/journey-ios-device/Build/Products/生成的文件.xctestrun'
python3 - <<'PY'
import os, pathlib, plistlib
path = pathlib.Path(os.environ['XCTESTRUN'])
run = plistlib.loads(path.read_bytes())
fixture = pathlib.Path('.local/mobile-acceptance/fixture.json').read_text()
run['JourneyUITests'].setdefault('EnvironmentVariables', {})['JOURNEY_FIXTURE_JSON'] = fixture
path.write_bytes(plistlib.dumps(run))
PY
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -xctestrun "$XCTESTRUN" \
  -destination "platform=iOS,id=$IOS_DEVICE_ID" test-without-building
```

`IOS_DEVICE_ID` 使用 Xcode 中该 iPhone 的设备标识。真机 UI 测试从 `JOURNEY_FIXTURE_JSON` 读取 fixture；未设置时，模拟器继续读取 Mac 上的 fixture 文件。路程签名单元测试使用测试包内的 `routes.json`，构建时直接引用 `mobile/fixtures/routes.json`。

## 已实现

- 密码登录、注册、Keychain 会话恢复，Cookie、Origin 与 CSRF 按现有后端执行。
- 旅程列表、创建（日期范围、团队模式、币种与时区）、邀请码和链接预览、加入旅程。
- 原生 TabView：行程、地图、费用、管理；亮色使用薄荷背景与深绿强调色，暗色使用深绿背景与亮薄荷强调色；iOS 26 起使用原生 Liquid Glass 按钮与玻璃悬浮导航。
- 按天安排活动，编辑时间、跨日结束、地点、缓冲、备注与链接，调整日期与活动顺序。精确时间仅在精确活动槽位重排，灵活活动保留位置。
- MapKit 地图、收藏、地点搜索与手动地点、添加行程、系统地图导航。地图首次根据地点范围定位；共享刷新保留用户相机位置。
- 共享路程展示和编辑，支持步行、驾车、骑行、公交，手动时间和现有代理估算。路线折线从 GCJ-02 转为 WGS84 后绘制。路程签名与网页兼容；端点变化后提示重新查询。
- 费用创建与分组增改，原币种分别统计已支付和预计费用，费用关联活动。编辑只发送用户改过的逻辑组；未修改的组继续接收协作更新。
- 邀请分享和撤销、成员权限与移除、团队模式、归档、退出与最后成员永久清除、软删除和恢复、成员表态、昵称与外观设置。
- 前台每 8 秒读取共享快照；按 epoch/cursor 拒绝过时响应。

## 保存与同步

`JourneyStore` 是 MainActor 上唯一的会话与队列所有者。本机缓存按服务器和账号分别保存；队列与草稿以原子写入保存，文件采用系统数据保护。账号切换先读取目标账号缓存，再一次安装会话；读取失败清空当前可见账号状态并保留原文件。

操作在入队时生成固定 ID 和单调时钟证据。上传按每段旅程的原队列顺序进行；一段旅程阻塞不影响其他旅程。丢失或无法识别回执时保留原操作和时钟，重试确认。明确时间不可信时由用户确认重新应用，生成新操作 ID，保留对象标识和生命周期代次。恢复操作与上传互斥；恢复前后的账号和待处理操作范围必须一致。

重启后不沿用旧进程的单调时间作为新编辑依据。离线新编辑保留在队列，联网后由用户确认重新应用。冷启动网络失败可查看最后账号的本机旅程；明确 401 则进入登录页。恢复网络先重新读取会话与 CSRF，再校时和上传。

界面即时结果由权威快照与同一份队列投影得到，未额外持久化一份乐观状态。投影覆盖活动/费用/收藏/路程、旅程信息、改期、生命周期代次和表态多数规则。

## 当前未覆盖

- 邀请二维码扫描与二维码展示，通知开关，以及网页中的更多外观/触感选项。
- MapKit 地图瓦片来自系统地图；离线地图包未提供。高德在线搜索和自动估算需要现有服务器地图代理可用。
- 前台轮询用于协作更新；未提供后台同步或推送。
- UI 自动验收使用隔离的本地真实后端。iPhone 17 Pro Max / iOS 27.0.1 已完成无线安装、启动和 14 项单元测试；本次真机 UI runner 在建立控制连接时退出，登录后的页面验收尚未完成。线上多人长时并发和外网地图代理验收仍待完成。

单元测试覆盖 GCJ/WGS 转换、时钟突变、费用精度、跨夏令时日期、混排排序、生命周期与多数表态投影、范围外计划日、快照版本、网页路程签名、未知回执恢复，以及账号缓存损坏隔离。
