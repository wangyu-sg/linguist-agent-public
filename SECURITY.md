# Security Policy

## 支持版本

Linguist Agent 处于按票重建早期，仅最新 release 获得安全修复。

| 版本 | 支持状态 |
|---|---|
| 最新 release | ✅ 支持 |
| 更早版本 | ❌ 请升级 |

## 报告漏洞

请**不要**在公开 Issue 中披露安全漏洞细节。

- 首选渠道：通过 GitHub 私有漏洞报告（Security Advisories → Report a
  vulnerability）提交到公开仓
  [wangyu-sg/linguist-agent-public](https://github.com/wangyu-sg/linguist-agent-public)。
  该渠道在公开仓启用 Security Advisories 后可用。
- 过渡渠道（公开仓或其私有漏洞报告尚未启用时）：在仓库提 issue，但**隐去
  敏感细节**（不贴可复现的利用步骤、凭据、用户数据），仅说明问题性质，
  维护者会私下跟进。

响应目标：7 天内确认收到报告，30 天内给出修复或缓解方案（目标值，非法律
承诺）。

## 范围与说明

- 本项目在本地存储用户的模型 API Key（经 Electron safeStorage 加密）与
  OAuth token；用户数据目录为 `~/.linguist-agent/`（开发版
  `~/.linguist-agent-dev/`）。
  涉及这些凭据/数据的泄露风险属于高优先级。
- 第三方依赖的漏洞请同时向上游报告；我们会在依赖升级窗口内跟进。
