# LA 全仓库审查与优化记录

核验日期：2026-09-08。工作分支：`codex/la-audit-upstream-20260908`，worktree：`.worktrees/la-audit-upstream-20260908`，起点：`e940e1bd`。本记录区分代码修复、自动验证、打包验证与人工资格。

## 审查范围与判据

目录清点覆盖 Electron Renderer / Main / Preload / Utility、CLI、共享包、CAT Core / Formats / Store / Tools / Migration、构建脚本、CI 与当前文档。上游合并后共有 1775 个受版本管理文件，其中 1133 个 TypeScript / JavaScript / 原生源码文件。人工审查按关键调用链深入，并未逐行证明整个仓库无缺陷。

前端重点检查 CAT 虚拟网格、编辑保存、项目/批次切换、异步回执、Agent/Chat 共用预览与设置；后端重点检查会话恢复、凭据、原子写入、导出重导、Stage/CAS 和邻文查询。复杂度审查只建议删除有证据的重复或失效路径；没有因文件大而进行拆分。

成功标准：上游稳定版有真实 merge ancestry；已确认问题有可运行的回归或基准；默认测试、类型、接缝与架构门禁通过；候选在临时用户根中完成 macOS arm64 打包和垂直冒烟；未取得的实机与质量证据继续列为未验证。

## 已确认问题与最小方案

| 优先级 | 问题与触发条件 | 影响 | 实施方案 |
|---|---|---|---|
| P1 | CAT 草稿存于虚拟行的 React state；滚出渲染范围或重新挂载工作台 | 未保存译文、撤销状态丢失 | 草稿移至项目与 Segment 隔离的 Jotai 状态，成功保存或取消后清理。 |
| P1 | 提交译文等待期间仍可编辑；旧请求成功即关闭编辑器 | 后续输入被关闭动作丢弃 | 保存与冲突刷新期间冻结全部编辑入口。 |
| P1 | 保存 A 批次后切至 B，A 的迟到回执只检查 ready | A 段落被写入 B 的可见数据集 | 保存回执复用已有 signature 校验，只更新原数据集。 |
| P1 | 快速打开项目/会话 A 后再打开 B，A 的 IPC 迟到 | 导航回到旧选择 | 共用原生项目导航代际，在所有异步入口只提交仍属于最新意图的结果。 |
| P2 | 900px 窄窗下 CAT 只剩约 340px，网格与工具栏仍压缩全部列 | 原文/译文列和控件重叠、文本逐字换行 | 保留内容可读宽度，局部水平滚动与工具栏换行；用真实布局断言和截图复验。 |
| P1 | JSON 单语字符串叶子导出后变成新 source，却按双语 source/target 校验 | 有译文的 flat/nested JSON 无法交付 | 根据既有 JSON 形状比较有效译文，并继续核对受管原 source；双语 JSON/CSV 保持严格重导。 |
| P1 | Automation 冷读以不存在的内部 Runtime 字段判定旧会话 | 每次重启清空 Pi `lastSessionId` | 只对 schema v3 之前的数据执行旧 Runtime 迁移，保留 v3/v4 的会话复用。 |
| P1 | 共享 JSON 写入使用固定 `.tmp` / 备份路径 | 符号链接可能导致写穿到其他文件 | 主文件与备份复用已有随机独占临时文件和原子 rename。 |
| P1 | 普通 Provider 创建/更新在 safeStorage 不可用时返回原密钥 | 密钥可能明文落盘 | 非空密钥加解密失败即报错；空密钥和显式隔离的假 Provider 测试路径单独处理。 |
| P1 | Provider 读取损坏配置时回退空配置并写入预设 | 只读列举也可能覆盖用户配置 | 配置解析失败可见且零写入，创建/更新最后一次原子提交。 |
| P1 | 异步导出期间修改项目，清单在导出结束后才读取 revision/evidence | 旧产物错标当前版本 | 在导出读取 Segment 前固定 revision 与证据快照。 |
| P2 | `neighborsMany` 使用全资产 window join 获取小范围上下文 | 大批次同步阻塞主进程 | 删除全资产 join，复用已索引的 `neighbors` 查询。 |
| P2 | 默认测试手工白名单遗漏现有权限、终端、阶段和新增上游回归 | 测试通过不能覆盖相关关键合同 | 把已验证隔离的测试纳入默认命令；有模块 mock 的组用独立进程。 |
| P2 | 同一锁文件在新 worktree 中丢失可选依赖的 repository 元数据 | 打包前后 SBOM 比较不稳定 | 缺项时复用现有扫描器读取已解析的包目录；原 SBOM 快照完整恢复，不放宽比较。 |
| P2 | Deviations 仍标注旧基线和旧触点数量 | 上游维护判断依据过期 | 从当前 diff 和机读基线重算，删除 stale 触点，保留历史报告。 |

## 上游合入

GitHub Releases API 核实最新稳定版为 [Proma v0.19.37](https://github.com/proma-ai/Proma/releases/tag/v0.19.37)，发布于 2026-09-07 14:12:56 UTC；精确 SHA 以 [机器基线](../architecture/proma-baseline.json) 为准。上游默认分支在核对时也指向同一提交。相对原基线涉及 16 个提交、102 个文件。

正式 merge 为 `4a7cbcec`，保留 LA 产品身份、独立数据根、原生 Agent/Chat 与第三 Linguist 模式。已合入 Copilot OAuth、计划文档预览与写入边界、跨工作区 Automation、Markdown/Vault/Skills/Slack 修复、更新缓存清理和模型上下文校正；随上游删除退役的搜索/生图工具路径。LA 应用版本不因本轮普通开发修改；CAT Store 因 JSON 交付行为修复递增 patch。

合并冲突按双方意图解决：保留 LA Host Extension、Provider-only 导入、主预览 Tab 入口、现有请求代次保护与滚动恢复；补入上游新行为。未恢复此前已精简的重复 helper。暂存 merge 的独立 `ponytail-review` 返回 `Lean already. Ship.` 后才提交。

## 性能证据

固定 50 段、前后各 1 邻段的合成资产，比较原 window join 与既有索引查询，逐项核对结果一致。本机 3 次测量中，1 万段约为 1.19 秒对 2.95 毫秒，3 万段原方案约为 3.86 秒，最终修复后三次中位数为 3.34 毫秒。数字仅代表该数据规模、查询形态和本机环境，不外推成整体应用加速倍数。

## 代码与回归入口

- CAT 编辑：[SegmentEditor](../../apps/electron/src/renderer/features/linguist/projects/SegmentEditor.tsx)、[TargetEditor](../../apps/electron/src/renderer/features/linguist/projects/TargetEditor.tsx)、[草稿状态](../../apps/electron/src/renderer/features/linguist/projects/cat-workspace-atoms.ts)；[真实浏览器回归](../../apps/electron/src/renderer/features/linguist/projects/cat-editor.browser.test.ts)。
- 导航：[原生项目切换](../../apps/electron/src/renderer/host/project-switch.ts)、[Linguist 会话入口](../../apps/electron/src/renderer/features/linguist/projects/open-linguist-session.ts)。
- 数据完整性：[safe-file](../../apps/electron/src/main/lib/safe-file.ts)、[Provider 配置](../../apps/electron/src/main/lib/channel-manager.ts)、[Automation](../../apps/electron/src/main/lib/automation-manager.ts)，对应测试同目录。
- JSON 与性能：[export-staging](../../packages/linguist-cat-store/src/export-staging.ts)、[Segment repository](../../packages/linguist-cat-store/src/repositories/segments.ts)；[Store 回归](../../packages/linguist-cat-store/src/store.nodetest.ts)、[邻文回归](../../packages/linguist-cat-store/src/segments.nodetest.ts)。
- 导出快照：[ProjectDelivery](../../apps/electron/src/main/lib/linguist/project-delivery.ts)、[并发交付回归](../../apps/electron/src/main/lib/linguist/project-delivery-evidence.nodetest.ts)。
- 许可：[扫描器](../../scripts/license-scan.mjs)；缺失的可选包元数据仍通过已安装的扫描库解析，未手写许可规则。

## 优化顺序与验证

1. 已完成上游 merge、冲突复核及第一轮构建；基线、About 显示与触点同步。
2. 修复上述数据丢失、凭据和查询问题，先确认失败再复验修复结果。
3. 执行默认回归、类型检查、boundary/fusion、Host Seam、许可与同步演练。
4. 对最终候选执行打包与 Agent / Chat / 项目切换 / Linguist 垂直冒烟，使用临时用户根和本地 Fake Provider。
5. 真实 Provider 四岗位、真实语言质量、IME/VoiceOver/Native Open/Save 与日用资格按 [TODO](../../TODO.md) 继续验收。

当前已通过：

- `bun install --frozen-lockfile`：锁文件安装成功，无依赖升级。
- `bun run test`：423 项通过。
- `bun test apps/electron/src/renderer/features/linguist/projects/cat-editor.browser.test.ts`：32 条真实 Chromium 行为检查通过，涵盖草稿、保存、跨批次回执及 Linguist / Agent / Chat 导航竞态。
- `bun run typecheck`：11 个 workspace package 通过。
- `bun run check:boundaries`：4 项通过；`node --test tests/linguist-fusion-architecture.test.mjs`：14 项通过。
- `node scripts/verify-host-seams.mjs`：12 个接缝通过；`node scripts/test-proma-sync-replay.mjs`：9 个冲突均按策略分类。
- `bun run license:check`：通过；修复扫描入口后 SBOM 与原快照一致。
- `bun run electron:build`：完整构建通过。初次受沙箱网络限制无法下载固定 OfficeCLI 资源；联网重跑并通过其 SHA-256 校验。默认测试初次本地端口绑定受沙箱限制，放行后同一命令通过，未削弱断言。

CAT 浏览器行为回归已纳入 macOS CI，在仓库锁定 Electron 的 Chromium 中运行，不依赖外部浏览器。

首轮干净候选 `f1cfefa1` 的六步垂直链路通过，Agent 19、Chat 19、Linguist 22 项自动检查通过；Linguist 仍有 2 项人工项。截图复核发现原有“页面不溢出”断言未能发现窄窗内容已不可读，因此该结果不能作为窄窗 UI 通过的证据。收紧后的同一探针在旧包复现 4 项失败：原文/译文列宽均为 0、筛选控件重叠、Dock 标签多行、编辑可读前置不满足。布局检查现已默认执行，截图保存仍可选。首轮日志与截图保存在 `artifacts/audit-20260908/first-vertical/`；最终候选正在重跑。

后续优化只在证据足够时实施：现有 Renderer 主 chunk 约 6.4 MB（首次构建，gzip 约 1.9 MB），属于构建事实；尚未证明它导致启动或交互延迟，因此先采集启动与交互 profile，再决定是否调整加载边界。大型真实 TM/TB/图片 Context 也应先测端到端延迟，再考虑候选剪枝或 Worker。

## 证据边界

本轮不以合成资料或 Fake Provider 证明翻译质量，不以 headless Chromium 证明真实输入法或屏幕阅读器可用，不以 macOS arm64 产物证明其他平台资格。草稿只在当前应用进程保留；关闭应用后的恢复不在本轮实现范围。审查中未发现可复现问题的路径不等于已证明无缺陷。

优化方向是先消除已证实的数据丢失和主进程阻塞，再取得实机与质量证据。没有以全仓重构、盲目拆 chunk、依赖全面升级或新增缓存替代问题复现。
