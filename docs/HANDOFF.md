# Linguist Agent 当前交接

当前工作是 [0.18 候选](./release/VALIDATION_0_18_0.md)，尚未公开发布，日用安装未替换。工程/typecheck、全链回归与六步打包 smoke 已通过；真实 Astra/xhigh 的 42 个独立案例和 6 次接续判断已完成模型辅助盲核（1 项正确待上下文，其余通过或合理保留，未发现需修改项）。Dock 专项的旧精确文本断言已修正并定向通过；下一步由 main CI 验证最终提交并触发正式 Release。起点见 [LA018_BASELINE](./release/LA018_BASELINE.md)，动态状态以 [当前事实](../CURRENT_FACTS_SIMPLE.md) 为准。

上次浏览器串行操作、Linguist 原生侧栏共用、定时任务领域快照已发布，用户授权的本机正式签名安装替换已完成，见 [发布记录](./release/VALIDATION_0_17_75.md)。

随后完成浏览器填充与固定只读 DOM 检查修复，并更新 Phrase / in-app-browser Skill。用户已授权替换本机安装；修复提交已沿用原证书打包、备份旧版、安装并启动，默认 Skill 已自动同步。公开 Release 仍对应原发布提交，详见 [效率修复及安装记录](./release/BROWSER_BATCH_FIX_2026_09_16.md)。

Proma / Pi 固定基线不变，本轮未修改 Pi 压缩器。0.18 候选的真实 Phrase 完整回填与保存流程仍须现场验证，不能将合成页当作客户平台提速证据。较新定制 Phrase Skill 需在新运行边界合并，默认更新不等于当前项目已加载。macOS 红绿灯问题按用户要求延期；其他人工资格见 [TODO](../TODO.md) 和 [限制](./release/KNOWN_LIMITATIONS.md)。

规范入口：[文档索引](./DOCS_INDEX.md)、[触点](./architecture/proma-touchpoints.json)。历史记录保留原版本与证据。
