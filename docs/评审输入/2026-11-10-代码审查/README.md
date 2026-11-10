# dev 相比 main 的完整代码审查（2026-11-10）

> 审查基线：`origin/main`（`26edb6b`，2026-11-02，Merge PR #10）→ `dev`（`6685e41`，2026-11-10）。
> 本地 `main` 分支为 `d1ded59`（2026-10-27），`git branch -vv` 显示 `[origin/main: behind 25]`，不能作为基线；本目录所有对比均使用远端 `origin/main`。
> 范围：18 个提交、133 个文件、+15613 / -1082 行（含新增测试、设计文档与实施记录）。已发布到 `origin/main` 的历史内容不在逐行审查范围内，但涉及被本次改动修改的文件会回看原实现。

## 一、审查对象与方法

1. **需求与契约对照**：`docs/设计文档/10-白板.md`、`app/CONTRACT.md`、`docs/评审输入/2026-11-03-行程地图费用与旅程设置/`（本轮待处理建议）、`docs/设计文档/00`–`03` 中相关条款。
2. **改动审查**：`git log --oneline origin/main..dev` 的 18 个提交；每个文件同时阅读 diff 与完整文件，避免只看上下文片段。
3. **动态验证**：`app/` 单元测试、构建、Token/时区/对比度/格式检查；Playwright E2E（board 及各改动相关 spec）。
4. **独立复核**：不采信实施记录中「已审查/已通过」的结论，以代码与运行结果为准。

## 二、已知环境限制（影响验证方式，不影响审查结论）

- 本机 `npm` CLI（11.13.0）在 Node 24.16.0 下无法执行 `npm run`（在 `npm run` 派发前即退出 1，且与 `~/.npm` 沙箱写入有关）；因此所有 npm script 等价命令直接用 `node` 执行并在验证记录中注明。CI 使用 Node 22.22.1，行为可能不同。
- 本机无 Android SDK、无完整 Xcode（仅 Command Line Tools），移动端只能做静态审查 + 检查已提交的测试/构建配置，无法复跑 Gradle/Xcode 构建。
- 浏览器 E2E 在 DSH 沙箱下可能被阻挡，若无法启动会如实记录，不以静态推断代替。

## 三、严重等级定义

| 等级 | 定义 | 处理要求 |
| --- | --- | --- |
| P0 | 数据丢失/损坏、鉴权绕过、远程代码执行、生产不可用 | 合并 main 前必须修复 |
| P1 | 主要路径可复现的功能错误、跨端数据不一致、安全风险（越权读取/注入/XSS 等）、明显性能退化 | 合并 main 前修复或有明确接受理由 |
| P2 | 边缘场景缺陷、错误处理/提示不当、可访问性、测试缺口、可维护性问题 | 下一迭代修复 |
| P3 | 风格、命名、注释、文档小问题 | 随手修 |

每条发现必须包含：编号、等级、文件:行、问题描述（触发条件）、依据（需求/契约/代码）、建议。无法确认的写「需复核」并说明疑点，不得臆断。

## 四、分工与产出

| 编号 | 报告 | 负责范围 |
| --- | --- | --- |
| 01 | 白板客户端画布与交互 | `Board.jsx`、`BoardItem.jsx`、贴纸/工具条/操作/最近删除、`board.js`、`board-sync.js`（客户端）、`board.css`、tokens |
| 02 | 白板小组件与收藏标记 | `board-widgets.js`、`components/widgets/*`、`FavoriteMarkEditor`、`MarkPicker`、`FavoritePlacePicker`、`DateRangePicker`、`marks.js`、`palette-meta.js`、相关 CSS/单测 |
| 03 | 服务端白板与协议 | `app/server/index.mjs`、`model.mjs`、`db.mjs` 中白板/素材/presence/SSE 相关改动，`CONTRACT.md`，`board-server.test.mjs` |
| 04 | 地图、地点与收藏 | `MapView.jsx`、`amap.js`、`map-*.js/css`、`Favorite*`、`MarkPicker`、`marks.js`、`map-clusters.js`、地理编码与搜索 E2E |
| 05 | 行程、费用、设置与 HCI | `Itinerary.jsx`、`ActivityEditor.jsx`、`ActivityPlaceField.jsx`、`Ledger.jsx`、`Settings.jsx`、`Login.jsx`、`Entry.jsx`、`DateRangePicker.jsx`、`reschedule.js`、`expenses.js`、`activity-url.js`、`feedback.js`、`sync.js`/`domain.js` 改动、相关 CSS/单测/E2E |
| 06 | 原生端与跨端一致性 | `mobile/` 全部改动、`design/tokens.json`、`scripts/` 生成脚本、`shared/`，与 Web 行为对照 |
| 07 | 质量门禁、测试与发布 | CI、`app/package.json`、`app/server/config.mjs`、`vite.config.js`、全部单测改动、E2E 改动、`app/ops`、AGENTS/STATE/文档一致性（并入最终报告第五、六节） |
| 08 | 验证记录 | Lead 执行的单元测试、构建、Token/对比度/格式、E2E 与动态复现记录（`08-验证记录.md`） |
| 最终 | `代码审查报告-2026-11-10.md` | 合并去重、P0–P3 定级、需求冲突裁定与发布建议 |

## 五、当前已完成的基线与验证（2026-11-10 23:2x）

- `prettier --check "src/**/*.{js,jsx,css}"`：通过（全部符合）。
- `node ../scripts/generate-design-tokens.mjs --check`：通过。
- `node ../scripts/generate-destination-timezones.mjs --check`：通过。
- `node ../scripts/check-design-contrast.mjs`：通过（90 项配色对比度）。
- `node --test tests/*.test.mjs`：143 项通过，0 失败。
- `vite build` + `finalize-build.mjs`：通过（`✓ built in 915ms`，离线壳 10 个资产）。
- `npm run check` / `npm run format:check` 因上述 npm CLI 环境问题无法按原命令执行，等价命令均已单独执行通过。
- E2E：白板 `board.spec.mjs` 4/4 通过；变更相关定向套件 92 通过 / 13 失败（含 2 条 dev 测试期望过期；地图类失败经 `origin/main` 对照为既有环境问题），完整结果与基线对照见 [08-验证记录.md](08-验证记录.md)。

## 六、结论维护方式

本目录各报告为各审查员独立结论；最终合并、去重与发布建议写在 `代码审查报告-2026-11-10.md`。发现之间如有冲突，以代码证据和可复现步骤为准。
