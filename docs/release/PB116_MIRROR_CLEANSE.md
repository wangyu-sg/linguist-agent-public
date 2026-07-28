# PB-116 公开镜像清洗记录（PB116_MIRROR_CLEANSE）

日期：2026-07-27
目标公开仓：`wangyu-sg/linguist-agent-public`（PUBLIC，已存在，main 为旧 LA lineage 两次提交）
候选分支：`audit/proma-based-candidate-v1` —— **已推送**，head = `185eb1614ff66e6a2a4658117b339e374ad853d5`
公共 `main`：**未触碰**（推送前后实测 = `81392346…`，计划 §25.2 + G11：最终审计后才允许合并）

## 历史策略（已拍板）

基线历史保留 + LA 增量单 commit squash：

- 候选分支以 Proma 基线 `702a8221bdeb6f3db7dc514b8e93e2a5a52f68df` 为根——上游历史**逐 commit 原样保留（SHA 完全一致，可公开审计）**，满足「公开仓必须保留 Proma 历史」。
- LA 重建全部工作（PB-002~PB-115 + PB-089，84 条账本）squash 为单个 commit `185eb161`，避免中间态敏感内容（施工过程截图/路径）随历史泄漏。
- 排除语义：预检命中的截图、proma-logos、proma-thinking、README.en.md 经 `git ls-tree 702a8221` 核实**全部存在于上游基线**（即上游已公开内容）——排除只作用于候选树当前快照，不改写上游历史。

## 清洗动作（候选树）

| 项 | 动作 | 理由 |
|---|---|---|
| `docs/assets/screenshots/proma-*.png` 5 张 | **删除** | 上游作者真实使用痕迹（个人会话标题/真实文件名），隐私性质的真实项目文本 |
| `/Users/<local>`（11 个文档，64+ 处） | scrub → `/Users/<local>` | 本机绝对路径 |
| `/Users/<author>`（guizang skill 4 文件） | scrub → `/Users/<author>` | 第三方作者本机路径 |
| `/Users/<user>`（message.test.tsx 1 处） | scrub → `/Users/<user>` | 上游贡献者本机路径（测试 fixture） |
| `apps/electron/resources/proma-logos/` | **保留** | 上游自有品牌资产 + 构建依赖（AppearanceSettings 13 个 png import），fork 惯例 + attribution 在案；删除会破坏候选树可构建性 |
| `proma-thinking/`、README 族、tutorial/ | **保留** | 上游原文内容，AGPL 衍生保留 attribution 义务；README.en.md 对已删截图的引用将成为死链（已记录） |
| LICENSE / NOTICE / ATTRIBUTION / SECURITY / CONTRIBUTING / THIRD_PARTY_NOTICES | 保留（义务性） | 计划 2429 行合规底线 |

## 自动检查（候选树实测，全部通过）

1. `data/**`：不存在 ✅
2. `.env*`：零命中 ✅
3. keys/tokens/credentials 命名文件：仅正当代码（SettingsSecretInput 等）✅
4. 客户文件/真实项目文本：截图已删；fixtures 全合成 ✅
5. 私人评测：零命中 ✅
6. 本机/第三方绝对路径：scrub 后 grep 零命中（唯一命中为 worktree 自身 `.git` 指针文件，非仓内容）✅
7. reverse-engineering docs / codex-teardown / asar-src：不存在 ✅
8. 原始闭源文案库：不存在 ✅
9. 第三方品牌资产：proma-logos 保留（理由见上表）；截图已删 ✅
10. raw logs：零命中 ✅
11. 硬编码密钥模式抽查（sk-ant/sk-proj/ghp_/BEGIN）：5 处命中全部为预检已判定的占位测试串与政策文档引用 ✅
12. 合规四件套 + SBOM + THIRD_PARTY_NOTICES 在树 ✅
13. 历史完整性：候选分支 `git log` 首父链 = 上游基线历史（SHA 一致）✅

## 推送证据

- 命令：`git push https://github.com/wangyu-sg/linguist-agent-public.git audit/proma-based-candidate-v1`（新建分支，非强推）
- gh api 实测：分支存在、head = `185eb161`；`main` head 推送前后均为 `81392346`（未动）
- 本地分支 `audit/proma-based-candidate-v1` 保留备查；施工 worktree 已移除

## 遗留

- README.en.md / tutorial-v2.md 对已删截图与 `img.erlich.fun` 图床的引用为死链（上游原文不改，最终审计时裁决是否重写 README 族）。
- 候选树未做构建验证（squash 快照与 main 树仅差清洗动作；main 树构建证据见 PB-114 实测）。
- 候选分支合入公开 `main`：G11 最终审计后由用户批准执行（本票不触碰）。
