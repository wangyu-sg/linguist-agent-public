# 2026-09-05 优化实施记录

本轮依据用户提供的新实施方案，逐批本地提交。起点为 `8fe9fe2e938698443bf07fea1bc04360094e19f7`，工作树干净；开发真源为本仓库。固定 Proma `v0.19.26@bbf577a8eb768225fdf1ac49ab9ef07a11413b24`，Pi 锁定 `0.84.4`，Bun `1.3.14`，App `0.17.70`，CAT schema `19`，实际工具数 `32`。本轮不移动上游基线。

## A / B1：自含多模态与历史恢复

- 真实失败：合法 GIF 经原 CAT projection 后，Pi 模型消息中的图片数为 0；移除投影后为 1。原投影通过 details 重建纯文本，根因得到生产转换链验证。
- 修改：`tool-runtime.ts` 输出自含正文；删除 `cat-tool-result-projection.ts` 及 adapter 的 CAT import/请求覆盖。既有 host extension 经 orchestrator 向 adapter 提供可选 `prepareSessionFile`，在 SDK 打开旧会话之前执行集中迁移。
- 存量保护：只处理正在恢复的会话中已知旧摘要；Pi SDK 解析记录；补回记录中已有 details 正文并保留图片和树 ID。首次写入前保留 `.before-cat-content-v1` 原件，原子替换，重复恢复不重写。缺失的历史图片无法重建，应重新读取受管资料。
- Touchpoint：删除 CAT request projection 跨层调用；已有 adapter/orchestrator 接入增加一次恢复前通知，登记原因同步。文件级账本数量未变。
- 验证：生产 sanitizer + SDK `convertToLlm` 的文本、混合图片、非法图片、非 CAT 内容；真实 `SessionManager.open`、压缩保留、分支与重复恢复。`test:evidence-workflow-v1` 3/3、`test:tools-critical` 44/44、全仓 typecheck、boundaries 4/4、fusion architecture 14/14、host seams 9/9 通过。Tools 废弃摘要断言改为自含 JSON，保留字节预算和隐私断言。
- 限制：B1 不改变旧工具执行时 Receipt 语义；该错误留给 B2，现有三岗位用例通过不能证明 Provider 收到资料。真实 Provider 与最终候选包尚未验收。

## B2：最终请求与回执

- 真实失败：原工具返回后、尚无下一次请求时已有 1 条 Receipt；生产回归先得到 `1 !== 0`，修复后为 0。
- 修改：Tools 只通知受信准备描述及实际 content；Linguist observer 核对最终 payload 的正文/视觉内容，再以 SDK `onResponse` 的 2xx HTTP 响应确认。adapter 只包装既有 SDK 回调并保留其他 extension 的修改，orchestrator 只传递 observer。
- 旧记录：既有 `evidence_json` 增加 `submission=provider-response-v1`、资料版本和视觉标记；无标记的旧工具级回执保留但不计新覆盖。未增加表或迁移 Schema。
- Touchpoint：已有 adapter/orchestrator 两个文件增加一个可选通用观察接入；未重新引入 CAT import、Provider 客户端、请求代理或全局 patch。计数未变。
- 验证：真实 CatStore → CAT tool → Pi Agent → SDK OpenAI Completions 序列化 → 127.0.0.1 合成 SSE Provider → 2xx 回调 → Receipt → 三岗位确认。实际 HTTP 包含正文和合法 GIF；非视觉模型与 sanitizer 删除的图片不签收；空 payload/503 不签收；记账故障不使模型调用失败，后续只重试记账；重复请求不重复记录。Evidence 3/3、Tools 44/44、Store 57/57、Delivery 2/2、全仓 typecheck、host seams 9/9 通过。
- 边界：2xx 证明实际请求获得 HTTP 响应，不证明流完整、模型理解或语言质量。尚未确认的准备信息只在当前 runtime turn 内保留；进程/turn 结束前未记账的内容保持未验证，需要再次读取，不能借历史图片目录补签。未知图像协议或未发出 SDK 响应通知的 Provider 保守少计；真实收费 Provider 未验证。

## B3：区间覆盖、分页预算与资料快照

- 修改：Context 提取格式化时把正文 UTF-16 `[start,end)` 定位写入既有 `locator_json`；Receipt 的既有 JSON 记录提交区间，Store 合并连续/重叠范围派生覆盖。视觉 anchor 只能由视觉记录满足；旧无定位资料保守要求全文。
- `cat_read_context_doc` 删除标记字符串反查及每页全量目录，返回实际 `nextOffset` 和独立 `nextMetadataOffset`。正文、当前目录、warnings、导航字段和封装共同计入最终文本预算；不足时给出 `minimumRequiredBytes`，不推进空游标。
- Translation Context 新游标 `ctx3` 比较剩余句段的实际 Source/Target、匹配、规则与关联资料事实；已提供的正常批次写回、Proposal、无关批次不使剩余页失效。有效旧 `ctx2` 保持原事件快照校验。相关资料摘要只在单次调用计算，不增加缓存服务。
- Touchpoint：未增删 Proma 触点；修改均在已有 Linguist 路径和 CAT 包。无新表、无 schema 修改。
- 验证：生产 tool/Store 先复现完整翻页仍 pending，修复后缺页 pending、补齐 complete、重复页不增加覆盖；中文/emoji/伪 anchor 标记原文逐页重组一致；60 个图片目录和 37 条 warning 均可分页取全，完整文本结果不超过 3,200 字节，长文页不超过 1,800 字节；不足预算不推进。Evidence 4/4、Tools 44/44、Store 57/57、extractor 2/2、全仓 typecheck、host seams 9/9 通过。组合分页 fixture 约 85 ms（单次测试观察，不作性能保证）。
- 限制：Stage 生命周期和决定归属由 C 修复；规则首页限额与预算清空必要术语由 D 修复。当前通过不代表这些后续合同已完成。

## C1：独立任务、决定归属与交付覆盖

- 修改：Stage 使用独立 UUID；通过既有 `cat_get_translation_context` 的 scope/restart 参数创建任务。Resume 复用当前任务；新范围、新轮次或相关资料变化产生新任务。Session 装配不再从 UI 当前批次冻结范围。
- 在既有 Plan JSON 内记录创建时的决定事件边界；完成计算只接受边界之后、同一 Session actor、当前 revision 的决定。旧 Plan 缺少边界时保持 pending，不能借用历史资格。Source authority 必须覆盖冻结范围内的每个句段。
- 完成查询不再写状态或 updatedAt；交付按每个句段选择最新任务，窄范围不能掩盖旧缺口，完全替代后的旧 stale 不再污染当前交付。人工工作流仍可在没有 Agent Stage 时导出。
- Context 正文、定位、相关 mapping 和实际使用的 optional 资料进入版本；无关 optional 新增不改变任务。闲置期间的变化在 Receipt/交付查询时也校验；错误提取偏移会回滚，不覆盖已有定位。
- 文件：20 个实现/回归文件（host extension、Stage host、Session CAT tools、delegation/delivery、Core Plan、Store repositories、Tools），另更新本实施记录。Proma Touchpoint 无增删；Schema 仍为 19。
- 验证：Stage host 1/1（包含 A→B→A、显式重启与重放、不同 actor、旧查询顺序、mapping/optional 变化）；Evidence 4/4（真实本地 HTTP Provider 链）；Delivery 3/3（窄范围覆盖和旧 stale 替代）；Store 57/57、Tools 44/44、全仓 typecheck、boundaries 4/4、host seams 9/9 通过。
- 风险：本轮职业阶段资格不能从旧记录推断，恢复后需重新读取并确认。纯查询派生状态不等同语言质量。CAT 装配可用性和规则截断仍由 C2/D 继续处理；真实 Provider 与候选包尚未验证。

## C2：CAT 可用性与宿主解耦

- 真实失败：删除合成项目 cat.db 后，`resolveLinguistSessionCatTools` 在定义工具时抛 STORE_NOT_FOUND，尚未进入 Agent 请求。修复后工具定义不打开 DB，每次执行重新验证 Session 绑定、取得当前 DB 和 Stage。
- 修改：Session CAT tools、Turn Context validator、Project Service、delegation host、原生 Collaboration 既有接入、相关测试与 Node loader。Project Service 在 DB 文件被替换/移除时撤销缓存句柄；开库失败返回带底层 code 的 PROJECT_UNHEALTHY。Turn Context 先拒绝跨项目身份；资料不可读时只注入已验证项目身份，不注入未验证 UI 实体 IDs。既有 Prompt Digest 的可用性提示继续生效。
- General 普通协作继承项目身份与宿主能力，不创建非空专业 scope；专业岗位与显式 CAT 范围仍冻结并校验。修正普通协作默认 role 和提示中的不存在 scope。
- Touchpoint：原有 `agent-collaboration-tools.ts` 接入原因更新；无新增/删除文件级触点。CAT Schema 不变。
- 验证：独立 Node 进程、临时数据根、Electron 外壳 mock，实际 Project Service/SQLite/会话索引/Host/Tool 状态链 1/1：缺失→损坏→恢复→缓存文件原子替换→metadata 缺失恢复→归档只读→解绑拒绝；32 个工具保持可装配，未重建缺失 DB。原生 Collaboration 4/4、全仓 typecheck、boundaries 4/4、host seams 9/9、fusion 14/14 通过。
- 风险：本包验证实际宿主装配和 CAT 调用，不把 Electron mock 等同真实窗口或 Provider；这些由 F 的隔离应用验证补充。文件原地破坏与外部非原子改写不提供自动数据修复，应使用已有备份恢复。

## D：同源规则、完整必要事实与岗位语义

- 修改：Prompt builder/General/Reviewer 资源，Store 的既有 ProjectDatabase/Stage repository，Tools 上下文与 DTO，以及对应生产回归。删除不可达的三岗位 fallback 和 Digest 的第二套技术约束摘要转换；保留已有专业资源缺失报错。Prompt 版本为 3.1.3。
- Digest、Stage 与上下文复用 `getProjectRules`。保留完整 Style Guide 示例和技术声明，优先技术/必要规则，排除明确指向其他资产的约束；自由文本 scope 无法确认时保留原声明，不猜测排除。规则全集的新增/修改使当前任务 stale，并要求新轮重读。
- 现有 `cat_get_translation_context` 增加 rulesOnly/rulesOffset 和规则总量/本页/剩余/下一偏移；规则页只读取规则，不重复构建 TM/TB/Context。长规则放不下返回 minimumRequiredBytes，不推进空游标。未增加工具，仍 32 个。
- 必要/禁止术语及冲突不受可选术语限额影响；最小预算核心保留这些事实、TM 强弱/来源/冲突信息和相关 speaker/voice。放不下应缩小批次或提高预算，不能用空数组冒充不存在。
- General 先解决可确定 Gap，warning 不自动暂停；通用专业合同统一要求报告本轮 pending/blocked/stale/complete，逐段数量齐全不能代替完整任务资格。
- Touchpoint：无增删；新增合同位于已有 CAT 包。无新表，Schema 仍 19。
- 验证：Tools 44/44（26 条适用规则经 2,000 字节规则页取全、其他资产约束排除、超长规则不空转、termLimit=0 仍保留 hard terms）；真实 Pi→本地 HTTP 的三岗位链：25 条规则中余下 5 条未提交时逐段确认仍 blocked，实际提交后 complete。Evidence 4/4、Store 57/57、Stage host 1/1、Delivery 3/3、Prompt 3/3、全仓 typecheck、boundaries 4/4 通过。
- 风险：规则覆盖证明本轮提交事实，不证明语言质量或任意自然语言约束被机器执行。未判定的自由文本 scope 保守保留；真实 Provider 专业效果仍未验证。

## E1：退役已由固定上游覆盖的 popup 偏差

- 当前上游 main 已核对至 `66b888268b38fcd13d85f71021e97ebacea28596`（新增 Slack bridge）；本轮仍固定 bbf577a8，不引入 Slack、Rail、新搜索布局或 Google 超时变更。
- 三方证据：当前 LA 和固定基线都已有 `outlivesOpener: true`，都没有父标签递归销毁子标签；`f2ddb623` 是固定基线的祖先。唯一剩余差异是 LA 删除了未使用的 opener 字段及传递，不能据此声称上游缺少生命周期修复。
- 修改：`browser-controller.ts` 恢复为固定基线逐字一致；删除其 temporary-deviation 登记，执行 policy 改为 take-upstream；同步现有账本摘要，新增小型原生 popup probe。共享 Host Seam 的冲突继续要求具体复核，未设置整文件 ours/theirs。
- Touchpoint：删除 1 个 temporary-deviation，49→48；总数 281→280，其余 222 product + 8 host + 2 generated 不变。恢复上游未使用字段增加 6 行本地代码，但移除了整文件维护责任。
- 验证：同一个源码级 probe 分别编译当前 LA 和恢复后的固定上游，使用真实 Electron 43.2.0 WebContents/受管 BrowserController、专用临时配置及 user-data-dir，执行 popup→切换→关闭父标签→切换/关闭另一标签→子页面正文仍可读→关闭子标签，两版均通过。日志 `/tmp/la-new-popup-current.log`、`/tmp/la-new-popup-upstream.log`。固定基线文件 diff 为零；boundaries 4/4、policy、fusion 14/14、host seams 9/9 通过。
- 风险：此次只证明该生命周期合同等价；未把最新上游的其他新行为当作 LA 已实现。其余临时偏差没有充分等价证据，保留。

## E2：默认验证链与 Worker 结算

- 真实失败：合成 Worker 在未返回结果时 exit(0)，原生产 helper 的 Promise 仍 pending，Node 测试以“事件循环已结束但 Promise 未解决”失败。
- 修改：`cat-job-worker-client.ts` 对任何未结算退出明确 reject，并忽略结算后的消息；一个使用真实 worker_threads 的生命周期用例验证 exit 0/7、abort、结果后异常和迟到消息。没有 worker pool、重试或新调度平台。
- 根 test 顺序接入既有 Stage/Delivery/Evidence 三个脚本及一处 host-lifecycle 集合；Store/Tools 各执行一次。Tools 复用 Store Node loader，删除两个重复文件。CI 标题移除“目标 200–300 条”。
- 默认链也揭示分页 fixture 的 discovery 清单只列当次文档，遗漏同项目已关联资料；改为实际全集，保留原有正文/图片/范围断言。
- Touchpoint：无新增/删除；根 manifest 和 CI 仍使用原有入口及登记。
- 验证：完整 `bun run test` 退出 0：Bun 主集合 255 + MCP 1 + 切换 1 + 协作 4；Store 57、Tools 44、Stage 1、Delivery 3、Evidence 4、Host 生命周期 2，总计 372 通过。真实本地 HTTP、SQLite 和 Worker 事件均进入默认链。全仓 typecheck 通过；未运行远程 CI（本轮不推送）。
- 风险：默认测试不是本机安装/原生对话框/真实模型资格；F 继续验证候选包和存量闭环。

## F：存量闭环与实际 utility 集成

- 合成旧格式副本使用 Schema 19、旧 Plan（无决定边界）、旧工具级 Receipt 和旧摘要 Pi JSONL；不冒充客户库或旧 Schema 自动升级。真实 Project Service 打开后保留原译文/参考和原 Session ID，旧资格不提升；备份、重复会话规范化、新轮写回、CAS 拒绝旧 revision、verified 导出和重导通过。Source 原字节、占位符、句段 key/数量正确；损坏备份被拒绝且当前译文不变，有效备份可恢复原译文/参考/旧 Receipt。
- 原生候选揭示两项进程内用例未覆盖的本轮集成回归：静态 SDK import 在 CJS 主进程触发 `ERR_PACKAGE_PATH_NOT_EXPORTED`；新增函数回调穿过 utility 序列化导致 `An object could not be cloned`。恢复模块改为 ESM 动态加载；adapter 等待恢复。沿用既有 capability RPC 等待主进程规范化，沿用有序 query callbacks 传递最终 payload/HTTP status，函数保留在所属进程，CAT 记账仍留在主进程。未增加事件总线、HTTP 代理或第二套会话系统。
- 更正 B1/B2 的证据范围：此前通过的是直接 Pi SDK/adapter 层的生产链，不能证明 packaged utility 路径可用；上述两项修复后才补齐实际应用链。失败记录保留在本节，不以先前测试通过掩盖。
- 原生探针在同一个绑定 General Session 上移走 cat.db、写入损坏 DB、恢复原件；三种状态都收到实际 HTTP 200 与 final，通用 read/bash 仍提交给模型，CAT 缺失不重建，错误保持 PROJECT_UNHEALTHY。另一个 Reviewer Session 真实调用 `cat_get_translation_context`，两次 Agent 流式请求后收到正文并在主进程得到一条 `provider-response-v1` Receipt。该链跨越原生 Electron → utility → Pi SDK → 本地 HTTP → main → SQLite。
- 探针自身曾漏传绑定会话 Context 快照，并误把自动标题请求计入 Agent 流；补齐实际 Context 合同，只筛选 stream=true 的 Agent 请求。未删除正文、工具、错误、覆盖或 Receipt 断言。同步演练 fixture 补齐三个接缝文件，原有验证不放宽。
- Core/Store/Tools 的公开字段、方法和工具参数已改变，分别递增一个 patch；版本只在 manifest、锁文件与机器基线维护。App 和 Proma 基线不变，未升级外部依赖、增加工具或改变 Schema。
- Touchpoint：本包新增 `pi-utility-adapter.ts`、`src/utility/agent-runtime.ts`、`shared/src/types/agent-runtime.ts` 三个 host-seam。固定上游缺少恢复/最终请求观察的等价接入，不能删除。均登记精确 policy 与 hook，仍要求冲突复核。

## 本轮真实差异与退役边界

同一固定上游 `bbf577a8`，比较 `git diff --numstat <upstream> <tree> -- apps packages scripts config`；开始树是 `8fe9fe2e`，结束树是包含本节的最终 F 提交。下表为双树差异，不是三点 merge-base，也不是触点账本计数。`src` 集合包含源码目录内资源；测试集合按 test/spec/fixture/smoke 路径单列，二进制不计文本行。

| 集合 | 起点：文件 / +行 / -行 | 结束：文件 / +行 / -行 |
|---|---:|---:|
| 全部不同路径 | 683 | 687 |
| 上游已有 src 路径 | 222 / 6467 / 5325 | 224 / 6517 / 5319 |
| LA 新增 src 路径 | 281 / 75800 / 0 | 282 / 76006 / 0 |
| tests / fixtures / probes | 121 / 16754 / 4650 | 122 / 17320 / 4650 |
| 其他配置与脚本 | 59 / 2731 / 275 | 59 / 2744 / 275 |

三类含二进制文件的数量前后相同：上游 src 16、LA src 1、其他 7。

| 高风险文件 | 起点 +行/-行/hunks | 结束 +行/-行/hunks |
|---|---:|---:|
| pi-agent-adapter.ts | 23/1/5 | 41/1/6 |
| agent-orchestrator.ts | 87/16/29 | 89/16/30 |
| agent-session-manager.ts | 321/40/52 | 321/40/52 |
| agent-collaboration-tools.ts | 159/141/73 | 159/141/73 |
| AgentView.tsx | 70/51/40 | 70/51/40 |
| AppShell.tsx | 86/19/18 | 86/19/18 |
| browser-controller.ts | 1/6/5 | 0/0/0 |
| pi-utility-adapter.ts | 0/0/0 | 17/0/4 |
| utility/agent-runtime.ts | 0/0/0 | 12/0/1 |
| shared/types/agent-runtime.ts | 0/0/0 | 2/0/1 |

账本起点为 222 product + 49 temporary + 8 host + 2 generated = **281**；结束为 222 + 48 + 11 + 2 = **283**。删除一处无须本地维护的 popup 偏差，新增三个必要跨进程接缝，净增二处。删除 CAT 专用请求投影和重复 loader 是实际减法，但本轮首先修正运行合同，不能宣称总代码或触点下降。必要恢复与请求观察的通用能力被固定上游等价覆盖后，才可退役相应接缝；其余临时偏差保留原逐项条件。

## 小样本测量

临时脚本直接调用当前 Store/Tool，无生产 trace/caching 平台：50 个合成句段、25 条规则、空 TM/TB，预算 8,192 字节。50 段在 19 页取完，每页 1–7 段、4,527–8,181 字节；单次总耗时约 100 ms，其中匹配约 3 ms。getByIds 20 次（包含后续规则页）、术语评价 648 次、TM 候选查询 19 次；另一个 rulesOnly 页取余下 5 条，1,119 字节、约 0.54 ms。每个句段只入页一次，但重复规则为 66,780 字节，约占文本输出 44.9%。

这个刻意低预算样本说明分页仍有重复计算/规则输出开销，不证明大库性能或模型费用；当前匹配耗时不足以支持新增缓存基础设施。可用现有 rulesOffset/rulesOnly 显式继续规则，并选择合适预算。没有真实 Provider usage，不推算精确成本或语言质量收益。

## 迁移、回滚和未验证资格

- 新结果只走自含 content；旧摘要识别集中在恢复边界。首次迁移保存 `.before-cat-content-v1`；历史未存储的图片需要重新读取。不开库即装配 CAT 工具，不重建缺失项目。
- Schema 保持 19，但新旧完成语义不同。回退代码不能恢复旧数据语义；如需回滚本轮项目操作，关闭相关会话后用操作前项目备份恢复；需要回滚 Pi 文件时另保留并恢复其迁移前副本。已导出的用户文件不因代码回退消失。
- 2xx 证明实际请求获得 HTTP 响应，不证明流完整、模型理解或语言质量。未确认记录只有当前 turn 内的记账重试；进程/turn 结束后仍未确认的内容保持 pending，重新读取后才能满足新覆盖。未识别的图片协议保守少计。
- 本轮没有授权的真实 Provider 配置。下一步使用独立临时配置和匿名 3–5 段、必读图片、跨页正文、25 条规则、术语冲突、locked 和预埋误译，显式跑 General → 三专业岗位 → QA → verified export → re-import；检查误译发现、正确译文是否被无益改写、图片事实和末页规则是否被引用，并记录实际 calls/usage/耗时。质量判断由人工复核，不使用模型自评替代。
- Native Open/Save、真实 Keychain、IME、VoiceOver、keyboard-only、视口及 14 天日用仍未取得本轮资格；不把自动窗口操作写成这些项目通过。真实 Phrase/memoQ 互操作仍见 TODO。

## 受保护文档待修订内容

本轮未改 README.md、README.en.md 或 AGENTS.md。获得对应授权后，必要修订为：

1. README 中文“General 可按任务选择性委派”段与英文对应段，以及 AGENTS 的 CAT 委派规则：明确专业岗位/显式 CAT 范围才冻结 Segment；通用 General 协作只继承项目和 Workspace，不要求非空 CAT 范围。
2. README 中文 `cat_confirm_segments` 段与英文对应段、AGENTS 的确认规则：完整完成同时要求“当前轮、当前 revision、本人有效决定、必要提交证据满足、pending/blocked 为零”；覆盖句段数量本身不构成 Full Review。
3. 在两份 README 的 CAT 说明中补充“必要规则/Context 可分页续读；旧回执不提升新资格；CAT 不可读时通用对话可继续”的用户行为。动态版本继续链接当前事实，不复制版本表。

## F 最终验证与提交文件

| 层级 | 实际结果 |
|---|---|
| 默认 `bun run test` | 373 通过，0 失败；Bun 255 + MCP 1 + 切换 1 + 协作 4；Store 57、Tools 44、Stage 1、Delivery 3、Evidence 4、Host/旧数据 3 |
| `bun run typecheck` | 全部 11 个包退出 0 |
| 边界与同步 | boundaries 4、fusion 14、Host Seams 12 通过；真实临时 Git 同步 replay 通过，未使用空 diff 代替验证 |
| `bun run smoke:vertical` | 退出 0；内含完整 Electron build、runtime deps、`smoke:pack`、artifact 验证、frozen-lockfile 恢复和原生探针，无需重复独立 build/pack |
| 原生 Agent / Chat | 分别 19/19；Agent 覆盖实际 utility Receipt、绑定会话故障恢复与 resume，Chat 覆盖流式/思考/工具/重试/Stop/重启 |
| 原生项目切换 | 通过：侧栏→权威 Session→持久化 Workspace/Tab→AgentView，含空项目创建与 A→B→A |
| 原生 CAT | 21 通过，0 失败，2 MANUAL；右侧 CAT、快捷确认、Proposal、QA、Backup/Restore、Worker、导出重导与重启 |
| 真实 Provider / 人工资格 | 未验证；自动执行 passed，完整产品合同仍为 partial，Native Open/Save 一项汇总 BLOCKED |

最终候选为 `apps/electron/out/mac-arm64/Linguist Agent.app`；ASAR SHA-256：`94f661ae1fdfe4b63e58b84aa1ab5705b128d320c176bca646f6641b0a02fcba`。生成记录：`apps/electron/out/smoke/vertical/vertical-smoke-report.json`，结束时间 `2026-09-05T05:54:20.437Z`。打包时 sourceHead 是 `2d526e2f`，workingTreeDirty=true，含本 F 实现；随后仅收口文档并提交同一产品代码，没有冒充干净 HEAD 打包。所有探针只运行临时 HOME/user-data-dir 和假凭据配置；产物验证不代表已安装或已发布。

本包修改 25 个文件：

```text
CURRENT_FACTS_SIMPLE.md
apps/electron/scripts/smoke/fake-model-server.ts
apps/electron/scripts/smoke/probe-pi-stream.ts
apps/electron/src/main/lib/adapters/pi-agent-adapter.ts
apps/electron/src/main/lib/adapters/pi-utility-adapter.ts
apps/electron/src/main/lib/linguist/agent-host-extension.ts
apps/electron/src/main/lib/linguist/evidence-workflow-v1.nodetest.ts
apps/electron/src/main/lib/linguist/legacy-cat-session.ts
apps/electron/src/main/lib/linguist/session-availability.nodetest.ts
apps/electron/src/utility/agent-runtime.ts
bun.lock
docs/DOCS_INDEX.md
docs/HANDOFF.md
docs/architecture/PROMA_CORE_TOUCHPOINTS.md
docs/architecture/proma-baseline.json
docs/architecture/proma-sync-policy.json
docs/architecture/proma-touchpoints.json
docs/release/IMPLEMENTATION_2026_09_05.md
docs/release/KNOWN_LIMITATIONS.md
packages/linguist-cat-core/package.json
packages/linguist-cat-store/package.json
packages/linguist-cat-tools/package.json
packages/shared/src/types/agent-runtime.ts
scripts/verify-host-seams.mjs
tests/proma-sync-policy.test.ts
```

前序独立本地提交：

```text
cc63cbc2 修复 CAT 自含多模态结果与旧会话恢复
656474c3 在真实 Provider 响应后确认 CAT 证据提交
76a81836 修复 Context 跨页证据、最终预算与资料快照
4c17049f 隔离 CAT Stage 轮次、决定归属与交付覆盖
82a9f92d 保留 CAT 不可用时的 Agent 宿主与通用协作能力
ffc9b285 统一项目规则续读与专业任务完成语义
6799a9f5 归还固定 Proma 已覆盖的浏览器 popup 生命周期
2d526e2f 接入完整证据回归并修复 Worker 无结果退出
```

最后 F 提交包含本节、实际跨 utility 修复和收口事实；最终 SHA 随交付回复给出。本轮总计九个本地提交，没有 push、PR、Tag、Release 或安装替换。每次提交前均审查当次 diff 并通过 ponytail-review；远程 CI 没有因本轮触发。

## 发布与数据边界

本轮仅本地提交，不推送、创建 PR/Tag/Release 或替换安装版。不使用客户文件、生产数据库或未授权凭据。README / AGENTS 本轮不改；需要同步的准确事实在最终记录列出。单元、生产链模拟、目录包与真实 Provider 资格分别记录。
