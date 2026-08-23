# TODO

更新时间：2026-08-23

> Proma v0.17.59 同步、自动回归与未打包构建已完成；以下项目仍需要 packaged 或真实运行证据。

- [ ] PACK-001：完成 `smoke:pack`、packaged startup 与 vertical smoke，分别验证 Agent / Chat / Linguist。
- [ ] MCP-001：修复 7 个既有 Pi MCP Streamable HTTP Session 恢复测试失败，并验证真实 HTTP MCP 重连。
- [ ] VALID-002：在当前 packaged app 中用真实 Provider 和 3–5 个匿名 Segment 完成 General → Translator → Reviewer → Proofreader，核对结构化 `linguistOutcome` 与 `verified` 交付。
- [ ] VALID-001：同一模型、同一 reasoning、同一真实语言任务，对比 Web Chat、旧 LA 与当前 LA。
- [ ] 使用真实 Phrase / memoQ 平台产物验证导入、修改、导出、重导、inline code、状态和审校批注。
- [ ] VALID-003：从当前可用构建开始累计 14 个真实日用日，记录阻断与数据完整性。
- [ ] 真机人工：IME composition、Native Open/Save、Companion round-trip、VoiceOver、keyboard-only、窄窗与拖拽 / resize。
- [ ] 取得上述证据后再裁决个人 Alpha 资格。

不做：公众发布、签名、公证、公开更新渠道；用 Fake Model 或自动化冒充语言质量；把客户正文、文件名或绝对路径提交入仓。
