# Linguist Agent 当前核验事实

核验日期：2026-08-06

代码、manifest、测试和真实运行输出优先；本轮实现提交为 `9a5353d2`，位于 `main`。

## Git 与版本

| 项目 | 当前事实 |
|---|---|
| Proma 基线 / formal merge | v0.16.8 `bde00f00` / `f3d2b431` |
| Electron App / Electron | `0.16.16` / `43.2.0` |
| Bun / Pi / Claude | `1.3.14` / `0.82.1` / `0.3.201` |
| Shared | `0.1.83` |
| CAT Core / Formats / Store / Tools | `0.0.14 / 0.0.7 / 0.0.27 / 0.0.21` |
| CAT schema / Tools | `15` / `19` |
| Prompt contracts | Profile `2.1.0` / Quality `1.0.0` / Prompt `1.0.0` / Digest `1.0.0` / Turn Context `1` |

精确基线、257 条触点与偏离分别见 [proma-baseline.json](docs/architecture/proma-baseline.json)、[proma-touchpoints.json](docs/architecture/proma-touchpoints.json) 和 [PROMA_DEVIATIONS.json](docs/architecture/PROMA_DEVIATIONS.json)。

## 已确认实现

- 完整 Proma Agent/Chat 是宿主；Linguist 是第三个并列模式，不复制 Agent、Chat、Session Store 或 Preview。
- 项目下可持续导入多个批次；语言资产是 TM/TB/Style Guide/Context。批次和保留原件的语言资产都走 Proma Preview Tab。
- XLSX 必须显式确认映射；TM/TB 必须先候选、后人工确认；Import Undo 遇到任何下游引用 fail closed。
- 模型只能创建 pending Proposal。人工写 Segment 仍受 CAS、locked、Tag、QA 与术语硬门约束。
- Prompt/Context/Translation Scope 已有单一合同；项目数据在 Pi markdown renderer 中按数据处理，不得改变指令边界。

## 自动验证事实

| 检查 | 结果 | 资格 |
|---|---|---|
| workspace typecheck | 11/11 | unit/build |
| 根测试 | 1481 pass / 0 fail | unit |
| CAT Store / Tools / Formats | 229/229、52/52、158/158 | unit |
| boundary / fusion+prompt+sync | 4/4、15/15 | architecture |
| packaged build / integrity | PASS | packaged |
| G0 packaged mode roundtrip | 19 PASS / 0 FAIL | packaged |
| PB-074 | 21 PASS / 0 FAIL / 2 MANUAL | packaged partial |

Native dialog、真实 IME、Companion roundtrip、VoiceOver/键盘、真实 Provider/格式和 14 天日用仍没有人工证据；产品不具备 release qualification。

## 数据边界

- 正式数据根 `~/.linguist-agent/`，开发根 `~/.linguist-agent-dev/`；smoke 必须使用临时 user-data-dir。
- SQLite 只用于每项目 `cat.db`；通用 Agent/Chat 继续使用配置文件、JSON/JSONL。
- Renderer 和模型不能以任意路径或 projectId 获得 CAT authority。
- 私有语料明细、客户文件、真实 userdata 与恢复产物不得进入 Git。
