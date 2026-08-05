# 本地化专家工作流与资产谱系调研（PB-095/096/097 共同依据）

> 日期：2026-07-27　调研人：Kimi（用户=本地化专家，全程拍板）
> 脱敏声明：本文件只含**结构形态**（列名、工作流、资产分类），不含任何客户名称、项目文本、角色名或译文。结构样本来自用户授权的某头部游戏 IP 真实项目参考资料（2026-06 批次）与用户个人模板；原资料一律不入仓（PB-116 排除清单：客户文件/真实项目文本）。

## 1. 真实专家工作流（行业证据 + 用户实战互证）

- **ISO 17100 TEP**：Translation → Editing（第二语言专家双语审校）→ Proofreading（单语通读）；译前必须有 translation brief，翻译阶段明确要求依据"client's terminology **and style guide**"。
- **开工五件套**（用户实战 prompt 的第一动作）：Style Guide / Glossary / Context / Tech Constraints / Game DNA——真实头部项目的参考资料恰好覆盖全部五类，理论被实战坐实。
- **译中**：每段在多类资产间交叉确认（TM 先例、TB 术语、Style Guide 语气、Context 语境、截图 UI 约束）。
- **译后**：LQA 按错误类型学系统标注（用户《通用缺陷等级》即项目实战标准，已随参考资料下发并被项目方采用）；游戏行业另有母语专家实机 LQA。

## 2. 资产六类（用户 2026-07-27 拍板的 LA 资产骨架）

| 类 | 真实形态（脱敏结构） | 要点 |
|---|---|---|
| ① Style Guide | xlsx「规则行」：说明 + 源文示例 + ✅推荐/❌反例对照 + 更新日期/更新人 + 截图引用；按内容类型分组（卡牌/角色/活动/道具/任务/标点各一组） | 有版本演进（V  dated 文件）；含**资产继承裁决**（子项目与母 IP 术语冲突时子项目优先；共享条目沿用母 IP 译名） |
| ② 术语 + 句式 | 术语表：Module / Category（多标签）/ 双语 / 双语备注 / 参考文档 / 图片参考 / 状态（已上线等）；**高频句式库**：更新时间/人 + 原文 + 改前译文 + 建议译文 + 备注 + 确认结果 + 确认人 | 句式是介于 TM 与术语之间的一等资产，带**审批流**（旧译→新译+审批人）；术语变更有 Change Log |
| ③ TM | （新仓已有，PB-080） | — |
| ④ Context | 角色/单位设定表（含立绘截图，数十 MB 级）；Style Guide 内嵌截图列 | 大附件以引用为主；需可被检索引用（memoQ LiveDocs 定位） |
| ⑤ Tech Constraints | 富文本说明文档 + **本地化语法 Tag 格式文档**（引擎语法 tag 系统，见 §3）+ 长度约束（UI 按钮字符上限） | tag 族是**项目级可登记**的；长度约束挂在 UI 场景 |
| ⑥ Game DNA | 台本结构：角色名 / 语音功能（场景分类）/ 资产文件名（wav key）/ 原文 / 备注 / 译文；角色声口含自称/口癖/称谓体系 | speaker + 场景功能 = 段级上下文；角色声口表驱动 character_voice 类检查 |

**活的项目中枢**（超越静态资产）：答疑 Query 表（状态机：Solved/…、日期、提问人、语对、文件名、Key、原文、译文、问题、回答方/回答）+ EN-Issue Log + 多轮通修 batch 记录 + 变更更新说明文档。Query 闭环由项目方官方回答，是译员与客户的唯一正式疑义通道。

## 3. 引擎语法 Tag 系统（PB-097 设计输入，脱敏族清单）

- 语法组 `[Grm:*]`：单复数 Qty（S/P/Idx）、俄语专属复数 Qty_RU（S/P/O 三形）、阴阳性 Gen（M/F）、阴阳+数量 GenQty（MS/MP/FS/FP）、序数词 Ord（ST/ND/RD/TH）、大小写 Case（U/Idx）、动态阴阳 Gen_Dyn（按对方性别）、不换行空格 nbsp。
- 富文本：`{X}` 参数（可调序不可变形）、`<color=#hex>…</color>`（成对、位置可调）、`<a href=…>`（链接可按语种替换）、`<b>`、`\n`（建议手动换行替代）、`[图标名]`、`[战斗公式]`、`▋▓▆` 特殊符号、`[time(…)]`、`[表情名]`。
- 规则共性：**tag 必须完整保留、允许调整位置/顺序、成对 tag 必须配平**——全部是机器可硬判性质，正是 PB-097 确定性 round-trip 校验的靶子；对应缺陷表 L0 `placeholders_variables` / `format_tags`。

## 4. QA 契约（PB-096 设计输入）

用户《通用缺陷等级》全盘采纳（2026-07-27 拍板），要点：L0~L4 严重度（L0=幻觉/占位符破坏/标签破坏/反义/合规硬雷）；defect/needs_review/query/info 四处置（query=必须向项目方提问才能继续）；strict/prefer/off 三术语策略（prefer 偏离→默认 needs_review+证据理由）；30 个 issue_type 字符串枚举（含 hallucination/character_voice/register_tone/glossary_conflict/source_issue 等游戏实战型）。另拍板：硬性 QA 规则须覆盖传统 Xbench 类检查（对照旧 LA xbench-like 规则盘点）。

## 5. 被否决项（同样拍板，避免回潮）

- 用户的《项目红线模板》与《通用项目起始 prompt》为老模板，**不作为刚性约束编码进 LA**（对 Agent 工作流会成为枷锁）；只把缺陷等级与资产形态带走，两文件不入仓。
- O'Hagan & Mangiron《Game Localization》（出版读物）仅作领域背景，不 ingest 入仓。
