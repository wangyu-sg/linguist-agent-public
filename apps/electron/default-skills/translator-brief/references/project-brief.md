# 可复用的项目要求简报

长期项目需要持久化要求时，在绑定工作区文件根的 `.linguist/project-brief.json` 保存派生简报；已有等价知识文件可继续作为原件，通过引用关联，不复制第二套规范。缺少简报不阻止作业。使用已有文件工具的原子写入，不改客户原件。

`schemaVersion` 为 1；`projectIdentity` 记录真实 `projectId/sourceLocale/targetLocale`；`purpose` 说明用途，可附 `audience`。`sources` 中逐来源记录 `ref/version/coverage`，coverage 是 complete/partial/unknown 的整理声明，不是逐段应用或批准证明。`approvalProvenance` 只填写可定位的客户/用户记录，不把模型建议标为批准。

来源版本：`context-doc:<id>` 使用 `cat_read_context_doc` 返回的 `docVersion`（包含正文与定位版本）；`style-rule:<id>`、`tech-constraint:<id>` 使用当前 context 返回的 version；`workspace-file:<相对文件路径>` 使用原件内容 SHA-256。工作区引用不能越界或通过符号链接读外部文件。其它来源可保留导航，但自动摘要将其最新版本标为未核实，不假定当前有效。

每个 `requirements` 项包含：

- `id`：稳定要求身份。
- `statement`：从原件提炼的必要要求。已有 projectRules 时省略此字段，只引用现有规则身份/版本，正文由 Store 取得。
- `appliesTo`：对象，值为字符串数组，例如 `{"textTypes":["tutorial"]}`；不要把局部规则标为全项目。
- `strength`：required/preferred/advisory，依据原要求，不自行升级。
- `sourceRefs`：`[{"ref":"来源身份","version":"实际版本","locator":"章节/位置"}]`，必须对应 sources 中的来源。

另有 `referenceRoutes`：`[{"purpose":"用途","ref":"来源身份","version":"实际版本"}]`；`unresolved`：`[{"issue":"未决问题","sourceRefs":[],"affects":["受影响范围"]}]`。空集合用空数组。

自动摘要核对身份与可取得的原件版本；变化项标 stale，只返回原件路由，不继续注入旧要求。完整基线才支持增量补充；未知、部分整理与缺失版本明确保留。这里的整理状态与 CAT Stage、平台确认及语言质量各自独立。
