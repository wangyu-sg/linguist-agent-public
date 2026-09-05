# KNOWN_LIMITATIONS — 当前已知限制

更新日期：2026-09-05

> 当前目标是作者本人使用的个人 Alpha。实现、单元验证、打包验证、真机人工和产品资格是不同证据等级。

## A. 尚缺的真实与人工证据

1. **真实 Provider 与模型质量**：历史单次真实请求不能证明本轮候选的 Provider 协议、网络重试或翻译质量；Fake Model、Prompt 合同和格式 round-trip 也不能替代这些证据。
2. **四岗位全链**：尚未用真实 Provider 完成 Translator → Reviewer → Proofreader → `verified` 交付并复核输出。
3. **对照评估**：尚未用同一模型、同一 reasoning 和同一真实任务比较 Web Chat、旧 LA 与当前 LA。
4. **14 天日用**：必须从当前可用构建重新累计，不能由开发日或自动测试补记。
5. **真机人工**：真实 macOS IME composition、Native Open/Save、Companion round-trip、VoiceOver、完整 keyboard-only、窄窗和拖拽/resize 仍待操作。

## B. 当前功能边界

1. `cat_import_resources` 的目录递归单次最多处理 500 个条目，不跟随符号链接目录；超大目录应拆分导入。
2. XLSX 批次和 TM/TB 仍需要显式 Sheet/列映射；目录导入遇到这类文件会返回 `needsInput`，不会猜测后静默写入。
3. Tag 编辑器采用原生 textarea + chip overlay。硬 Tag 改动会阻止保存，但它不是 contenteditable 的原子不可拆 token 控件。
4. Phrase 内容配对和 mapping 已通过一组真实私有副本验证，但未见过的客户生成器变体仍需逐样本验证；过期或不完整 mapping 会阻止 `verified` 交付。
5. `as-is` 导出有意允许未完成内容，不代表可交付；`verified` 才执行完整 QA/阶段预检；两种模式都保留结构检查与重新导入验证。
6. memoQ MQXLIFF 专用 Adapter 已通过合成 fixture round-trip，但尚未用真实客户样本验证生成器变体、确认级别与批注互操作。
7. 通用文件撤销使用 Proma File Rewind；Run Undo 只结构化撤销仍满足 revision/状态前提的 CAT 变更。外部 MCP/程序副作用只记录。
8. 旧数据迁移不读取治理 SQLite 的 proposals/ledger/checklist 投影；超大项目迁移仍可能同步占用主进程。
9. General Agent/Chat 使用 JSON/JSONL；CAT 使用每项目 SQLite。两种持久化策略不会互相扩散。

10. 新回执确认的是最终请求获得 HTTP 2xx，不证明流完整或模型理解；未产生响应、被过滤或未知协议不计覆盖。当前 turn/进程结束前未成功记账的内容保持未验证，需重新读取。
11. 旧摘要会话只在恢复时备份并规范化；历史未保存的图片无法恢复。旧 Receipt/无决定边界的 Stage 保留历史和译文，但不能继承新的完成资格。Schema 仍为 19，代码回退不等同数据语义回退，应恢复本轮操作前备份。
12. 自由文本技术约束无法可靠判定范围时保留原声明；覆盖不代表自然语言约束均被机器执行。CAT 文件原地损坏不会自动修复，应使用已有备份恢复。

## C. 性能、构建与平台

1. 当前自动矩阵集中在 macOS arm64；macOS Intel、Windows 和 Linux 尚无真机资格证据。
2. Vite 仍可能报告大 chunk、重复静态/动态 import 和 Browserslist 数据警告；警告本身不等于 build 失败。
3. CJS bundle 对 `import.meta` 有既有 esbuild warning；packaged smoke 只能证明当前宿主路径。
4. serious/critical Axe 自动回归不能替代真实屏幕阅读器和完整键盘操作。
5. Full Integrity Scrub、Backup/Restore 有自动故障注入；真实磁盘耗尽、只读卷、断电和硬件损坏不是本轮 real-machine 证据。
6. 公开 Release 的存在不能证明本机安装版已更新；产物和安装验证状态见 [当前事实](../../CURRENT_FACTS_SIMPLE.md)。

## D. 发布定位与平台资格

发布产物主要用于作者本人安装与自动更新；不承诺公众支持、兼容周期、Developer ID 签名、Apple Notarization 或跨平台真机资格。公开安装包和更新元数据的存在不等于安装、升级与回滚全链均已验证。

## E. 已确认边界

- 数据根已隔离为 `~/.linguist-agent(-dev)`；旧 Proma 根只供显式 Provider-only 导入。
- Project/Session binding、数据库身份、导出路径和恢复流程均 fail closed。
- 所有 BrowserWindow 固定 context isolation、sandbox、禁用 Node integration 并启用 webSecurity。
- 旧 Auditor、Execution Policy、公开 Critic 和 Translation Scope 不再是 active 产品流程；历史源码/DB/报告不能反向恢复它们。
