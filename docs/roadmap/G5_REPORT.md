# G5 门禁报告：Translation Proposal（计划 §18 / PB-050~054）

> 日期：2026-07-26　状态：**GATE PASSED**
> 基线 commit：`cd9dc5a9`（PB-054）
> 硬标准：Agent 在打包 Electron 中创建 Proposal；只有用户在 Proposal Inbox 接受后 Segment 才更新；Agent 不得拥有 accept/commit 能力。

## 1. 结论

G5 通过。当前 macOS arm64 未签名打包应用在临时 HOME、临时 Electron userData 和 synthetic JSON 项目中完成真实纵向路径：

```text
项目会话 → cat_propose_translations → pending Proposal
→ Project「建议」页显示 source/current/proposed/diff
→ 用户点击「接受」
→ Segment target 变为「生命药水」，revision 0 → 1
```

模型收到的项目工具中没有名称匹配 accept/commit/reject 的工具。Proposal 创建前后由真实项目 `cat.db` 校验；Agent 未直接写 Segment。

## 2. 环境

| 项 | 实际值 |
| --- | --- |
| Node | v22.22.2（Playwright / node:sqlite 探针均用 node） |
| bun | 1.3.14 |
| Electron | 39.5.1；应用版本 0.15.18 |
| 产物 | `apps/electron/out/mac-arm64/Linguist Agent.app` |
| 数据 | mkdtemp HOME + 独立 `--user-data-dir` + synthetic `mini_items.json` |
| 模型 | `127.0.0.1` 确定性 fake model；无外部 Provider |

## 3. Gate 逐项结果

| 检查 | 实际结果 |
| --- | --- |
| `bun run typecheck` | **10/10** 包 exit 0 |
| 根 `bun test` | **668 pass / 2 fail**；仅 PB-003 起既有纯 Bun `electron` 命名导入环境失败 |
| `bun run check:boundaries` | **3/3** |
| `cd apps/electron && bun run test:linguist` | **50/50** |
| `cd packages/linguist-cat-store && bun run test` | **71/71**；真实 node:sqlite |
| `cd packages/linguist-cat-tools && bun run test` | **16/16**；Proposal-only 写入、50 上限、locked/CAS/硬规则、无人工审核工具 |
| `cd apps/electron && CSC_IDENTITY_AUTO_DISCOVERY=false bun run smoke:pack` | **PASS**；0.15.18 产物 |
| `node scripts/smoke/run-g0-smoke.ts` | **18/18**；text/thinking/tool、429、context error、Stop、持久化与重启 |
| 历史 CAT Tools packaged 探针（已退役） | **17/17**；含 G5 三项纵向断言 |

## 4. G5 硬标准实录

```text
[PASS] g5-agent-creates-proposal-only —
tool=true，result 含 proposalId=true，final=true，Agent accept/commit/reject tools=0

[PASS] g5-proposal-inbox-visible —
建议译文=true，源文=true

[PASS] g5-human-accept-updates-segment —
Inbox 清空=true，target=生命药水，revision=1
```

同一探针还证明普通 Chat 不含任何 `cat_*` 工具、项目会话 resume 保留六个 CAT 工具、会话与项目索引只写临时 HOME。

## 5. 安全与一致性

- Proposal Tool 一次最多 50；unknown、locked、stale revision、空 target 和确定性格式/术语硬规则均在写入前拒绝。
- Agent 写入 pending Proposal，不写 Segment；人工接受仍由 PB-053 的 expected revision + idempotency key + SQLite transaction 裁决。
- 真实 Segment 在人工点击前保持 revision 0；点击后才变为 revision 1。
- 未新增 accept/commit/reject Agent Tool。
- 不读取旧仓 `data/**`，不复制真实用户数据。

## 6. 已知限制

1. fake model 是确定性本地服务；外部 Provider、网络和供应商行为不属于 G5。
2. Inbox 当前按计划提供单项 accept/reject/edit；批量 Review 留 PB-064。
3. 差异视图使用 Unicode 安全的共同前后缀，适合短译文的单处替换；不是通用最短编辑脚本。
4. 两个打包探针首次 channel seed 均遇到已知 macOS SecurityAgent safeStorage 弹窗；终止弹窗后应用按既有 plaintext 降级，完整运行退出码均为 0。

## 7. 最终判定

打包 Electron 中的 Proposal 创建、人工审核与 Segment CAS 更新主链通过，Agent 没有 Commit 能力，通用 Agent 回归未退步。**G5 = GATE PASSED**。
