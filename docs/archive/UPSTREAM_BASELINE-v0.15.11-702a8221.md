# Upstream Baseline — Proma

> **工单**：PB-001（创建 Proma 衍生新仓），《Linguist Agent：基于 Proma 的产品重建执行计划》v1.0（2026-07-25）
> **记录时间**：2026-07-25
> 本文件固定新产品的 upstream 基线。按计划 §11.3，在完成完整 CAT Vertical Slice 之前**不追 Proma main**；之后按里程碑同步。

## 基线事实

| 项 | 值 |
|---|---|
| upstream URL | `https://github.com/proma-ai/Proma` |
| baseline SHA | `702a8221bdeb6f3db7dc514b8e93e2a5a52f68df`（`fix(preview): show 200 Excel rows per sheet (#1294)`） |
| git describe | `v0.15.11-1-g702a8221`（HEAD 在 tag `v0.15.11` 之后 1 个 commit） |
| 最近 tag | `v0.15.11`（2026-07-23，`feat(agent): Git/PR 推广标识 Made-with: Proma (#1275)`） |
| Proma version | `0.15.11`（`apps/electron/package.json` 的 `@proma/electron` version；根 `package.json` 为 `0.1.0` 占位） |
| Electron version | 声明 `^39.5.1`，bun.lock 解析 `39.5.1`（`apps/electron`） |
| Pi version | `0.80.9`（`@earendil-works/pi-agent-core` / `pi-ai` / `pi-coding-agent` / `pi-tui`，根 `package.json` overrides 锁定；`pi-ai@0.80.9` 带本地 patch `patches/@earendil-works%2Fpi-ai@0.80.9.patch`） |
| Claude Agent SDK | `0.3.201`（overrides 锁定；D-002：第一版仅隐藏入口，不删代码） |
| Bun version | 仓库未 pin（无 `packageManager` 字段、无 `.bun-version`）；`bun.lock` `lockfileVersion: 1`。**本机当前未安装 bun**（`command -v bun` 不存在），为 PB-003 前置待办 |
| LICENSE | AGPL-3.0，`LICENSE` 文件 SHA-256：`0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0` |

## Remote 布局

```text
upstream → https://github.com/proma-ai/Proma   （只读基线来源）
origin   → 待办：用户私人远端尚未准备，未配置、不伪造（计划 PB-001 第 4 条）
```

## 分支布局

```text
main → 产品主线（计划 §11.2）。即 upstream 默认分支，本票在其上记录基线文档，不改任何代码。
```

## 当前测试 / 构建命令（根 `package.json`，实际结果留待 PB-003/PB-004 验证）

```bash
bun install --frozen-lockfile
bun run typecheck        # bun run --filter='*' typecheck
bun test
bun run electron:build   # @proma/electron: esbuild main+preload、vite renderer、cli、resources
bun run electron:dev     # 开发启动（vite + electronmon）
```

## 边界声明

- 本票未修改任何产品代码，仅新增 `docs/` 文档与账本；
- 未执行 `bun install` / typecheck / test / 打包（属 PB-003 / PB-004）；
- 未配置 `origin`（私人远端待办）；
- 未 push 任何内容。
