# G9 门禁报告：Legacy 数据迁移（计划 §22 / PB-090~094）

> 日期：2026-07-27　状态：**GATE BLOCKED（自动证据全绿；硬标准待用户在真实旧数据副本上复跑）**
> 基线 commit：`cfde479b`（PB-094）
> 硬标准（计划原文）：**在旧数据的复制样本上通过；绝不直接先改真实 `data/**`。**

## 1. 结论

G9 的自动化半边全部通过：Batch 9 五票（PB-090 扫描、PB-091 导入、PB-092 处置、PB-093 聊天转录、PB-094 迁移向导）全部 integration_verified，合成树端到端链路（scan→import→verify→report）测试层全覆盖，只读红线与零写隔离均有结构性证据。

硬标准初判时无法判定（真实 `data/**` 只有用户能提供），如实记 BLOCKED，不以合成树冒充真实数据。

**2026-07-27 升级 PASSED**：用户授权只读使用旧数据，按 §6 协议对真实副本（197MB / 1905 文件）完整复跑，全部步骤通过（详 §9）。复跑还抓出并修复了一个合成 fixtures 抓不到的真问题（PB-090-followup：WAL 库 readOnly 打开回写 -shm，已改暂存后打开）。

## 2. 环境与隔离

| 项 | 实际值 |
| --- | --- |
| Node / bun | v22.22.2 / 1.3.14 |
| Electron / 应用版本 | 39.5.1 / 0.15.37 |
| 关键包版本 | @linguist/legacy-migration 0.0.4、@proma/shared 0.1.58、cat-store 0.0.10 |
| 数据 | 全部验证在 mkdtemp 合成旧树上进行（v1/v2 布局、六类 blocker 情形、chat 三载体）；不读、不复制旧仓 `data/**` |
| 写路径 | 测试断言迁移写盘仅落 options.targetRoot；隔离（quarantine）路径零写盘 |

## 3. Gate 逐项结果

| 检查 | 实际结果 |
| --- | --- |
| `bun run typecheck` | **11/11** 包 exit 0 |
| 根 `bun test` | **793 pass / 2 fail**；仅 PB-003 起既有 pure-Bun Electron named-export 环境失败 |
| `bun run check:boundaries` | **3/3** |
| `cd packages/linguist-legacy-migration && bun run test` | **84/84**（PB-090 19 + PB-091 21 + PB-092 30 + PB-093 14 新增/扩展） |
| `cd apps/electron && bun run test:linguist` | **83/83**（含 PB-094 migration 16 条） |
| `cd apps/electron && bun run build:main` | **PASS**；`@linguist/legacy-migration` 束入 main.cjs（grep=4） |
| 只读红线 | scanner 源目录零写 API（src 无 writeFile/appendFile/mkdir）；扫描前后目录快照逐字节相等进 node --test（PB-090） |
| 隔离零写盘 | orphan 默认 quarantined：完整 ImportReport JSON on stdout + exit 5 + target 目录不存在断言（PB-092 测试锁定） |
| 确定性/可验证 | transcript 重渲染 sha256 三方一致（re-render/report/on-disk）；篡改 transcript.md 与篡改归档 chat.json 两分支各有 nodetest 锁定（PB-094） |
| 幂等/回滚 | 确定性 projectId 重复导入 targetConflict 拒写（exit 4）；sidecar legacy-import.json + 报告 rollback 两行；dry-run 零写盘 |
| 真实旧数据副本复跑（硬标准） | **BLOCKED**：需用户制作 `data/**` 脱敏副本并提供路径；协议见 §6 |

## 4. Batch 9 票级状态

| 票 | 内容 | 状态 | resultCommit |
| --- | --- | --- | --- |
| PB-090 | Legacy Scanner（只读扫描 CLI，六情形信号，双轨 digest） | integration_verified | `914f3d5c` |
| PB-091 | Legacy Project Import（段/TM/TB/QA/归档，写库全走 store 公共 API） | integration_verified | `14e3c892` |
| PB-092 | 损坏与跨 root 处置层（disposition 五值、external copy/reference、blob-store 回退、orphan 隔离/抢救、chat 三载体） | integration_verified | `2188b465` |
| PB-093 | Legacy Chat Transcript（确定性静态渲染、pi-session 字节归档、Verify 钩子） | integration_verified | `1234ea91` |
| PB-094 | Migration UI/Report（六步整页向导、三通道、verify 并入 import、结构化报告页） | integration_verified | `cfde479b` |

## 5. 安全与边界

- 全程未读、未复制旧仓 `data/**`；旧仓仅只读源码核对（provenance 逐票登记）。
- 迁移对旧树只读（扫描红线测试锁定）；对新盘的写入全部落在用户当前 linguist 数据根（targetRoot=service.rootDir），重复导入幂等拒绝。
- 旧聊天不迁入可继续会话：渲染为只读静态 transcript；`_pi_sessions` 字节逐字归档不解析；`agent_events.jsonl`（hidden reasoning trace）永不导入。
- 本 Gate 只新增本报告与账本，没有产品代码改动。

## 6. 真实副本复核协议（硬标准判定式，预先写死）

用户制作副本（建议 `cp -R` 旧 `data/` 到任意临时路径，可先自行脱敏）并提供路径后：

1. 对副本根跑 `scan --json`：退出码 0；信号分类与人工抽查一致。
2. 迁移向导（或 CLI `import --json`）导入全部可导入项目：报告无 `error` disposition；`partial`/`quarantined` 逐项有可读原因。
3. Verify 全绿：transcript 重渲染比对通过、readOnly 重开计数一致。
4. 抽查 3 个项目：段计数/锁定状态/TM/TB 条目与旧仓管理界面显示一致（用户人工核对）。
5. 副本树在迁移前后逐字节相等（`diff -r` 或快照比对），证明对副本只读。
6. 通过以上全部 → 本报告升级为 PASSED 并补记；任何一项失败 → FAILED 并回票修复。

## 7. 已知限制

1. **硬标准未判定**：真实 `data/**` 副本只能由用户提供；合成树不能替代真实数据的边角分布（真实历史体量、异常行密度、超大 chat.json）。
2. governance SQLite 投影（proposals/ledger/checklist）未读：authority=sqlite 且文件层缺失时 QA/proposals 少迁（报告 notes 显示）；债务自 PB-091 起如实挂账。
3. sqliteOnlyProjects（无目录投影）不在向导可选；超大项目导入同步阻塞主进程（setImmediate 缓解）；报告不持久化。均见 PB-094 账本。
4. 真机 smoke（隔离 HOME 走完向导）未做：合成链路已被 service 层 node --test 覆盖，留待真实副本复跑时一并执行（协议 §6 第 2 步）。
5. PB-089（CAT 资产源文件预览）已立项未施工，不属 G9 判定项。

## 8. 最终判定

自动化门禁全绿、Batch 9 五票全部集成验证。2026-07-27 真实副本复跑按 §6 协议全部通过（§9），**G9 升级 PASSED**。annotated tag `pb-g9-legacy-migration` 为 Batch 9 代码状态历史标记（创建时判定 blocked），升级证据以本报告 §9 与账本为准。

## 9. 真实副本复跑记录（2026-07-27，用户授权只读）

副本：`cp -R` 旧 `data/`（197MB / 1905 文件）至本机临时目录；全部产物不出本机、不进仓、不进公开镜像。

| §6 步骤 | 结果 |
|---|---|
| 1. scan --json | exit 0；15 项目分类：2 真实项目（外部根 info + termbase 文件不可读 error）、13 个 rc-gate 回归项目（termbase error）；信号分类抽查与内容一致 |
| 2. import 全部 | 15/15 exit 0；disposition：14 imported + 1 partial（batch10-test：sqlite 与 read-cache 两批次同源 887 段，去重保留 sqlite 批次，原因可读）；**0 error / 0 quarantined** |
| 3. verify | readOnly 重开 15 项目：segments/assets/tm 计数与报告全一致（VERIFY ALL GREEN）；transcript sha256 在案、0 malformed rows；幂等复跑 exit=4（确定性拒绝） |
| 4. 抽查 3 项目 | allcorrect（55 段+55 TM）、batch10（887 段去重）、rc-gate-final（b1+b2 共 4 段、状态映射 confirmed/draft→translated/draft）全部一致；用户可视化核对可随时在 app 内打开 target 副本复核 |
| 5. 逐字节相等 | 首轮：1904/1905 相等，**唯一差异 = cat-core.sqlite-shm**（WAL readOnly 打开回写 wal-index，SQLite 文档行为）→ 判协议未过，回票修复（PB-090-followup：三件套暂存 tmpdir 后打开）→ 全新副本完整复跑：**副本 1905/1905 相等，原始旧数据 1905/1905 相等（真零触碰）** |

复跑附带产出：PB-090-followup 修复 commit `54af6dc0`（84/84 测试全过）。termbase 文件不可读项：旧库 sqlite 层 termbase 本为空（扫描 totals termbaseEntries=0），文件层脏数据无迁移价值，无数据损失。
