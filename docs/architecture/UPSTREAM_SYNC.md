# Upstream Sync Policy — Proma 同步策略与演练记录

> **工单**：PB-112（Proma Upstream Sync Rehearsal），《Linguist Agent：基于 Proma 的产品重建执行计划》v1.0 §24
> **首次演练**：2026-07-27（G10 之后）
> 本文件是 PB-112 要求的「documented policy」本体 + 首次演练记录。后续每次同步演练在本文件追加一节。

## 1. 同步策略（固定）

- **基线**：`702a8221bdeb6f3db7dc514b8e93e2a5a52f68df`（v0.15.11-1，见 UPSTREAM_BASELINE.md）。
- **节奏**：按计划 §11.3，里程碑后同步（G7/G10 已达成，本票为首次）；不追 Proma main 的每个 commit。
- **remote**：`upstream → https://github.com/proma-ai/Proma`（只读基线来源；不 push）。
- **冲突解决纪律**：只允许在 `docs/architecture/proma-touchpoints.json` 登记过的触点文件内解冲突；任何**未登记文件**出现冲突 = 边界失守信号，优先调整 LA 代码边界（把改动移出 Proma 核心文件），而不是在未登记文件里硬解（计划 §24 原文：「若冲突太多，优先调整 LA 代码边界，不是放弃同步」）。
- **验证**：合并解冲突后必须跑完整 G7 smoke（`bun run smoke:g7`，打包纵向探针）+ 全量回归（typecheck / bun test / test:linguist / check:boundaries）。
- **合并只在 sync 分支进行**，经门禁复核后才合入 main；不在 main 上直接 merge upstream。

## 2. 演练流程（每次照做）

```text
git fetch upstream --tags
git rev-list --count HEAD..upstream/main        # 上游领先数
git checkout -b sync/rehearsal-<date>
git merge upstream/main                          # 或既定里程碑 tag
# 冲突处理：只对 proma-touchpoints.json 登记文件解冲突；未登记冲突 → 停下来调整边界
# 通过：bun run smoke:g7 + 全量回归
# 记录：本文件追加演练节（日期/上游 HEAD/冲突清单/处置/验证结果）
```

## 3. 首次演练记录（2026-07-27）

| 项 | 实际值 |
| --- | --- |
| upstream HEAD | `702a8221`（与基线相同；`git ls-remote` 实测） |
| 上游领先 / 我方领先 | **0** / 91（merge-base = 基线） |
| 最新 upstream tag | v0.15.11（2026-07-23，与基线记录一致） |
| sync 分支 | `sync/rehearsal-2026-07-27` 创建 → `git merge upstream/main` → **Already up to date** → 分支删除 |
| 冲突 | **零**（上游自基线起零 commit，无冲突可解；触点登记簿未经实战检验） |
| G7 smoke | 未触发（零代码 delta，无可验证变更）；当前 main 的 G7 状态见 G7_REPORT.md（已通过） |
| 回归 | 演练前后工作树零变化；`check:boundaries` 3/3 |

**结论**：同步链路（remote/fetch/分支/合并流程）可用；Proma 上游自基线（2026-07-25）起在 main 上无新提交，本次演练为零增量干跑。下一次里程碑（或 upstream main 前进后）重跑本流程，届时触点登记簿将接受真实冲突检验。
