# KNOWN_LIMITATIONS — 当前已知限制

更新日期：2026-07-29

> 当前交付目标是作者本人使用的个人 Alpha，不是公众发行。历史 PB/Gate 报告中的旧限制只有在当前代码或新证据仍能验证时才列入本总账。

## A. 个人 Alpha 尚缺的真实证据

1. **LF-048 手工 CAT Gate**：自动矩阵 20 pass / 0 fail / 2 manual；真实 macOS IME composition 与 Native Save 防覆盖仍需人工操作。
2. **G10 Product Qualification**：长线程和 serious/critical Axe 自动化已通过；VoiceOver、完整 keyboard-only 路径、拖拽/resize 手感仍未验证。
3. **G8 翻译质量**：Fake Model 只能证明 Fast / Balanced / Best 管线可运行，不能证明质量排序。需要真实游戏文本盲评和用户评分。
4. **14 天日用**：代码与自动门禁完成后仍需连续真实项目使用，才能发现工作流摩擦、长时稳定性与数据恢复问题。

## B. 当前功能边界

1. 真实客户格式兼容性仍依赖用户样本；现有 XLIFF/SDLXLIFF/MXLIFF/Phrase DOCX/CSV/JSON/XLSX 测试以仓库 fixtures 为主。
2. 旧数据迁移不读取治理 SQLite 的 proposals/ledger/checklist 投影；超大项目迁移仍可能同步占用主进程。
3. 受管 `source/`、`blobs/`、`exports/` 被本机恶意篡改或内部 symlink 攻击不属于普通用户威胁模型；服务仍通过 realpath、hash 与目录围栏 fail closed。
4. General Agent/Chat 使用 JSON/JSONL；CAT 使用每项目 SQLite。不要把其中一种持久化策略强行扩散到另一域。
5. 一些 Proma 继承的品牌/文件格式名仍存在，例如 `.proma-backup`、`.proma-share` 和部分 logo/CLI 文案；不影响个人使用，但若未来改变发行身份需另做兼容迁移。

## C. 性能与无障碍

1. 当前 macOS arm64 打包矩阵验证了 1000-turn 会话、10k Segment Grid 与 serious/critical Axe；其他硬件和系统尚未验证。
2. moderate landmark 规则仍可能存在，不得把 serious/critical 清零写成“全部无障碍完成”。
3. 屏幕阅读器、输入法和键盘流程的结论必须来自真实应用操作，不以单元测试或 DOM 字符串替代。

## D. 公众发行（当前不在范围）

以下未完成，但不阻断作者本机 14 天使用：

- Developer ID 签名与 Apple Notarization；
- Gatekeeper/签名 DMG 真机矩阵；
- 自动更新通道和签名版本升级/回滚；
- Windows/Linux 与 macOS Intel 真机构建；
- Anthropic/默认 Skills 等二进制再分发的最终法律复核；
- release notes、公开镜像和跨平台 SBOM 收尾。

如果未来决定公开发行，这些项目必须重新进入门禁，不能沿用“个人 Alpha 可用”的结论。

## E. 已关闭、不得继续误报的问题

- G9 已用 197MB / 1905 文件的真实旧数据副本复跑并通过，源副本 1905/1905 字节不变。
- 数据根已隔离为 `~/.linguist-agent(-dev)`；旧 Proma 根只供设置中的显式 Provider-only 导入。
- Project binding 已 fail closed，并提供永久解绑。
- Export 已拒绝覆盖原稿和受管目录。
- 所有 BrowserWindow 已显式固定 sandbox 与 webSecurity。
- 1000-turn 性能旧 FAIL 来自错误 selector，AC-007 修正后 packaged 验证通过。
- Agent/CAT/Projects serious/critical Axe 已由 AC-008 清零。
- 根测试长期容忍的 2 个 Electron mock 失败已关闭；当前全量验证要求零失败。
