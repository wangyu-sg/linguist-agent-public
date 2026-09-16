# 浏览器批量回填效率修复

日期：2026-09-16。基于已发布源码 `85aa7e5d`；修复提交 `2468e3e2`，App 版本保持不变。用户随后授权替换本机安装，未发布新的 Release。

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

代码回归只用合成页面与临时 profile，没有操作真实 Phrase 任务。此轮证明故障样例修复，不证明真实 Phrase 保存/富文本全流程或实际提速倍数。

## 本机安装

用户授权后，于当日 23:55（Asia/Shanghai）完成 macOS arm64 打包、正常退出旧版、备份、替换与启动。安装版本仍为 `0.17.75`，代码为 `2468e3e2`；GitHub 同名 Release 仍对应 `85aa7e5d`。

- 使用现有 `Linguist Agent Self Update` 证书签名，与旧安装的 designated requirement 一致；`codesign --verify --deep --strict` 通过。未重新验证自动更新链路。
- 安装路径：`/Applications/Linguist Agent.app`；启动后主进程 PID `80379`，默认模板及 OSgame 工作区的 Phrase / in-app-browser Skill 均已自动升级到上述版本。
- `app.asar` SHA-256：`c2fec54c48b83f7fe5cf3522cdc9b03818a8e5cea3530bfe8f605cc1219d6c5b`。
- 旧正式安装备份：`/tmp/la-2468e3e2-install-backup/Linguist Agent 0.17.75 official.app`。
- 打包日志：`/tmp/la-2468e3e2-pack.log`。保留前述定向回归结果，安装阶段未重复全量烟测。
