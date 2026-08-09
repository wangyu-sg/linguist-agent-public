# Proma Core Touchpoints — v0.16.10 基线

> 基线：v0.16.10 / 72fd1b1a474ab0375b9c126d11d3c7c4c8ed538a
> 正式 merge：ea26177f36d59bd2781d7ff9264451a8430e2249
> 机读真源：[proma-touchpoints.json](./proma-touchpoints.json)
> 强制测试：tests/upstream-boundary.test.ts（bun run check:boundaries）

此文件是当前账本的简明说明；逐文件列表只保留在机读 JSON，避免手写两份会漂移的清单。旧 v0.15.11 快照已归档到 [docs/archive/PROMA_CORE_TOUCHPOINTS-v0.15.11-702a8221.md](../archive/PROMA_CORE_TOUCHPOINTS-v0.15.11-702a8221.md)。

## 重算结果

| 集合 | 路径数 | 依据 |
|---|---:|---|
| formal merge 相对 Proma v0.16.10 的全部变动 | 808 | git diff --name-only 72fd1b1a...ea26177f |
| 允许路径 | 549 | 机读账本的 allowedNewPaths |
| 仅公开路径占位符替换 | 4 | boundary test 的精确内容规则 |
| 当前账本 | 255 | 其余 Proma 核心差异逐文件登记 |

v0.16.10 已删除旧的独立 Agent Island BrowserWindow，本地对应触点随之退役；原生 Island 能力继续复用上游实现。其余差异继续按 Permanent Product Fork、Local Host Seam、Linguist Extension 与 Temporary Deviation 分类；精确路径和理由只维护在机读账本中。

## 规则

1. 新的 Linguist 领域代码优先进入以下允许根：apps/electron/src/renderer/features/linguist/、apps/electron/src/main/lib/linguist/、packages/linguist-*、resources/linguist-skills/、resources/linguist-roles/、docs/ 和 tests/。apps/electron/src/renderer/host/ 仅用于静态本地 Host Contract 与 composition root。
2. 跨出允许根的 Proma 文件必须在同一变更中写入 proma-touchpoints.json，并给出具体 ticket 与原因。登记了但已不再相对基线变动的条目同样是错误。
3. apps/electron/src/renderer/lib/linguist-build-metadata.ts 是精确 renderer-lib 例外：它只提供 About 与 Linguist Diagnostics 共用的不可变 build metadata，不承载 Agent 或 CAT 行为。
4. tests/upstream-boundary.test.ts 同时比较基线至 HEAD、tracked 工作树与 untracked 文件；提交前即可验证将要交付的真实树，提交/推送前仍须重新运行。
5. 偏离的产品语义、分类和 sunset 在 [PROMA_DEVIATIONS.md](./PROMA_DEVIATIONS.md) / [PROMA_DEVIATIONS.json](./PROMA_DEVIATIONS.json) 中维护。不要把“已登记”误解为“永久合理”。

## 当前分类

| 分类 | 处理原则 | Sunset |
|---|---|---|
| Permanent Product Fork | 产品身份、独立数据根、资源和打包可以与上游长期不同。 | 产品仍是 Linguist Agent 时无计划移除。 |
| Local Host Seam | 只在本 fork 的窄 composition / session / IPC 缝中接入垂直能力。 | 上游出现等价、稳定且不破坏权限模型的 Host Contract 后复核。 |
| Linguist Extension | CAT 领域和 Workbench 保持在允许的 Linguist 根，不反向侵入 Proma Core。 | 产品仍提供 CAT 时保留。 |
| Temporary Deviation | 目前仅 Pi compaction continuation context preservation。 | 上游提供等价 host-owned continuation hook 后移除；下次上游同步强制复核。 |

## 维护顺序

    更新 Proma baseline
      → 以实际 Git diff 重算 JSON
      → 删除 stale 条目
      → 更新 deviations / sunset
      → 运行 boundary + fusion tests

不要手工复制旧票号或扩大白名单来掩盖核心改动。
