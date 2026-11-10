<!-- 快照，不是日志：整体重写，不追加；已完成的内容移到 docs/实施记录/。规则见 AGENTS.md「状态维护」。 -->
# 项目状态

更新时间：2026-11-11

## 当前步骤

- 2026-11-10 代码审查（dev vs origin/main）的 P0/P1 与 dev E2E 阻塞项已修复：白板 epoch 全量重读、generation 漂移、加入行程 422、KRW 金额、visibleDays 层级、presence 限流/资源上限、素材备份、ASSETS_PATH 与 nginx、手机底部导航 5 列、过期 E2E 断言。
- 验证：单测 149、服务端 45、备份 8、构建成功；Token/时区/对比度/格式通过；E2E 定向套件 90 通过 + 白板 6 通过（等价 `node` 命令；本机 npm CLI 故障见实施记录）。
- 变更在 `dev`，已提交并推送 `origin/dev`，等待用户确认后以 PR 合并 `main`。

## 已做决定及理由

- 默认开发分支 `dev`；`main` 等用户明确确认后通过 PR 合并（推送 `main` 即部署生产）。
- 白板同步：`epoch` 与本地缓存不一致时必须丢弃 `since` 全量重读；客户端不本地自增 generation（服务端只在 delete/restore 递增）。
- presence 不占全局 IP 限流桶，独立限频并受 live/条目/SSE 连接上限约束；素材目录用 `ASSETS_PATH`，备份含 `assets.enc`。
- 手机底部导航固定 5 列（新增「白板」后不可换行，否则遮住「添加活动」浮动按钮）。

## 产出物

- 审查与专项报告：[docs/评审输入/2026-11-10-代码审查/](docs/评审输入/2026-11-10-代码审查/)
- 本次修复记录：[docs/实施记录/2026-11-11-审查问题修复.md](docs/实施记录/2026-11-11-审查问题修复.md)

## 风险

- 生产部署需在 `/etc/journey/journey.env` 写入 `ASSETS_PATH`、reload nginx，并迁移旧 `data/assets` 素材；否则白板图片/GIF 上传失败或旧图丢失。
- 审查报告中的 P2/P3 未修（详见报告 §四/§五）。
- CI 仍不运行 Playwright E2E；真实 AMap 类 E2E 在本机环境不稳定，需干净环境复跑。
- 本机 npm CLI 故障，`npm run check` 未能按原命令执行，已用等价 `node` 命令替代。

## 下一步

- 用户确认后创建 `dev → main` PR，CI 通过后合并发布。
- 分批修复 P2/P3，并评估把核心 E2E 接入 CI。
