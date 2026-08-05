# Runtime Policy

Linguist Agent 保留 Proma 的完整 Claude / Pi Runtime 能力，不通过产品开关隐藏任一内核。

- 新会话继承 Proma 当前默认 Runtime；已持久化会话继续使用自身 Runtime。
- Agent、Chat、Automations、远程桥与 Linguist 项目会话共用同一套 Runtime、Provider 和 Session 实现。
- Linguist 不创建第二套 Runtime selector、路由或状态；项目能力只通过既有 Session authority 注入 CAT Tools。
- Claude SDK 与 Pi Runtime 都必须通过现有打包同步和 packaged smoke，不得因某个 UI 入口暂未使用而删除。
- 当前固定版本以各 `package.json` 与 `bun.lock` 为准，不在本文件复制版本号。
