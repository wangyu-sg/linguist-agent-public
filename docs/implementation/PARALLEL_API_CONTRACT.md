# Linguist 并行 API 合同

冻结日期：2026-08-10。此合同供 `integration/la-proma-0.16.10` 与
`feature/kimi-k3-linguist-ux` 对齐；项目身份始终来自 Session binding，模型输入不含
`projectId`。

## CAT Tools

### `cat_apply_translations`

```ts
type ApplyTranslationsInput = {
  edits: Array<{
    segmentId: string
    baseRevision: number
    target: string
    note?: string
  }>
  mode?: 'apply' | 'proposal'
}

type ApplyTranslationsResult = {
  requested: number
  applied: number
  pending: number
  stale: string[]
  locked: string[]
  failed: Array<{ segmentId: string; code: string }>
  proposalIds: string[]
}
```

默认 `apply`；内部仍创建 Proposal 并在同一业务操作中接受。`proposal` 仅保留
Pending。单次最多 200 段。旧的 propose / accept tools 继续用于高级操作。

### 术语

- `cat_upsert_terms`：批量新增或按 `id` 更新；字段为 `term`、`translation`、
  `status`、`caseSensitive?`、`note?`、`module?`、`category?`。
- `cat_delete_terms`：批量 `ids`。
- `cat_list_term_conflicts`：读取同一 Source 在适用范围内的多译冲突。
- `cat_validate_terms`：输入 `segmentIds`，服务端读取 Source/Target 后返回
  `missingRequired`、`forbiddenHits`、`preferredNotUsed`、`unresolvedConflicts`。

状态语义固定为：`required` 缺失是 error；`preferred` 缺失是 advisory；
`forbidden` 目标命中是 error；`allowed` 仅参考；`deprecated` 仅建议更新。

### Workbook Mapping

- `cat_preview_workbook_mapping`：输入授权路径；返回 fingerprint、Sheet 预览、
  id/source/target/context/speaker/status 列建议、confidence 与 reasons。
- `cat_save_workbook_mapping`：保存已确认的 fingerprint、Sheet、header signature 与列映射。

### Voice / Exemplar

- `cat_upsert_voice_profile`
- `cat_add_approved_exemplar`
- `cat_get_voice_context`

Approved Exemplar 复用 confirmed Sentence Pattern，不新增独立存储平台。

## 导入与导出

`cat_import_resources` 结果计数固定为：`imported`、`unchanged`、`needsInput`、
`unsupported`、`failed`；逐项结果位于 `items`。可选 `unknownTagSummary` 只提示，
不自动激活规则。旧的含糊 `supported` 计数不再公开。

`cat_export_asset` 使用 `validation: 'verified' | 'as-is'`。`verified` 执行交付检查和
重新导入验证；`as-is` 导出当前结构化状态。默认不覆盖，明确 `overwrite: true` 时
原子替换。

## Tag

继续使用 `cat_scan_unknown_tag_patterns` 与 `cat_save_tag_profile_candidate`。成功导入
Asset 后自动运行轻量未知 Tag 扫描，只返回候选摘要；普通导入绝不自动激活。
