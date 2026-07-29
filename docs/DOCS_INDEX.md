# Linguist Agent 文档索引

更新时间：2026-07-29

## 从这里开始

1. [README.md](../README.md) — 产品身份、三模式、架构和开发入口。
2. [AGENTS.md](../AGENTS.md) — 当前仓库执行与安全约束。
3. [HANDOFF.md](./HANDOFF.md) — 当前交付、验证、安装和下一步。
4. [TODO.md](../TODO.md) — 只列未完成事项。

## 当前状态真源

- [LINGUIST_FUSION_CURRENT_REALITY.md](./roadmap/LINGUIST_FUSION_CURRENT_REALITY.md)
- [linguist-fusion-queue.json](./roadmap/linguist-fusion-queue.json)
- [LINGUIST_FUSION_QUEUE.md](./roadmap/LINGUIST_FUSION_QUEUE.md)
- [KNOWN_LIMITATIONS.md](./release/KNOWN_LIMITATIONS.md)

## 架构与边界

- [UPSTREAM_BASELINE.md](./architecture/UPSTREAM_BASELINE.md) — 固定 Proma 基线。
- [PROMA_CORE_TOUCHPOINTS.md](./architecture/PROMA_CORE_TOUCHPOINTS.md) — 所有 Proma 核心修改登记。
- [proma-touchpoints.json](./architecture/proma-touchpoints.json) — 机读触点真源。
- [ADR-LINGUIST-AS-VERTICAL-AGENT-PROFILE.md](./adr/ADR-LINGUIST-AS-VERTICAL-AGENT-PROFILE.md) — Linguist 作为 Proma 垂直 Profile 的固定决策。
- [USERDATA_LAYOUT.md](./architecture/USERDATA_LAYOUT.md) — `.linguist-agent` 数据布局与 Provider 导入。
- [RUNTIME_POLICY.md](./architecture/RUNTIME_POLICY.md) — Runtime 边界。
- [FEATURE_FLAGS.md](./architecture/FEATURE_FLAGS.md) — 功能旗标。

## 当前实施计划

- [LINGUIST_MODE_AND_CAT_WORKBENCH_IMPLEMENTATION_PLAN_CN.md](./roadmap/LINGUIST_MODE_AND_CAT_WORKBENCH_IMPLEMENTATION_PLAN_CN.md)
- [LINGUIST_FUSION_EXECUTION_LEDGER.md](./roadmap/LINGUIST_FUSION_EXECUTION_LEDGER.md)

计划解释目标；当前实现状态必须回到队列和 Current Reality 核对。

## 关键 Gate 证据

- [G8_REPORT.md](./roadmap/G8_REPORT.md) — 三档质量自动链已实现；真实盲评仍阻断。
- [G9_REPORT.md](./roadmap/G9_REPORT.md) — 真实旧数据副本复跑已通过。
- [G10_REPORT.md](./roadmap/G10_REPORT.md) — 自动化已修复，人工产品资格仍阻断。
- [AC007_LONG_THREAD_REPORT.md](./roadmap/AC007_LONG_THREAD_REPORT.md) — 长线程 selector 更正与 packaged 数据。
- [G11_REPORT.md](./roadmap/G11_REPORT.md) — 历史发布/合规证据，不代表当前个人 Alpha 要公开发行。
- [LA_CI_001_BASELINE.md](./release/LA_CI_001_BASELINE.md) — 远端 CI 历史失败、本地修复与成功关闭证据。

## 发布与归属

- [NOTICE.md](../NOTICE.md)
- [ATTRIBUTION.md](../ATTRIBUTION.md)
- [SOURCE_PROVENANCE.md](./attribution/SOURCE_PROVENANCE.md)
- [KNOWN_LIMITATIONS.md](./release/KNOWN_LIMITATIONS.md)
- [PUBLIC_MIRROR_MANIFEST.md](./release/PUBLIC_MIRROR_MANIFEST.md) — 当前公开源码镜像坐标、历史结构与隐私门禁。
- [PB116_MIRROR_CLEANSE.md](./release/PB116_MIRROR_CLEANSE.md) — 初次清洗证据与 2026-07-29 后续更正。

公开源码镜像已经同步；签名、公证、公众安装包和更新渠道仍只是历史/未来发行资料，当前没有公众发布计划。

## 维护

- [DOCUMENTATION_MAINTENANCE.md](./DOCUMENTATION_MAINTENANCE.md)
- Codex Skill：`/Users/<local>/.codex/skills/linguist-agent-doc-sync/SKILL.md`

不要从历史报告反向覆盖当前状态；先核对代码、manifest、队列 JSON 和真实命令输出。
