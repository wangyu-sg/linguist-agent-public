# 0.17.75 实施与发布验证

日期：2026-09-16。起点 `44d675b58549f3a0ed67cbd51ab677997b47403b`，工作分支 `codex/la-01775-browser-native-parity-20260916`。Proma v0.19.53、Pi 0.85.1、Electron 43.2.0、Bun 1.3.14 保持固定。

## 实现

- BrowserPress 采用显式 text/key，拒绝旧快捷键字符串；真实输入节点、焦点与紧前 guard 经同一控制器执行。
- BrowserAct 支持至多 64 个步骤、30 秒总预算（含排队）；复用 tab 队列，返回成功前缀、失败/未知位置及未执行范围。Pi 将未完成序列标为工具错误，保留结构化结果。
- probe 是同步只读 JSON 函数，由 Chromium side-effect check 和执行时间预算限制；不内建站点选择器。当前 Chromium 对部分 DOM 方法（如 getElementById）也会拒绝，需使用实际已验证的只读表达式。
- Linguist 退役独立整块侧栏；原生列表处理展开、归档、搜索、会话行和子会话，领域仅提供项目数据/操作。关闭原生组件返回 CAT。Agent/Linguist 顶栏恢复上游尺寸与展开入口；Chat 视觉/操作本来已一致，保留无障碍增强。
- Automation 持久化领域身份/岗位/范围；真实 session binding、reuse/daily 检查和 headless 执行复用原生服务。跨工作区清除旧绑定，既有运行记录保留原快照；不存在 scope 不代表全项目授权。
- 正式包包含 Phrase Skill 1.0.5、in-app-browser 1.1.2；后续源码修复见当前事实，不追记为此包内容。

## 自动验证与边界

发布源码：`85aa7e5da0f1ed63a6ed63d5bcd8a89c24fdd8a1`。以下自动检查已经实际执行：

| 检查 | 结果 |
|---|---|
| `bun install --frozen-lockfile`、`bun run typecheck`、默认 `bun run test` | 通过；最终小范围 UI 修正另跑 Electron 类型与架构检查 |
| `bun run check:boundaries`、架构、host seams、同步策略回放、license/public identity | 通过；推送前扫描公开树及四个新增提交 |
| 实际 Chromium 按键、焦点、guard、步骤序列、冲突、取消、保存失败 | 通过；执行真实控制器和 CDP |
| CAT 编辑/草稿、七种原生组件的打开/关闭导航 | 通过 |
| 定时任务 new/reuse/daily、范围变更、重启/来源删除、真实 Store 只读快照 | 通过 |
| `bun run electron:build` 与 `bun run smoke:vertical` | 干净发布 SHA 六步全部通过；Agent/Chat 各 19 PASS，CAT 32 PASS / 0 FAIL / 2 MANUAL |
| `node scripts/smoke/probe-pb074-e2e.ts --lf056-only` | 26 PASS / 0 FAIL；基于相同产品代码（后续仅补新建项目焦点标识） |
| 顶栏真实窗口检查 | 通用 Agent / Linguist 均为 48px；收起后按钮可见并能重新展开；项目徽标是静态 span |
| 包内默认 Skill | Phrase 1.0.5、in-app-browser 1.1.2 |

本地最终报告：`apps/electron/out/smoke/vertical/vertical-smoke-report.json`。其 `sourceHead` 为上述发布 SHA，`workingTreeDirty=false`、六步 exitCode 均为 0。未签名包 app.asar SHA-256 为 `6e2d47368e6ac22dbe84dd955f3ac374f1b1dedd462824143f7630212b06eb37`；正式签名产物另行记录。

两类旧探针假设已修正：Linguist 使用共享侧栏容器/菜单，并从原生 CAT 标签返回；Chat 通过实际模式入口切换，不再依赖可能被会话恢复覆盖的 localStorage 写入及旧按钮的固定超时等待。

### 合成页面调用量

1 句：原子接口 3 次、steps 1 次；5 个不同句段：原子接口 15 次、steps 1 次。各运行 3 次，仅测本机控制器耗时：1 句中位数约 2.91/2.19ms，5 句约 14.22/12.64ms（原子/steps）。这证明合并了宿主调用，不包含模型往返、授权等待、网络或真实 Phrase 操作；不据此给出真实提速倍数。

富文本行末换行在合成 inline contenteditable 中出现额外换行，严格读回阻止继续。单行富文本结构与 textarea 的 LF/字面反斜杠分别校验；这不证明真实 Phrase 富文本多行编辑可用。实际编辑器需要一次结构/保存校准，不可静默裁剪或归一文本。

## 尚未验证

- 未取得 Phrase 测试工作：真实 DOM、标签/格式、多行、保存、TM/QA 与 Accepted 流程未校准，无启用的站点写入配方。
- 不用本地 fixture 时长推断模型往返、浏览器授权等待或真实 Phrase 提速。
- 旧版到新版的自动更新链路未验证；真实 Provider、人工 IME/Native Open/Save 等资格不由本轮自动测试推定。

## 发布

正式发布流水线：[Release 35094944942](https://github.com/wangyu-sg/linguist-agent-public/actions/runs/35094944942)。验证、三平台构建、Mac 更新清单合并及发布均成功。

[公开 Release](https://github.com/wangyu-sg/linguist-agent-public/releases/tag/v0.17.75) 于 `2026-09-16T12:37:42Z` 发布，非 draft，Tag 指向上述发布 SHA。七项资产齐全：latest-mac.yml、latest.yml、arm64/x64 DMG/ZIP、Windows x64 EXE。实际下载的两份 ZIP 和 EXE 的 SHA-512 与更新清单相符，文件大小与 GitHub 资产相符；Mac 清单的 size 也匹配，Windows 清单没有 size 字段。两个 DMG 的公开下载 URL 均返回 HTTP 200。机器结果见 [RESULT_0_17_75.json](./RESULT_0_17_75.json)。

远程 artifact `packaged-vertical-35094944942-1` 已下载核对：sourceHead 与发布 SHA 相同、workingTreeDirty=false，六步 passed/exitCode=0；人工原生对话框资格仍是 partial。

## 签名、Skill 升级与本机安装

正式 arm64 ZIP 的 `codesign --verify --deep --strict` 通过，Authority 为 `Linguist Agent Self Update`，CDHash 为 `d6190317a3cb1b0afc3d279e2f7cc7347a5f1ec8`。这是项目自更新证书，不代表 Developer ID 公证。隔离真实启动通过 Agent/Linguist 顶栏收起再展开，以及 Phrase Skill 新工作区安装、旧 active 升级、inactive 原位升级且不启用、较高自定义版本保留。

用户报告自动更新失败后，明确授权替换本地安装版。已正常退出旧版、保留临时备份、安装正式 arm64 包、验签并重新启动。安装版版本为 `0.17.75`；安装与下载解包的 app.asar SHA-256 均为 `0b8cdee444ce21129991750fee8c5bf235cf4ee9482bff11d5b4772c2c31cd27`。

旧安装版为 `0.17.74`，ad-hoc 签名、Identifier=Electron，与正式签名不同。这支持签名不匹配的判断，但没有从更新失败日志确认唯一原因；手动安装成功不等于自动更新已验证。
