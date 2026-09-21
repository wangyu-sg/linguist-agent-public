# LA 0.18.0 实施与验证

状态：工程和候选打包验证通过；真实语言验证待系统 Keychain 授权入口恢复。尚未公开发布，日用安装未替换。

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

### 本地候选来源

打包在 `276c2ea7` 上含本次未提交变更的候选树进行；机器报告明确 `workingTreeDirty=true`，不是声称旧提交已包含新实现。构建后冻结的 apps/packages/resources/scripts 及 manifest 共 1628 个文件指纹为 `918cae5b9b3bce7b4322e165c54827293fea0df168f60e3abf05ce9568c4c5ca`，正式提交前将核对该集合不变。

候选 `app.asar` SHA-256：`86461aef551e69cb351b2a43dceec1202d97d5e92c0cbc3afb423d240769bfe3`。运行与机器报告存于候选工作树的 `apps/electron/out/smoke/vertical/`；这是独立测试安装，不是日用安装或正式签名 Release 包。

### 真实语言验证

输入分为 36 个常规案例（其中 7 个与方法示例同源，单列回归）和 6 个独立小样；生成侧白名单去掉评价预期。计划按 T/E/P 分组，再用真实 T 结果接续 E/P。用户已授权只读复用模型鉴权，所有输入/产物/会话隔离，暂未读取客户会话或写入鉴权。

当前不能用 Fake Provider 的通过替代真实语言结果；语言结果、配置、原始 usage 和模型辅助盲核将在实际请求完成后补入。模型评价不等于独立人类认证，生产提速、Phrase 与游戏内质量另行验证。

## 发布顺序

首次候选安装/资源核验及真实语言运行在 Tag 或 release dispatch 前完成。既有 Release workflow 构建成功会自动公开 latest，不假定存在人工等待门。发布后的核对仅确认实际下载资产与更新清单。用户自行在线更新，开发过程不替换日用安装。

## 限制

此版本不修改 Pi 压缩器；语言小样本、结构测试与工具合同都不能证明所有客户项目已通过。较新定制 Phrase Skill 不自动覆盖，私有合并只在新运行边界启用。客户批次、真实 Phrase/游戏内 LQA 和在线更新链路单独记录。
