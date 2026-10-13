# 浏览器测试

- 正式 E2E 从 `app/` 执行 `npm run test:e2e -- <测试文件或过滤参数>`；独立验收/截图脚本使用 `npm run test:browser -- <脚本路径> [参数]`。
- 在 macOS Codex 中，凡是会启动 Chrome 或 WebKit 的命令，从第一次执行就通过 `exec_command` 的 `sandbox_permissions: "require_escalated"` 申请该命令的授权。原因是 Seatbelt 阻止 Chrome 访问 LaunchServices/WindowServer，导致应用注册时 SIGABRT 并弹出系统崩溃窗口。
- 若命令返回 `JOURNEY_BROWSER_SANDBOX`，按原命令申请授权后执行。不要在受限环境重试、清除 `CODEX_SANDBOX`、全局关闭沙箱或添加 `--no-sandbox`。Chrome 自身沙箱必须保留。
- `npm run test:e2e -- --list`、帮助和不启动浏览器的单元测试可在受限环境运行。
- 新建独立浏览器脚本时，导入 `app/scripts/browser-runtime.mjs` 的 `assertBrowserLaunchAllowed`、`launchChrome` / `launchWebKit`。在启动本地服务前执行检查，通过共享函数启动浏览器，并在 `finally` 中关闭浏览器和服务。E2E 优先使用 Playwright fixture；额外引擎使用共享启动函数。
- 独立 Playwright 配置必须调用共享的 `preparePlaywrightTest()`，将同一模块设为 `globalSetup`，沿用 `chromeLaunchOptions`。浏览器缓存默认使用项目 `.local/browsers/`，已有 `PLAYWRIGHT_BROWSERS_PATH` 设置继续生效。
- 启动流程回归运行 `node --test tests/browser-runtime.test.mjs` 和 `npm run test:e2e -- browser-startup.spec.mjs`。后者只检查本机 Chrome/WebKit，创建页面内测试内容，无需业务服务或生产站点。

`.local` 内的历史发布/验收副本保留原始源码；如需复跑，通过当前 `npm run test:e2e -- --config <旧配置路径>` 或 `npm run test:browser -- <旧脚本路径>` 执行，以使用现行启动检查。
