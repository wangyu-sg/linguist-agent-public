# PB-085 人工盲评备料：synthetic 双批 + 协议 + 指标

状态：**备料完成，执行阻塞**。阻塞项（G8 账本如实记录，不伪造）：

1. 真实模型 API Key（跑 Fast/Balanced/Best 三档产出；fake model 产出无评测意义）；
2. 用户本人或指定评审做盲评打分（人工分不可替代）。

**排期决策（2026-07-27 用户拍板）**：盲评推迟到全部其他工单交付、app 流畅
运行之后执行——app 做好之前盲评没有好的评测平台。届时按本文件协议执行，
G8 随之复核升级。

本文件交付可在无 Key 条件下准备的全部内容：评测协议、synthetic 双批源文、
评分表模板、指标定义与采集脚本规格。执行时按 §4 跑臂、按 §2 盲评、按 §3 算分。

## 1. 设计依据

计划 §21 PB-085：准备 synthetic 双批，臂（arm）= Fast / Balanced / Best /
人工原始 / 旧 LA 结果（可选）。记录：准确性、自然度、术语、人工修改字符数、
延迟、token/cost。G8 硬标准：Balanced 必须成为可靠默认；Best 必须有可测收益，
不能只更慢。

- **双批**：两个独立源文批次（A=UI/系统文本，B=剧情/角色对话），防止单批
  过拟合；每批含刻意的术语陷阱、重复源文、角色名、占位符与语气分化，恰好
  命中 PB-082 三档策略与 PB-084 一致性类别的考查点。
- **合成而非真实客户文件**：真实客户文件不进仓（纪律）；合成批次按游戏
  本地化典型形态构造，不携带任何真实项目内容。
- **规模**：每批 30 段。Fast 档单轮可覆盖；Best 档小 batch 分轮，恰好制造
  批内一致性考查面。评测总时长控制在一次人工会话内（≤90 分钟）。

## 2. 盲评协议

1. 跑臂（§4）产出每批 × 每臂一份译文，文件命名随机化（如 `run-3f9a.tsv`），
   评审不知道哪份对应哪档；映射表由跑臂人保管，评分完成后才揭晓。
2. 评审逐段对照源文与译文，按 §3 三个维度打分；同时直接修订译文，保存
   修订版（用于人工修改字符数）。
3. 评分表（TSV，每行一段×一臂）：

```text
run_id	batch	segment_id	accuracy	naturalness	terminology	note
run-3f9a	A	A01	4	3	5	术语对但语气偏书面
```

   刻度 1~5：5=可直接交付，4=小修可用，3=需中修，2=需重写，1=不可用/误导。
   accuracy=忠实度（漏译/错译/加译）；naturalness=目标语自然度；
   terminology=术语与角色名一致性（含批内一致）。

## 3. 指标定义与采集

| 指标 | 定义 | 采集 |
| --- | --- | --- |
| 准确性/自然度/术语 | §2 人工分，按臂×批求均值与 blocking（≤2 分）段占比 | 评分表汇总 |
| 人工修改字符数 | 盲评修订版 vs 臂产出的逐段 Levenshtein 距离之和（字符级） | 脚本：`python3 -c` 用 `difflib.SequenceMatcher` 或 `Levenshtein` 包（venv，不装全局）对两列 TSV 计算；脚本执行时现写，规格即本行 |
| 延迟 | 会话首条用户消息 → 最后一条助手消息的主进程时间戳差 | 会话 meta createdAt/updatedAt 或消息日志 |
| token/cost | 三档会话的 input/output token 合计 × 模型单价 | Pi 会话用量记录（orchestrator 已有 token 统计，执行时导出） |

**判定（G8）**：Balanced 可靠默认 = 三维度均值 ≥4 且 blocking 段占比 ≤10%；
Best 可测收益 = Best 相对 Balanced 至少在两个维度均值提升 ≥0.5 分，或
blocking 段占比下降 ≥50%，且延迟/成本增幅有记录——收益不达标或只有更慢，
G8 不过，回计划调整策略档而不是放行。

## 4. 跑臂流程（需 API Key 后执行）

对每批（A/B）×每臂（Fast/Balanced/Best）：

1. 新建临时项目（sourceLocale `en`，targetLocale `zh-Hans`），导入该批 CSV
   （segment key/source 两列，target 空）。
2. 项目设置质量策略档为对应档（PB-082 选择器）。
3. 项目对话发统一指令：「把这个资产全部 30 段翻译成 zh-Hans，完成后
   cat_run_qa。」中途不人工干预（除 Best 档按策略提示点「独立评审」——
   评审会话产出 CRITIC_ finding 后，用一句「按评审 Finding 提交修订提案」
   收尾，仍走人工接受提案——接受动作由跑臂人统一执行，不算干预差异）。
4. 导出译文为 TSV（segment key/target），按 §2 随机化命名。
5. 人工原始臂：评审在无辅助条件下翻译同批（独立进行，不看任何臂产出）。
6. 旧 LA 臂（可选）：旧仓冻结环境若仍可运行则跑，否则记 N/A，不伪造。

TM/TB 准备：三档共用同一项目预置 TB（含批中 8 个术语的 preferred 译法与
2 个 forbidden 译法）与小型 TM（5 条近似句对）——Balanced/Best 档的术语
增益由此可测，Fast 档不查库的差异也由此可测。

## 5. synthetic 双批源文（fixture）

两批各 30 段，key/源文如下（CSV 结构：`key,source`，target 列留空导入）。
考查点标注仅供跑臂人核对，不随盲评材料给出。

### 批 A：UI/系统文本（en→zh-Hans）

考查点：占位符（{player}/{n}）、术语陷阱（"fusion" 非"融合"是合成、
"sanctuary" 是圣所非庇护所——随 TB preferred 给定）、重复源文（A06/A07
同文不同语境——一致性考查）、命令式语气统一。

```csv
key,source
A01,"Welcome back, {player}!"
A02,"You have {n} unread messages."
A03,"Fuse two items to create a stronger one."
A04,"Fusion failed: the items are incompatible."
A05,"Enter the Sanctuary to restore your party."
A06,"Cancel"
A07,"Cancel"
A08,"Settings saved."
A09,"Daily reward claimed. Come back tomorrow!"
A10,"Inventory is full."
A11,"Equip this item?"
A12,"Unequip"
A13,"Server maintenance starts in {n} minutes."
A14,"Purchase successful!"
A15,"Insufficient gems."
A16,"Claim"
A17,"Claim all"
A18,"New quest available: {quest}"
A19,"FPS dropped below 30. Lower your graphics settings?"
A20,"Screenshot saved to gallery."
A21,"Link your account to keep your progress."
A22,"Account linked."
A23,"You were disconnected. Reconnecting..."
A24,"Patch 3.2.1 is ready to install."
A25,"Report player"
A26,"Mute"
A27,"Unmute"
A28,"Party invite from {player}."
A29,"Loading assets…"
A30,"Quit to title screen?"
```

（A06 为取消合成确认、A07 为取消举报弹窗——同文异境，目标语应一致；
此处故意不提供语境注记给翻译臂，以测真实表现。）

### 批 B：剧情/角色对话（en→zh-Hans）

考查点：角色名一致（Kaelitha/Mirror Tribunal 全批出现——TB preferred）、
voice 分化（B01-B10 将军冷峻简短、B11-B20 小妖精碎嘴俚俗）、重复源文
（B16/B26）、文学性 vs 直译的准确性取舍。

```csv
key,source
B01,"Kaelitha does not kneel. Not to kings, not to gods."
B02,"The Mirror Tribunal has already judged you."
B03,"Hold the gate. No one passes while I still draw breath."
B04,"Your report. Now."
B05,"So be it."
B06,"I remember when this valley was green."
B07,"Do not mistake my silence for mercy."
B08,"Archers, on my mark."
B09,"The wound is nothing. The shame is everything."
B10,"Dismissed."
B11,"Ooh! Shiny! Can I keep it? Pleeease?"
B12,"Snikkit saw nothing, heard nothing, knows nothing!"
B13,"You smells like coins, friend. Good coins!"
B14,"No no no, that one bites. That one definitely bites."
B15,"Snikkit knows a shortcut. Maybe. Probably!"
B16,"Wait. You hear that?"
B17,"Kaelitha won't like this. Nope. Not one bit."
B18,"Shhh! The Mirror Tribunal has ears everywhere."
B19,"Trade you! This button for that shiny ring!"
B20,"Snikkit is brave! Snikkit is just... careful."
B21,"The general carried her out of the fire herself."
B22,"They say the Tribunal's mirrors show your last lie."
B23,"We were soldiers once. Now we are a warning."
B24,"Every gate has a price. Hers was a name."
B25,"If the valley falls, let them say we held it an hour longer."
B26,"Wait. You hear that?"
B27,"Kaelitha gave the order before dawn."
B28,"The Tribunal does not forget a debt."
B29,"Bring the healer. Quickly."
B30,"It is done."
```

（B16/B26 同文异境：一为警觉、一为伏击前兆，目标语应一致。）

## 6. 执行检查单（解除阻塞后按序执行）

- [ ] 用户提供真实 API Key 并确认可用模型
- [ ] 建临时项目 ×2，预置 TB/TM，按 §4 跑 3 档 × 2 批
- [ ] 人工原始臂 + 旧 LA 臂（可选）
- [ ] 盲评打分 + 修订版回收
- [ ] 按 §3 算分，填 G8 报告度量表
- [ ] 判定：Balanced 可靠默认 / Best 可测收益，如实写账本
