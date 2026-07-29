# PB-116 公开镜像清洗记录（PB116_MIRROR_CLEANSE）

初次执行日期：2026-07-27
目标公开仓：`wangyu-sg/linguist-agent-public`（PUBLIC，初次同步时 main 为旧 LA lineage 两次提交）
初次候选分支：`audit/proma-based-candidate-v1`，当时 head = `185eb1614ff66e6a2a4658117b339e374ad853d5`
初次同步时公共 `main`：未触碰（当时为 `81392346…`）

> **2026-07-29 后续更正**：公开前复核发现初次候选在 3 份文档中有
> 10 处不应公开的中文姓名署名。当前树已统一改为 `Henry Wang`，并新增
> 自动文档护栏。当前源码生成净化快照
> `e877a211715f251df704b662f39526ae7a94d504`，只作为公共 `main`
> 的 Proma 历史父提交，不保留独立远端候选分支。用户批准同步后，公共
> `main` 通过双亲合并
> `b8ce7e0a6a2df555884971d57687d6dc09951c6f` 快进，保留旧公共 main
> 两次提交和完整 Proma 基线历史，没有强推 main。验证 main 后删除
> `audit/proma-based-candidate-v1`，远端只保留 `main`。当前公开树和
> 全部可达提交历史的禁用姓名扫描均为零命中。该动作只是公开源码镜像同步，
> 不代表计划发布面向公众的安装包。

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

### 旧 LA 清单复核（2026-07-29）

清单不是凭记忆重建。以旧仓 `LEGACY_FREEZE_REPORT.md` 为第一证据，再对比旧
私有冻结树 `60c504e55d098a96b78f26fdc08a14f506d5eb14` 与旧公共
`main` 树 `813923460424a444b10ac24e092bdfa10db9fdb7`：

- 始终拒绝运行时 `data/`、`sessions/`、`tmp/quarantine/`、
  `.data-root-writer-lease/`、密钥配置、本机 Pi 状态、日志和反向工程产物；
- 旧私有树存在、旧公共树排除的 3 份跟踪文档是
  `docs/CODEX_UI_CONTRACT.md`、
  `docs/roadmap/LA_Evolution_Master_Blueprint_for_Codex_CN.md` 和
  `docs/ui/codex-ui-spec-full.md`；
- 未跟踪且保持私有的 UI 资料还包括 `docs/ui/CODEX_DESIGN_SPEC.md` 与
  `docs/ui/THREE_APPS_PIXEL_SPEC.md`；
- `OPENWORKER_DESIGN_SPEC.md` 与 `PROMA_DESIGN_SPEC.md` 后来被明确加入旧
  公共树，不列入拒绝清单。

上述边界已写入 `tests/public-mirror-cleanliness.test.mjs`；同一护栏还阻止
已知真实项目标识重新进入公开源码。架构边界检查只允许与 Proma 基线逐字
比对后确认属于三类路径占位符替换的公开净化，不因此放宽其他上游修改。

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
- Git 托管平台可能暂存已经失去 branch/tag 引用的旧 object；仓库内引用和后续
  同步已经清除，若仍能通过旧 SHA 直接访问，只能由托管平台完成物理清除。

## 2026-07-29 优化快照增量同步

- 本地来源：已提交树 `cd33ccf5210646fd37095e9e8e69787901831c37`。
- 公开父提交：`a879f185ecb77397f9c07b0d22002b5ad4aa379b`。
- 公开实现快照：`9ed5e8dd113a06cde0e04ac5fae884303ebfad83`。
- 清洗继续执行既有规则：删除 5 张 Proma 真实使用截图，并把三类本机路径替换为占位符。
- 快照只含已提交树；本地主线施工提交与两份未提交 `electron-user-data-path*` 文件没有进入公开历史。
- 候选验证：根测试 1,320/0、typecheck 11/11、boundary 4/0、fusion/身份/净化 11/0、许可扫描 417 个依赖。
- 推送方式：`a879f185..9ed5e8dd` 普通 fast-forward 到 `origin/main`，没有强推。
- GitHub Actions Run `30450830504` 成功；历史许可 allowlist 失败已关闭。
