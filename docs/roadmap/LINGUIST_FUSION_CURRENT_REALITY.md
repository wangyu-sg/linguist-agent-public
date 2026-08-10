# Linguist Fusion 当前事实

> 更新日期：2026-08-10。代码、manifest、测试和真实运行输出优先于本文。

## 基线

| 项目 | 当前事实 |
|---|---|
| 仓库 / 分支 | `/Users/<local>/Desktop/linguist-agent-next` / `main` |
| Proma Base / formal merge | v0.16.10 `72fd1b1a` / `ea26177f` |
| App / Electron | `0.16.36` / `43.2.0` |
| Bun / Pi / Claude | `1.3.14` / `0.82.1` / `0.3.201` |
| Shared | `0.1.94` |
| CAT Core / Formats / Store / Tools | `0.0.20 / 0.0.10 / 0.0.36 / 0.0.33` |
| CAT schema / Tool count | `15` / `30` |

产品结构固定为完整 Proma Agent + Chat，加 Linguist Vertical Agent Profile / CAT Core / Store / Tools / Workbench。Linguist 复用同一个 AgentView、Session、Planning、Preview Tab、权限和 Host 状态。

## 当前产品事实

- Linguist 岗位只有 `general / translator / reviewer / proofreader`。四岗位使用同一套 CAT/Proma 能力，差异只存在于短而明确的岗位提示词。
- 岗位可创建时选择并在 Header 切换；旧 reviewer/auditor 字段只在 Session 读取时转换，转换后不再保留旧字段。
- 项目异常不封死会话。Agent 的通用读写、思考、MCP 和文件能力继续可用；CAT mutation 仍由 Session binding、项目健康、revision CAS、locked 和结构规则保护。
- Common Quality Contract 内置于单一 Prompt Builder，四份岗位 Markdown 位于 `resources/linguist-roles/` 并作为岗位提示词唯一真源；不再注入旧 project role Skill。Project Digest 诊断为 `complete / partial / skipped` 加 `truncated`，失败占位对模型可见，Markdown project-data 有数据围栏。
- Reviewer 默认对当前完整资产执行 Source + Target 审校，Proofreader 默认对当前完整资产聚焦目标语；两者都可在用户明确要求时通过 Proposal 写回。
- 对外 CAT Toolset 固定为 30 个，包含直接写入、术语闭环、Workbook Mapping、Voice Context、统一资源导入、未知 Tag 扫描、Tag Profile 保存和 `validation: verified/as-is` 导出；不再公开 Critic 或 Translation Scope 工具。
- `cat_import_resources` 接受文件或目录、绝对路径或相对会话工作目录路径，递归上限为 500 个条目，不跟随符号链接目录；XLSX 和其他歧义映射显式返回 `needsInput`。
- `cat_export_asset` 默认拒绝覆盖。`verified` 经过交付预检、结构硬规则和重导验证；`as-is` 可导出未完成批次，但仍保留路径校验、格式生成和原子写入。
- 原生 UI 以同一入口选择多文件或文件夹，并提供 `verified` 与需明确确认的 `as-is` 导出；Renderer 不接受任意粘贴路径。文件使用同一 fd 异步限额读取，manifest 校验与 secure copy 在 ProjectDelivery 单点执行。
- Tag Scanner 是 Core 到 UI 的单一真源。内建 family、项目 Active pattern 和 Candidate 共用同一扫描结果；Candidate 在保存前检查证据、正则安全、重叠和 paired pattern。
- Phrase Master 配对依赖内容身份；mapping 持久化 source hash、placeholder 顺序和原始 XML，过期/不完整 mapping 阻止 `verified` 交付，不阻止 `as-is`。
- 术语库已具备批量 CRUD、冲突查询、revision cache matcher 和 required/preferred/forbidden/deprecated 译后校验；翻译上下文只返回实际命中项。
- Workbook Mapping 支持建议/置信度/理由、保存与项目内安全复用；不一致多候选 fail closed，`locked` 列贯穿导入。Voice/Exemplar 支持原生添加、上下文展示、Agent 总结与 stale 内容原子替换。
- Full Agent 保留 Proma Files / Changes，Workbench rail 保持对话专用。Linguist 展开态与 mini rail 复用 Proma 的“新会话 + 搜索”宿主结构；普通新会话只绑定当前 CAT 项目并默认 General。Planning 与 Agent Skills 绑定普通 Agent workspace，故不显示在 Linguist 侧栏；这是域隔离，不是遗漏。术语冲突可并排比较和一键保留；CSV auto 分类只在列语义明确时执行，歧义表返回 `needsInput`。
- 批次导航只列真实批次并支持刷新；选择失效时收敛到首个有效批次。底部进度、草稿数和源/译字符数仅统计当前批次，阶段标签由项目工作流映射为“已确认 / 已审校 / 已校对”。
- memoQ MQXLIFF 已有专用 Adapter 和合成 fixture round-trip，保留 inline code、确认状态与审校批注；真实客户样本仍待验证。
- Kimi K3 Linguist UX 已通过 merge commit `0136a1d2` 合入。
- 旧 Critic DB 记录仅为历史兼容读取，不再有公开创建或工作流入口。Execution Policy 和 Translation Scope active 路径已删除。

## 证据边界

- SIMPLE-001 证明的是干净启动基线；本轮聚焦测试证明的是实现行为。
- 本轮全量证据为：11 workspace typecheck、根 `1540/1540`（`6906` assertions）、Electron `207/207`、CAT Store `229/229`、CAT Tools `40/40`、boundary `4/4`、fusion `9/9`、432 依赖 SBOM/许可证核验。
- 私有 Phrase 工作目录只做只读副本测试；82/82 placeholder segment 配对、713 segments、byte-stable 与 reimport-stable，客户内容不进入仓库。
- 当前 `0.16.36` 的 macOS arm64 packaged vertical 通过：Agent `15/15`、Chat `19/19`、Linguist `21/21`；Linguist 另有 `2 MANUAL`，LF-003 `runStatus=passed`、coverage `partial`。`app.asar` SHA-256 为 `0c97ba3a522e6e92656657d20f58b6847ea49f75a1a23c40e9cde64a25b14fa8`；已安装 `/Applications/Linguist Agent.app` `0.16.36`，hash 一致。旧 `0.16.35` 位于废纸篓可恢复。
- 远端同步状态以最终 Git 回执为准，不作为产品资格证据。
- 真实模型质量、四岗位真实全链、Phrase/memoQ 互操作、14 天日用、VoiceOver、IME 和 Native Open/Save 仍待真实证据，不能由自动测试替代。

当前 Ticket 状态见 [SIMPLE_IMPLEMENTATION_STATUS.md](./SIMPLE_IMPLEMENTATION_STATUS.md)。历史 v1 queue 和 Gate 报告只代表当时证据，不覆盖本页。
