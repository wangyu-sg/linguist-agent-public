# PUBLIC_MIRROR_MANIFEST — 公开镜像清单（PB-117）

日期：2026-07-27

## 镜像坐标

```text
公开仓        https://github.com/wangyu-sg/linguist-agent-public（PUBLIC）
候选分支      audit/proma-based-candidate-v1
候选 head     185eb1614ff66e6a2a4658117b339e374ad853d5
基线根        702a8221bdeb6f3db7dc514b8e93e2a5a52f68df（上游历史 SHA 原样）
公共 main     81392346…（旧 LA lineage，未触碰；合并待最终审计 + 用户批准）
推送时间      2026-07-27（gh api 双向核验在案，docs/release/PB116_MIRROR_CLEANSE.md）
```

## 历史结构

- 根 → 基线：Proma 上游历史逐 commit 保留（SHA 与上游一致，可公开审计）。
- 基线 → head：单 squash commit `185eb161`「Linguist Agent rebuild on Proma baseline (PB-002~PB-115, PB-089)」，含全部 LA 工作与发行治理文件。

## 内容清单

**保留（义务性/构建必需）**：LICENSE（AGPL-3.0 原样）、NOTICE.md、ATTRIBUTION.md、SECURITY.md、CONTRIBUTING.md、THIRD_PARTY_NOTICES.md、docs/release/SBOM.md + sbom-full.json、全部源码与 linguist-* 包、proma-logos（上游自有品牌资产 + 构建依赖）、proma-thinking/ 与 README 族（上游原文）、docs/ 全套施工与账本文档（路径已 scrub）。

**删除**：docs/assets/screenshots/proma-*.png 5 张（上游作者真实使用痕迹，隐私）。

**Scrub（占位符化）**：`/Users/<local>` → `/Users/<local>`（11 文档）；`/Users/<author>` → `/Users/<author>`（guizang skill 4 文件）；`/Users/<user>` → `/Users/<user>`（1 测试 fixture）。

## 清洗验证（13 项自动检查全过）

data/** 不存在；.env* 零命中；无凭据命名文件；无客户文件/真实项目文本；无私人评测；本机/第三方绝对路径零残留；无 reverse-engineering docs/codex-teardown/asar-src；无闭源文案库；raw logs 零命中；硬编码密钥模式仅已知占位测试串；合规四件套 + SBOM 在树；历史完整性（首父链 = 上游基线）。明细：docs/release/PB116_MIRROR_CLEANSE.md。

## 已知瑕疵

- README.en.md / tutorial-v2.md 对已删截图与 img.erlich.fun 图床的引用为死链。
- 候选树未单独构建验证（与 main 树仅差清洗动作；main 树构建证据 PB-114）。

## 合并条件（G11）

候选分支合入公开 `main` 必须同时满足：最终审计通过 + 用户明确批准（计划 §25.2「未经批准 push 公共 main」禁令 + G11「最终审计后才合并」）。
