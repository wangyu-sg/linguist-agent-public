# PUBLIC_MIRROR_MANIFEST — 公开镜像清单（PB-117）

初次日期：2026-07-27
最近同步：2026-07-30

## 镜像坐标

```text
公开仓        https://github.com/wangyu-sg/linguist-agent-public（PUBLIC）
公开分支      main（远端唯一长期分支）
初次净化快照  e877a211715f251df704b662f39526ae7a94d504
最新实现快照  14331d30cd61470cc0a47878cf31a7724479cae7
基线根        702a8221bdeb6f3db7dc514b8e93e2a5a52f68df（上游历史 SHA 原样）
main 合并点    b8ce7e0a6a2df555884971d57687d6dc09951c6f
同步性质      公开源码镜像；不是公众安装包 Release
```

## 历史结构

- Proma 根 → 基线：上游历史逐 commit 保留，SHA 与上游一致。
- 基线 → 净化快照：单个 commit `e877a211`，包含当前个人 Alpha 源码、测试和治理文件。
- 旧公共 main 两次提交 → `b8ce7e0a`：以净化快照为第二父提交的双亲合并；因此
  公共 main 是普通 fast-forward，旧公共历史和 Proma 历史都保留。
- 初次候选 `185eb161` 因隐私署名复核失败，在公共 main 验证后删除其
  `audit/proma-based-candidate-v1` 分支；它不再由公开 branch/tag 引用。
- `a879f185` → `9ed5e8dd`：在现有公开 `main` 上追加单个增量净化快照；
  本地施工历史不进入公开可达历史，远端仍是普通 fast-forward。
- `9ed5e8dd` → `d8959427`：记录该优化快照的公开 CI 结果。
- `d8959427` → `8660d32f` → `14331d30`：依次追加共享 Linguist 侧栏/会话复制实现与项目菜单绘制修复；每次都从最新公开 `main` 创建净化快照并普通 fast-forward。

## 内容清单

**保留（义务性/构建必需）**：LICENSE（AGPL-3.0 原样）、NOTICE.md、ATTRIBUTION.md、SECURITY.md、CONTRIBUTING.md、THIRD_PARTY_NOTICES.md、docs/release/SBOM.md + sbom-full.json、全部源码与 linguist-* 包、proma-logos（上游自有品牌资产 + 构建依赖）、proma-thinking/ 上游原文、当前 Linguist Agent README，以及 docs/ 全套施工与账本文档（路径已 scrub）。

**删除**：docs/assets/screenshots/proma-*.png 5 张（上游作者真实使用痕迹，隐私）。

**Scrub（占位符化）**：`/Users/<local>` → `/Users/<local>`；
`/Users/<author>` → `/Users/<author>`；`/Users/<user>` → `/Users/<user>`。
该替换覆盖全部受管文件，不依赖容易过期的文件数量。

## 旧 LA 净化清单依据

净化规则同时来自两份可复核证据：

1. 旧仓 `/Users/<local>/Desktop/linguist-agent/LEGACY_FREEZE_REPORT.md` 记录的
   运行时数据、会话、隔离项目、本机 lease 和私人 UI 研究资料；
2. 旧私有冻结树 `60c504e55d098a96b78f26fdc08a14f506d5eb14` 与旧公共
   `main` 树 `813923460424a444b10ac24e092bdfa10db9fdb7` 的实际差异。

公开镜像拒绝 `data/`、`sessions/`、`tmp/quarantine/`、
`.data-root-writer-lease/`、`.env*`、Pi 本机设置/会话、日志、反向工程产物，
以及以下旧 LA 私有研究文档：

- `docs/CODEX_UI_CONTRACT.md`
- `docs/roadmap/LA_Evolution_Master_Blueprint_for_Codex_CN.md`
- `docs/ui/codex-ui-spec-full.md`
- `docs/ui/CODEX_DESIGN_SPEC.md`
- `docs/ui/THREE_APPS_PIXEL_SPEC.md`

`OPENWORKER_DESIGN_SPEC.md` 与 `PROMA_DESIGN_SPEC.md` 虽在冻结报告的早期
未跟踪清单中，但随后被明确纳入旧公共树，因此不属于拒绝清单。
`tests/public-mirror-cleanliness.test.mjs` 固化上述边界，并阻止已知真实项目
标识重新进入公开源码。`tests/upstream-boundary.test.ts` 只豁免与基线逐字
比对后确认属于上述三类路径占位符替换的差异，其他 Proma 核心改动仍须登记。

## 清洗验证

data/** 不存在；.env* 零命中；无凭据命名文件；无客户文件/真实项目文本；无私人评测；本机/第三方绝对路径零残留；无 reverse-engineering docs/codex-teardown/asar-src；无闭源文案库；raw logs 零命中；硬编码密钥模式仅已知占位测试串；合规四件套 + SBOM 在树；历史完整性（首父链 = 上游基线）。明细：docs/release/PB116_MIRROR_CLEANSE.md。

2026-07-29 新增身份隐私检查：

- 当前公开树的禁用中文姓名：0；
- 净化快照与公共 main 的完整可达历史：0；
- commit author / committer / subject：0；
- `tests/public-identity-privacy.test.mjs` 自动阻止后续文档回归；
- `tests/public-mirror-cleanliness.test.mjs` 自动阻止旧 LA 私有资料和真实项目标识回归；
- 作者公开署名只允许 `Henry Wang` 或 `Wang Yu`。

2026-07-29 优化快照验证：

- 当前树路径/身份护栏、根测试 1,320/0、typecheck 11/11、boundary 4/0、
  fusion/隐私 11/0 和 417 依赖许可扫描均通过；
- GitHub Actions Run `30450830504` 成功，含 Electron build；
- 当前公开 README 不再引用已删除的 5 张截图。

2026-07-30 共享侧栏与菜单修复验证：

- 实现快照 `8660d32f` 的 GitHub Actions Run `30478305394` 成功；
- 菜单修复快照 `14331d30` 的 GitHub Actions Run `30480198628` 成功；
- 修复候选的 frozen install、typecheck 11/11、根测试 1,347/0、boundary 4/0 和公开身份/隐私守卫均通过；
- 当前树路径/凭据/私有资料扫描与可达历史作者身份扫描通过，推送没有携带本地施工历史或两份用户自有未暂存文件。

## 已知瑕疵

- 继承的 tutorial 仍依赖上游 `img.erlich.fun` 外部图床，镜像不控制其可用性。
- 签名、公证、公众安装包与跨平台 Release qualification 未执行。

## 当前边界

用户已明确批准同步公开源码 main；最新实现/修复快照 `14331d30` 已推送并通过
远端 CI。签名、公证、公众安装包、公开更新渠道和 Release qualification 仍不在
当前个人 Alpha 范围内。远端只保留长期分支 `main`。
