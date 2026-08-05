# G4 门禁报告：CAT Tool 与 Skill 接入 Pi（计划 §17 / PB-040~044）

> 日期：2026-07-26　状态：**GATE PASSED**
> 基线 commit：`c5d878b9`（PB-044）
> 硬标准：Project Chat 在打包 Electron 中完成「总结这个项目 → `cat_project_summary` → tool result → 流式 final」，不接受仅 Adapter unit test。

## 1. 结论

G4 通过。`smoke:pack` 产出的真实 macOS arm64 `.app` 在临时 HOME 下完成 Project Skill 注入、项目绑定、真实 CAT store 读取、Pi `customTools` 调用、tool result 回传与多 chunk final。普通 Chat 不含 CAT 工具，resume 后仍绑定原项目；通用 Tool/Stop/Retry/重启恢复无回归。

## 2. 环境

| 项 | 实际值 |
| --- | --- |
| Node | v22.22.2（所有 Playwright / node:sqlite 探针均用 node） |
| bun | 1.3.14 |
| Electron | 39.5.1；应用版本 0.15.14 |
| 产物 | `apps/electron/out/mac-arm64/Linguist Agent.app` |
| 数据 | 每个探针独立 mkdtemp HOME + synthetic fixtures；均有 temp-home-isolation 断言 |
| 模型 | 探针内 `127.0.0.1` fake model server；无外部 Provider |

## 3. Gate 逐项结果

| 检查 | 实际结果 |
| --- | --- |
| `bun run typecheck` | **10/10** 包 exit 0 |
| 根 `bun test` | **658 pass / 2 fail**；两条为 PB-003 起既有纯 Bun `electron` 命名导入环境失败，未增加 |
| `bun run check:boundaries` | **3/3** |
| `cd apps/electron && bun run test:linguist` | **49/49** |
| `cd packages/linguist-cat-tools && bun run test` | **14/14**；含真实 CatStore、错误矩阵、无绝对路径、10k 分页 |
| `cd apps/electron && CSC_IDENTITY_AUTO_DISCOVERY=false bun run smoke:pack` | **PASS**；PB-044 的 0.15.14 产物 |
| 历史 Project Skill packaged 探针（已退役） | **10/10**；项目会话首发/resume 有 Skill，普通会话无 |
| 历史 Project Session packaged 探针（已退役） | **17/17**；绑定冻结、归档主进程阻断、重启 missing 降级 |
| `node scripts/smoke/run-g0-smoke.ts` | **18/18**；text/thinking/tool、429 retry、context error、Stop、持久化与重启 |
| 历史 CAT Tools packaged 探针（已退役） | **14/14**；五个 CAT 工具、真实工具结果、活动事件、resume、普通会话隔离及 G4 精确脚本 |

## 4. G4 硬标准实录

```text
[PASS] g4-project-summary-roundtrip —
用户「总结这个项目」
→ cat_project_summary=true
→ tool result 含项目名=true
→ 流式 final=true（text events=5，complete=true）
```

同一探针还证明：

- 项目会话首发向模型广告恰好 5 个 `cat_*` 工具；
- `cat_get_segments` 从临时项目真实读取 `Health Potion`，结果经 `role:"tool"` 回送模型；
- `onAgentStreamEvent` 收到 `tool_use`；
- resume 请求仍含 5 个 CAT 工具；
- 普通会话 22 个工具中不含任何 `cat_*`。

## 5. Hermetic 与环境事件

- 所有探针使用独立临时 HOME、临时项目和 synthetic fixture，不读取旧仓 `data/**`，不触碰真实 `~/.proma`。
- 首次 Gate 尝试发现一条更早遗留的 `/tmp/pb042-head-check` shell 循环持续启动旧 App/探针，抢占 Electron single-instance；终止该父进程和子进程后重新执行，全部有效结果通过。
- 每个新临时 HOME 首次 seed channel 会触发本机 `SecurityAgent` safeStorage 弹窗；按 PB-030 起既有处置终止弹窗，使应用回落 plaintext。该环境事件逐次记录，不计作产品通过证据；最终结果均来自清理后完整退出码 0 的探针。

## 6. 已知限制

1. fake model 是确定性本地服务；外部 Provider、网络和供应商限流不属于 G4。
2. Project Skill 正文仍由模型按需读取；Gate 证明 `<available_skills>` 到达模型，并不把正文强制内联每轮。
3. CAT 写能力未在本 Gate 范围：Proposal/QA/export 分别由后续 Batch 提供；Agent accept/commit 工具仍严格不存在。

## 7. 最终判定

打包 Electron 的 G4 主链和所有必要回归均通过，测试基线未劣化。**G4 = GATE PASSED**。
