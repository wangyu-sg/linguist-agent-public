# Linguist Agent 当前交接

更新时间：2026-08-10

## 当前状态

- 仓库：`/Users/<local>/Desktop/linguist-agent-next`
- 分支：`main`；实现以当前 `git HEAD` 和工作树为准。
- 上游基线：Proma v0.16.10 / `72fd1b1a`；正式 merge：`ea26177f`。
- Kimi K3 Linguist UX 已合并：`0136a1d2`。
- 当前版本：Electron App `0.16.35`、Shared `0.1.93`、CAT Core / Formats / Store / Tools `0.0.20 / 0.0.10 / 0.0.35 / 0.0.33`、schema `15`。
- 产品结构仍是完整 Proma Agent + Chat，加 Linguist Vertical Agent Profile / CAT Workbench；没有第二套 Agent、Chat、Planning、Preview 或权限系统。

## 已实现

- 岗位统一为 `General / Translator / Reviewer / Proofreader`。四岗位使用同一套 30 个 CAT 工具和 Proma 权限，只由提示词规定默认职责；岗位可在创建时选择，也可在会话 Header 切换。
- 旧 Reviewer/Auditor 元数据仅在读取时解码；旧 role Skill 双注入、Execution Policy、公开 Critic、Translation Scope 和相关无调用 UI 已移除。
- 项目归档、缺失或不可用时不再阻断整个 Agent 会话；通用 Agent 能力继续工作，CAT 读取/写入按真实项目状态 fail closed。
- Common Quality Contract 内置于单一 Prompt Builder，四岗位 Markdown 的唯一真源位于 `resources/linguist-roles/`；岗位资源缺失时使用短 fallback，不再叠加旧 Linguist Skill。Project Digest 以 `complete / partial / skipped` 和 `truncated` 显示降级，失败占位对模型可见，Markdown project-data 用围栏标记为数据而非指令。
- Reviewer 默认读取当前完整资产的 Source + Target 并给出可执行审校结果；Proofreader 默认处理当前完整资产并聚焦目标语。Proposal 只是可见、可接受、可撤销的正式修改载体，不是低质量草稿或审校前置流程。
- `cat_import_resources` 支持绝对路径、相对会话工作目录路径、文件和目录递归导入；单文件 alias `cat_import_asset` 保留。批次、TM、TB、Context 自动分类，XLSX 等歧义输入返回 `needsInput`。
- `cat_export_asset` 公开参数为 `validation: verified/as-is`。两者默认不覆盖；只有显式 `overwrite=true` 才原子替换普通文件。`verified` 必须通过完整交付与结构硬规则，`as-is` 允许未完成内容但仍保留路径安全和格式 round-trip 验证。原生 UI 的单一入口可导入多文件或文件夹，并同时提供 `verified` 和需明确确认的 `as-is` 导出；Renderer 不接受任意粘贴路径。异步读盘、manifest 校验和安全复制已收口到共享服务。
- Tag Scanner 是 Core、导入、QA、导出和 Renderer 的单一真源。未知 Tag 形状可扫描为 Candidate，经证据、ReDoS、重叠和配对验证后启用；UI 显示 Active/Candidate/Ignored。编辑器保留原生 textarea，并以 chip overlay 展示 token，硬 Tag 被改动时禁止保存。
- Phrase Master 配对使用内容身份而非文件名；mapping 记录 source hash、placeholder 顺序和原始 XML，导入时 rehydrate，导出时 dehydrate，过期或不完整 mapping 阻断 `verified` 交付。
- 术语支持批量 CRUD、冲突查询、revision cache 编译 matcher，required/preferred/forbidden/deprecated 译后校验与中英文命中规则。
- Workbook Mapping 可预览建议、置信度与理由并持久化复用；语义不一致的多候选 fail closed，`locked` 列贯穿导入。Voice Profile 与 approved exemplar 有原生添加、上下文展示和 Agent 总结入口；同一 Segment/角色/文本类型的新译例原子替换旧内容。
- Full Agent 保留 Proma Files / Changes 面板，Workbench rail 保持对话专用。Linguist 展开态与 mini rail 复用 Proma 的“新会话 + 搜索”宿主结构；普通新会话只绑定当前 CAT 项目并默认 General，项目/会话仍与普通 Agent workspace 隔离。Planning 与 Agent Skills 绑定普通 Agent workspace，故不显示在 Linguist 侧栏；这是域隔离，不是遗漏。术语冲突可并排比较并一键保留；CSV auto 分类只有在列语义明确时直接执行，歧义输入返回 `needsInput`。
- memoQ MQXLIFF 使用专用 Adapter，保留 inline code、确认状态与审校批注；已有合成 fixture round-trip，真实客户样本仍待验证。
- Proma v0.16.10 已合并；CI 保留 macOS 15 arm64 packaged build 与完整性验证。

## 已取得的证据

- SIMPLE-001 启动基线：根测试 `1485/1485`、CAT Core `123/123`、CAT Tools `54/54`、Electron Linguist `211/211`、boundary `4/4`、fusion architecture `9/9`。
- 本轮全量 typecheck：11 个 workspace 全部通过。
- 本轮测试：根 `1537/1537`（`6890` assertions）、Electron Linguist `207/207`、CAT Store `228/228`、CAT Tools `40/40`、boundary `4/4`、fusion architecture `9/9`。
- SBOM/许可证：432 个生产依赖一致；NOTICE 和 packaged resources 已纳入检查。
- 当前 `0.16.35` 的 macOS arm64 packaged vertical 通过：Agent `15/15`、Chat `19/19`、Linguist `21/21`；Linguist 保留 `2 MANUAL`。LF-003 `runStatus=passed`、coverage `partial`。`app.asar` SHA-256：`35cbb7dc6643736b29a10e579e5ffc658974960cda7bb76eb2400d6206493261`。
- 已安装 `/Applications/Linguist Agent.app` `0.16.35`，其 hash 与验证产物一致；旧 `0.16.34` 位于废纸篓且可恢复。远端同步状态以最终 Git 回执为准。
- 忽略的 `artifacts/ui-final/` 有 Dark、Light、Narrow 三张侧栏截图，检查未见全局横向溢出。
- 私有工作目录只读 Phrase 副本验证：82/82 个 placeholder segment 内容配对，713 segments，byte-stable 与 reimport-stable；文件名、绝对路径和客户正文未进入仓库。

自动回归与 packaged smoke 不等于真实模型质量、真机人工或产品资格。当前纵向 smoke 的合同覆盖状态为 `partial`；即使自动 smoke 通过，也不能据此关闭下列真实证据项。

## 尚需真实使用取得的证据

1. 同模型、同 reasoning 的 Web Chat / 旧 LA / 新 LA 对照。
2. 真实 Provider 驱动四岗位完成翻译 → 审校 → 校对 → `verified` 交付。
3. 用真实 Phrase 与 memoQ 样本/平台产物验证导入、修改、导出、重导、inline code、状态与批注兼容。
4. 从可用构建开始累计 14 个真实日用日。
5. 真机 VoiceOver、完整键盘、IME、Native Open/Save、窄窗和 Companion round-trip。

状态真源见 [SIMPLE_IMPLEMENTATION_STATUS.md](./roadmap/SIMPLE_IMPLEMENTATION_STATUS.md)；本轮实施证据见 [FINAL_IMPLEMENTATION_REPORT_2026-08-10.md](./implementation/FINAL_IMPLEMENTATION_REPORT_2026-08-10.md)；未完成项只列在 [TODO.md](../TODO.md)。测试、smoke、打包只能使用任务专用临时 user-data-dir，私有语料不得进入 Git。
