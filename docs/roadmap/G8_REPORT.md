# G8 门禁报告：质量与格式扩展（计划 §21 / PB-080~088）

> 日期：2026-07-26　状态：**GATE BLOCKED（自动证据全绿；硬标准待 PB-085 人工盲评）**
> 基线 commit：`2c355aa5`（PB-080 探针文案修正）
> 硬标准：Balanced 必须成为可靠默认；Best 必须有可测收益，不能只更慢。

## 1. 结论

G8 的自动化半边全部通过：Batch 8 八票（PB-080~084 + 用户授权扩围 PB-086~088）全部 integration_verified，打包产物 0.15.36 重新生成，G7 时代全部探针零回归。

硬标准**无法在本轮判定**：它要求对 Fast/Balanced/Best 三档产出做人工盲评（PB-085），而盲评需要真实 API Key 驱动的三档产出 + 用户本人打分，两者都不是自动可伪造的输入。按纪律如实记 BLOCKED，不以 fake model 或自评冒充。

硬标准判定式已预先写死（`docs/release/PB085_BLIND_EVAL_PREP.md` §3）：Balanced 三维均分 ≥4 且 blocking 段占比 ≤10%；Best 相对 Balanced 至少两维 ≥+0.5 或 blocking 占比降 ≥50%。盲评完成后按该式升级为 PASSED 或 FAILED。

## 2. 环境与隔离

| 项 | 实际值 |
| --- | --- |
| Node / bun | v22.22.2 / 1.3.14 |
| Electron / 应用版本 | 39.5.1 / 0.15.36 |
| 产物 | macOS arm64 未签名 `Linguist Agent.app`（`CSC_IDENTITY_AUTO_DISCOVERY=false bun run smoke:pack`） |
| 模型 | 自动验证全部使用 `127.0.0.1` 确定性 fake model；无外部 Provider、无真实 API Key |
| 数据 | 探针各自临时 HOME 与独立 userData；合成 fixture；不读旧仓 `data/**` |

## 3. Gate 逐项结果

| 检查 | 实际结果 |
| --- | --- |
| `bun run typecheck` | **10/10** 包 exit 0 |
| 根 `bun test` | **787 pass / 2 fail**；仅 PB-003 起既有 pure-Bun Electron named-export 环境失败 |
| `bun run check:boundaries` | **3/3** |
| `bun test packages/linguist-cat-{core,store,tools}` | **81/81** |
| `cd packages/linguist-cat-store && bun run test` | **92/92**（node --test 层） |
| `cd packages/linguist-cat-tools && bun run test` | **26/26**（node --test 层） |
| `cd apps/electron && bun run test:linguist` | **67/67** |
| `bun test apps/electron/src/renderer/features/linguist/projects` | **41/41** |
| `cd apps/electron && CSC_IDENTITY_AUTO_DISCOVERY=false bun run smoke:pack` | **PASS**；重新生成 0.15.36 未签名产物 |
| `node scripts/smoke/run-g0-smoke.ts` | **18 PASS / 0 FAIL**（Proma 通用回归） |
| `node scripts/smoke/probe-import.ts` | **28 PASS / 0 FAIL**（修正一处 PB-080 空态文案过时断言后，见 §5） |
| `node scripts/smoke/probe-cat-tools.ts` | **21 PASS / 0 FAIL** |
| `node scripts/smoke/probe-pb074-e2e.ts` | **11 PASS / 0 FAIL / 2 MANUAL**（G7 纵向链零回归；2 MANUAL 为原生 Open/Save，同 G7 口径） |
| PB-085 人工盲评（硬标准） | **BLOCKED**：需真实 API Key 产出三档译文 + 用户人工打分；备料（双批 fixture 各 30 段、协议、指标、判定式）已提交 `c5900116` |

## 4. Batch 8 票级状态

| 票 | 内容 | 状态 | resultCommit |
| --- | --- | --- | --- |
| PB-080 | TM/TB 管理（TMX/CSV/TBX 导入、exact/fuzzy 检索、Reference UI、Context Rail 真实匹配） | integration_verified | `176006a2` |
| PB-081 | XLSX adapter（字节稳定往返） | integration_verified | `f0806c5e` |
| PB-082 | 质量策略档 Fast/Balanced/Best（project.json 字段、Skill 注入矩阵、评审会话编排；刻意不做 Router） | integration_verified | `ac6f8774` |
| PB-083 | Independent Critic（契约、schema v5、第九工具、评审 Skill） | integration_verified | `4854c863` |
| PB-084 | Batch Consistency（7 码投影、第十工具 check-only/repair，repair 走 Proposal 人审链） | integration_verified | `7ab2af48` |
| PB-085 | 人工盲评 | **blocked**（备料 `c5900116` 已提交；执行待真实 API Key + 用户打分） | — |
| PB-086 | Trados SDLXLIFF adapter（用户 2026-07-26 授权扩围） | integration_verified | `13139218` |
| PB-087 | Phrase MXLIFF adapter（同上） | integration_verified | `4d39e888` |
| PB-088 | Phrase bilingual DOCX adapter（同上） | integration_verified | `894d44f7` |

## 5. 安全与边界

- 测试不读取旧仓 `data/**`；未使用客户数据、真实 API Key 或真实 Provider。
- Batch 8 不改写段路径：PB-083 评审只产 Finding，PB-084 repair 只产 pending Proposal，均经人工审核链。
- 探针修正一处（`2c355aa5`）：probe-import 的 Context Rail 空态断言仍匹配 PB-063 时代静态占位文案（"当前项目暂无 TM 匹配"），PB-080 将该 Tab 实现为真实匹配渲染并改文案为"当前片段没有 TM 匹配"；属测试追平产品既有行为，非产品回归。首轮 27/1 与修正后 28/28 均如实记录。
- 本 Gate 只新增报告与账本，另含上述一处探针文案修正，没有产品代码改动。

## 6. 已知限制

1. **硬标准未判定**：Balanced 可靠默认与 Best 可测收益均需 PB-085 盲评数据；fake model 不验证模型产出质量。盲评协议、双批 fixture（各 30 段，含术语陷阱/重复源文/角色名/占位符/语气分化）与判定式已备妥。
2. PB-082 策略档只改 guidance（批次/查库/评审要求），不切模型参数；评审发起为人工按钮，无自动 critic 编排。
3. PB-086~088 真实客户格式兼容性仅以合成 fixture 验证（真实样本需用户提供脱敏版）。
4. 仅验证当前 macOS arm64 未签名产物；签名、公证与其他平台留 Batch 11。
5. PB-089（CAT 资产源文件预览，用户授权的 Proma 预览栈融合）已立项未施工，不属 G8 判定项。

## 7. 最终判定

自动化门禁全绿、Batch 8 代码票全部集成验证；但 G8 硬标准（Balanced 可靠默认、Best 可测收益）在缺少 PB-085 人工盲评数据时不可判定，如实记 **GATE BLOCKED**。创建 annotated tag `pb-g8-quality-strategies` 标记 Batch 8 代码状态；PB-085 完成后按预备判定式复核并更新本报告结论。Batch 9（Legacy 迁移，PB-090 起）与质量档无技术依赖，按计划继续推进。
