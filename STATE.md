<!-- 快照，不是日志：整体重写，不追加；已完成的内容移到 docs/实施记录/。规则见 AGENTS.md「状态维护」。 -->
# 项目状态

更新时间：2026-11-13

## 当前步骤

- `dev` 已完成合并前审查修复与 macOS 本机验证（2026-11-13）：`npm run check`（192 单测全通过 + 构建）、`format:check`、69 项 E2E（含两条新增用例）、专项浏览器回归与 390/1280 截图均已通过。

## 已做决定及理由

- 默认开发分支 `dev`；`main` 等用户明确确认后通过 PR 合并（推送 `main` 触发自动部署）。
- 地图小组件降级顺序：高德 Web 服务静态图（`webKey`）→ 高德栅格瓦片（2× 清晰度）→ 草图轮廓（断网标「离线」，加载失败标「地图未载入」）。
- 白板本地修改优先使用顶层 `item.frame` 并即时同步 `itemsRef.current`；样式 patch 必须经过 `BOARD_STYLE_KEYS`/`cleanBoardStylePatch()`，新增样式字段要同步加入。
- 交互与面板拖拽：面板拖出在 `window` 上跟踪移动/松手/取消/失焦及 `document.visibilitychange`（窗口外松手 `buttons & 1 === 0` 或失焦立即取消）；第一次单击只出变换框，再次单击或右键出菜单。
- 浮动栏与弹层排版：实测 `#toolbar`、`#zoom`、`#top-left`、`.header-right` 避让；`.style-pop` 展开时隐藏 `#actions` 悬停提示；390 窄屏下 `.gallery-tools` 限宽折行。
- 参考线与缩放控件：虚线连接屏幕约 `240px` 内最近对齐对象；「对齐吸附」开关记在 `localStorage`，拖动按住 `⌥` 临时反转；图库调整控件与箭头按 `scale(--ik)` 保持屏幕可读尺寸并避开侧边手柄。
- 媒体与内容：富文本存 `content.html`（白名单清洗）并保留纯文本；表情库跟账号（服务端 `preferences.stickers`），我的表情右键菜单挂到页面顶层避免面板裁切；非 GIF/贴纸图片转 JPEG，表情/贴纸保留透明度；分区仅标题和边框接指针。
- 分区归属：对象至少一半（旋转后外框）在分区内即属于它，分区套分区要求完全在内；拖动与选中提示共用 `inSection()`。
- 断网是状态不是错误：`sync.js` 的 `setError` 遇 `NETWORK` 只置 `offline`，不出页面横幅；每次访问首次离线提示一次。
- 地图小组件外观：卡片 `style.variant`（plain/flat/polaroid/outline）+ 地图 `style.mapStyle`（standard/light/dark/satellite/sketch），服务端只允许 place/places/route 设置 `mapStyle`。
- 已知限制：新建便签/分区/文字后 4–5ms 内立即打字可能丢字；白板重进自动「适应全板」；缩放步进 1.2（无法精确 59%）。

## 产出物

- 合并前审查与本机验证结果：[合并前审查报告.md](docs/评审输入/2026-11-13-合并前审查/合并前审查报告.md)
- 实施记录：[2026-11-11-白板交互与界面.md](docs/实施记录/2026-11-11-白板交互与界面.md)
- 验收证据：`.local/evidence/1113-审查修复/`（4 张 390/1280 截图）、`.local/evidence/1111-白板界面/`

## 风险

- 浅色暖黄便签上的橙色文字对比度 3.69:1 低于 AA（需求只要求深色模式可读，暂只记录）。
- 「最近」表情存 localStorage，不跟账号、不跨设备（预期内）。
- Chrome 真实后台切走标签页依赖 `visibilitychange`/`blur` 取消拖拽；无头浏览器多标签切换不触发该事件，曾通过派发 `visibilitychange`（`document.hidden = true`）及 `window.blur` 实测通过。

## 下一步

- 推送 `dev` 后确认 `ci.yml` 通过；真机（iOS Safari、Android Chrome）确认触屏点选便签不弹软键盘。
- 审查报告未处理的 P2-3、P2-6、P2-7 与 P3 另行安排。
- 完成审查报告第七节服务器配置并取得用户明确确认后，创建以 `main` 为目标的 PR 合并发布。
