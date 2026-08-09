# Linguist Fusion 当前事实

> 更新日期：2026-08-10。代码、manifest、测试和真实运行输出优先于本文。

## 基线

| 项目 | 当前事实 |
|---|---|
| 仓库 / 分支 | `/Users/<local>/Desktop/linguist-agent-next` / `integration/la-proma-0.16.10` |
| Proma Base / formal merge | v0.16.10 `72fd1b1a` / `ea26177f` |
| App / Electron | `0.16.29` / `43.2.0` |
| Bun / Pi / Claude | `1.3.14` / `0.82.1` / `0.3.201` |
| Shared | `0.1.91` |
| CAT Core / Formats / Store / Tools | `0.0.19 / 0.0.10 / 0.0.34 / 0.0.31` |
| CAT schema / Tool count | `15` / `30` |

产品结构固定为完整 Proma Agent + Chat，加 Linguist Vertical Agent Profile / CAT Core / Store / Tools / Workbench。Linguist 复用同一个 AgentView、Session、Planning、Preview Tab、权限和 Host 状态。

## 当前产品事实

- Linguist 岗位只有 `general / translator / reviewer / proofreader`。四岗位使用同一套 CAT/Proma 能力，差异只存在于短而明确的岗位提示词。
- 岗位可创建时选择并在 Header 切换；旧 reviewer/auditor 字段只在 Session 读取时转换，转换后不再保留旧字段。
- 项目异常不封死会话。Agent 的通用读写、思考、MCP 和文件能力继续可用；CAT mutation 仍由 Session binding、项目健康、revision CAS、locked 和结构规则保护。
- Common Contract 与四份岗位提示词位于 `resources/linguist-roles/`，这是唯一岗位 Prompt 真源；不再注入旧 project role Skill。
- Reviewer 默认执行完整 Source + Target 审校，Proofreader 默认聚焦目标语；两者都可在用户明确要求时通过 Proposal 写回。
- 对外 CAT Toolset 固定为 30 个，包含直接写入、术语闭环、Workbook Mapping、Voice Context、统一资源导入、未知 Tag 扫描、Tag Profile 保存和 `verified/as-is` 导出；不再公开 Critic 或 Translation Scope 工具。
- `cat_import_resources` 接受文件或目录、绝对路径或相对会话工作目录路径，递归上限为 500 个条目，不跟随符号链接目录；XLSX 和其他歧义映射显式返回 `needsInput`。
- `cat_export_asset` 默认拒绝覆盖。`verified` 经过交付预检、结构硬规则和重导验证；`as-is` 可导出未完成批次，但仍保留路径校验、格式生成和原子写入。
- Tag Scanner 是 Core 到 UI 的单一真源。内建 family、项目 Active pattern 和 Candidate 共用同一扫描结果；Candidate 在保存前检查证据、正则安全、重叠和 paired pattern。
- Phrase Master 配对依赖内容身份；mapping 持久化 source hash、placeholder 顺序和原始 XML，过期/不完整 mapping 阻止 final，不阻止 draft。
- 旧 Critic DB 记录仅为历史兼容读取，不再有公开创建或工作流入口。Execution Policy 和 Translation Scope active 路径已删除。

## 证据边界

- SIMPLE-001 证明的是干净启动基线；本轮聚焦测试证明的是实现行为。
- 本轮全量证据为：11 workspace typecheck、根 `1479/1479`、Electron `181/181`、CAT Tools `36/36`、boundary `4/4`、fusion `9/9`、432 依赖 SBOM/许可证核验。
- 私有 Phrase 工作目录只做只读副本测试；82/82 placeholder segment 配对、713 segments、byte-stable 与 reimport-stable，客户内容不进入仓库。
- macOS arm64 packaged artifact integrity 通过；纵向 smoke 为 Pi `15/0`、Chat `19/0`、Linguist `21/0/2 MANUAL`，合同覆盖仍是 `partial`。
- 真实模型质量、四岗位真实全链、14 天日用、VoiceOver、IME 和 Native dialog 仍待真实证据，不能由自动测试替代。

当前 Ticket 状态见 [SIMPLE_IMPLEMENTATION_STATUS.md](./SIMPLE_IMPLEMENTATION_STATUS.md)。历史 v1 queue 和 Gate 报告只代表当时证据，不覆盖本页。
