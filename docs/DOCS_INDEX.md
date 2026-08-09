# Linguist Agent 文档索引

更新时间：2026-08-10

## 从这里开始

1. [README.md](../README.md) — 产品身份、三模式、架构和开发入口。
2. [AGENTS.md](../AGENTS.md) — 当前仓库执行与安全约束。
3. [CURRENT_FACTS_SIMPLE.md](../CURRENT_FACTS_SIMPLE.md) — 简化重构启动时的已核验事实。
4. [HANDOFF.md](./HANDOFF.md) — 当前交付、验证和下一步。
5. [TODO.md](../TODO.md) — 只列未完成事项。

## 当前方案状态

- [SIMPLE_IMPLEMENTATION_STATUS.md](./roadmap/SIMPLE_IMPLEMENTATION_STATUS.md) — 简化重构 Ticket、验证层级与真实证据阻断项。
- [LINGUIST_FUSION_CURRENT_REALITY.md](./roadmap/LINGUIST_FUSION_CURRENT_REALITY.md) — 当前产品和同步事实。

## 架构、基线与边界

- [UPSTREAM_BASELINE.md](./architecture/UPSTREAM_BASELINE.md) — Proma v0.16.10 人读基线。
- [proma-baseline.json](./architecture/proma-baseline.json) — 基线与 runtime/contract 机读真源。
- [PROMA_CORE_TOUCHPOINTS.md](./architecture/PROMA_CORE_TOUCHPOINTS.md) — 核心触点规则与重算说明。
- [proma-touchpoints.json](./architecture/proma-touchpoints.json) — 当前精确 Proma Core touchpoint ledger。
- [PROMA_DEVIATIONS.md](./architecture/PROMA_DEVIATIONS.md) — 偏离分类与 sunset。
- [PROMA_DEVIATIONS.json](./architecture/PROMA_DEVIATIONS.json) — 偏离机读真源。
- [docs/archive/](./archive/) — 旧 v1 queue 与旧 v0.15.11 baseline/touchpoint snapshots。
- [ADR-LINGUIST-AS-VERTICAL-AGENT-PROFILE.md](./adr/ADR-LINGUIST-AS-VERTICAL-AGENT-PROFILE.md) — Linguist 作为 Proma 垂直 Profile 的固定决策。
- [USERDATA_LAYOUT.md](./architecture/USERDATA_LAYOUT.md) — .linguist-agent 数据布局与 Provider 导入。
- [RUNTIME_POLICY.md](./architecture/RUNTIME_POLICY.md) — Runtime 边界。

## 质量、发布与历史证据

- [G8_REPORT.md](./roadmap/G8_REPORT.md)、[G9_REPORT.md](./roadmap/G9_REPORT.md)、[G10_REPORT.md](./roadmap/G10_REPORT.md) — 历史 Gate 证据，不替代当前 v2 状态。
- [KNOWN_LIMITATIONS.md](./release/KNOWN_LIMITATIONS.md) — 已知限制。
- [NOTICE.md](../NOTICE.md)、[ATTRIBUTION.md](../ATTRIBUTION.md)、[SOURCE_PROVENANCE.md](./attribution/SOURCE_PROVENANCE.md) — 归属与来源。

## 维护

- [DOCUMENTATION_MAINTENANCE.md](./DOCUMENTATION_MAINTENANCE.md)
- Codex Skill：/Users/<local>/.codex/skills/linguist-agent-doc-sync/SKILL.md

不要从历史报告反向覆盖当前状态；先核对代码、manifest、简化实现状态表和真实命令输出。
