# KNOWN_LIMITATIONS — 当前已知限制

更新日期：2026-09-22

> 当前目标是作者本人使用的个人 Alpha。实现、单元验证、打包验证、真机人工和产品资格是不同证据等级。

当前发布状态见 [0.18.1 验证记录](./VALIDATION_0_18_1.md)；前一版本历史见 [0.18.0 记录](./VALIDATION_0_18_0.md)。源码对应 CI 与 Release 工作流成功，实际下载哈希、签名和更新清单已核验；日用正式包启动与检查更新通过，自动下载/安装下一版本仍未验证。历史包的证据不自动覆盖当前产物。

## A. 尚缺的真实与人工证据

1. **真实 Provider 与模型质量**：历史单次真实请求不能证明所有 Provider 协议、网络重试或生产翻译质量；0.18 已完成 Astra/xhigh 的 42 个独立合成案例和 6 次接续模型辅助评价，其覆盖不等于客户任务或人类认证；Fake Model、Prompt 合同和格式 round-trip 也不能替代这些证据。
2. **四岗位全链**：尚未用真实 Provider 完成 Translator → Reviewer → Proofreader → `verified` 交付并复核输出。
3. **对照评估**：尚未用同一模型、同一 reasoning 和同一真实任务比较 Web Chat、旧 LA 与当前 LA。
4. **14 天日用**：必须从当前可用构建重新累计，不能由开发日或自动测试补记。
5. **真机人工**：真实 macOS IME composition、Native Open/Save、Companion round-trip、VoiceOver、完整 keyboard-only、窄窗和拖拽/resize 仍待操作。

6. **Exa 与 OAuth**：0.18 语言验证已走通所选模型的正常 Keychain 只读鉴权；这不证明 Exa 账号认证或远程 MCP 握手已通过。

7. **Phrase 网页回填现场校准**：0.18 尚未执行真实客户回填；合成 Chromium 页面与既有私有项目方法不能证明当前版本在实际站点的 DOM、富文本换行、保存与 TM owner 信号全部有效，不据此给出提速倍数。

## B. 当前功能边界

1. `cat_import_resources` 的目录递归单次最多处理 500 个条目，不跟随符号链接目录；超大目录应拆分导入。
2. XLSX 批次和 TM/TB 仍需要显式 Sheet/列映射；目录导入遇到这类文件会返回 `needsInput`，不会猜测后静默写入。
3. Tag 编辑器采用原生 textarea + chip overlay。硬 Tag 改动会阻止保存，但它不是 contenteditable 的原子不可拆 token 控件。
4. Phrase 内容配对和 mapping 已通过一组真实私有副本验证，但未见过的客户生成器变体仍需逐样本验证；过期或不完整 mapping 会阻止 `verified` 交付。
5. `as-is` 导出有意允许未完成内容，不代表可交付；`verified` 才执行完整 QA/阶段预检；两种模式都保留结构检查与重新导入验证。
6. memoQ MQXLIFF 专用 Adapter 已通过合成 fixture round-trip，但尚未用真实客户样本验证生成器变体、确认级别与批注互操作。
7. 通用 Agent 回退只截断 Pi 对话，不恢复工作区文件；Run Undo 只结构化撤销仍满足 revision/状态前提的 CAT 变更。外部 MCP/程序副作用只记录。
8. 旧数据迁移不读取治理 SQLite 的 proposals/ledger/checklist 投影；超大项目迁移仍可能同步占用主进程。
9. General Agent/Chat 使用 JSON/JSONL；CAT 使用每项目 SQLite。两种持久化策略不会互相扩散。

10. 新回执确认的是最终请求获得 HTTP 2xx，不证明流完整或模型理解；未产生响应、被过滤或未知协议不计覆盖。当前 turn/进程结束前未成功记账的内容保持未验证，需重新读取。
11. 旧摘要会话只在恢复时备份并规范化；历史未保存的图片无法恢复。旧 Receipt/无决定边界的 Stage 保留历史和译文，但不能继承新的完成资格。Schema 仍为 19，代码回退不等同数据语义回退，应恢复本轮操作前备份。
12. 自由文本技术约束无法可靠判定范围时保留原声明；覆盖不代表自然语言约束均被机器执行。CAT 文件原地损坏不会自动修复，应使用已有备份恢复。

13. 先前安全存储不可用时保存的明文 Provider 凭据不再自动读取；需在系统安全存储可用后重新输入密钥并加密保存。损坏配置保留原文件并明确报错。

14. CAT 草稿与撤销历史只在当前进程保留；旧中心预览仅有标题时恢复其合法宿主会话，不根据标题构造文件路径。项目阶段仍为项目配置，批次不是独立阶段实体。

15. 文件工作副本复用原件格式解析与结构保护，支持阶段接续，输出完整私有 JSON 和差异；它不写 CAT Stage，不是原生交付导出，也不证明 QA/TM 或平台责任已完成。
16. 可选项目简报是按来源版本校验的派生整理；覆盖和批准信息仍是声明，不能替代原件或逐段裁定。诊断中的 Skill 文件版本/hash 是当前探测，不证明历史运行已加载。
17. 默认 Phrase Skill 更新不会合并较新的项目定制；定制覆盖需在新运行边界合并，保留客户事实和禁用状态。本轮未修改 Pi 压缩器，也未证明真实任务的时间/token收益。

## C. 性能、构建与平台

1. 当前自动矩阵集中在 macOS arm64；macOS Intel、Windows 和 Linux 尚无真机资格证据。
2. Vite 仍可能报告大 chunk、重复静态/动态 import 和 Browserslist 数据警告；警告本身不等于 build 失败。
3. CJS bundle 对 `import.meta` 有既有 esbuild warning；packaged smoke 只能证明当前宿主路径。
4. serious/critical Axe 自动回归不能替代真实屏幕阅读器和完整键盘操作。
5. Full Integrity Scrub、Backup/Restore 有自动故障注入；真实磁盘耗尽、只读卷、断电和硬件损坏不是本轮 real-machine 证据。
6. 公开 Release 的存在不能证明本机安装版已更新；产物和安装验证状态见 [当前事实](../../CURRENT_FACTS_SIMPLE.md)。

7. 用户报告 macOS 红绿灯窗口按钮存在问题；尚未取得具体复现和根因证据。按用户要求延期排查修复。

## D. 发布定位与平台资格

发布产物主要用于作者本人安装与自动更新；不承诺公众支持、兼容周期、Developer ID 签名、Apple Notarization 或跨平台真机资格。公开安装包和更新元数据的存在不等于安装、升级与回滚全链均已验证。

## E. 已确认边界

- 数据根已隔离为 `~/.linguist-agent(-dev)`；旧 Proma 根只供显式 Provider-only 导入。
- Project/Session binding、数据库身份、导出路径和恢复流程均 fail closed。
- 所有 BrowserWindow 固定 context isolation、sandbox、禁用 Node integration 并启用 webSecurity。
- 旧 Auditor、Execution Policy、公开 Critic 和 Translation Scope 不再是 active 产品流程；历史源码/DB/报告不能反向恢复它们。
