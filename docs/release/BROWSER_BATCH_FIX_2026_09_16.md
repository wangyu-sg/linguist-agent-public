# 浏览器批量回填效率修复

日期：2026-09-16。基于已发布源码 `85aa7e5d`；本次不提高 App 版本，不发布或替换安装版。

## 原因与改动

- 一段真实会话在约 87 分钟内进行了 367 次工具调用；调用至返回累计约 56 秒，模型响应区间约 65 分钟，五次上下文压缩约 21 分钟。输入累计约 3740 万 token，其中约 3686 万为缓存读取；不能按全部新输入或纯模型思考计费/计时。
- 编辑器拦截全选 keydown 时，原 `fill` 会插入而不替换。隔离 Chromium 已复现，改用 WebContents 原生 `selectAll()`，保留真实输入、焦点与紧前 guard。
- Chromium 的副作用检查会拒绝部分正常 DOM 读取（隔离页 `getElementById` 可复现）。新增固定 `probe:{selector,attributes?}` 返回精确 `{url,nodes:[{text,value,attributes}]}`；在隔离 world 执行固定读取，不运行页面包装函数。任意 expression probe 继续接受副作用检查，未放宽为任意写入。
- Phrase Skill 1.0.6：最终差异清单、同句合并、连续有界执行、最终状态核验、组末保存/记账；原生标签、冲突、QA/TM 和 Accepted 边界保留。
- in-app-browser 1.1.3 及工具 schema/说明同步固定 DOM 读取。共享合同经既有工具与 IPC 透传，没有新增 IPC 通道或站点自动化框架。

## 验证

已执行并通过：

- `bun test apps/electron/src/main/lib/browser-input.test.ts apps/electron/src/main/lib/browser-input.browser.test.ts`：4 项通过。实际 Chromium 覆盖快捷键被拦截后的替换/清空、固定 DOM 读取不执行页面包装函数、用户改动阻断写入、标签/变量、原有停止/部分成功和保存屏障。
- `bun run typecheck`：全工作区通过。
- `bun run check:boundaries`、`node --test tests/linguist-fusion-architecture.test.mjs`：通过。
- Electron `build:main`、`build:agent-runtime`：通过。保留已有 CAT runtime 的 CJS/import.meta 构建警告。

代码样例只用合成页面与临时 profile；没有操作真实 Phrase 任务、热改工作区 Skill 或替换运行中的安装版。此轮证明故障样例修复，不证明真实 Phrase 保存/富文本全流程或实际提速倍数。安装与现场验证留待用户今晚任务结束后明确安排。
