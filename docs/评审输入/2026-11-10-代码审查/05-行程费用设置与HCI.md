# 05 行程、费用、设置与 HCI（dev `6685e41` vs `origin/main` `26edb6b`）

> 审查员：reviewer-itinerary｜日期：2026-11-10｜只读审查，未改任何源码/测试。
> 方法：`git diff origin/main...dev` + 范围内 16 个源文件、7 个 CSS、相关测试与实施记录全文通读；对照 `app/CONTRACT.md`、SRS（FR-01/05/06/07/09、NFR-02）、`docs/设计文档/02-交互与界面设计稿.md`、`docs/评审输入/2026-11-03-行程地图费用与旅程设置/`、`.../2026-11-03-行程卡片布局与细节/`。
> 动态验证：`node --test tests/reschedule-ui.test.mjs tests/expenses.test.mjs tests/activity-url.test.mjs tests/sync.test.mjs` → 33 通过 0 失败；`tests/board-widgets.test.mjs` → 9 通过。另用 `createApp()` 内存实例做 4 组 API 级验证（见 P2-3、需复核 2/3）与 `node` 直接调用纯函数（见 P2-4、P2-6、P3-1）。本机 npm CLI 不可用、浏览器 E2E 由 Lead 执行（见 README 二、五），390/1280 的视觉回归结论以 06 号验证记录为准，本篇只做静态布局评审。

## 一、范围与结论

- 覆盖：`Itinerary.jsx`、`ActivityEditor.jsx`、`ActivityPlaceField.jsx`、`Ledger.jsx`、`Settings.jsx`、`Login.jsx`、`Entry.jsx`、`DateRangePicker.jsx`、`feedback.js`、`reschedule.js`、`expenses.js`、`activity-url.js`、`sync.js`、`domain.js`、`App.jsx`、`ui.jsx`、`itinerary.css`、`editor-ledger.css`、`trip-settings.css`、`styles.css`（相关）、`date-range-picker.css` 与列出的单测/E2E。
- **本范围内未发现 P0/P1**。理由：链接协议的客户端校验在服务端有同规则兜底（`server/model.mjs:8` 仅允许空或 http(s)）；改期的 `moves`/`DAY_DELETED`/代数据由服务端事务兜底；登录/注册的字段级错误在服务端 422 `details` 分发链路完整。未发现可导致数据丢失、越权或 XSS 的代码路径。
- 共 **6 条 P2、7 条 P3、7 条需复核**。2026-11-03 两份建议的主要交互项已落实（第三节），剩余风险集中在：字段级错误关联只做了一部分表单；设置页本地状态与同伴更新冲突；已删除计划日与改期流程；费用日期文案与白板精度；平板宽度的排序入口；以及若干无障碍细节。
- 一并说明：**`feedback.js` 不是行内校验模块**（任务关注点 2 的前提有偏差）。它负责交互反馈音/振动、指针辉光与软键盘视口变量；表单校验在 `ui.jsx` 的 `Field` 与各编辑器中（`Field` 已实现 `aria-invalid`/`aria-describedby`/`role=alert`）。
- 输入保留机制（`context.drafts` + `editedFields` + legacy「上次未完成输入」）在 ActivityEditor/ExpenseEditor 中逻辑一致，切换卡片/关闭/刷新后草稿保留；未发现「校验失败清空已输入内容」的路径（`requestClose` 只保存通过校验的组，失败组留草稿）。网络失败与校验失败可通过 `errorMessage()` 的 `NETWORK/CLOCK_*/STALE_GENERATION` 映射与普通校验文案区分。

## 二、缺陷表

### P0（无）

### P1（无）

### P2

| 编号 | 文件:行 | 触发条件 / 复现 | 影响 | 依据 | 建议 |
| --- | --- | --- | --- | --- | --- |
| P2-1 | `ActivityEditor.jsx:290-296`（showIssue 只对 url 聚焦并挂字段错误）、`:623-627`（其余错误统一渲染在表单最底部）；名称/所在日 `:443-470`、时间 `:472-542`、到场与预留 `:571-592` 均无 `aria-invalid`/`aria-describedby`。同类：`Ledger.jsx:153-167` + `:486-490`（金额/币种校验只进底部通用 `role=alert`），金额输入 `:395-406` 无 aria-invalid | 新建活动 →「具体时间」不填开始时间 →「完成」；或「记一笔」已支付不填金额 →「完成」 | 错误文案与出错字段无程序关联（读屏/键盘只能靠猜），移动端错误在折叠内容下方可能不可见；顶部保存状态只写「部分输入待完善」，不指出哪个字段。11-10 实施记录声称「错误提示必须精确锚定在具体字段下方、高亮输入框、同步 aria-invalid」，实际只在登录/创建旅程/链接字段（`Login.jsx:368-422`、`Entry.jsx:184-215`、`ActivityEditor.jsx:611`）落实 | NFR-02「标签/错误关联」；FR-06「格式无法成立的时间需就地纠正」；11-10 实施记录 | title/dayId/time/buffers、金额/日期/币种改用 `<Field error>`（能力已在 `ui.jsx:119-154`）或在输入上补 aria 关联 + 错误 id；`complete()` 聚焦首个出错字段（当前仅 url 聚焦） |
| P2-2 | `Settings.jsx:343-344`（`useState(trip.name/destination)` 只初始化一次）、`:388-400`（onBlur 用当前渲染的 `trip` 比较后 patch）、`:363-372`（patch） | A 打开旅程设置（名称 X）→ B 在另一设备改名为 Y（SSE 已更新 `j.snapshot.trip.name`，输入框仍显示 X）→ A 点入名称框再点出**不做任何输入** → 处理函数里 `value(X) !== trip.name(Y)` 成立 → 发出 `patch('name','X')`，本地时钟更新 → 覆盖 B 的修改。目的地同理。另：目的地可被清空保存 —— 实测 `PATCH` 空串返回 200 并落库（`server/model.mjs:139` 的 `destination:text.optional()` 允许空，创建时 `:86` 却要求非空），客户端无校验 | 无意图写入覆盖同伴修改；共享旅程出现空目的地 | FR-09「同字段竞争按操作发生时间取较新」；02 设计稿「后台更新不抢输入」 | 未 dirty 时显示值直接用 `trip.name/trip.destination`（或用 dirty 标记），失焦时若值未编辑则直接 return；目的地与服务端同样只接受 trim 后非空；错误改用 Field 关联（见 P2-1） |
| P2-3 | 客户端 `reschedule.js:9-16`（只遍历 active 的 day，检测不到已删除计划日）、`Itinerary.jsx:444-460`（finish）、`:618-662`（SwapDays）；服务端 `server/model.mjs:204`（`ensureUsable`→`DAY_DELETED`）、`:206-207`（对 1..dayCount 每个日期 `getDay`） | 当天菜单「删除这一天」删掉范围内任意一天 → 打开「调整日期与天数」→ 不改任何值点「完成」→ **409 DAY_DELETED「此计划日已删除，请先恢复」**（已用内存服务实例实测：reschedule unchanged 与 extend 均 409）；两步选择/逐项勾选全部作废，须关弹窗→恢复该日→重来；「与另一天交换」同样失败 | 改期主流程被挡住，且弹窗内没有「哪一天被删/就地恢复」的入口；用户容易以为功能坏了 | CONTRACT.md:61「命中已删除日期返回 DAY_DELETED，须先恢复」（协议如此，缺的是客户端预检）；FR-01「修改日期范围或计划天数须保留已有活动，取消修改仍可回到原安排」 | 第一步渲染前扫描范围内 `state==='deleted'` 的计划日，直接提示具体日期并提供内联「恢复这一天」；或禁用完成按钮并说明原因 |
| P2-4 | `expenses.js:44-47`（找不到可见计划日时按 `date < startDate` 判为行前/行后） | 9 天旅程 10/30–11/07，已有一笔 `date=2026-11-04` 的已付费用（原分组「第 6 天 · 11/04 周三」）→ 删除 11/04 这一天 → 分组标题变成 **「行后支付 · 11/04周三」**（`node` 实测 `expenseDateLabel` 返回值） | 仍在旅程范围内的日期被标成行后支付，日期语义错误（金额与数据不受影响） | 11-03 建议三「分组标题改为『第 6 天 · 11/04 周三』…不在旅程日期内的放在行前/行后支付组」 | 先判断 `startDate ≤ date < startDate+dayCount`：范围内即使无可见 day 也用日期差推算「第 N 天」；范围外才加行前/行后。与 06 报告 B3 的口径讨论一并处理（建议两端都改成该规则） |
| P2-5 | `itinerary.css:379-381`（手柄基础 `display:none`）、`:435-445`（仅 `(width>760px) and (hover:hover) and (pointer:fine)` 显示）、`:446-448/463-465`（「调整顺序」入口仅 ≤760px）；键盘手柄见 `Itinerary.jsx:1134-1149` | iPad 横屏等 761–1279px 且 `hover:none` 的设备：既没有拖拽手柄，也没有手机端「调整顺序」模式；手柄 `display:none` 时不可聚焦，无指针设备的纯键盘用户同样没有 ↑↓ 排序入口 | 该设备类完全无法调整同一天内的顺序（FR-05 核心编辑能力之一） | FR-05「拖拽须有按钮、日期选择或键盘等价操作」；NFR-02「键盘及非拖拽操作等价」；11-03 卡片布局第三节要求手柄只在 hover/fine 下显示——按字面实现与该两条需求冲突 | 对 `pointer:coarse` 或缺 hover 的宽度区间常显手柄，或把「调整顺序」入口的媒体条件放宽到 `(hover:none)`；补 1024/1180 + `hasTouch` 的 E2E |
| P2-6 | `domain.js:186-192`（`money()` 仅特判 JPY，其余一律 `/100`）；使用处 `board-widgets.js:525/535/538/540`；费用页/行程卡用 `ui.jsx:238-249`（按 Intl 位数，正确） | 旅程记账币种选 KRW → 记一笔 ₩12,000 已支付 → 白板贴「费用」小组件：`formattedTotal = ₩120`（`node` 实测），费用页为 `₩12,000`。JPY 因特判恰好正确，其余 2 位小数币种正确，只有 0 位小数币种（当前可选 KRW）错 | 同一笔记账在费用页与白板相差 100 倍，且会被截图/分享 | FR-07 金额一致性；NFR-05 跨端一致；`ui.jsx:238-249` 为正确实现 | 删除 `domain.money`，统一改用 `ui.money`（或抽共享模块）；单测覆盖 JPY/KRW/CNY。注：文件在 01 报告范围，请合并去重 |

### P3

| 编号 | 文件:行 | 问题 | 建议 |
| --- | --- | --- | --- |
| P3-1 | `domain.js:141-146`；显示点 `ActivityEditor.jsx:462-467` | 行程外且日期早于新开始日的计划日会算出负序号：11-03 流程选「留在原来的日期」把开始日推后后，所在日下拉显示「第-1天 11/01 · 行程外」（`node` 实测 `dayLabel` 返回「第-1天」）；白板日期/活动小组件同样 | 非范围内日期不显示「第N天」，改为「行程外 · 11/01」 |
| P3-2 | `Entry.jsx:184-215` | CreateTrip 表单保留原生 `required` 且无 `noValidate`：日期为空时提交触发浏览器原生气泡（文案随浏览器语言、样式不可控），与 Login（`Login.jsx:367` noValidate + 字段级行内错误）不一致；11-10 记录所说的「统一 noValidate」只落到登录 | 补 `noValidate` 与出发/结束日期的字段级错误（含「结束日期不能早于出发日期」） |
| P3-3 | `ui.jsx:211-213`、`Login.jsx:309-313` | 用户界面文案暴露内部信息：`window.location.origin` 与服务端环境变量名 `APP_ORIGIN`。普通用户无法执行「配置环境变量」，只应被告知联系管理员 | 用户文案保留「请使用标准网址访问或联系管理员」，`APP_ORIGIN` 写进部署文档。注：11-10 记录为有意添加，需复核取舍 |
| P3-4 | `editor-ledger.css:303-311` | 新增 `.editor-modal select` 用 `appearance:none` + 内联 SVG `#7f999e` 作箭头：颜色硬编码、不走 design token，`scripts/check-design-contrast.mjs` 覆盖不到；强制色彩/高对比模式下背景图不可见且原生箭头已被移除 | 改用 token 色（如 `--muted`）；或在 `forced-colors` 媒体查询里恢复原生外观 |
| P3-5 | `App.jsx:371-390`、`Ledger.jsx:505` | 从账本点「关联活动」跳到行程后返回费用页：Ledger 按 key 重挂，`dateFilter` 是局部 state → 日期筛选回到「全部」（滚动位置由 App 的 scroll context 恢复）。02 设计稿要求「从账目进入关联活动后，返回保持账本浏览位置」未完全落实 | 把 `dateFilter`（及从活动进入时的 `expenseActivityId`）放进 `j.context` |
| P3-6 | `Itinerary.jsx:430`、`:607-613` | 天数非法时只把「下一步/完成」置灰，没有任何说明；`:446` 的「天数应为 1 至 365」因按钮禁用永远执行不到。同类：`Ledger.jsx:661-678` 在日期筛选下仍写「已支付合计」，实际是筛选后子集 | 禁用时把原因写在按钮旁/输入下方；合计标题随筛选改为「当日已支付」等 |
| P3-7 | `Itinerary.jsx:1032`、`itinerary.css:89`/`:392`；`:1038-1050` | 侧栏编辑的选中卡片（`activity-selected`）与跳转高亮（`activity-focused`）只靠背景/描边颜色表达，无 `aria-current`/文本；具体时间锁的说明只在 `title` 里（触屏、读屏拿不到） | 加 `aria-current`/隐藏说明文本；锁图标补可访问名称。依据 NFR-02「重要状态不只靠颜色」、02 设计稿「选中状态具有语义表达」 |

## 三、需求一致性

**已落实（对照 2026-11-03 两份建议）**

- 一、排序：桌面去掉「排序/完成排序」开关；手柄移到卡片右侧「···」左边、hover/focus 才显示、不再遮序号（`itinerary.css:435-445`）；具体时间活动无手柄并加锁；手机「调整顺序」进当天「…」菜单、顶部说明条 +「完成」、进行中隐藏路程/意见（`Itinerary.jsx:1201-1208`、`itinerary.css:463-514`）。
- 卡片布局：四列网格（序号/时间/内容/操作）、标题左对齐、同名地点不重复（`Itinerary.jsx:971/1063-1078`）、菜单文案「与另一天交换」「调整日期与天数」「删除这一天」。侧栏：≥1280 右侧面板 400–440px、非模态、列表不遮挡、切换卡片直接换内容、Esc 关闭且焦点回原卡片（`App.jsx:159-161/406-417`、`ui.jsx:29-69` 的 `nonModal/returnFocus`）。
- 五、调整日期：两步流程（日历选范围 + 起止/天数 + 原范围与整体位移说明；无影响时直接「完成」；第二步 跟着移动/留在原日期/逐项选择 + 2–3 条预览）；「交换两天」移到当天菜单；取消（Esc/返回选日期）不写入。
- 三、费用：`date=null` 且活动有效 → 显示与分组按活动所在日、活动移动自动跟随（`expenses.js`、`Ledger.jsx:513-543/621-633`，E2E `expense-completion.spec.mjs` 新增用例覆盖）；显式日期不跟随；关联活动写成可点标签，跳到行程页对应日滚动并高亮 1 秒，不打开编辑框（`App.jsx:374-379`、`Itinerary.jsx:692-710`）；未命名时用活动名兜底；「未记录日期」「关联活动已删除」；编辑器中「已按活动所在日填写 / 改为付款当天（…）」与「跟随活动日期」。
- 四、旅程设置：基本信息/日程/成员与权限/整理分组与行样式；「仅你一人」修复；时区改为可搜索列表（目的地/本机/全部优先）；退出/删除独立红色分组。链接：裸域名自动补 `https://`、拒绝非 http(s)（含 `javascript:`）、错误在字段正下方并聚焦（`activity-url.js`、`ActivityEditor.jsx:611`、E2E `itinerary-review.spec.mjs`）。
- 账号：`Login.jsx` 字段级校验 + 服务端 422 `details` 按 `path[0]` 分发到字段 + 聚焦首个出错项 + 切换模式重置 touched/serverErrors；`errorMessage` 区分 `NETWORK/CLOCK_*/STALE_GENERATION/ORIGIN_REJECTED/CSRF_REJECTED/RATE_LIMITED`。

**未完全落实**

- 字段级错误关联只覆盖链接/登录/创建旅程（P2-1）；设置页本地状态与同伴更新（P2-2）；已删除计划日与改期（P2-3）；账单日期文案（P2-4）；平板排序入口（P2-5）。
- `sync.js`/`domain.js` 本次 diff 未触碰字段时钟、离线队列与乐观回滚的核心逻辑（仅新增二进制 body、`boardItem` 跳过乐观投影、markPreset 级联、presence/change 监听）；本次运行的四个测试文件共 33 项（含 sync 的恢复/失序/幂等/租约用例）全通过，**未发现被破坏**。
- 文档一致性（提示，属 02/06 范围）：`CONTRACT.md:27` 的 expense payload 定义没有 `date` 字段，而 `:69` 又定义了 `date=null` 的日期规则，建议补全。

## 四、测试缺口

1. 改期：无「范围内有已删除计划日 → DAY_DELETED → 恢复后重试」的用例（P2-3，已可 API 复现）；「留在原来的日期」只有 `reschedule-ui.test.mjs` 断言 `moves` 为空，未验证落盘后旧日进入「行程外」及跨月/跨时区；未覆盖「清空开始日期」路径。
2. 费用：`expenses.test.mjs` 覆盖 date=null、删除活动、标题、日期标签；无 E2E 覆盖「关联活动已删除 → 未记录日期 + 关联活动已删除」；无币种精度（KRW/JPY）用例；「改为付款当天 / 跟随活动日期」两个按钮无用例；`domain.money` 与 `ui.money` 不一致无测试（P2-6）。
3. 行内校验：`activity-completion.spec.mjs` 只断言底部 `role=alert` 文案，未断言 `aria-invalid`/`describedby`/焦点；Ledger 金额同理 → P2-1 长期漏检。登录已有 aria-invalid 断言（`login.spec.mjs` 新增）。
4. 设置：`reschedule-settings.spec.mjs` 覆盖分组/时区搜索/「仅你一人」，无名称/目的地空值、同伴改名后失焦是否回写的用例（P2-2）。
5. 排序：`itinerary-order.spec.mjs` 覆盖指针拖拽/取消/键盘/重载，`itinerary-review.spec.mjs` 覆盖 1440/1280/1100/390 卡片与侧栏；无 761–1279 + `hasTouch`/`hover:none` 的排序入口用例（P2-5）。
6. 白板联动：`board-widgets.test.mjs` 未断言 `countdown.startDateLabel`、`expense.perDay/top[].dayText/formattedTotal`，也未断言 0 位小数币种（P2-6、需复核 1）。
7. `tests/e2e/navigation.spec.mjs` 本次未改动（任务清单列出但 diff 为空）。

## 五、需复核项

1. **白板倒计时/费用小组件取错 `visibleDays()` 层级（可能属 01 报告范围）**：`board-widgets.js:364/413-430` 用 `firstDay?.date`，`:496-537` 用 `d.date`/`days[0]?.date`/`d.ordinal`，而 `visibleDays()` 返回 `{payload:{date,ordinal}}`（`node` 实测 `d.date` 为 `undefined`）。结果：倒计时小组件始终「未定日期」、`startWd/endMd` 为空；费用小组件 `perDay` 全 0、`top[].dayText` 永远「未记日期」。同文件 day/activity/route 小组件用 `day?.payload?.date`（正确），疑为笔误。建议统一 `d.payload.*` 并补断言。
2. **计划日 `payload.ordinal` 在改期复用时不刷新**：`server/model.mjs:206-207` 的 `getDay` 命中同日期的旧 day 时只复用、不回写 ordinal。API 实测：10/30 起 3 天 → 保留安排改到 11/01 起 3 天后，可见日为 11/01=ordinal 3、11/02=ordinal 2、11/03=ordinal 3（重复且非单调）。客户端 `Itinerary.jsx:1448-1451` 的「从前一天延续」正是比较 stored ordinal → 跨夜活动（`endDayOffset>0`）在该场景会漏显示；`BoardStickerPanel.jsx:159/174` 的「第 N 天概览/路线」也会标错。属 origin/main 已有行为（本次未改服务端 reschedule），但新两步流程让「部分重叠改期」更常见。建议改期事务内按日期重算 reused day 的 ordinal，或客户端改为按日期推导。
3. **开发来源白名单与 50× 限流放宽的判定依据（可能属 02/06 报告范围）**：`server/index.mjs:52-60` 用「appOrigin 是否回环/内网」推断开发环境，`isAllowedOrigin` 在 appOrigin 为内网时放行同 Host 的任意 Origin。若生产漏配 `APP_ORIGIN`（默认 `http://127.0.0.1:4177`），站点不会报错（Origin host==Host 被放行），却静默进入开发判定：注册/登录/验证码 IP 限流放宽 50 倍、来源校验退化为同 Host。建议用显式 NODE_ENV/部署标志，缺省 APP_ORIGIN 时健康检查告警。
4. **「日期未定 ↔ 有日期」转换的第二步文案**：清空开始日期后（`Itinerary.jsx:430/508`），moving 选项因 `shift===0` 显示「移到最后一天」，实际却是把活动改挂到无日期计划日（`reschedule.js:30-38` 的 `date` 为 null），预览行也只显示「第N天」。建议按 `startDate` 是否为空单独命名，或在第一步限制清空。
5. **pointer glow 每帧全量扫描（性能/兼容）**：`feedback.js:117-143` 每次 pointermove 的 rAF 内对当前 dialog 或 document 执行 `querySelectorAll(SURFACES)` + 每元素 `getBoundingClientRect`/`checkVisibility`；长日程/白板元素多时成本线性增长，`checkVisibility({visibilityProperty:true})` 在旧 Safari 会抛错（无 try/catch），且高亮清理依赖下一次 pointermove（停止移动时可能残留）。需实测帧时间后决定是否节流。
6. **`Itinerary.jsx:721-785` 日切换过渡的 `useLayoutEffect` 无依赖数组**：每次渲染都 `cloneNode(true)` 整天 DOM 并量一次高度；侧栏编辑时每次按键都会执行（当前列表规模下开销小，长列表需实测）。
7. **`reschedule` 的 `moves` 只改 `dayId` 不重排 `order`**：缩短天数把多日活动并入最后一天时，与原有活动 order 冲突，日内先后由 `domain.js:5` 的 `id.localeCompare` 决定（稳定但语义随机）。需求未规定，需产品确认是否接受。
