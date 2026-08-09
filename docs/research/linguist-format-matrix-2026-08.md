# Linguist CAT 格式真实频率矩阵（LA-FORMAT-001 · LA-FORMAT-002）

- 日期：2026-08-06
- 扫描器：`corpus-scan.mjs`（scripts 目录；Bun 与 Node 均可运行，用法见文件头注释）
- 回归测试：`corpus-scan.test.mjs`（tests 目录；10 例全部通过）
- 语料：主语料 A（作者本地化工作目录，含历史项目与代码树）、次语料 B（系统下载目录）；均只读扫描，未改动语料中任何文件
- 体积上限：50 MiB，与 `project-delivery.ts` 第 46 行 `MAX_IMPORT_BYTES` 一致（回归测试锁定同步）
- 注册表：生产同款 7 个 adapter，注册顺序与 `format-registry.ts` 一致
- roundtrip 定义：复用 cat-formats testing 子路径的 `assertRoundTrip` harness（import、编辑、export、落盘读回校验、re-import、句段身份比对）；真实语料非范式字节，关闭 unmodified 字节稳定断言
- 失败类别消毒：仅保留错误类名与机器 code，消息中的路径与内容片段已剥离
- 下文 family 名称中的下划线按脱敏自检规则改写为连字符，真实 adapter id 以 `format-registry.ts` 为准

## 1. 总量与 detect 分类

| 指标 | 主语料 A | 次语料 B |
|---|---|---|
| 文件总数 | 146149 | 917 |
| 总字节 | 9319939702 | 7148119172 |
| detected（有 adapter 命中） | 6358 | 120 |
| unsupported（候选文档但无命中） | 5791 | 223 |
| non-document（非候选扩展名） | 133979 | 568 |
| oversize（超 50 MiB） | 21 | 6 |
| detect 抛错 | 0 | 0 |
| 读取失败 | 0 | 0 |
| 重复文件（SHA-256 相同） | 8114 | 19 |
| 重复字节 | 73575953 | 1519767 |
| 隐藏项忽略 | 1143 | 11 |
| 目录读取失败 | 0 | 0 |

## 2. 扩展名频次（各取前 15）

| 扩展名 | A 数量 |  | 扩展名 | B 数量 |
|---|---|---|---|---|
| .ts | 56409 |  | .dll | 472 |
| .js | 43784 |  | .json | 124 |
| .map | 19341 |  | .md | 122 |
| .json | 5709 |  | .jpg | 29 |
| .md | 5142 |  | .pdf | 29 |
| （无扩展名） | 2970 |  | .xlsx | 26 |
| .mjs | 2149 |  | .zip | 14 |
| .woff2 | 1281 |  | .docx | 13 |
| .png | 1257 |  | .ttc | 12 |
| .woff | 1220 |  | .mxliff | 11 |
| .mts | 1218 |  | .png | 10 |
| .proto | 914 |  | .txt | 6 |
| .cjs | 909 |  | .exe | 5 |
| .css | 772 |  | .gz | 5 |
| .cts | 505 |  | .tmx | 4 |

说明：A 的 .ts、.js、.map 等来自语料中携带的完整代码工程与依赖目录，非本地化文档本体；CAT 相关子集以第 4 节 family 分布为准。

## 3. 体积分桶

| 分桶 | A | B |
|---|---|---|
| 64 KiB 以下 | 141388 | 460 |
| 64 KiB 至 1 MiB | 3978 | 351 |
| 1 至 10 MiB | 740 | 79 |
| 10 至 50 MiB | 22 | 21 |
| 50 MiB 以上 | 21 | 6 |

## 4. 格式 family 分布（detect 成功项）

| family | A | B |
|---|---|---|
| json-i18n | 5334 | 4 |
| csv-rfc4180 | 557 | 80 |
| xlsx-ooxml | 353 | 20 |
| sdlxliff-1-2 | 44 | 0 |
| phrase-bilingual-docx-1 | 56 | 1 |
| phrase-mxliff-1-2 | 11 | 11 |
| xliff-1-2 | 3 | 4 |

family 与扩展名交叉观察（真实计数）：

- csv-rfc4180 的低置信内容嗅探（0.5 分）大量命中非 CSV：A 共 166（.md 112、.txt 44、.html 9、.json 1），B 共 77（全部为运行时配置型 .json）。这些命中在 import 阶段必然失败（无双语表头）。
- json-i18n 在 A 的 5334 绝大部分来自代码树依赖目录中的配置型 JSON（依赖清单、工程配置等），并非双语资源文件。
- phrase-bilingual-docx-1 只覆盖 Phrase 双语变体：A 另有 56 个普通 .docx、B 另有 12 个普通 .docx 落入 unsupported。

## 5. roundtrip 矩阵（每 family 确定性采样至多 3，同 family 内跳过重复内容）

| family | A 采样 | A 成功 | B 采样 | B 成功 | 失败类别（次数） |
|---|---|---|---|---|---|
| xliff-1-2 | 3 | 3 | 3 | 3 | 无 |
| sdlxliff-1-2 | 3 | 2 | 0 | 0 | FormatExportError（A 1） |
| phrase-mxliff-1-2 | 3 | 3 | 3 | 3 | 无 |
| phrase-bilingual-docx-1 | 3 | 3 | 1 | 1 | 无 |
| csv-rfc4180 | 3 | 0 | 3 | 1 | FormatParseError（A 3、B 2） |
| json-i18n | 3 | 0 | 3 | 0 | FormatExportError（A 3、B 3） |
| xlsx-ooxml | 3 | 0 | 3 | 0 | FormatParseError（A 3、B 3） |

## 6. 阻断场景归因（类别级；由采样文件私下复跑的原始错误消息归类，消息本身不进本文）

1. xlsx 真实任务全阻断：采样的 6 个真实任务 xlsx（LQA 表单 2 个、同一进行中本地化任务的 3 个版本、术语信息表 1 个）全部 FormatParseError，原因统一为找不到 source 列——真实厂商表头不在别名表（source、src、sourcetext、源文、原文）之内。intake 支持显式列映射之前，xlsx 真实任务阻断率 100%。
2. sdlxliff 复杂 mrk 嵌套：A 1 例（真实审稿流程文件）编辑导出后 target 校验不一致——修改后的译文被 mrk 标签结构包裹，re-import 结果与导出语义不符。需后续 ticket 深挖 mrk 嵌套回写。
3. csv 低置信误中后 import 失败：管道符表格的 .md 文档、含逗号的运行时 JSON 被 0.5 置信嗅探命中，import 因无 source 与 target 表头而 FormatParseError。detect 与 import 的一致性需要收紧（表头校验前置或置信阈值）。
4. json-i18n 编辑导出语义：flat i18n JSON 的导出语义是把译文写入叶值产出译文文件（包内 json.test.ts 已记录该语义），harness 的编辑再导入校验对其不适用；叠加配置型 JSON 误中，A 与 B 采样共 6 例全部 FormatExportError。该类别不视为 adapter 缺陷，但 family 计数需先完成置信治理才可引用。
5. 伪 xlsx：B 有 5 个 .xlsx 并非 zip 容器（扩展名误标的非文档二进制，且内容一致），detect 正确判 0 分，不计入 adapter 缺口。

## 7. unsupported 中的文档需求信号

| 扩展名 | A | B | 说明 |
|---|---|---|---|
| .docx（普通） | 56 | 12 | 无 adapter；Phrase 双语变体已覆盖 |
| .pdf | 56 | 29 | 无 adapter |
| .tmx | 2 | 4 | 包内已有 `parseTmx` 解析器，未注册双语 adapter |
| .strings | 2 | 0 | 无 adapter |
| .md 与 .txt 与 .html 与 .json 合计 | 5620 | 172 | 多数为非双语场景文档，优先级低 |

## 8. 对后续 Adapter 决策的结论

1. xlsx 列映射 intake 为最高优先：真实存量 373（A 353、B 20），采样阻断 6 阻 6（100%）。阻断面是真实进行中任务，不是边角格式。
2. csv 与 json 的 detect 置信治理：误中规模 csv 方向 A 166、B 77；json-i18n 家族在 A 的 5334 大部分为配置型误中。治理完成前，这两个 family 的计数不得用于容量规划。
3. 普通 docx adapter：存量 68（A 56、B 12），属于明确的双语任务输入格式缺口。
4. pdf：存量 85（A 56、B 29），需求真实存在但实现成本高，建议先立调研项。
5. tmx 双语 adapter：存量 6（A 2、B 4），解析器已在包内，注册成本低。
6. sdlxliff mrk 嵌套回写修复：真实审稿文件阻断 1 例，影响交付链路，优先级高于新格式。
7. oversize 共 27（A 21、B 6）：intake fail closed 行为符合预期，需产品侧给出明确提示而非静默拒绝。
8. 重复文件规模 A 8114、B 19：import 去重与重复提示有真实价值（SHA-256 已具备）。

## 9. 脱敏自检与复现

- 逐文件明细、相对文件名与 SHA-256 只写入仓库外的私有报告，不进 Git；本文仅含聚合数字。
- 本文落盘前经 `corpus-scan.mjs --check-doc` 校验：不含路径分隔符，不含固定禁止词，不含语料身份类文件名 token（合计 13983 个；判定规则：全部含 CJK 的 stem、含分隔符或字母数字混合的 stem、长度 8 及以上的纯拉丁 stem。不视为身份标识的三类：纯数字、在 10 个及以上不同文件中出现的通用词、格式与工程通用概念词如 i18n 与 woff2）。
- 复现命令（对任意只读目录）：`bun` 加 scripts 目录下 `corpus-scan.mjs`，后接目录与 `--roundtrip-sample 3` 等参数；Node 运行方式见文件头注释。

## 10. 2026-08-10 能力增量（未重扫上述语料）

| capability | 合成 fixture | 真实样本 |
|---|---|---|
| memoQ MQXLIFF 专用 Adapter（namespace、mq:rxt/mq:ch、bpt/ept、状态、缺陷批注、round-trip） | 已验证 | 待验证；不得用本地真实数据进入 CI |
| XLSX Workbook Mapping（50 行预览、启发式建议、确认保存、fingerprint/文件名模式/header signature 复用） | 已验证 | 待对第 6 节记录的阻断样本重新执行；本次不读取原语料 |

本节只记录实现能力，不回写 2026-08-06 的历史扫描计数。生产注册表已新增 MQXLIFF 专用 Adapter；上文“7 个 adapter”仍是当次扫描的事实。
