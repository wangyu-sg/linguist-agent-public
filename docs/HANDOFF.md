# Linguist Agent 当前交接

当前周期按优化方案分工作流收口，每项独立提交。版本、基线、验证状态只维护在 [当前事实](../CURRENT_FACTS_SIMPLE.md)；未完成项见 [TODO](../TODO.md)。

已完成：

- A1 `2f3b598e`：MCP 桥接完整采用固定上游；真实 loopback 连接验证失败冷却、缓存淘汰和恢复。
- A2 `4365d7af`：逐项审计产品触点，通用差异转临时偏差；原生生命周期与安全候选补丁保存在 `architecture/upstream-native-security.patch`，未向外部提交。
- D `aa5290da`：项目切换权威刷新、创建空项目会话、代际判定和同步持久化；Store 状态回归通过，真实窗口状态链须另验。
- B `e047c71b`：统一产品身份、三模式首章、FAQ 与截图；目录包和隔离应用欢迎页已检查。
- C：README 与工程规则保留稳定职责，动态事实与未完成清单收敛；合同测试从实际工具常量读取数量，纠正此前漏记的工具。

下一步执行最终门禁与发布准备。真实 Provider 测试需要独立临时配置，目前尚未提供；不得读取真实用户数据根运行 smoke。Keychain 会阻塞无登录钥匙串的临时 HOME；现有无真实凭据 smoke 配置只用于自动探针，不能代表真实密钥存储验证。

当前规范和证据入口：[文档索引](./DOCS_INDEX.md)、[基线](./architecture/proma-baseline.json)、[触点](./architecture/proma-touchpoints.json)、[限制](./release/KNOWN_LIMITATIONS.md)。
