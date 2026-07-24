# Linguist Agent UI 差距矩阵

基线：`64bcb15b`。唯一公开实现合同是净化后的 `docs/ui/LA_UI_BEHAVIOR_SPEC.md`。2026-07-24 用户授权（见 `IMPLEMENTATION_QUEUE.md` §10.5）：LA-134 至 LA-142 把 `docs/ui/codex-ui-spec-full.md` 作为私有实现目标执行复刻改造；该文档仍不得作为公开合同或验收标准，公开镜像净化清单不变。领域、安全和后端事实冲突时，以代码 hard rails 为准。状态：`present`、`partial`、`missing`、`unknown-runtime`。

## 1. Shell、导航与设计系统

| 合同 | 当前文件/函数/数据链 | 状态 | 已有测试 | 差距/验收 | 未知 |
|---|---|---|---|---|---|
| 1280×820默认、480×600最小 | `desktop-security.mjs::resolveWindowSize/browserWindowOptions` -> BrowserWindow | present | `security.test.mjs`、UI contract | 加1024×700/200% zoom截图 | 打包产物真机 |
| 46px titlebar/hiddenInset/traffic lights | main window options + renderer CSS | present | source contract tests | 真机拖拽区、全屏、浅深主题 | macOS版本差异 |
| neutral tokens/light-dark/reduced motion | `styles/tokens.css`、全局/feature CSS | partial | UI contract tests | token覆盖审计、contrast、forced colors、截图 diff | 规格色值部分为观察推断 |
| clamp sidebar/resizable inspector | shell/workspace CSS、SegmentCompanion | partial | inspector/model tests | 480px碰撞、键盘resize、persisted width | 真机pointer/VO |
| 一级导航 Chats/Projects/Library/Settings | `ProductWorkspace`/toolbar/sidebar；当前另有 Package Center | partial | navigation/command tests | Package移Settings；Pipeline/Eval/Maintainer降级但功能可发现 | 无用户行为数据 |
| Command palette/shortcuts | command palette、main fixed commands | present | command palette/bridge tests | native shortcut真机验证 | automated CDP不能证明系统菜单 |

## 2. Conversation、Composer 与 Run

| 合同 | 当前实现与调用链 | 状态 | 测试 | 差距/验收 | 未知 |
|---|---|---|---|---|---|
| 48rem左右Thread主列 | conversation CSS | present | source contract | 480/1024/1280截图与长内容 | 字体渲染差异 |
| Composer squircle、工具/模型/权限控件 | `AgentComposer`、controls/power slider/CSS | present | composer model/power/slash tests | advanced/profile语义与后端ExecutionProfile对齐 | 真实provider models |
| Send/Stop/Queue/Steer四态 | composer model -> TaskConversation -> workspace client/server queue/stream | present | composer/conversation/client tests | 后端单Run状态机后重验；a11y announcements | stop race真运行时 |
| queue drag/edit/delete/retry | queued message surface -> canonical queue routes | present | queued model/client/server queue tests | 跨reload真实恢复、拖动键盘替代 | 长队列性能 |
| Turn虚拟化/长Thread | `TaskConversation` + `@tanstack/react-virtual` | present | source/model tests | Playwright 1000-turn、anchor/streaming/selection | 真机内存/屏幕阅读器 |
| Activity聚合/Worked divider | `ConversationItems`、conversation model | partial | conversation model/activity tests | canonical event type统一后，重复计数/耗时/折叠完整映射 | Pi原始事件变化 |
| model changed divider + config warning | model/conversation components有切换语义痕迹 | partial | model tests | 后端 `session.config_changed`、epoch/compatibility/compaction actions | Pi session内模型迁移能力 |
| Retry/recovery actions | conversation recovery models + permission surface | partial | conversation/permission tests | 统一ErrorEnvelope/RecoveryAction，禁止字符串猜测 | provider failure矩阵 |
| pending permission reload recovery | `PermissionRequestSurface`、workspace store refresh/stream reconnection、server pending decisions | present in baseline | desktop permission tests、server decision tests | 真机reload/stop/expiry/duplicate response | 当前提交未发布 |
| image attachments | direct image attachment server + composer/preload/client | present in baseline | direct image/desktop tests | 大图内存、EXIF/隐私、streaming import | 真机/客户图像未测 |

## 3. Decision、Plan、Artifact、Inspector

| 合同 | 当前实现/数据 | 状态 | 测试 | 差距/验收 | 未知 |
|---|---|---|---|---|---|
| Approval/Decision cards | canonical Task decision/activity + `PermissionRequestSurface`/pipeline decisions | partial | decision/permission/UI tests | 单一 Decision Center；scope/hash/expiry/revoke；拒绝为正常结果 | 所有decision type inventory |
| Plan/WorkGraph cards | Team preflight/planHash、pipeline views | partial | workflow/team plan tests | Adaptive WorkGraph canonical schema与可视化，不伪造进度 | 质量路由尚不存在 |
| Artifact cards/preview/export | Task artifacts、RichArtifact contract/export | present | rich artifact/security/export tests | provenance、delivery状态、blob migration UI | 大artifact性能 |
| Evidence inspector | SegmentCompanion/ProjectAssets/pipeline artifact evidence | partial | evidence/inspector tests | 统一source refs、page/segment navigation、unknown provenance blocked | 真实OCR overlay |
| QA/Delivery authority | PipelineWorkspace、CAT/decision ledger | present but fragmented | QA/delivery/pipeline tests | 从Task可发现；不因Pipeline降级而隐藏 | 人类盲评可用性 |

## 4. CAT Workspace

| 合同 | 当前实现/数据链 | 状态 | 测试 | 差距/验收 | 未知 |
|---|---|---|---|---|---|
| virtualized 10k segment grid | renderer CAT + filtered full rows/virtual styles；server batch/segment | partial | 10k filter/navigation model test | 真DOM virtualization、scroll p95、编辑时不抖动 | 真机计时未做 |
| revision/CAS | segment client发送revision、server canonical 409、autosave model | present | CAT draft/conflict tests | 全批量proposal/commit CAS统一 | 多用户/多进程 |
| locked row保护 | server domain gates + UI locked behavior | present | locked/QA/write gate tests | a11y明确只读原因 | 真格式项目 |
| tag/placeholder chips | server detected tags -> renderer chip editor | present | chip/tag tests | IME、复制粘贴、VO、复杂ICU | 真实语言输入法 |
| Proposal/Diff/QA/Review/Artifact/Delivery | backend完整、UI分布CAT/Pipeline/Inspector | partial | extensive backend/desktop tests | 单Task discoverability、状态术语一致、批量影响预览 | 60-row blind review仍未完成 |
| keyboard/VoiceOver | 键盘模型、ARIA/CSS focus部分存在 | partial | source/unit tests | 真机全流程、grid semantics、announcements | P3 open gate |

## 5. Library、Memory、Document

| 合同 | 当前实现/数据 | 状态 | 测试 | 差距/验收 | 未知 |
|---|---|---|---|---|---|
| Personal/Project Library + provenance | `LibraryWorkspace` -> library routes/store catalog/blocks/vectors | present | library tests | 大文件streaming、reindex状态、source navigation | managed E5 pack缺失 |
| Memory proposal/confirm/revoke/conflict | assistant memory APIs/tools + Library UI | partial | memory tests | candidate queue、conflict/expiry/scope、semantic recall、used-memory chip | 旧TDAI真实资产 |
| Document backend/job status | document capability/settings/library/artifacts | partial | document tests | Router UI、per-page backend、progress/partial-ready/failure recovery | real backends |
| OCR correction/source navigation | evidence overlay/artifacts有限 | partial | document evidence tests | correction workflow、bbox/page jump、backend/version/digest visible | real OCR corpus |
| MinerU/Unlimited-OCR gating | MinerU fail-closed；Unlimited-OCR不存在 | partial/missing | qualification tests | Labs/optional backend，绝不默认fallback | hardware/license/quality |

## 6. Settings 与开发面

| 合同 | 当前实现 | 状态 | 测试 | 差距/验收 | 未知 |
|---|---|---|---|---|---|
| Models & Providers | Settings Pi/model/auth routes/UI | present | settings/Pi tests | model capability/context registry、epoch change UX | live providers |
| Privacy & Permissions | PermissionSettings + server contract | partial | permission/settings tests | unknown deny；Stable remove full；capability grants细节 | existing full users |
| Resources & Packages | Package Center/Settings CSS与routes | present but top-level | package/settings tests | 移入Settings；Stable `.lapkg`；executable分级 | publisher ecosystem |
| Runtime & Updates | runtime installer/status/repair + MaintainerPanel elsewhere | partial | installer/maintainer tests | Maintainer从conversation移除；signed update状态/rollback历史 | real signing/runtime install |
| Appearance & Accessibility | theme/menu/tokens/reduced motion | partial | security/UI tests | font/zoom/contrast/VO settings | real machine |
| Advanced/Developer gating | full/npm/extensions/diagnostics边界分散 | missing/partial | policy tests | 单一channel/build gate，Stable不可环境变量打开危险面 | channel metadata |

## 7. 测试差距

| 层 | 当前 | 需要新增 | 成功定义 |
|---|---|---|---|
| unit/model | 数量较多，覆盖queue/CAT/store/settings | canonical event/recovery/config change纯模型 | 无时间/网络依赖，穷尽union |
| contract | 多为源码字符串和手写DTO路径断言 | shared schema/IPC generated drift | main/preload/renderer/server不一致即失败 |
| visual | 无完整Playwright baseline | 3窗口×2主题×motion×zoom关键页截图 | 差异需人工批准，LA品牌不复制OpenAI资产 |
| performance | 10k filter等模型测试 | 10k DOM grid、1000-turn thread、20fps stream、background runs | 明确p50/p95、无100ms freeze |
| accessibility | focus/ARIA source证据 | axe + keyboard map + VoiceOver人工记录 | 主流程无鼠标可完成、状态不只靠颜色 |
| recovery | gap/reload模型较强 | runtime crash、renderer reload、pending decision、queue、partial stream真进程 | 后端snapshot/event完全重建 |

## 8. Clean-room 与未知项

- 只复现公开观察到的交互行为与尺寸，不复制 OpenAI logo、品牌文案、视频、专有源代码或反编译资产。
- UI 规格中的部分数值来自观察/推断；未有源码或运行证据的项目必须用 LA 自己的视觉测试固化，不能声称与 Codex 内部实现一致。
- 当前 baseline UI tests green 不等于真实安装版 P3、VoiceOver或人类blind review完成。
