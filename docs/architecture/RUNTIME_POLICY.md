# Runtime Policy

Linguist Agent 采用 Proma v0.17.46 的单一 Pi Runtime。Claude 模型仍可通过 Provider 使用，但不再包含 Claude Agent SDK runtime。

- Agent、Automations、远程桥与 Linguist 项目会话共用同一套 Pi Runtime、Provider 和 Session 实现；Chat 继续使用共享 Provider 层。
- Linguist 不创建第二套 Runtime selector、路由或状态；项目能力只通过既有 Session authority 注入 CAT Tools。
- 打包只同步 Pi external 依赖；Claude SDK 和 Nowledge Mem 的 adapter、配置、sidecar 与打包路径均不得恢复。
- 当前固定版本以各 `package.json` 与 `bun.lock` 为准，不在本文件复制版本号。
