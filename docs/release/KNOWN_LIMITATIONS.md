# KNOWN_LIMITATIONS — 当前已知限制

更新日期：2026-07-29

> 当前目标是作者本人使用的个人 Alpha。自动化、打包 smoke、真机操作、远端 CI 和 Release qualification 是不同证据等级。

## A. 尚缺的外部与人工证据

1. **真实 Provider**：Fake Model packaged smoke 覆盖 Agent/Chat/CAT 流程，不证明真实 Pi/Claude Provider、网络重试、权限和模型质量。
2. **LF-048**：真实 macOS IME composition 与 Native Open/Save 对话框仍需人工操作。
3. **AC-009**：VoiceOver、完整 keyboard-only、拖拽/resize 手感仍未验证。
4. **AC-010**：Fast / Balanced / Best 只有离线评估框架；真实游戏文本盲评尚未执行。
5. **AC-011**：尚未完成连续 14 天真实项目使用。

## B. 当前功能边界

1. 真实客户格式兼容性仍依赖用户样本；现有 XLIFF/SDLXLIFF/MXLIFF/Phrase DOCX/CSV/JSON/XLSX 主要由仓库 fixtures 覆盖。
2. 通用文件撤销使用 Proma File Rewind；Run Undo 只结构化撤销仍满足 revision/状态前提的 CAT 变更。外部 MCP/程序副作用仅记录。
3. Full Integrity Scrub、Backup/Restore 已有生产路径与确定性故障注入；真实磁盘耗尽、只读卷、强制断电和硬件损坏仍不是 real-machine 证据。
4. 旧数据迁移不读取治理 SQLite 的 proposals/ledger/checklist 投影；超大项目迁移仍可能同步占用主进程。
5. General Agent/Chat 使用 JSON/JSONL；CAT 使用每项目 SQLite。不要把其中一种持久化策略强行扩散到另一域。
6. 一些 Proma 继承的品牌/文件格式名仍存在，例如 `.proma-backup`、`.proma-share` 和部分 logo/CLI 文案。

## C. 性能、构建与无障碍

1. 当前自动矩阵集中在 macOS arm64；其他硬件、macOS Intel、Windows 和 Linux 未做真机资格验证。
2. Vite 仍报告大 chunk、重复静态/动态 import 与旧 Browserslist 数据警告；当前 build/pack 不失败，但若启动或更新性能出现测量回退再处理。
3. CJS bundle 对 `import.meta` 有既有 esbuild warning；packaged smoke 已通过当前 fallback 路径，不能据此推断所有平台一致。
4. serious/critical Axe 已清零，但 moderate landmark 与真实屏幕阅读器结果不能由 DOM 测试替代。

## D. 公众发行（当前不在范围）

- Developer ID 签名与 Apple Notarization；
- Gatekeeper/签名 DMG；
- 自动更新通道和签名版本升级/回滚；
- 跨平台构建与最终法律/再分发复核；
- 公众 release notes 与安装包发布。

## E. 已关闭、不得继续误报

- G9 已用真实旧数据副本复跑通过，源副本字节不变。
- 数据根已隔离为 `~/.linguist-agent(-dev)`；旧 Proma 根只供显式 Provider-only 导入。
- Project/Session binding、数据库身份、导出路径和恢复流程均 fail closed。
- 所有 BrowserWindow 已固定隔离、sandbox、禁用 Node integration 并启用 webSecurity。
- 根测试不再容忍已知失败；当前 clean source 全仓为 1,320 pass / 0 fail。
- 公开源码实现快照 `9ed5e8dd` 的 GitHub Actions Run `30450830504` 已成功，历史许可扫描失败已关闭。
