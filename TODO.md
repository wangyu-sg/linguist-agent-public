# TODO

更新时间：2026-07-30

只记录仍未完成的事项。已实现功能和历史工单见 `docs/roadmap/linguist-fusion-queue.json`。

## 14 天个人使用

- [ ] 从已安装的 `0.15.140` 重新开始连续 14 天真实本地化项目使用。
- [ ] 每个问题记录：复现步骤、项目/资产类型、数据安全影响、频率、期望行为。
- [ ] P0/P1 修复完成后重跑相关 targeted test、全量门禁与 packaged smoke。

## 人工产品证据

- [ ] 真实 macOS IME composition：中日韩输入、候选确认、撤销、保存、确认并前进。
- [ ] Native Save：原稿、受管 source/blobs/exports/backup 路径的覆盖拒绝与默认文件名。
- [ ] VoiceOver：三模式、Project Sidebar、Segment Grid、Bottom Dock、Agent Rail。
- [ ] 完整 keyboard-only 工作流与焦点顺序。
- [ ] Agent Rail / Bottom Dock 拖拽和窄窗手感。

## 翻译质量

- [ ] 用真实游戏文本生成 Fast / Balanced / Best 三档结果。
- [ ] 按 `docs/release/PB085_BLIND_EVAL_PREP.md` 盲评准确性、自然度、术语一致性、人工修改量、延迟和成本。
- [ ] 依据预先写死的判定式决定默认档位，不以主观印象替代数据。

## 外部验证

- [ ] 使用真实 Provider/模型验证 Pi、Claude、Prompt 降级、Thinking、权限与 CAT Tool 链。
- [ ] 用代表性真实客户文件复跑导入、编辑、QA、导出、重导入与恢复。

## 当前不做

- 公众发布、签名、公证、公开更新渠道；
- 新格式、OCR、多 Agent Team、自动模型路由、Extension 市场；
- 重写 Proma Runtime、Agent/Chat UI 或 CAT Core。
