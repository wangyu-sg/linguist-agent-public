# LA / Proma v0.17.1 实施报告

日期：2026-08-11

## 1. Git 基线

- 起点：`main@3f53e7b66c10734d88455ad65ded51acc46ab33e`
- upstream：Proma `v0.17.1@6094036d3f6f4363c44ce8a11155ecd531a80aae`
- 正式 merge：`96155d1ad2f131e10fd2f0a6998ec13573aa2ead`
- 实现提交：`a8b1ef35`；基线文档：`4437356c`；上游 #1527 修复：`2b958562`；收口：`ba23f0fb`
- 施工分支：`codex/la-proma-v0.17.1`；最终 main merge：`dd154b0d`；push 以 Git 回执为准。

## 2. Runtime 与路径收口

- 保留：Pi `0.82.1`、Provider、Workspace、Skills、MCP、受信 `AGENTS.md`、Memory、Files、Planning、Queue、Collaboration、Preview。
- 删除：Claude Agent SDK / Nowledge Runtime 及其专属 selector、sidecar、配置和打包路径。Claude 模型仍可经 Provider 使用。
- 修复 packaged 启动崩溃：主进程不再用 CJS `require()` 加载 ESM-only `@earendil-works/pi-coding-agent`，只在图片读取路径异步 `import()`。

## 3. Workspace 绑定

- CAT Project 创建或打开时确保有真实 Proma Workspace。
- Linguist Session 同时保存 `workspaceId + linguistProjectId + linguistRole`。
- 新建、复制与分叉会话保持双绑定；CAT authority 仍由主进程重新校验。

## 4. 多岗位协作与冻结范围

- General 可选择性委派 Translator、Reviewer、Proofreader，不是强制流水线。
- 子会话继承同一 Workspace / CAT Project；创建时冻结 asset / Segment 范围。
- 交接使用共享 CAT Store 和阶段事件，不复制聊天正文。

## 5. Reviewer / Proofreader 覆盖

- 新增第 31 个工具 `cat_confirm_segments`。
- 决策为 `unchanged / corrected / blocked`；stage 从当前岗位推导。
- 读取或抽样不算完成；101 Segment 跨页测试证明 coverage 可从 `in_progress` 到 `complete` / `completed_with_blocks`。

## 6. 术语与规则策略

- CAT Core 增加纯 evaluator，CAT Store 继续复用原有 boundary / scope-aware matcher。
- context、QA、write gate 与 verified export 使用同一判断结果。
- 只有明确适用、无冲突、非歧义 required / forbidden 硬拦；preferred、deprecated、冲突、低区分度和 scope unknown 为 advisory。
- 数字术语允许保存；普通数字、换行和 token 差异保留为 QA，不再作为结构硬拦。

## 7. Skills、图片与 Workbench 可见性

- bundled：localization readiness、translator brief、terminology candidate mining、cultural LQA、release LQA。
- 复用既有 seed / workspace upgrade，不新增 Skill 服务。
- 受管 Context 图片经 `cat_read_context_doc` 返回 Pi ImageContent，不新增 OCR / 图片数据库。
- 项目设置复用 Proma Agent Skills / Memory UI；Workbench 显示阶段 coverage、阻断和 QA 层级。

## 8. 自动与 packaged 验证

- 冻结安装：通过。
- 当前树：11 workspace typecheck、根 `1517/1517`（`6881` assertions）、Electron Linguist `212/212`、CAT Store `230/230`、CAT Tools `42/42`、boundary `4/4`、fusion `9/9` 与 license scan 全部通过。
- packaged vertical：Agent `15 PASS / 0 FAIL`、Chat `19 / 0`、Linguist `21 / 0 / 2 MANUAL`。
- LF-003：`runStatus=passed`、coverage `partial`；两项 MANUAL 为原生 Open / Save 对话框。
- 产物 `app.asar` SHA-256：`f2d05f75249f369c0bb16e14368e658538feee4d76e4d02a087b9530750b0a9d`。

## 9. 本机安装与真实 Provider

- 已把 smoke-passed `0.17.2` 安装到 `/Applications/Linguist Agent.app`，安装 hash 与产物一致；旧 `0.16.36` 已移入废纸篓，可恢复。
- 已从安装应用使用 `ChatGPT 订阅 (Codex) · GPT-5.6 Sol` 发出真实请求并收到精确响应 `REAL_PROVIDER_OK`。
- 这证明 Provider 请求路径可用，不证明代表性格式、四岗位协作或语言质量。

## 10. 仍未完成

- 同模型 / reasoning 的真实语言任务对照。
- 真实 Provider 驱动代表性格式完成四岗位全链和 `verified` 交付。
- 真实 Phrase / memoQ 平台互操作。
- Native Open/Save、IME、VoiceOver、完整键盘与 14 天真实日用。

实现和自动验证已完成；以上项目只能由真实样本、人工操作或时间证据关闭。
