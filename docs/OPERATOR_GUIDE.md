# Linguist Agent 操作指南

Linguist Agent 是本机 macOS 上运行的通用工作 Agent，并叠加专业游戏本地化能力。维护中的客户端只有 `apps/desktop` Electron 应用；后台是受认证的 loopback server 和 Pi runtime。

## 开始前

1. 确认 API/订阅认证已经在 Settings 中配置。密钥应进入 Keychain 或官方环境变量引用，不要写进项目文件。
2. 确认 runtime 健康、版本兼容。
3. 普通工作可直接 New Chat；只有需要客户资产、语言对、双语句段、QA 和交付权威时才创建 Project。
4. 无项目 Chat 只可访问自己的私有 workspace 和用户明确授权的文件/目录；Project 只管理 `data/projects/<projectId>`。删除 Chat/Project 都不会删除原始目录。

如果只是验证仓库，不要安装/替换 `/Applications/LinguistAgent.app`，也不要同步或重启 Application Support managed runtime。

## 产品结构

- Standalone Chat：无项目的 canonical Task，使用 General Core、私有 workspace 和显式文件授权。
- Project：客户/游戏项目及资产、TM、TB、默认语言。
- Batch：一组可编辑双语句段，拥有自己的语言对。
- Task：一次明确目标和范围的工作。
- Run：Task 内的一次 Single、Team、Eval 或系统 pipeline 尝试。
- Agent thread：Main 或具名 specialist 的过程身份。
- Activity：按时间排列的人类消息、工具、证据和过程事实。
- Artifact：候选译文、QA、交付、Eval 等版本化产物。
- Decision：需要人工授权或已经记录的处置。

Conversation 用来协作；有 Batch 范围时 CAT 用来生产。两者属于同一个 Task，不是两套任务系统。

## 无项目 Chat

1. 从 Chats 选择 New Chat。创建的是正式 standalone Task，不是隐藏 Project 或 Home Agent。
2. 需要本地文件时，在 Composer 左侧 `+` 通过原生 picker 添加文件。它只为当前 Chat 创建显式只读 file grant；在同一附件菜单中可管理和撤销。不要给整个主目录做默认授权。相邻盾牌是 Agent 的运行权限档位（请求批准／替我审批／完全访问权限／自定义规则），不是文件授权列表。
3. 选择工作目录后，项目级 Pi 资源需先通过目录 trust。未知的用户/全局 executable Extension 会显示 canonical path、来源和 SHA-256；只有确认这个摘要后才会执行。文件内容变化会使批准失效。
4. Run 进行中，发送按钮或 `⌘↩` 使用 Pi steer；`⌥⌘↩` 进入 follow-up 队列；`Esc` Stop。没有需要长期保持的“现在调整/完成后执行”切换状态。
5. Chat 可从标题栏 `…` 显式 compact、fork、copy/handoff、archive/restore。复制上下文不会修改源 Chat，也不会偷偷继承源 Chat 的文件授权。
6. PNG/JPEG/WebP 图片会在支持视觉输入的当前模型上随下一次新 Run 直接发送；其他文件仍作为受控工具/OCR附件。若模型不支持图片输入，系统会明确拒绝，不会静默忽略。
7. General Chat 没有 Segment、proposal/apply、QA 或 Delivery 权限；需要这些能力时创建 Project Task。

Library 中可维护个人或 Project 文档，并选择 lexical/vector/hybrid 检索。向量能力依赖 exact managed multilingual-E5 pack；未就绪必须显示状态。Memory 必须由 Agent 提议并经用户确认，支持编辑/撤销，且不能当作 CAT evidence。

Package Center 只在浏览目录时不会执行代码。安装前先查看 quarantine descriptor、依赖闭包、lifecycle script、license、文件/网络/进程/secret/custom UI 风险，确认当前 `planHash` 和所有风险。安装不等于 Run 激活，正在运行的 Chat 也不会扩权。

## 新建项目与导入

1. New Project 中选择源目录，并明确默认源/目标语言。
2. 在 Project → Assets 检查扫描结果、工作簿预览、映射和资产角色。
3. 创建 Batch 或导入 Phrase MXLIFF、memoQ MQXLIFF、SDLXLIFF、通用 XLIFF、CSV/XLSX、Phrase bilingual DOCX 等受支持格式。
4. 导入 TM/TB/术语资产时检查语言对和字段映射；不要把错误语言对当成可回退证据。
5. 在 Batch → CAT 抽查锁定、标签、占位符、状态、上下文和建议证据。

## CAT 工作

- 锁定句段不可覆盖。
- 精确 TM 是否具有约束力取决于项目中的 typed authority；fuzzy TM 和未晋升的 working TM 只是建议。
- Termbase、glossary、客户资产、源文件、已审核/已晋升 TM 可以形成可引用证据。
- 普通翻译可写受控 draft；编辑、校对和高风险修改优先走 proposal → review/apply。
- 标签、占位符、ICU、转义、换行和明确数字策略由确定性 gate 检查，不能靠 Agent 自报通过。
- QA finding 必须修复、明确处置或在允许的紧急流程中接受风险；忽略不等于删除记录。

## Main、Team 与 follow-up

Main 是默认输入目标。Team preflight 先显示计划、角色和等待/审批状态，不会在未开始时偷偷调用模型。每个 specialist 的安全过程、证据、状态和产物进入同一 Task 时间线。

需要追问某个 specialist 时，从对应 Activity 或 Artifact 发起 scoped follow-up。它会创建新的 canonical Run，不会改写原 Run，也不会生成永久平行聊天室。

Stop 针对当前 canonical Run：Single、Team、Eval 都会进入各自权威的停止路径。若 UI 显示 stopping，等待 durable terminal state；不要通过杀进程伪造完成。

## Evidence、QA 与 Delivery

1. 在 Inspector 检查 TM/TB/glossary/asset/source excerpt 的真实返回内容。
2. Tool trace 只能证明工具调用过，不能单独证明术语或译法。
3. Quality Audit、Expressive Audit、Delivery QA 和 readiness 都会生成 Task pipeline Activity/Artifact。
4. 在交付前处理 blocker、未审核 finding、标签/占位符/换行风险和显式 accepted risk。
5. 导出审计是交付事实；不要只凭界面标签宣布 ready。

## Eval

Private Eval 只能在明确 Project/Batch 范围内执行。Single 和 Team 生成时看不到 reference/reviewed/customer-return 字段；blind queue 完成前也不暴露 Run 身份。

固定 60 队列需要人工逐条 A/B/C 判断。只有平局、双方失败或标记争议的行才做九维复核。机械 QA 通过不等于语言质量通过。

## Settings

Settings 管理：当前模型与 Provider/能力连接、认证、Pi settings、Package Center/resources、document capabilities、permissions、memory、one-shot run options、keybindings、themes、历史 Pi sessions、notifications、runtime/storage diagnostics。

- “当前模型”是本机用户选择的完整 provider/model 对，不是只显示不生效的项目默认值。它会原子保存，并只应用到下一次新 Run；发送消息、切换 standalone/Project Task 都不会清掉它。正在运行的 Run 不会被中途改写。
- OAuth Provider 和 API key Provider 都直接显示在“模型与能力连接”中。OAuth 登录会打开官方验证流程；不要把 token 或设备代码写入项目文件、终端历史或文档。
- Runtime 页可明确重启、修复本机 managed runtime；缓存必须先预览，再用服务端返回的 `planHash` 确认清理。该清理只针对可重建缓存，不会删除 Project、Task、记忆、审计或客户文件。

- Pi keybindings 写入官方全局文件；活动中的 Pi session 可能需要 `/reload`。
- Pi Settings 的 Package 操作与 Package Center 的 managed install 是两条明确路径；目录浏览不执行代码，安装/激活第三方资源必须经过各自的预览、信任、摘要和确认路径。
- Agent Autonomy 只控制通用 runtime tool；不会放开 CAT 写入和交付 gate。
- 历史 Pi session 仅用于管理/审计，不是 Task Resume 入口。

Maintainer 只接受 standalone Chat 中明确的 recursive read-write repository grant。先生成只读 upgrade plan，再按 exact `planHash` 在独立 Git worktree 构建/验证候选；激活是第二次批准。它不能直接修改当前 runtime 或跳过回滚健康检查。

## 故障处理

- Runtime unavailable：先看 Settings → Diagnostics 和 runtime 日志，不要把空项目列表当正常状态。
- Credential unavailable/rejected：修复 Keychain/认证，不要把 token 打到终端或文档。
- Prompt too long：系统允许 Pi native compaction 后重试一次；持续失败应保留明确错误。
- Waiting/permission/Decision：权限请求会替换当前 Composer 为 Task-scoped approval surface；按请求选择批准范围或拒绝，或明确 Stop，不要通过刷新掩盖等待状态。切换 Task 只会隐藏审批卡，不会替你批准/拒绝；若审批卡未出现，先检查 runtime/stream 恢复状态，而不是把超时当作模型失败。
- Failed Run：从 Activity/diagnostic 找到失败边界，再决定重试；新尝试必须是新 Run。

## 安全验证命令

```bash
npm run typecheck
npm test
npm run mac:build
npm run mac:test
npm run mac:verify
npm run release:check
npm run runtime:health
npm run rc:status
```

最终 RC 使用 checkout-local 的 synthetic two-batch 项目，见 `docs/RELEASE_CANDIDATE.md`。真实视觉/可访问性门槛见 `design-qa.md`；固定种子人工盲评见 `TODO.md`。
