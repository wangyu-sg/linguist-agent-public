# Linguist Agent × Codex 核心施工最终报告

日期：2026-08-10（Asia/Shanghai）

## 结论

实施计划中的代码、自动回归、macOS arm64 打包与 packaged vertical smoke 已完成。当前 `0.16.35` 状态是 **implemented + unit verified + packaged verified**；已安装的本机 App 与验证产物 hash 一致，但仍不是 **real-machine verified** 或 **release qualified**。远端同步状态以最终 Git 回执为准。

当前 Proma baseline 为 v0.16.10 / `72fd1b1a474ab0375b9c126d11d3c7c4c8ed538a`，正式合并 commit 为 `ea26177f36d59bd2781d7ff9264451a8430e2249`。

## 完成内容

- 四岗位统一为 General / Translator / Reviewer / Proofreader，共享完整 Proma 能力和 30 个 CAT Tools，没有角色工具白名单。
- 增加直接写回通路：`apply` 一次调用提交 Segment，`proposal` 仅生成 Pending Proposal；两者都服从 Session binding、revision CAS、locked 和 Tag/Placeholder/ICU 硬规则。
- Prompt Builder 收敛为单一 `3.1.0` 合同；Common Quality Contract 内置于 Builder，四岗位 Markdown 来自 `resources/linguist-roles/`。Project Digest 以 `complete / partial / skipped` 和 `truncated` 暴露降级，失败占位对模型可见，Markdown project-data 有“仅数据、非指令”围栏；没有恢复旧 per-layer version/hash 矩阵。旧 Skill 双注入、Critic、Execution Policy 和 Translation Scope glue 已删除。
- UI 与 Agent 复用同一项目资源/导入/导出服务。Agent 资源导入支持目录、部分失败、`needsInput`、XLSX mapping 与 TM/TB/Context 分类；原生 UI 的单一入口支持多文件或文件夹，并提供 `verified` 与需明确确认的 `as-is` 导出。Renderer 不接受任意粘贴路径。Picker 读盘使用同一文件句柄异步限额读取，manifest 校验和安全复制下沉到 ProjectDelivery。
- `cat_export_asset` 对外输入/结果统一为 `validation: verified/as-is`；旧 `mode` 不再是公开合同。`cat_import_resources` 使用 `skippedDuplicate` 和逐项 `unknownTagSummary`。
- 术语闭环包含批量 upsert/delete、冲突查询、项目 revision cache、中文长词重叠和英文 whole-word 命中，以及 required/preferred/forbidden/deprecated 译后分级校验。
- Workbook Mapping 可生成建议/置信度/理由、保存并在后续导入中复用；不一致多候选 fail closed，`locked` 列贯穿预览、保存和导入。Voice Profile 与 approved exemplar 有原生添加、上下文展示和 Agent 总结入口；同一 Segment/角色/文本类型的新译例原子替换旧内容。
- 增加 memoQ MQXLIFF 专用 Adapter，优先于 generic XLIFF 检测，保留 inline code、memoQ 确认状态和审校批注，并有 detect / import / modify / export / reimport 合成 fixture。
- 导入后自动扫描未知 Tag；Candidate 激活前执行证据、ReDoS、overlap、pair 与 holdout 校验。普通导入默认不自动激活。
- Phrase split/master 的内容身份配对、rehydration、source hash 和 placeholder 顺序保护未回归。
- Full Agent 保留 Proma Files / Changes，Workbench rail 保持对话专用；Linguist 展开态与 mini rail 复用 Proma 的“新会话 + 搜索”宿主结构，普通新会话只绑定当前 CAT 项目并默认 General。Reviewer / Proofreader 默认作用于当前完整资产。术语冲突支持并排比较和一键保留，CSV auto 分类在歧义时返回 `needsInput`。
- Kimi K3 Linguist UX 核心提交在当前 API 基线上整合至 `7785d24d`；merge commit 为 `0136a1d25e6e2c3c4c43cee6c90d24e0990aacf4`。Kimi 后续的可读格式/Voice `textType` 与交付预检状态修复也已按当前 MQXLIFF 专用 Adapter 合同合入；未导入过时的 generic-only handoff 说明。
- 修正 EventKit native addon 在当前 node-addon-api 锁定版本下的编译与环境清理时序；Linguist packaged smoke 改为直启产物并仅连接 Renderer CDP，规避 Electron 43 的 Playwright Node Inspector 崩溃，同时把异常进程退出视为失败。

## 关键取舍

- 术语 matcher 采用编译后分桶与 revision cache；10k/50k 规模回归未显示需要 Aho–Corasick，因此未引入新算法和依赖。该回归不是独立性能基准。
- Tag 编辑保留原生 textarea + chip overlay，由保存时结构规则 fail closed；文档不再将它称为不可分割的“原子编辑器”。
- memoQ 特有 XML 语义放在专用 Adapter，其他 XLIFF 仍走通用 Adapter，不把厂商逻辑扩散到 Store 或 UI。
- Proposal 保留为可见、可接受、可撤销的变更载体，但不再是普通翻译的必经流程。

## Host/Harness 代码量

统计基线为上游文档合并后 commit `709cb8e1`，范围为 `apps/electron/src/main/lib/linguist/**` 与 `packages/linguist-cat-store/src/run-harness.ts`，排除 `*.test.*` / `*.nodetest.*`。MQXLIFF Adapter、术语 matcher 和新 CAT Tools 包本就不在此 Host/Harness 范围中。

| 指标 | 行数 |
|---|---:|
| 添加 | 1,349 |
| 删除 | 1,603 |
| 净变化 | -254 |

这个范围仍包含新的主进程导入、Workbook 和 Prompt 服务，所以净减少不是通过排除新 Host 能力得到的。

## 验证证据

| 层级 | 结果 |
|---|---|
| TypeScript | 11 个 workspace typecheck 全部通过 |
| 根测试 | `1537 pass / 0 fail`（`6890` assertions） |
| Electron Linguist Node | `207/207` |
| CAT Store | `228/228` |
| CAT Tools | `40/40` |
| 边界 / Fusion | `4/4` / `9/9` |
| 依赖与许可 | SBOM 与 432 个生产依赖一致 |
| 当前 `0.16.35` 构建 / 打包 | macOS arm64 packaged artifact integrity 通过 |
| 当前 `0.16.35` Packaged vertical | Agent `15/15`、Chat `19/19`、Linguist `21/21`；Linguist `2 MANUAL`；LF-003 `runStatus=passed`、coverage `partial` |
| 当前 `0.16.35` 本机安装 | `/Applications/Linguist Agent.app` `0.16.35`；`app.asar` SHA-256 `35cbb7dc6643736b29a10e579e5ffc658974960cda7bb76eb2400d6206493261` 与验证产物一致 |

旧 `0.16.34` 位于废纸篓，可恢复。现有 Phrase 私有副本证据仍为 82/82 placeholder segment 配对、713 segments、byte-stable 与 reimport-stable；客户内容未进入仓库，该证据也不等于真实 Phrase 平台互操作。

## 仍需真实证据

- 真实 Phrase / memoQ 平台产物的生成器变体、inline code、状态与审校批注互操作。
- 同模型、同 reasoning 的 Web Chat / 旧 LA / 当前 LA 对照。
- 真实 Provider 驱动四岗位完成翻译 → 全量双语审校 → 目标语校对 → `verified` 交付。
- 真机 IME、VoiceOver、keyboard-only、Native Open/Save、窄窗、拖拽/resize 和 Companion round-trip。
- 从当前可用构建开始的 14 个真实日用日。

上述项目保持 pending / blocked by real evidence。它们不否定本轮实现与自动验证，但会继续阻止将产品标记为 real-machine verified 或 release qualified。
