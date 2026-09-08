# 0.17.72 发布验证

## 源码与证据

- 发布源码：`1136b426fadaeb389d797fedf7576b2a1378c6d4`，已合入并推送 `main`。
- Proma：`v0.19.37` / `a987ec88fcfa05dd2448dc0ccdd9824a4b510dc6`，正式合并 `4a7cbcec`。
- 原审查候选 `479120b7` 相对本地打包源码 `9ea58ca2` 仅变更 CI、探针与文档。本次另增发布版本元数据和下述滚动条修复，已重新打包并执行远程验证。

## 远程验证

[CI 34182752848](https://github.com/wangyu-sg/linguist-agent-public/actions/runs/34182752848) 成功。已下载 `packaged-vertical-34182752848-1`，独立核对报告的 sourceHead 与发布源码一致、工作树干净、六步均 passed / exitCode=0、原始日志非空。

| 验证 | 结果 |
|---|---|
| 基础 CI | 类型检查、默认生产链回归、Proma 同步合同、许可扫描、Electron 构建通过 |
| CAT 真实浏览器 | 通过 |
| 打包垂直六步 | package、workspace-deps、agent、chat、project-switch、linguist-current 全通过 |
| Agent / Chat | 各 19 PASS / 0 FAIL |
| Linguist | 31 PASS / 0 FAIL / 2 MANUAL |
| 语言资产 Dock | 26 PASS / 0 FAIL / 0 MANUAL |

CI 未签名验证产物的 app.asar SHA-256：`8ee2ae524007f5a88c1a753ed774789be332c0c298977f4327fa1cdc712b0e11`。这不是正式签名 Release ZIP 的哈希。

## 失败记录及修正

- [首次 CI 34180940506](https://github.com/wangyu-sg/linguist-agent-public/actions/runs/34180940506)：传统滚动条占用列表宽度，文本列为 174.5px 且与表头错位，四项窄窗断言失败，发布被阻断。表头与列表改用相同的原生 `scrollbar-gutter: stable`，最小网格宽度补足滚动条空间；本地强制传统滚动条复现后转绿。
- [第二次 CI 34181813638](https://github.com/wangyu-sg/linguist-agent-public/actions/runs/34181813638)：六步通过，Dock 专项发现横向滚动条使最小编辑区低于原有 140px 要求，发布继续被阻断。编辑容器最小高度由 180px 调整至 196px；探针在主题重载后仍固定传统滚动条，复现 25 PASS / 1 FAIL 后验证为 26 PASS / 0 FAIL。
- 没有降低列宽、编辑区高度或命中断言；最终远程 CI 同时通过六步和 Dock 专项。

## 正式发布与自动更新

[Auto Release 34183280354](https://github.com/wangyu-sg/linguist-agent-public/actions/runs/34183280354) 成功；复用上述通过的 CI，三个平台构建、macOS 更新索引合并与公开步骤全部成功。

[Release v0.17.72](https://github.com/wangyu-sg/linguist-agent-public/releases/tag/v0.17.72) 于 2026-09-08 03:31:40 UTC 公开，latest API 已指向本版本，非草稿、非预发布。Tag 指向上述发布源码。七个资产齐全：macOS arm64/x64 DMG 与 ZIP、Windows x64 EXE、`latest-mac.yml` 和 `latest.yml`。

已下载最终索引与正式 arm64 ZIP：包版本为 0.17.72，大小 222150031 字节，SHA-512 与 `latest-mac.yml` 完全一致：

```text
XCIMindxutcpWu03OZYF1Gc5SmB71eGi26LoWbbvOas+FXSOM9jgA5isS+JY0Ksvw4NXJQWgFOoa21FMTsx7Lg==
```

在可访问 macOS 安全服务的环境执行 `codesign --verify --deep --strict --verbose=4`，下载包验证为 valid on disk / satisfies its Designated Requirement。未启动或安装此下载包。正式包签名验证与 CI 未签名包的行为验证分别记录，不能混用哈希。

## 资格边界

真实 Provider、语言质量、输入法与原生 Open/Save 仍按现有记录保持未验证。草稿保护覆盖当前应用进程。本次不替换本机安装版，由用户通过自动更新安装；不能据此声明用户安装或实际使用已经通过。
