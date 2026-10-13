# GitHub 自动部署

仓库：<https://github.com/mcjiansheng/journey>。工作流：`.github/workflows/deploy.yml`，名称为 **Test and deploy Journey**。生产站点：<https://journey.jscloud.wang>。

## 触发和检查

每次 push 或合并到 main，GitHub 托管的 Ubuntu runner 使用 Node.js 22.22.1 执行部署引擎 Python 测试、`npm ci`、`npm test`，随后调用 `app/ops/package-release.mjs` 构建并打包。任一步失败都不会开始部署。Actions 页的 Run workflow 可重跑 main。

发布 ID 为 `提交SHA-运行ID-重跑次数`，对应唯一发布目录，重复上传同一个 ID 会被拒绝。发布包包含生产依赖、前端、服务端、来源提交和文件 SHA-256 清单；测试产物在 Actions 中保留七天。

工作流采用 `journey-production` 并发组，`cancel-in-progress: false`，已有部署执行完后再运行等待任务。GitHub 会合并等待中的重复触发；上传前核对 main 仍指向该次测试的提交，过期提交跳过部署。

仓库变量 `JOURNEY_DEPLOY_ENABLED=true` 启用生产发布；设为 `false` 时继续执行测试和打包，跳过服务器部署。首次启用前，确认当前线上修改已提交并推送到 main。

## 生产连接和权限

GitHub `production` 环境仅允许 main 分支部署，无人工审批或等待时间。环境变量为 `DEPLOY_HOST`、`DEPLOY_PORT`、`DEPLOY_USER`；环境 Secrets 为 `DEPLOY_SSH_KEY`、`DEPLOY_KNOWN_HOSTS`。主机公钥通过已有管理员 SSH 连接取得，客户端启用严格主机公钥校验。

服务器账号为 `journey-deploy`，authorized_keys 由 root 管理，并使用 `restrict` 和固定命令 `/usr/local/libexec/journey/deploy-ssh.sh`。这个密钥仅接受以下协议：

```text
deploy RELEASE_ID ARCHIVE_SHA256 COMMIT_SHA
status RELEASE_ID
```

deploy 的标准输入为发布包；status 输出 JSON。sudo 仅授权固定部署程序的 receive 和 status 子命令。账号不能执行通用 shell、端口转发或任意 systemctl 命令。

部署程序、SSH 包装脚本和备份脚本固定安装在 `/usr/local/libexec/journey/`，所有者为 root。日常应用发布不会更新这些管理员脚本。更新部署基础设施时，由管理员审核并重新运行 `app/ops/install-deployment.sh <部署公钥文件>`。该命令只重载 systemd 单元定义；不重启游戏、控制器或 nginx。

首次重建时，先按《运行维护》安装 Journey，再将上述 ops 文件和部署公钥放到管理员控制的目录，以 root 执行安装脚本。私钥通过标准输入写入 GitHub Secret，不放入仓库、发布包或日志。

## 发布事务和恢复

部署接收器限制压缩包为 100 MiB，并校验归档 SHA-256。独立 systemd 单元执行解压和切换，CPUQuota 为 20%、MemoryMax 为 256 MiB、Nice 为 19、IOWeight 为 1。归档展开上限为 400 MiB、条目数上限为 30,000；拒绝越界路径、特殊文件、硬链接及越界符号链接。发布清单与实际文件、来源提交必须一致。

GitHub 到服务器的上传最多等待 15 分钟，客户端 SSH 最多等待 16 分钟，部署 job 总上限为 50 分钟。实测较慢链路会超过原先的三分钟上传时限；上传超时在版本切换前失败，线上版本继续运行。

上传和解压前要求剩余空间足以容纳最大归档、展开文件并额外保留 1 GiB；不足时停止本次发布，现有服务继续运行。服务器保留历史发布目录，管理员可在确认当前版本和回滚目标后清理更早版本。

服务器锁串行保护版本切换。部署状态保存在 root 专属的 `/var/lib/journey-deploy/state/<发布ID>.json`。SSH 断开后，服务器上的事务继续执行，客户端重新读取状态。

切换前完成加密备份，记录旧版本及前端 build ID；随后停止 Journey、原子切换 `/opt/journey/current`、启动 Journey。健康检查同时验证回环和公网 HTTPS 的 `/api/health` 与 `/build.json`。新版本检查失败时自动切回旧发布目录，启动并检查旧版本；Actions 将本次部署标记为失败。

协调进程收到终止信号时执行回滚；被强制终止或达到资源限额时，systemd 的 ExecStopPost 负责恢复。新部署在取得锁后先处理尚未完成的旧事务，避免选择故障版本作为回滚目标。

自动回滚只切换代码，保留现有业务库和权限账本。数据库结构变更必须兼容前一版代码；需要恢复业务数据时，使用《运行维护》的加密恢复流程，并保留最新权限账本。

部署前后读取 `l4d2.service`、`l4d2-control.service`、`l4d2-crash-recorder.service` 和 `nginx.service` 的 PID、启动时刻、重启次数及活动状态。部署程序仅能启动/停止 `journey.service`，以及启动 `journey-backup.service`；受保护服务状态发生变化会使部署失败并回退 Journey。

## 查看结果

在 [Actions](https://github.com/mcjiansheng/journey/actions/workflows/deploy.yml) 查看测试和部署日志。部署终态为 `success`、`failed`、`rolled_back` 或 `rollback_failed`；后面三个状态都会令工作流失败。服务器可用管理员账号查看：

```sh
sudo /usr/local/libexec/journey/deploy-release.py status RELEASE_ID
sudo journalctl -u journey-deploy-RELEASE_ID --no-pager
sudo systemctl status journey.service --no-pager
```

若状态为 `rollback_failed`，JSON 会保留原始失败原因和恢复失败原因。保留发布目录及状态文件，根据记录的 previousRelease 修复 Journey；代码回退不覆盖数据库。

## 验收记录

2026-10-13 已完成服务器安装及故障恢复演练：

- 本地运维测试 30/30 通过，已提交应用快照测试 32/32 通过，构建通过。独立审查发现的中断恢复并发与信号问题已修复并加入回归测试。
- 通过专用部署密钥上传 `rollback-drill-20261013-01`，包内入口主动抛出异常。服务器完成备份、切换，健康检查失败后自动恢复 `2026-10-13-01`，终态为 `rolled_back`，客户端退出码为 1。
- 旧版回环与公网健康检查通过，前端 build ID 恢复为 `f1d5c78ff285e30d`，保留当时线上备案修改。整个事务约 88 秒，协调单元 CPU 用时 1.666 秒，峰值内存 111 MiB。
- 游戏 PID `2503473`、控制器 PID `2427712`，部署前后均相同，重启次数均为 0。崩溃记录器和 nginx 的进程、启动时刻、重启次数也相同；既有 nginx 站点和 L4D2 单元文件校验值相同。
- 固定备份脚本运行成功；部署密钥尝试普通 `id` 命令被拒绝，部署账号的 sudo 授权仅包含接收发布包和读取状态。

2026-10-13，现有功能及备案修改全部进入远端 main 后，已设置 `JOURNEY_DEPLOY_ENABLED=true`。后续 main 更新通过测试后自动部署。

- 首次完整 GitHub 发布：[运行 38343123774](https://github.com/mcjiansheng/journey/actions/runs/38343123774)，由 main 推送触发，`test-and-package` 和 `deploy` 均成功。
- 已发布提交 `0ff13b8c0e8611f0dfa0de6d61619a410712e240`，发布目录 `0ff13b8c0e8611f0dfa0de6d61619a410712e240-38343123774-1`，前端 build ID `d48542785b679ff4`。
- 服务器发布清单的提交号与 GitHub 一致；回环和公网 HTTPS 的健康检查及前端构建编号一致。
- 发布前后游戏、控制器、崩溃记录器和 nginx 的 PID、启动时间、重启次数完全一致，既有 nginx 站点及 L4D2 systemd 单元校验值相同。
