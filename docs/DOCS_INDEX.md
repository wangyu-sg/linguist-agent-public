# Linguist Agent 文档索引

更新时间：2026-09-09

## 当前真源

1. [README.md](../README.md) — 产品身份、架构和开发入口。
2. [AGENTS.md](../AGENTS.md) — 当前工程与安全约束。
3. [CURRENT_FACTS_SIMPLE.md](../CURRENT_FACTS_SIMPLE.md) — 已核验当前事实。
4. [HANDOFF.md](./HANDOFF.md) — 当前交付与下一步。
5. [TODO.md](../TODO.md) — 只列真实未完成项。

旧 Fusion queue 已退役，只在 [docs/archive/](./archive/) 保留历史快照；当前动态事实由 CURRENT_FACTS_SIMPLE.md 维护，状态入口页只提供链接。

## 状态与架构

- [SIMPLE_IMPLEMENTATION_STATUS.md](./roadmap/SIMPLE_IMPLEMENTATION_STATUS.md)
- [LINGUIST_FUSION_CURRENT_REALITY.md](./roadmap/LINGUIST_FUSION_CURRENT_REALITY.md)
- [UPSTREAM_BASELINE.md](./architecture/UPSTREAM_BASELINE.md)
- [UPSTREAM_SYNC.md](./architecture/UPSTREAM_SYNC.md)
- [proma-baseline.json](./architecture/proma-baseline.json)
- [PROMA_CORE_TOUCHPOINTS.md](./architecture/PROMA_CORE_TOUCHPOINTS.md)
- [proma-touchpoints.json](./architecture/proma-touchpoints.json)
- [PROMA_DEVIATIONS.md](./architecture/PROMA_DEVIATIONS.md) / [PROMA_DEVIATIONS.json](./architecture/PROMA_DEVIATIONS.json)
- [ADR-LINGUIST-AS-VERTICAL-AGENT-PROFILE.md](./adr/ADR-LINGUIST-AS-VERTICAL-AGENT-PROFILE.md)
- [USERDATA_LAYOUT.md](./architecture/USERDATA_LAYOUT.md)
- [RUNTIME_POLICY.md](./architecture/RUNTIME_POLICY.md)

## 发布与历史

- [0.17.73 实施与发布验证](./release/VALIDATION_0_17_73.md) — 原生 UI 收敛、批次范围、草稿和发布证据。

- [2026-09-08 全仓库审查与优化](./release/REPOSITORY_AUDIT_2026_09_08.md) — 审查候选、问题证据、修复、验证和后续计划。
- [发布收尾验证](./release/VALIDATION_0_17_72.md) — main / Tag、远程 CI、滚动条回归及自动更新产物。

- [2026-09-05 优化实施记录](./release/IMPLEMENTATION_2026_09_05.md) — 本轮修改、实际验证与尚缺资格。
- [2026-09-06 优化实施记录](./release/IMPLEMENTATION_2026_09_06.md) — 工具说明、只读查询、岗位/Skill 定稿与定向验证。

- [SBOM.md](./release/SBOM.md) / [sbom-full.json](./release/sbom-full.json)
- [KNOWN_LIMITATIONS.md](./release/KNOWN_LIMITATIONS.md)
- [NOTICE.md](../NOTICE.md)、[ATTRIBUTION.md](../ATTRIBUTION.md)、[SOURCE_PROVENANCE.md](./attribution/SOURCE_PROVENANCE.md)
- [LA_PROMA_V0_17_1_IMPLEMENTATION_REPORT_2026-08-11.md](./implementation/LA_PROMA_V0_17_1_IMPLEMENTATION_REPORT_2026-08-11.md)、[FINAL_IMPLEMENTATION_REPORT_2026-08-10.md](./implementation/FINAL_IMPLEMENTATION_REPORT_2026-08-10.md) 与 G8/G9/G10 报告均为历史证据，不描述当前实现。
- [docs/archive/](./archive/) 保存旧基线与队列快照。

维护规则见 [DOCUMENTATION_MAINTENANCE.md](./DOCUMENTATION_MAINTENANCE.md)。事实优先级始终是代码 / manifest / 测试 / 真实运行输出高于说明文档。
