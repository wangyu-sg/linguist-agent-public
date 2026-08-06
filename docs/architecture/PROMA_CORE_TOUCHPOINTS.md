# Proma Core Touchpoints — v0.16.8 基线

> 基线：v0.16.8 / bde00f00323d6735a939d14dbce3b2f1a5b672bc
> 正式 merge：f3d2b431996523a4aa75ec2b027dcf0e932ef08f
> 机读真源：[proma-touchpoints.json](./proma-touchpoints.json)
> 强制测试：tests/upstream-boundary.test.ts（bun run check:boundaries）

此文件是当前账本的简明说明；逐文件列表只保留在机读 JSON，避免手写两份会漂移的清单。旧 v0.15.11 快照已归档到 [docs/archive/PROMA_CORE_TOUCHPOINTS-v0.15.11-702a8221.md](../archive/PROMA_CORE_TOUCHPOINTS-v0.15.11-702a8221.md)。

## 重算结果

| 集合 | 路径数 | 依据 |
|---|---:|---|
| formal merge 相对 Proma v0.16.8 的全部变动 | 766 | git diff --name-only bde00f0...f3d2b431 |
| 允许路径 | 514 | 机读账本的 allowedNewPaths |
| formal merge 中必须登记的 Proma 核心触点 | 252 | git diff 与当时账本 |
| 当前账本 | 257 | formal merge 后新增 13 个必要触点，并退役 8 个非必要通用 UI 触点 |

formal merge 触点按同步票归组：LA-SYNC-003 的 Local Host Seam 为 75 条、Temporary Deviation 为 1 条；LA-SYNC-004 的 Local Host Seam 为 147 条；LA-SYNC-005 的 Permanent Product Fork 为 29 条。其后新增 13 个必要触点；本轮退役长会话窗口、模型分隔器、ScrollMinimap 支线与冗余 Feature Flags 共 8 个通用 UI 触点，当前总数为 257。权限作用域摘要继续保留，用于在授权前显示文字风险等级与实际操作范围。

## 规则

1. 新的 Linguist 领域代码优先进入以下允许根：apps/electron/src/renderer/features/linguist/、apps/electron/src/main/lib/linguist/、packages/linguist-*、resources/linguist-skills/、docs/ 和 tests/。apps/electron/src/renderer/host/ 仅用于静态本地 Host Contract 与 composition root。
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
