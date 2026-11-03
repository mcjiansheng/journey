# 项目状态跟踪（STATE.md）

更新时间：2026-11-03

## 当前步骤

- **所在分支**：`dev`
- **当前阶段**：已完成本地测试端高德地图配置回退与视口加载修复，全量通过配置单元测试（106 项单测通过）、设计校验与地图 E2E 验证；`AGENTS.md` 项目索引与 `STATE.md` 看板机制已落盘。

## 已做决定及理由

1. **本地环境与测试子目录多级配置文件回退机制**：
   - **问题**：本地真实测试配置存于根目录 `.local/amap-test.json`，而服务端默认配置路径仅查找当前工作目录下的 `.local/amap.json`。当在 `app/` 目录执行 `node server/index.mjs` 或运行 E2E 测试时，`process.cwd()` 为 `app/`，导致无法解析父目录 `.local/`，进而导致 `/api/config` 返回空的 `amapKey`，地图在页面报错「地图暂时无法加载」。
   - **决策**：在 `app/server/config.mjs` 中设置回退候选路径 `['.local/amap.json', '.local/amap-test.json', '../.local/amap.json', '../.local/amap-test.json']`。显式指定 `AMAP_CONFIG_FILE` 时依然保持严格校验（不存在则抛出错误），未显式指定时按序寻找首个存在的本地配置文件。并在本地创建 `.local/amap.json` 作为镜像。
   - **理由**：既不破坏生产部署使用 `AMAP_CONFIG_FILE` 显式路径的安全性与确定性，又能让本地开发、根目录与 `app/` 子目录下执行测试时实现开箱即用的地图密钥自动加载。
2. **在 `AGENTS.md` 中建立分层项目索引**：
   - **理由**：显式标注顶层共享、Web 前后端、原生双端和文档结构，消除跨会话和自动化智能体全仓扫描盲区。
3. **引入并持续维护根目录 `STATE.md`**：
   - **理由**：作为跨会话唯一进展快照，保证每次审查、修改与发布的决策和产出清晰可追溯。

## 产出物

- `app/server/config.mjs`：新增本地地图配置自动回退至 `amap-test.json` 及父目录 `../.local/` 的支持。
- `app/tests/config.test.mjs`：新增 2 项单测，验证 `amap-test.json` 回退与 `app/` 子目录下父目录解析的有效性。
- `app/dist/`：重新构建并固化前端生产产物，包含最新的地图控件边距与主题样式。
- `AGENTS.md`：新增项目索引（“什么东西在哪”）及 `STATE.md` 规范。
- `STATE.md`：更新当前状态、已做决定及验证记录。

## 验证结果

1. **配置单元测试**：`node --test tests/config.test.mjs` 7 项用例全部通过。
2. **后端全量单测**：`node --test tests/*.test.mjs` 106 项用例全部通过（耗时 1.7s）。
3. **静态设计与数据校验**：
   - `node ../scripts/generate-design-tokens.mjs --check`：通过（Design tokens match generated themes）。
   - `node ../scripts/check-design-contrast.mjs`：通过（72 palette contrast checks passed）。
   - `node ../scripts/generate-destination-timezones.mjs --check`：通过（Destination timezones match shared data）。
4. **前端构建**：`vite build && node scripts/finalize-build.mjs` 成功，离线应用壳资源校验无误。
5. **本地地图真实 E2E 验证**：
   - `map-selection.spec.mjs`（4 项通过，19.4s）：390px/320px 真实地图选点标记与浮层可见性均正常。
   - `map-camera-motion.spec.mjs`（7 项通过，58.2s）：390px/1440px 真实地图交互、手势平移、缩放与相机动效均正常。

## 风险

- **macOS 沙箱与浏览器 LaunchServices**：沙箱环境下 Chrome/WebKit 会触发 LaunchServices/WindowServer 权限拦截，运行浏览器 E2E 测试时需申请提权运行。
- **高德地图 Web JS API 密钥特性**：`.local/amap-test.json` 中的 Key 为 JS API 类型，直接调用 REST 接口会报错 10009（USERKEY_PLAT_NOMATCH），必须经由本地代理服务 `_AMapService` 注入 SDK 参数转发。

## 下一步

1. 将 `AGENTS.md`、`STATE.md`、`app/server/config.mjs`、`app/tests/config.test.mjs` 提交至 `dev` 分支并推送到 `origin/dev`。
2. 保持在 `dev` 分支，等待用户进行最终确认。
3. 取得明确确认后，通过 Pull Request 合并至 `main` 分支。
