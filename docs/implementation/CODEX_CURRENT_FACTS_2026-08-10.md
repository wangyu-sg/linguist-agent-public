# Codex 当前事实（2026-08-10）

本文件记录 Proma v0.16.10 同步前的最小可复核基线。事实来源仅为当前 Git、清单、代码与本轮本机测试；没有读取或修改真实用户项目。

## Git

- HEAD：`aa3b8520bde74a14d6e68c01c0c94135ac7fec48`（`main`，与 `origin/main` 一致）。
- 工作树：开始实施时 clean。
- 保护标签：`pre-proma-0.16.10-20260810`。
- `origin`：`https://github.com/wangyu-sg/linguist-agent-public.git`。
- `upstream`：`https://github.com/proma-ai/Proma`。
- 当前 Proma baseline：`v0.16.9` / `d08179d9b6e84a5ac8e33a7d70fc2e12dfde21cf`。
- 已核验目标：`v0.16.10` / `72fd1b1a474ab0375b9c126d11d3c7c4c8ed538a`。

## 固定版本

| 项目 | 当前值 |
|---|---|
| Bun | `1.3.14` |
| Electron App | `0.16.21` |
| Shared | `0.1.86` |
| CAT Core | `0.0.15` |
| CAT Formats | `0.0.9` |
| CAT Store | `0.0.29` |
| CAT Tools | `0.0.24` |

## 合并前测试

- `bun run typecheck`：通过。
- `bun test`：`1479 pass / 0 fail`。
- `bun run check:boundaries`：`4 pass / 0 fail`。
- `node --test tests/linguist-fusion-architecture.test.mjs`：`9 pass / 0 fail`。
- `bun run --filter='@proma/electron' test:linguist`：`181 pass / 0 fail`。
- `bun run --filter='@linguist/cat-tools' test`：`36 pass / 0 fail`。

## 关键文件与调用关系

| 文件 | 行数 | 当前职责 / 调用关系 |
|---|---:|---|
| `apps/electron/src/main/lib/linguist/prompt-contract.ts` | 877 | `project-assets-prompt.ts` 调用 `buildLinguistPromptContract()`；保存分层合同、预算、hash 与降级状态。 |
| `apps/electron/src/main/lib/linguist/prompt-renderer.ts` | 61 | 接收 Prompt Contract，渲染 XML / Markdown。 |
| `apps/electron/src/main/lib/linguist/project-assets-prompt.ts` | 133 | `agent-orchestrator.ts` 与 `diagnostics-ipc.ts` 调用；串联 contract 与 renderer。 |
| `apps/electron/src/main/lib/linguist/session-cat-tools.ts` | 458 | `agent-orchestrator.ts` 解析绑定并装配 CAT tools；`assets-ipc.ts`、`proposal-ipc.ts` 复用其中部分导入/导出辅助。 |
| `packages/linguist-cat-tools/src/factory.ts` | 65 | 装配当前 20 个 CAT tools。 |
| `packages/linguist-cat-tools/src/tool-runtime.ts` | 128 | 集中 Session authority、通知、Provenance 与工具结果投影。 |

已确认的缺口：没有 `cat_apply_translations`、术语 CRUD/验证工具、Workbook Mapping 工具或 Voice/Exemplar Agent 工具；未知 Tag 扫描存在，但导入后不会自动触发。`LinguistProjectService` 已拆出 `project-resources.ts`、`project-quality.ts` 与 `project-delivery.ts`，后续应复用这些现有 seam，而不是再造服务层。
