# 分支与发布

- 后续修改默认在 `dev` 分支开发，满足「默认完成标准」后提交并推送到 `origin/dev`。
- 合并到 `main` 前，完成相关测试与验收，并取得用户明确确认；通过以 `main` 为目标的 Pull Request 合并。原因：推送 `main` 会触发 `.github/workflows/deploy.yml` 直接部署生产站点。
- `main` 用于正式发布；推送 `dev` 后保留在开发分支，等待确认后再合并。

# 默认完成标准

除非任务另有说明，宣布完成前满足以下各项，并在回复中给出实际运行结果，不凭推断声称通过：

- 在 `app/` 执行 `npm run check` 与 `npm run format:check` 均通过（Token、时区、对比度、单测、构建、格式）。
- 改到界面行为时，运行相关 E2E（`npm run test:e2e -- <spec>`）；界面外观有变化时，在 390 与 1280/1440 宽度截图，存入 `.local/evidence/<MMDD-主题>/`。
- 改到 `mobile/` 时，按 `mobile/README.md` 运行对应平台的构建与单元测试。
- 提交信息写清改了什么，不加 AI 署名行（如 `Co-Authored-By`、`Claude-Session`）；AI 参与统一在 README「AI 参与说明」中说明。较大改动在 `docs/实施记录/<日期>-<主题>.md` 记录修改与验证结果；同一天同一主题的追修追加到该文件。
- 测试失败时，先判断该测试表达的是需求（用户要求、`app/CONTRACT.md`、设计文档）还是临时限制或旧需求：前者修改实现；后者与当前需求矛盾时可以更新测试，并在回复中说明改了哪个测试、依据哪条需求。任何情况下都不为通过而跳过、放宽或删除测试。

# 项目索引（什么东西在哪）

## 顶层与跨端共享
- `README.md`：项目总览、产品范围、快速启动与设计文档导航。
- `AGENTS.md`：协作开发规范、项目索引、状态维护与浏览器测试准则。
- `STATE.md`：跨会话进度快照（不是日志），维护规则见「状态维护」。
- `design/tokens.json`：跨端设计 Token 单一事实源（薄荷/海图蓝双色板、明暗模式、字号与圆角）。
- `shared/destination-timezones.json`：Web 与原生客户端共享的目的地默认时区映射表。
- `scripts/`：跨端生成与校验脚本（`generate-design-tokens.mjs`、`generate-destination-timezones.mjs`、`check-design-contrast.mjs`、`appearance-init.template.js`）。
- `.github/workflows/`：CI/CD 工作流（`deploy.yml` 负责 Web 校验与发布，`mobile.yml` 负责 Android/iOS 构建与测试）。

## Web 正式应用（`app/`）
- `app/package.json`：Web 前后端脚本入口（`dev`、`build`、`start`、`test`、`test:e2e`、`check`）。
- `app/CONTRACT.md`：前后端与原生端共享的 REST API、Cookie/CSRF 会话、离线同步与冲突合并协议。
- `app/src/main.jsx` & `App.jsx`：React 应用入口、全局状态编排与「行程 / 地图 / 费用 / 设置」主导航切换。
- `app/src/MapView.jsx` & `amap.js`：高德地图 JS API 2.0 视图、路线规划、地点标记与视口控制（配 `map*.js/css`）。
- `app/src/sync.js` & `domain.js`：IndexedDB 离线存储、自动保存、字段级时间戳合并及行程/账本/团队表态领域逻辑。
- `app/src/appearance.js` & `tokens.css` & `styles.css`：主题色板切换、明暗模式、减少透明效果（纯平模式）及全局样式。
- `app/src/components/`（主流程）：`Login.jsx` 登录、`Entry.jsx` 旅程列表与创建、`Itinerary.jsx` 行程主视图、`ActivityEditor.jsx` 活动编辑、`Ledger.jsx` 费用账本。
- `app/src/components/`（设置与公共）：`Settings.jsx` 旅程管理、`PersonalSettings.jsx` 个人偏好、`SyncSettings.jsx` 同步状态、`TeamModePicker.jsx` 团队模式、`ui.jsx` 通用控件。
- `app/server/`（核心业务）：`index.mjs` 路由与 API 入口、`model.mjs` 领域模型与冲突合并、`db.mjs` SQLite 持久化、`config.mjs` 环境配置。
- `app/server/`（安全与集成）：`auth.mjs` 会话认证、`security.mjs` 限流与安全头、`amap.mjs` 高德服务代理、`admin.mjs` 管理员维护工具。
- `app/scripts/`：构建收尾（`finalize-build.mjs`）、压测（`load-check.mjs`）及浏览器运行封装（`browser-runtime.mjs`、`run-browser-tests.mjs`）。
- `app/tests/`：Node 单元/集成测试（`*.test.mjs`）与 Playwright E2E 用例（`tests/e2e/*.spec.mjs`）。
- `app/ops/`：生产发布、回滚与备份脚本（`deploy-release.py`、`backup.mjs`、Nginx 与 systemd 配置）。

## 原生客户端（`mobile/`）
- `mobile/README.md` & `THEME.md` & `ACCEPTANCE.md`：原生双端构建说明、主题映射规范与验收报告。
- `mobile/android/`：Android 客户端（Kotlin + Jetpack Compose + Material 3 + MapLibre Native），源码位于 `app/src/main/`。
- `mobile/ios/`：iOS 客户端（SwiftUI + MapKit），含 `Journey/` 源码、`JourneyTests/`、`JourneyUITests/` 与工程生成脚本 `generate-project.py`。
- `mobile/tools/dev-server.mjs` & `fixtures/`：原生联调验收后端（默认监听 `4188` 端口）与测试种子数据。

## 文档与本地归档（`docs/` 及忽略目录）
- `docs/设计文档/`：`00`–`09` 正式需求规格（SRS）、交互设计稿、系统数据设计、决策工作坊与旅行图册重设计文档。
- `docs/实施记录/`：按日期归档的修复说明、测试验收记录、截图证据、`运行维护.md` 与 `GitHub自动部署.md`。
- `docs/评审输入/` & `docs/竞品调研/`：代码与前端设计审查报告、修改建议及前期竞品调研材料。
- `.local/`、`outputs/`、`releases/`、`prototype*/`、`sites/`：本地浏览器缓存、验收证据、安装包产物与历史原型（均由 `.gitignore` 排除，不入库）。

# 状态维护（STATE.md）

`STATE.md` 是给下一次会话看的**快照**，不是日志。旧内容堆积会让下一次会话分不清哪条是“现在”、哪个构建号是最新的。

- **何时更新**：开始或结束一个跨会话任务、做出今后需要遵守的决定、出现或解除未解决的风险、合并 `main` 发布。普通小修（包括推送 dev）不更新，提交信息就是记录；最新提交与构建号以 `git log` 为准，不写进 STATE.md。
- **怎么更新**：整体重写，不追加。已完成的过程与验证细节写入 `docs/实施记录/<日期>-<主题>.md`，`STATE.md` 只留链接。全文保持在约 40 行以内。
- **各节含义**（标题保持不变）：
  - **当前步骤**：正在进行的事，含分支和完成度；没有就写“无进行中的任务”及当前交付状态。
  - **已做决定及理由**：今后仍需遵守的规则及理由；已被代码或 `app/CONTRACT.md` 固化、或已过时的删掉或改为链接。
  - **产出物**：只列当前阶段的实施记录与证据路径，不写会随提交变化的哈希。
  - **风险**：尚未解决的问题；解决后删除。
  - **下一步**：未完成、可验证的事项；完成即删。

# 浏览器测试

- 正式 E2E 从 `app/` 执行 `npm run test:e2e -- <测试文件或过滤参数>`；独立验收/截图脚本使用 `npm run test:browser -- <脚本路径> [参数]`。
- 在 macOS Codex 中，凡是会启动 Chrome 或 WebKit 的命令，从第一次执行就通过 `exec_command` 的 `sandbox_permissions: "require_escalated"` 申请该命令的授权。原因是 Seatbelt 阻止 Chrome 访问 LaunchServices/WindowServer，导致应用注册时 SIGABRT 并弹出系统崩溃窗口。
- 若命令返回 `JOURNEY_BROWSER_SANDBOX`，按原命令申请授权后执行。不要在受限环境重试、清除 `CODEX_SANDBOX`、全局关闭沙箱或添加 `--no-sandbox`。Chrome 自身沙箱必须保留。
- `npm run test:e2e -- --list`、帮助和不启动浏览器的单元测试可在受限环境运行。
- 新建独立浏览器脚本时，导入 `app/scripts/browser-runtime.mjs` 的 `assertBrowserLaunchAllowed`、`launchChrome` / `launchWebKit`。在启动本地服务前执行检查，通过共享函数启动浏览器，并在 `finally` 中关闭浏览器和服务。E2E 优先使用 Playwright fixture；额外引擎使用共享启动函数。
- 独立 Playwright 配置必须调用共享的 `preparePlaywrightTest()`，将同一模块设为 `globalSetup`，沿用 `chromeLaunchOptions`。浏览器缓存默认使用项目 `.local/browsers/`，已有 `PLAYWRIGHT_BROWSERS_PATH` 设置继续生效。
- 启动流程回归运行 `node --test tests/browser-runtime.test.mjs` 和 `npm run test:e2e -- browser-startup.spec.mjs`。后者只检查本机 Chrome/WebKit，创建页面内测试内容，无需业务服务或生产站点。

`.local` 内的历史发布/验收副本保留原始源码；如需复跑，通过当前 `npm run test:e2e -- --config <旧配置路径>` 或 `npm run test:browser -- <旧脚本路径>` 执行，以使用现行启动检查。
