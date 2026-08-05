# TODO

更新时间：2026-08-05

> 唯一 active 计划与完整 ticket 列表见 [LA_UNIFIED_MASTER_PLAN_V2.md](docs/roadmap/LA_UNIFIED_MASTER_PLAN_V2.md) 与 [linguist-fusion-queue.json](docs/roadmap/linguist-fusion-queue.json)。不要从本文件恢复 v1 队列。

## Phase 0

- [x] LA-MASTER-000：当前事实、计划唯一性、旧计划 superseded 标记与文档校验。
- [x] LA-SYNC-001：backup/恢复验证、同步前 tag、专用同步分支与 clean tracked tree。
- [x] LA-SYNC-002：正式 merge Proma v0.16.8 为 f3d2b431。
- [x] LA-SYNC-003：Runtime/Session reconciliation。
- [x] LA-SYNC-004：Agent Surface/Sidebar/Settings reconciliation。
- [x] LA-SYNC-005：Electron 43、lock/build 与 packaged smoke gate。
- [x] LA-SYNC-006：完成 baseline/touchpoints/deviations 的 current boundary 与 fusion verification。
- [ ] LA-SYNC-007：完成 v0.16.8 验收；当前仍有 2 个 MANUAL 和 3 个 BLOCKED coverage gaps。
- [x] LA-HOST-000：建立静态本地 Host Contracts、Extension Registry 与 Linguist composition root。
- [x] LA-HOST-004：建立 Rail/Full Host Capability Manifest，并隐藏未实现入口。

## 后续真实证据（按 v2 依赖解锁）

- [ ] LA-HOST-001：完成 Session-scoped Reference。
- [ ] LA-EVAL-001 / LA-EVAL-002：同模型 Web Chat、旧 LA、新 LA 基准与 Prompt/Model regression harness。
- [ ] LA-EVAL-003：真实 Provider Tool Loop、真实 CAT 格式 round-trip 与 macOS packaged App。
- [ ] LA-EVAL-004：真实项目与 14 天日用、IME、Native Open、VoiceOver、键盘和窄窗交互证据；Native Save 防覆盖已单独通过。

## 当前不做

- 公众发布、签名、公证、公开更新渠道；
- 用 packaged smoke 取代手工或真实机器验收；
- 将私有客户项目、扫描报告或恢复产物提交入仓。
