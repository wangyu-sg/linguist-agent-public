# LA 0.18.0 实施与验证

状态：`0.18.0` 已于 2026-09-22 15:45:29（Asia/Shanghai）[公开发布](https://github.com/wangyu-sg/linguist-agent-public/releases/tag/v0.18.0)并成为 latest。源码/Tag 为 `a7c80c20`；日用安装未替换，用户自行在线更新。

## 已实现

- B/C：公共 Prompt、四岗位、专业 Skills 与可选派生项目简报；基于实际来源版本判定 stale，不建立第二知识库。
- D：context schema 2 共享正文、最终结构装页、无损分片、当前未附资料和历史覆盖分开；显式 metadataOnly 续页。
- E：事务内逐项 apply 回执、回滚无幽灵 ID、原版本幂等重放；文件工作副本 prepare/assemble 输出 JSON 工作成果与差异，复用现有格式解析，不是原生交付导出。
- F：ICU 复数类别的语言兼容；原有变量、select、offset、锁/CAS 保留；项目 grammar 仅由明确声明的受控策略启用。
- G：默认 Phrase 流程收敛；私有覆盖合并候选与公开发行分离，不在活动任务中替换。
- H：当前批次 Stage 事实、建议生成版本/依据、工作区 Skill 文件来源与 hash。用量沿用原生会话统计；未采集的历史装配、窗口及精确压缩耗时不推定。

## 验证记录

- 全工作区 typecheck、Proma 边界（4 项 / 2969 断言）、宿主接缝与同步重放：通过。
- 完整默认回归按原命令链完成：起始 Bun 集合 315 项；MCP、项目切换、协作、定时任务、Store、CAT tools、Stage host、delivery、Evidence workflow 与 host lifecycle 后续集合均通过。首次两处旧断言因新工具说明/数量不再匹配，调整后对应集合各 5 项通过；没有隐藏失败。
- 最后变更定向复验：简报/语言输入/工作稿等 4 文件共 13 项、84 断言；结构与 QA 44 项；上下文 schema/metadataOnly 4 项，均通过。
- 工作稿覆盖跨会话 T→E→P 接续、保留上一阶段 Target、阶段差异与累计差异、完整身份/版本/锁检查、原件不变及成果目录隔离。
- 依赖许可扫描与 SBOM 一致性通过，没有升级第三方依赖。
- `electron:build` 通过；随后 `smoke:vertical` 重新构建并完成六步：package、workspace-deps、Agent、Chat、project-switch、Linguist。Agent 19 PASS，Chat 19 PASS，Linguist 32 PASS / 0 FAIL / 2 MANUAL。原生 Open/Save 没有执行人工交互，整体覆盖为 partial。
- 打包后 248 个默认 Skill/岗位资源文件逐文件 hash 与源码一致，包括新增 game-localization 及其 references。
- 远程 CI `35629138226` 的 validate 与六步打包通过；额外 Dock 专项因新来源说明与旧整段精确文本断言失配而失败。断言改为在同一来源区匹配规则正文后，本地专项 27 PASS / 0 FAIL；最终 main CI `35699307235` attempt 2 已重验通过，包括 Dock 27 项。

### 本地候选来源

打包在 `276c2ea7` 上含本次未提交变更的候选树进行；机器报告明确 `workingTreeDirty=true`，不是声称旧提交已包含新实现。构建后冻结的 apps/packages/resources/scripts 及 manifest 共 1628 个文件指纹为 `918cae5b9b3bce7b4322e165c54827293fea0df168f60e3abf05ce9568c4c5ca`，提交 `bb604c61` 时已核对该集合完全一致。此后仅修改了 Dock 专项脚本的一行文本断言及验证文档，产品构建输入未变。

候选 `app.asar` SHA-256：`86461aef551e69cb351b2a43dceec1202d97d5e92c0cbc3afb423d240769bfe3`。运行与机器报告存于候选工作树的 `apps/electron/out/smoke/vertical/`；这是独立测试安装，不是日用安装或正式签名 Release 包。

### 真实语言验证

实际运行日期为 2026-09-22，UTC 07:13:21–07:17:13（Asia/Shanghai 15:13:21–15:17:13）。使用 `gpt-6-astra` / `openai-codex-responses`，20 次请求的有效 effort 均为 `xhigh`；实际模型目录解析窗口 272000、maxTokens 128000。候选 Prompt `3.1.6`，Pi `0.85.1`，原生 Skill 展开已观察到。输入去掉 evaluation/cohort，未读取客户会话。

8 组包含 42 个独立案例，以及将真实 T 输出送入 E、再将 E 输出送入 P 的 6 次接续判断。合计执行 232.210 秒、20 次请求、14 次 read；没有调用/解析错误、遗漏 ID、模型重跑或压缩事件。该时间不含 runner 准备、鉴权等待与独立评价，不能外推客户项目提速。独立进程只读复用鉴权，刷新 0 次，原配置和日用安装未变。

原生 Pi usage 合计：`input=51813`、`cacheRead=35840`、`cacheWrite=0`、`output=5513`、`totalTokens=93166`。每条 assistant usage 只计一次，reasoning 子集未另返回；累计输入不当作唯一正文体量，不换算费用。

独立上下文先只看 Source、任务和最终 Target，再查看 rubric；仅在全部盲判完成后核对 E11 的公开说明。结果为**模型辅助评价**，没有独立人类认证：

| 样本组 | 通过 | 正确保留 | 正确待上下文 | 需修改 |
|---|---:|---:|---:|---:|
| 同源方法示例回归（7） | 5 | 2 | 0 | 0 |
| 其余既有合成回归（29） | 16 | 12 | 1 | 0 |
| 新样（6） | 4 | 2 | 0 | 0 |
| E/P 接续判断（6，不计新案例） | 0 | 6 | 0 | 0 |

E11 的孤立 `Join` 正确保留“加入”，并只询问区分加入、连接或合并所需的界面/动作信息；没有把未知事实猜成通过。结构测试、样本评价与生产质量互不替代。运行计数与实际 Target 见 [脱敏语言证据](./evidence/0.18.0-language.json)，不包含鉴权或隐藏推理。

## 发布顺序

首次候选安装/资源核验及真实语言运行在 Tag 或 release dispatch 前完成。既有 Release workflow 构建成功会自动公开 latest，不假定存在人工等待门。发布后的核对仅确认实际下载资产与更新清单。用户自行在线更新，开发过程不替换日用安装。

## 正式发布核验

- main CI `35699307235` attempt 2 成功，机器报告 `sourceHead=a7c80c200d5f4043469626bd9b2fab07629ff524`、`workingTreeDirty=false`、六步均 passed/exitCode=0，Dock 专项 27 PASS。首次并发取消与早先候选的旧断言失败不计为通过。
- Auto Release `35700030085` 成功；Tag 实际解析为同一源码 SHA；GitHub latest 为 `v0.18.0`，非草稿/预发布。
- 两套 macOS DMG/ZIP、Windows x64 EXE、两份更新清单共 7 项资产齐全，blockmap 已删除。
- 最终 `latest-mac.yml` 同时列出 arm64/x64 ZIP；两个 ZIP 和 Windows EXE 的下载 SHA-512 与各自清单一致，大小与 GitHub 资产元数据一致（macOS 清单也提供并匹配 size，Windows 清单未提供 size）。
- 两个 macOS ZIP 解包后的版本均为 0.18.0，`codesign --verify --deep --strict` 通过，均满足旧安装的 designated requirement，证书 root SHA-1 为 `065e1da4385a42fc59b0c2da5daa7b6e2b39b969`。
- 正式 arm64 包在隔离临时数据根中启动：Agent 19 PASS、Chat 19 PASS、Linguist 32 PASS / 0 FAIL / 2 MANUAL；启动后签名仍有效，248 个默认 Skill/岗位资源文件与源码逐文件一致。没有在 arm64 主机执行 x64/Windows 包。
- [发布机器证据](./evidence/0.18.0-release.json)记录资产哈希、CI 与正式包 ASAR 哈希、签名及覆盖边界。用户日用安装和数据未替换，下载包启动通过不等于在线更新端到端通过。

## 限制

本机日用安装在只读验签时返回 invalid signature，原因未调查。本次不会替换安装；正式发行包须验签并核对旧安装的证书要求，在线更新端到端仍由实际更新确认。

此版本不修改 Pi 压缩器；语言小样本、结构测试与工具合同都不能证明所有客户项目已通过。较新定制 Phrase Skill 不自动覆盖，私有合并只在新运行边界启用。客户批次、真实 Phrase/游戏内 LQA 和在线更新链路单独记录。
