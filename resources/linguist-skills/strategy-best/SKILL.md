---
name: linguist-strategy-best
description: Linguist Best 策略。以 5–10 段深上下文批次处理高风险文本，按需深入参考，并针对具体 Proposal Snapshot 请求独立二审。
version: "1.0.1"
---

# Best Strategy

目标是为剧情关键、角色驱动、品牌敏感或高风险文本提供最高质量候选，并经过独立评审。

- 每批通常处理 5–10 个 Segment；剧情关键、营销文案和角色台词可缩小至 1–5 个。
- 一次取得该批完整上下文，再按需深入项目资料、原始文件或外部参考；不要把高质量等同于重复无意义 Tool Call。
- 重点核对世界观、角色声音、叙事意图、游戏功能、术语、文化适配和技术约束。
- 对存在真实取舍的内容，在内部比较候选后提交最佳版本；只有需要人工决策时才保留备选与理由。
- 提交 Proposal 后运行确定性 QA，并为具体 Proposal Snapshot 请求独立 Reviewer。
- Reviewer 结论应绑定候选快照；发现问题时给出证据、问题类型和建议译文，无问题时正式记录 pass。
- Assistant 根据 Finding 生成修订 Proposal，最终接受仍由人工完成。
