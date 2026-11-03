# 分支与发布

- 后续修改默认在 `dev` 分支开发，完成相关检查后提交并推送到 `origin/dev`。
- 合并到 `main` 前，完成相关测试与验收，并取得用户明确确认；通过以 `main` 为目标的 Pull Request 合并。
- `main` 用于正式发布；推送 `dev` 后保留在开发分支，等待确认后再合并。

# 项目索引（什么东西在哪）

## 顶层与跨端共享
- `README.md`：项目总览、产品范围、快速启动与设计文档导航。
- `AGENTS.md`：协作开发规范、项目索引、状态维护与浏览器测试准则。
- `STATE.md`：任务状态跟踪看板，记录当前步骤、已做决定及理由、产出物、风险和下一步。
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

开发与维护过程中，必须在仓库根目录维护 `STATE.md`，在每次关键步骤推进、决策落定或阶段交付时同步更新，作为跨会话的唯一进度快照。`STATE.md` 需持续记录以下五项内容：

- **当前步骤**：当前所在分支、正在执行的任务阶段及完成度。
- **已做决定及理由**：关键产品、交互、架构或工程决策及其取舍依据。
- **产出物**：本阶段新增或更新的核心代码、文档、测试结果与构建产物路径。
- **风险**：已知环境限制、外部依赖约束、潜在回归风险或阻塞项。
- **下一步**：明确、可验证的后续待办事项与合并/发布前置条件。

# 浏览器测试

- 正式 E2E 从 `app/` 执行 `npm run test:e2e -- <测试文件或过滤参数>`；独立验收/截图脚本使用 `npm run test:browser -- <脚本路径> [参数]`。
- 在 macOS Codex 中，凡是会启动 Chrome 或 WebKit 的命令，从第一次执行就通过 `exec_command` 的 `sandbox_permissions: "require_escalated"` 申请该命令的授权。原因是 Seatbelt 阻止 Chrome 访问 LaunchServices/WindowServer，导致应用注册时 SIGABRT 并弹出系统崩溃窗口。
- 若命令返回 `JOURNEY_BROWSER_SANDBOX`，按原命令申请授权后执行。不要在受限环境重试、清除 `CODEX_SANDBOX`、全局关闭沙箱或添加 `--no-sandbox`。Chrome 自身沙箱必须保留。
- `npm run test:e2e -- --list`、帮助和不启动浏览器的单元测试可在受限环境运行。
- 新建独立浏览器脚本时，导入 `app/scripts/browser-runtime.mjs` 的 `assertBrowserLaunchAllowed`、`launchChrome` / `launchWebKit`。在启动本地服务前执行检查，通过共享函数启动浏览器，并在 `finally` 中关闭浏览器和服务。E2E 优先使用 Playwright fixture；额外引擎使用共享启动函数。
- 独立 Playwright 配置必须调用共享的 `preparePlaywrightTest()`，将同一模块设为 `globalSetup`，沿用 `chromeLaunchOptions`。浏览器缓存默认使用项目 `.local/browsers/`，已有 `PLAYWRIGHT_BROWSERS_PATH` 设置继续生效。
- 启动流程回归运行 `node --test tests/browser-runtime.test.mjs` 和 `npm run test:e2e -- browser-startup.spec.mjs`。后者只检查本机 Chrome/WebKit，创建页面内测试内容，无需业务服务或生产站点。

`.local` 内的历史发布/验收副本保留原始源码；如需复跑，通过当前 `npm run test:e2e -- --config <旧配置路径>` 或 `npm run test:browser -- <旧脚本路径>` 执行，以使用现行启动检查。
