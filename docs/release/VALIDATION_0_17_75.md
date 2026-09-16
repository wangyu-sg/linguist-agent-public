# 0.17.75 实施与发布验证

日期：2026-09-16。起点 `44d675b58549f3a0ed67cbd51ab677997b47403b`，工作分支 `codex/la-01775-browser-native-parity-20260916`。Proma v0.19.53、Pi 0.85.1、Electron 43.2.0、Bun 1.3.14 保持固定。

## 实现

- BrowserPress 采用显式 text/key，拒绝旧快捷键字符串；真实输入节点、焦点与紧前 guard 经同一控制器执行。
- BrowserAct 支持至多 64 个步骤、30 秒总预算（含排队）；复用 tab 队列，返回成功前缀、失败/未知位置及未执行范围。Pi 将未完成序列标为工具错误，保留结构化结果。
- probe 是同步只读 JSON 函数，由 Chromium side-effect check 和执行时间预算限制；不内建站点选择器。当前 Chromium 对部分 DOM 方法（如 getElementById）也会拒绝，需使用实际已验证的只读表达式。
- Linguist 退役独立整块侧栏；原生列表处理展开、归档、搜索、会话行和子会话，领域仅提供项目数据/操作。关闭原生组件返回 CAT。
- Automation 持久化领域身份/岗位/范围；真实 session binding、reuse/daily 检查和 headless 执行复用原生服务。跨工作区清除旧绑定，既有运行记录保留原快照；不存在 scope 不代表全项目授权。
- Phrase Skill 1.0.5、in-app-browser 1.1.2 仅随新二进制发布。旧安装与真实工作区 Skill 未改动。

## 自动验证与边界

定向 Chromium 按键/焦点/序列、CAT 草稿和导航、定时任务调度以及真实 Store 只读快照测试已执行。完整命令、打包与远程状态在发布收口时记录，以实际输出为准。

富文本行末换行在合成 inline contenteditable 中出现额外换行，严格读回阻止继续。单行富文本结构与 textarea 的 LF/字面反斜杠分别校验；这不证明真实 Phrase 富文本多行编辑可用。实际编辑器需要一次结构/保存校准，不可静默裁剪或归一文本。

## 尚未验证

- 未取得 Phrase 测试工作：真实 DOM、标签/格式、多行、保存、TM/QA 与 Accepted 流程未校准，无启用的站点写入配方。
- 不用本地 fixture 时长推断模型往返、浏览器授权等待或真实 Phrase 提速。
- 日用安装未替换；真实 Provider、人工 IME/Native Open/Save 等资格不由本轮自动测试推定。

## 发布

待完成本地门禁、提交与既有签名发布流水线；此处尚不声明已发布。
