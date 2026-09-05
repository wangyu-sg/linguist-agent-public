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

## 发布与数据边界

本轮仅本地提交，不推送、创建 PR/Tag/Release 或替换安装版。不使用客户文件、生产数据库或未授权凭据。README / AGENTS 本轮不改；需要同步的准确事实在最终记录列出。单元、生产链模拟、目录包与真实 Provider 资格分别记录。
