# Linguist Agent UI 行为合同

状态：LA 自有、clean-room、可公开的实现合同。

基线：`64bcb15b`。

适用范围：`apps/desktop` Electron 前端及其与 canonical backend contract 的交互。

## 1. 合规与事实边界

本文只规定 LA 需要实现和验证的产品行为，不复刻第三方产品，不包含第三方品牌、资产、完整内部文案、反编译 chunk/class 名称或私有实现细节。外部产品研究只能帮助形成一般交互原则，不能成为源码、样式或文案复制依据。

发生冲突时，优先级如下：

1. 后端 canonical Task / Run / Activity / Artifact / Decision 事实；
2. CAT locked、proposal、evidence、QA、tag/placeholder 与 delivery hard rails；
3. 共享 API/IPC schema 和 capability policy；
4. 本行为合同；
5. 视觉偏好与研究输入。

Renderer 是投影和交互层，不得创建隐藏 Run、伪造完成状态、扩大权限、把 Artifact 当成 Delivery，或用本地 fallback 掩盖后端失败。

## 2. 产品壳层

- 桌面端保持专业、低噪、信息密度适中的视觉语言，支持浅色、深色和减少动态效果。
- 窗口在默认桌面尺寸、紧凑尺寸、200% 缩放下均可操作；关键操作不得因窄窗口消失。
- 一级入口围绕 Chats、Projects、Library、Settings 收敛；能力可以迁移位置，但不得在没有替代入口时消失。
- 低频操作可在 hover/focus 时出现，但键盘和触屏等价入口必须存在。
- 所有导航、命令和深链必须指向 canonical 实体，不使用仅存在于 Renderer 的幽灵选择状态。

## 3. Conversation 与 Composer

- Conversation 统一呈现 Message、Activity、Decision、Artifact、Recovery 与状态变化，保持一个 Task chronology。
- 长时间或高频 Activity 应聚合为可展开摘要；工具请求、Decision、Error 和 terminal event 不得被普通文本节流吞并。
- 长 Thread 使用窗口化或等价技术，保持滚动锚点、文本选择和流式内容稳定。
- Composer 必须明确区分发送、停止、排队和立即引导当前 Run；按钮状态只由 canonical Run/queue 状态决定。
- 排队消息支持查看、编辑、删除和失败重试；刷新或切换页面后从后端恢复。
- 模型、reasoning effort 或 execution profile 的显式变化显示为时间线事件，并说明从下一 Turn、压缩后或新 runtime epoch 生效。
- 生成中切换模型默认从下一 Turn 生效；若用户要求立即切换，必须先停止当前生成并创建新的 execution snapshot。

## 4. Decision 与权限

- 所有授权、冲突、waiver、Package、Extension 和恢复选择使用同一 Decision 语义。
- Decision 必须显示申请者、动作、对象、scope、原因、风险、hash/版本、有效期和拒绝后果（适用时）。
- 权限文案描述真实能力和数据流，例如文件内容是否会进入模型上下文；不只显示抽象工具名。
- 拒绝是正常业务结果，不显示为未知系统崩溃。
- Pending Decision 在 Renderer reload、页面切换和连接恢复后仍可恢复；重复响应由后端幂等处理。

## 5. Run、Activity 与恢复

- Run 状态、重试、停止、压缩和终态来自后端唯一状态机。
- 中间可重试错误不得先显示成 terminal failure；terminal event 只能出现一次。
- 流式 UI 更新应有界，目标不高于约 20 次/秒；final 前必须 flush pending text。
- Error 使用稳定 code、公开消息、diagnostic ID 和后端提供的 recovery actions；前端不得解析英文错误字符串猜操作。
- Runtime 断线时保留已确认事实，恢复后按 cursor 补事件；检测到 gap 时重新请求 snapshot，不自行补造历史。

## 6. CAT Workspace

- Segment Grid 在至少 10,000 行规模下使用虚拟化或等价增量渲染。
- 编辑提交携带 `expectedRevision`；冲突时展示当前值与草稿，不采用静默 last-write-wins。
- locked Segment 必须不可写，并以文本和辅助技术说明原因。
- draft、proposal、committed、delivered 是不同状态；不得用一个模糊完成态合并。
- tag、placeholder、ICU、换行和术语约束由后端确定性 gate 验证；UI 只展示与修正。
- QA、Review、Artifact、Delivery 和 Evidence 从同一 Task 可发现，Pipeline 或页面重组不得隐藏权威流程。
- 主要 CAT 操作支持键盘完成，Grid 具备可理解的行列与状态语义。

## 7. Library、Memory 与 Document

- Library 结果显示来源、locator、digest/revision 与检索方式。
- Confirmed Memory 显示 scope、来源、确认/撤销/supersede 状态、有效期、显式冲突与 lexical/local-semantic 召回状态；Client/Franchise 必须显示显式 identifier，不得假装从 Project 推断映射。Memory 不得被展示成 Project Evidence。
- Document job 显示 backend、版本、进度、partial/failed 状态和来源位置。
- OCR/解析结果允许回到页、区域或结构块；无法确认 provenance 时明确标记 unknown，而不是伪造引用。
- 未资格化 backend 保持 disabled/blocked；不得静默转系统或云端 fallback。

## 8. Accessibility 与动效

- 所有主流程可仅用键盘完成，焦点顺序稳定且可见。
- Dialog、Menu、Tab、Grid、状态更新和错误提示具有正确的辅助技术语义。
- 不以颜色作为唯一状态信号；blocking、warning、success 同时有文字或图标标签。
- 遵循 `prefers-reduced-motion`；减少动态时停用非必要位移、粒子、闪烁和自动滚动动画。
- 浅深主题、200% 缩放、窄窗口和 VoiceOver 属于发布验证门，不以源码字符串测试替代真机证据。

## 9. 可验证矩阵

至少覆盖：

- 480×600、1024×700、1280×820；
- 浅色、深色、减少动态、200% 缩放；
- 1,000-turn 长 Thread 与持续流式更新；
- 10,000-row CAT Grid、编辑冲突、locked row、tag/placeholder；
- Decision reload、过期、拒绝、撤销和重复响应；
- queue/steer/stop/retry/model change/compaction；
- Runtime disconnect、cursor reconnect、event gap recovery；
- 键盘全流程、自动 accessibility 检查和真机 VoiceOver。

自动化截图、源码合同和组件测试只能关闭其对应层级。真实安装包、系统菜单、VoiceOver、性能和人类可发现性仍需真机证据。

## 10. 禁止事项

- 不复制第三方品牌、Logo、图标资产、完整内部文案或反编译实现表达。
- 不把原始逆向工程材料作为公开实现合同或 Agent 直接施工输入。
- 不要求“原样复刻”“像素级复制”第三方界面。
- 不让视觉合同覆盖后端事实、安全 policy 或 CAT gate。
- 不用自动化截图宣称真实机器、可访问性或产品验收已经完成。
