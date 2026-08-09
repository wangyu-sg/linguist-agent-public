# Linguist Agent 当前交接

更新时间：2026-08-10

## 当前状态

- 仓库：`/Users/<local>/Desktop/linguist-agent-next`
- 分支：`integration/la-proma-0.16.10`；实现以当前 `git HEAD` 和工作树为准。
- 上游基线：Proma v0.16.10 / `72fd1b1a`；正式 merge：`ea26177f`。
- 当前版本：Electron App `0.16.29`、Shared `0.1.91`、CAT Core / Formats / Store / Tools `0.0.19 / 0.0.10 / 0.0.34 / 0.0.31`、schema `15`。
- 产品结构仍是完整 Proma Agent + Chat，加 Linguist Vertical Agent Profile / CAT Workbench；没有第二套 Agent、Chat、Planning、Preview 或权限系统。

## 已实现

- 岗位统一为 `General / Translator / Reviewer / Proofreader`。四岗位使用同一套 30 个 CAT 工具和 Proma 权限，只由提示词规定默认职责；岗位可在创建时选择，也可在会话 Header 切换。
- 旧 Reviewer/Auditor 元数据仅在读取时解码；旧 role Skill 双注入、Execution Policy、公开 Critic、Translation Scope 和相关无调用 UI 已移除。
- 项目归档、缺失或不可用时不再阻断整个 Agent 会话；通用 Agent 能力继续工作，CAT 读取/写入按真实项目状态 fail closed。
- Common Contract 与四岗位提示词的唯一真源位于 `resources/linguist-roles/`；资源缺失时使用短 fallback，不再叠加旧 Linguist Skill。
- Reviewer 默认读取完整 Source + Target 并给出可执行审校结果；Proofreader 聚焦目标语。Proposal 只是可见、可接受、可撤销的正式修改载体，不是低质量草稿或审校前置流程。
- `cat_import_resources` 支持绝对路径、相对会话工作目录路径、文件和目录递归导入；单文件 alias `cat_import_asset` 保留。批次、TM、TB、Context 自动分类，XLSX 等歧义输入返回 `needsInput`。
- `cat_export_asset` 支持 `verified` 和 `as-is`。两者默认不覆盖；只有显式 `overwrite=true` 才原子替换普通文件。`verified` 必须通过完整交付与结构硬规则，`as-is` 允许未完成内容但仍保留路径安全和格式 round-trip 验证。
- Tag Scanner 是 Core、导入、QA、导出和 Renderer 的单一真源。未知 Tag 形状可扫描为 Candidate，经证据、ReDoS、重叠和配对验证后启用；UI 显示 Active/Candidate/Ignored。编辑器保留原生 textarea，并以 chip overlay 展示 token，硬 Tag 被改动时禁止保存。
- Phrase Master 配对使用内容身份而非文件名；mapping 记录 source hash、placeholder 顺序和原始 XML，导入时 rehydrate，导出时 dehydrate，过期或不完整 mapping 阻断 final。
- Proma v0.16.10 已合并；CI 保留 macOS 15 arm64 packaged build 与完整性验证。

## 已取得的证据

- SIMPLE-001 启动基线：根测试 `1485/1485`、CAT Core `123/123`、CAT Tools `54/54`、Electron Linguist `211/211`、boundary `4/4`、fusion architecture `9/9`。
- 本轮全量 typecheck：11 个 workspace 全部通过。
- 本轮测试：根 `1479/1479`、Electron Linguist `181/181`、CAT Tools `36/36`、boundary `4/4`、fusion architecture `9/9`。
- SBOM/许可证：432 个生产依赖一致；NOTICE 和 packaged resources 已纳入检查。
- macOS arm64 packaged build 与 artifact integrity 通过。纵向 smoke：Pi `15 PASS / 0 FAIL`、Chat `19 PASS / 0 FAIL`、Linguist `21 PASS / 0 FAIL / 2 MANUAL`；Native Open/Save 仍需真机人工。
- 私有工作目录只读 Phrase 副本验证：82/82 个 placeholder segment 内容配对，713 segments，byte-stable 与 reimport-stable；文件名、绝对路径和客户正文未进入仓库。

自动回归与 packaged smoke 不等于真实模型质量、真机人工或产品资格。纵向 smoke 的合同覆盖状态仍是 `partial`，不能据此关闭下列真实证据项。

## 尚需真实使用取得的证据

1. 同模型、同 reasoning 的 Web Chat / 旧 LA / 新 LA 对照。
2. 真实 Provider 驱动四岗位完成翻译 → 审校 → 校对 → final 交付。
3. 从可用构建开始累计 14 个真实日用日。
4. 真机 VoiceOver、完整键盘、IME、Native Open/Save、窄窗和 Companion round-trip。

状态真源见 [SIMPLE_IMPLEMENTATION_STATUS.md](./roadmap/SIMPLE_IMPLEMENTATION_STATUS.md)；未完成项只列在 [TODO.md](../TODO.md)。测试、smoke、打包只能使用任务专用临时 user-data-dir，私有语料不得进入 Git。
