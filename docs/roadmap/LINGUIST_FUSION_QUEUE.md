# Linguist Agent v2.1 实施队列

更新时间：2026-08-06

> 唯一 machine queue：[linguist-fusion-queue.json](./linguist-fusion-queue.json)。本页只投影当前可行动状态。

## 已完成的本轮闭环

- Intake Verification 与引用感知 Undo（LA-INTAKE-007）。
- Execution Policy、专业质量合同、Canonical Prompt、预算、Translation Scope、Context cursor/scope（LA-QUALITY-001/002、LA-PROMPT-001/002、LA-TRANS-001、LA-CONTEXT-001/002/003）。
- 私有语料扫描与脱敏格式矩阵（LA-FORMAT-001/002）。
- XLSX 映射确认、SDLXLIFF `mrk` 回写、CSV/JSON detect 置信治理（LA-FORMAT-005/006/007）。
- Proma 上游只读影响报告（LA-UPSYNC-001）。

## 未关闭

| Ticket | 状态 | 还缺什么 |
|---|---|---|
| LA-SYNC-007 | IN_PROGRESS | G0 packaged smoke 19/19 通过；仍缺 Native dialog 与真实 IME 人工证据。 |
| LA-HOST-002 | IN_PROGRESS | 真实机器 Companion Chat roundtrip。 |
| LA-INTAKE-001 | IN_PROGRESS | 当前 Alpha 单文件闭环已完成；目录扫描/持久 Job 只在真实批量阻断后另建 successor。 |
| LA-ALPHA-000 | TODO | 等待上述人工证据。 |
| LA-EVAL-001/003/004 | TODO | 同模型对照、真实 Provider/格式、14 天日用。 |
| LA-DOCS-001 | TODO | Alpha Gate 后的最终产品文案收口。 |
| LA-PHRASE-001 | BLOCKED | 等待真实 split-MXLIFF 样本。 |

`implemented`、`unit verified`、`packaged verified`、`real-machine verified` 与 `release qualified` 始终分开记录。
