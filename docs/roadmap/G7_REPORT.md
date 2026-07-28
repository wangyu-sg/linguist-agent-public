# G7 门禁报告：可交付纵向产品（计划 §20 / PB-070~074）

> 日期：2026-07-26　状态：**GATE PASSED**
> 基线 commit：`b1ea513d`（PB-074）
> 硬标准：在打包 Electron 中完成项目创建、导入、项目 Chat 工具读取与 Proposal、人工审核、QA、原生导出、重导入与同数据根重启恢复。

## 1. 结论

G7 通过。结论由两条互补的 packaged run 共同构成：自动探针覆盖项目 Chat、Proposal、QA 与 adapter 路径；macOS 原生文件面板由隔离真机运行完成，不将 CLI 或 picker stub 当作原生 UI 证据。

```text
创建项目 → 导入 XLIFF → 项目 Chat 读取 Segment → Proposal
→ 人工接受 → QA 阻断 → 人工处理/豁免 → 原生 Save
→ 第二项目原生 Open 重导入 → 退出 → 同一数据根重启核验
```

## 2. 环境与隔离

| 项 | 实际值 |
| --- | --- |
| Node / bun | v22.22.2 / 1.3.14 |
| Electron / 应用版本 | 39.5.1 / 0.15.28 |
| 产物 | macOS arm64 未签名 `Linguist Agent.app` |
| 自动模型 | `127.0.0.1` 确定性 fake model；无外部 Provider |
| 自动数据 | 临时 HOME、独立 Electron userData、synthetic XLIFF |
| 原生真机数据 | 另一套临时 HOME、独立 userData、synthetic `mini_game_ui.xliff` |

原生真机为避开 macOS 单实例机制而使用同一 0.15.28 产物的测试副本：只改 bundle identifier 与显示名，并 ad-hoc 重签；`app.asar` 与原产物 SHA-256 完全一致。此前一次未证实隔离性的尝试未计入本报告，以下只记录最终隔离运行。

## 3. Gate 逐项结果

| 检查 | 实际结果 |
| --- | --- |
| `bun run typecheck` | **10/10** 包 exit 0 |
| 根 `bun test` | **681 pass / 2 fail**；仅 PB-003 起既有 pure-Bun Electron named-export 环境失败 |
| `bun run check:boundaries` | **3/3** |
| `cd apps/electron && bun run test:linguist` | **59/59** |
| `cd packages/linguist-cat-store && bun run test` | **74/74** |
| `cd packages/linguist-cat-tools && bun run test` | **17/17** |
| `cd apps/electron && CSC_IDENTITY_AUTO_DISCOVERY=false bun run smoke:pack` | **PASS**；重新生成 0.15.28 未签名产物 |
| `node scripts/smoke/run-g0-smoke.ts` | **18 PASS / 0 FAIL**；Proma 通用回归 |
| `node scripts/smoke/probe-import.ts` | **28 PASS / 0 FAIL**；导入、10k Grid、QA、导出入口与临时根隔离 |
| `node scripts/smoke/probe-cat-tools.ts` | **21 PASS / 0 FAIL**；项目 CAT tools、人工 Proposal Review 与重启恢复 |
| `node scripts/smoke/probe-pb074-e2e.ts` | **11 PASS / 0 FAIL / 2 MANUAL** |
| 原生 Open / Save / 重导入 / 重启 | **PASS**；见下一节 |

## 4. 完整纵向证据

### 自动打包路径

`probe-pb074-e2e.ts` 在真实 packaged Electron 中完成：UI 创建项目、同一项目库导入 7 段 XLIFF、项目 Chat 打开与 preload 消息发送、fake model 调用 `cat_get_segments`。只有从真实 tool result 获取 `id/revision` 后，模型才调用 `cat_propose_translations`。随后人工接受 Proposal，先确认 `EMPTY_TARGET` 阻断导出，再以带原因的 waiver 处理 `REPEATED_PUNCTUATION`，确认 open blocking 为零，并完成 adapter export/reimport 与同 HOME 重启恢复。

原生 Open 与 Save 在此探针中明确输出为两个 `MANUAL`，不计入自动 PASS。

### 隔离原生真机路径

1. 原生 Open 选择 synthetic `mini_game_ui.xliff`，CAT UI 显示 7 段。
2. 人工把 Welcome 段修改为 `欢迎回来，{player}！`，QA 显示 0 条 Finding。
3. 原生 Save 选择新的目标文件 `mini_game_ui_g7.xliff`；输出 SHA-256 为 `50c4fc2835836a101d3ef511ae08240957ee8d340561394a04691bc358ede08a`，源 fixture SHA-256 为 `5a6ce10ce092f16d32734b70d0f7acff051a08a20a2c184842631d420a6d90be`。
4. 创建第二个 CAT 项目，原生 Open 上述输出；UI 显示 7 段，Welcome 段显示相同译文。
5. 真正退出应用，以同一临时 HOME 与 userData 重启；再次进入第二项目 CAT，仍显示 7 段和 `欢迎回来，{player}！`。

## 5. 安全与边界

- 测试不读取旧仓 `data/**`，未使用客户数据、真实 API Key 或真实 Provider。
- Agent 仅创建 Proposal；接受、豁免与实际 Segment 更新均经人工 UI/主进程边界完成。
- QA blocking 在 native Save 打开前执行，阻断时不会进入原生选择器。
- Gate 只新增报告与账本，没有产品代码改动。

## 6. 已知限制

1. fake model 验证工具协议与产品边界，不代表用户实际模型或供应商的输出质量；真实项目应先在副本上小范围验收。
2. 项目 Chat 是由 UI 打开的，但自动消息经 preload IPC 发送；Composer DOM 的输入/发送控件不在本 Gate 覆盖范围。
3. 这是当前 macOS arm64 未签名产物的验证，不构成签名、公证或其他平台发布证明。

## 7. 最终判定

G7 的完整纵向交付链、原生文件交互、重导入和重启恢复均已在隔离环境中实测；自动和手动边界已如实区分。**G7 = GATE PASSED**，可创建 annotated tag `pb-g7-vertical-product`，并开始 PB-080。
