# TODO

更新时间：2026-09-04

> Proma v0.19.26 同步与自动回归已完成；以下项目仍需要真实 Provider、平台或人工证据。

- [ ] VALID-002：在当前 packaged app 中用真实 Provider 和 3–5 个匿名 Segment 完成 General → Translator → Reviewer → Proofreader，核对结构化 `linguistOutcome` 与 `verified` 交付。
- [ ] VALID-001：同一模型、同一 reasoning、同一真实语言任务，对比 Web Chat、旧 LA 与当前 LA。
- [ ] 使用真实 Phrase / memoQ 平台产物验证导入、修改、导出、重导、inline code、状态和审校批注。
- [ ] VALID-003：从当前可用构建开始累计 14 个真实日用日，记录阻断与数据完整性。
- [ ] 真机人工：IME composition、Native Open/Save、Companion round-trip、VoiceOver、keyboard-only、窄窗与拖拽 / resize。
- [ ] 取得上述证据后再裁决个人 Alpha 资格。

## CAT 右侧工作区收口

- [x] 将 CAT 接入 Proma 现有右侧工作区；普通状态保留完整 Agent，展开 CAT 时自动收起左栏，并将中区切为现有 Agent rail。
- [x] 窄窗或 200% 缩放时让 CAT 独占工作区，不强留不可用的 Agent rail；展开与还原必须一键完成且按会话记忆。
- [x] 压缩 CAT Header：只保留一层上下文工具栏；Proma 顶栏承载工作区展开按钮；项目设置位于 CAT 工具栏右端。
- [x] 批次入口放在 CAT 工具栏左端、靠近批次导航；语言资产入口放在底部状态栏右端并向上展开；移除重复的 Agent 入口。
- [x] Grid 保留虚拟滚动；普通行默认最多显示三行，当前编辑、Proposal 或异常行完整展开，不增加密度设置。
- [ ] 完成新路径后删除旧 Workbench / Project Tab 双轨；同步更新 Proma 核心触点登记与边界检查。
- [ ] 验收：项目徽标与批次/阶段上下文清楚；1440px、1024px 和 200% 下无重叠；Header 减少且 Grid 可用高度增加；展开/还原不丢失当前会话和 CAT 状态。

## 当前缺陷

- [x] Segment 状态筛选必须与 Footer 的当前阶段进度使用同一口径；修复剩余未确认片段存在但筛选结果为 0 的问题。
- [x] 在 CAT 紧凑工具栏直接显示并切换当前项目任务阶段 T / E / P；筛选、Footer、确认、QA 与导出必须使用同一阶段，不从文件名推断。
- [ ] 若真实使用证明同一项目必须同时处理不同阶段的批次，再把阶段提升为批次级并为旧项目数据做显式迁移；当前不提前扩 Schema。

不做：公众发布、签名、公证、公开更新渠道；用 Fake Model 或自动化冒充语言质量；把客户正文、文件名或绝对路径提交入仓。
