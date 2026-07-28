# G6 门禁报告：CAT Workspace（计划 §19 / PB-060~065）

> 日期：2026-07-26　状态：**GATE PASSED**
> 基线 commit：`6364ea75`（PB-065）
> 硬标准：10k fixture 在打包应用中可滚动；Agent Proposal 可在 Grid 审核；同一数据目录重启后状态恢复。

## 1. 结论

G6 通过。macOS arm64 未签名打包应用使用临时 HOME、独立 Electron userData、synthetic fixtures 和本地 fake model 完成两条真实纵向路径：

```text
10k CSV → CAT Grid → 虚拟滚动末行 → Arrow/焦点/编辑/筛选
项目 Agent → pending Proposal → Grid/Rail 人工接受
→ 关闭应用 → 同 HOME 重启 → 已接受译文恢复、pending=0
```

## 2. 环境

| 项 | 实际值 |
| --- | --- |
| Node | v22.22.2 |
| bun | 1.3.14 |
| Electron | 39.5.1；应用版本 0.15.24 |
| 产物 | `apps/electron/out/mac-arm64/Linguist Agent.app` |
| 数据 | mkdtemp HOME + 独立 `--user-data-dir` + synthetic CSV/JSON |
| 模型 | `127.0.0.1` 确定性 fake model；无外部 Provider |

## 3. Gate 逐项结果

| 检查 | 实际结果 |
| --- | --- |
| `bun run typecheck` | **10/10** 包 exit 0 |
| 根 `bun test` | **677 pass / 2 fail**；仅 PB-003 起既有 Bun/Electron 环境失败 |
| `bun run check:boundaries` | **3/3** |
| `cd apps/electron && bun run test:linguist` | **54/54** |
| `cd packages/linguist-cat-store && bun run test` | **71/71** |
| `cd packages/linguist-cat-tools && bun run test` | **16/16** |
| `cd apps/electron && CSC_IDENTITY_AUTO_DISCOVERY=false bun run smoke:pack` | **PASS**；0.15.24 产物 |
| `node scripts/smoke/probe-import.ts` | **24/24**；10k、键盘/a11y、p95 |
| `node scripts/smoke/probe-cat-tools.ts` | **20/20**；Agent Review + 同 HOME 重启 |
| `node scripts/smoke/run-g0-smoke.ts` | **18/18**；Proma 通用回归 |

## 4. G6 硬标准实录

```text
[PASS] cat-10k-virtual-scroll-anchor —
末行=true，DOM rows=13（<80），scroll delta=0.0px

[PASS] cat-10k-search —
20 次打包应用精确搜索均命中=true，p95=62ms（目标≤200ms）

[PASS] g5-human-accept-updates-segment —
Grid marker 清空=true，target=生命药水，revision=1

[PASS] g6-restart-cat-state-recovered —
同 HOME 重启后已接受译文可见=true，pending Proposal=0
```

键盘/无障碍专项同时证明 ArrowUp 将焦点从第 10000 行移动到 9999 行、Enter 进入编辑、Escape 不保存退出、locked 状态和 QA 未运行状态均有文字与读屏标签。

## 5. 数据与安全边界

- Grid 保留 ID 索引和 200 行窗口，不把 10k Segment 全量复制进 renderer atoms。
- Target 编辑与 Proposal 接受均由 SQLite revision CAS 裁决；Agent 不具备 accept/commit/reject 工具。
- 重启验证复用同一临时 HOME，真正关闭并重新启动 packaged Electron，不是组件 remount。
- 未读取旧仓 `data/**`，没有真实用户数据或机器绝对路径进入产物/账本。

## 6. 已知限制

1. QA Finding 的真实规则与查询属于 PB-070/071；“下一个 QA 问题”当前明确禁用，不把空表伪装成 QA 通过。
2. p95 是当前机器、当前未签名产物的一组 20 次端到端样本，不代表所有硬件。
3. fake model 是确定性本地服务；外部 Provider 和网络不属于 G6。
4. 探针首次 channel seed 遇到已知 SecurityAgent safeStorage 弹窗；终止后应用按既有 plaintext 降级，完整运行均退出码 0。

## 7. 最终判定

10k CAT Workspace、Grid 内人工 Proposal Review、持久化重启恢复和 Proma 通用回归全部通过。**G6 = GATE PASSED**。
