# 0.17.73 原生 UI 收敛与批次作业修复

日期：2026-09-09。用户明确要求实施、doc sync 与 Release；未要求安装到日用环境。

## 来源与范围

- 起点：`ccdd3956be1c4e35056a593fe1152dbaec15d581`。
- 候选：`codex/la-proma-ui-convergence-20260909`，独立 worktree；原工作副本保持原状。
- 固定上游：Proma `v0.19.37`，`a987ec88fcfa05dd2448dc0ccdd9824a4b510dc6`；没有升级 Runtime / Provider。
- App `0.17.73`；CAT Store `0.0.45`（批次过滤公开合同）；Prompt `3.1.5`；Schema 19、32 个 CAT 工具不变。

## 已实现

中心 CAT Tab 类型、挂载、打开/最近入口与独立全宽、中心归零和 rail 能力分支已删除。主区继承完整 Agent，CAT 只作为原生右工作区内容。项目入口激活 CAT；已有会话切换保留原生工作区选择和布局。中心 Preview 的 LA 强制打开选项与 Dock 跳板删除；上游固有 Preview 类型和生命周期仍保留。

保留模式与项目绑定、CAT 内容贡献、受管预览、当前轮上下文捕获、附件权限接缝，以及现有导航代际、原子写入、CAS、冻结任务、导出、安全和无障碍修复。没有加入第二套布局或任务平台。

- 修改建议默认当前批次 pending；SQL JOIN 后在排序/分页前过滤，列表与总数一致。末页清空回到有效页；切换批次和筛选的晚响应不能覆盖新列表。
- pending 按 revision 显示真实版本冲突；accepted 显示已应用，其正常 revision 增长不误报。终态文字差异只作中性提示，锁定标识保留。技术 ID 与 provenance 收进详情。
- QA 列表、总数、下一项与交付默认当前批次；主进程校验批次归属。全项目建议/QA 历史必须从设置显式打开，项目级规则豁免只在那里提供。
- 阶段进度取当前 asset 的 segmentCount/currentStageCounts。切换视图不修改正在运行的 Stage 范围。
- 批次导航去阴影；管理批次进入独立批次页。辅助面板与项目共用语言资产分开；TM/TB、Context 等仍是项目资源。
- 键盘切换辅助面板后，用原生 scrollIntoView 保证选中标签可见。

## 旧状态与数据

旧项目 Tab 归一为合法已有绑定 Agent，会话重复项去重；只有标题的旧 Preview 回到所属会话，不猜测文件。恢复保留合法标签顺序和活动身份；有效活跃项目缺少会话时由既有项目入口确保会话。数据库及持久化项目格式不变，不清空用户设置。

卸载 CAT 不再释放项目草稿和撤销 atom；显式项目删除才清理。草稿只在当前进程保留，不承诺崩溃或退出恢复。浏览器回归覆盖编辑与保存隔离、CAS、切换竞态、旧 Tab 恢复幂等性、显式 Preview owner、批次响应隔离及 pending/终态标签。测试使用合成资料和临时数据根。

## 同一上游的 UI 差异

数值为 `git diff --numstat` 相对同一个固定上游的增加/删除行数；统计包括仍必须保留的正确性补丁，不把差异减少当作等价证明。

| Renderer 文件 | 起点 | 本轮实现 |
|---|---:|---:|
| `components/tabs/MainArea.tsx` | +9 / −5 | +9 / −5 |
| `components/tabs/TabContent.tsx` | +36 / −2 | +9 / −2 |
| `atoms/tab-atoms.ts` | +283 / −35 | +183 / −31 |
| `components/tabs/TabBar.tsx` | +50 / −55 | +27 / −52 |
| `components/tabs/TabBarItem.tsx` | +40 / −26 | +18 / −20 |
| `components/app-shell/AppShell.tsx` | +83 / −20 | +57 / −17 |
| `components/app-shell/right-panel-layout.ts` | +11 / −0 | 0 / 0 |
| `components/agent/SidePanel.tsx` | +20 / −13 | +13 / −13 |
| `components/diff/DiffPanelTabBar.tsx` | +34 / −23 | +10 / −22 |
| `components/diff/preview-opener.ts` | +30 / −14 | +12 / −17 |

`right-panel-layout.ts` 已与固定上游逐字一致，因此移除该触点登记；其余接缝继续登记并接受边界检查。

## 验证

- `bun run test`：默认完整链通过，包括真实 SQLite / Worker / 本地 HTTP；不是只运行 Bun 帮助。
- `bun run typecheck`、真实 Electron `cat-editor.browser.test.ts`：通过。
- `node scripts/verify-host-seams.mjs`：12 个接缝通过；`node scripts/test-proma-sync-replay.mjs`：通过，9 个冲突均按现有策略分类。
- Store 新增批次分页/计数/accepted 测试，QA 主进程新增批次范围和跨批次拒绝测试；默认集合包含这些测试。
- `bun run electron:build`：通过。首次受限沙箱无法写 Swift 模块缓存，正常构建权限下重跑通过。
- 初轮打包探针定位旧中心 Tab 断言，并保留其会话/数据恢复验证改为原生主区定位；辅助面板专项发现窄窗 End 焦点可见性问题并修复。最终修复保持会话/工作区/标签落盘断言，并按中心标签的可访问名称定位，避免误判右侧文件来源 Tab。原生滚动后的 0.10px 取整误差按既有 1px 几何容差检查，中间失败不计为通过。

## 本地最终打包证据

- 源码：`2ad71c23e1a4a7fcabaf5f6a99722abe15479b93`，`workingTreeDirty=false`。实现提交 `8836ba71`，随后 `2ad71c23` 只调整探针定位。
- 命令：`cd apps/electron && CSC_IDENTITY_AUTO_DISCOVERY=false bun run smoke:vertical`。
- 六步 `package / workspace-deps / agent / chat / project-switch / linguist-current` 均 `passed / exitCode=0`，逐一核对日志非空。
- Agent：19 PASS / 0 FAIL；Chat：19 PASS / 0 FAIL；CAT：31 PASS / 0 FAIL / 2 MANUAL。
- 报告：候选 worktree 下 `apps/electron/out/smoke/vertical/vertical-smoke-report.json`；各步日志位于同目录。
- macOS arm64 `app.asar` SHA-256：`648a9a83d18cf398665bad67169e291b798fa472c05c8b2fd062a83a13d6a119`。这是本地未签名探针产物，不作为远程 Release 安装包哈希。
- 辅助面板专项：`node scripts/smoke/probe-pb074-e2e.ts --lf056-only`，26 PASS / 0 FAIL / 0 MANUAL；包含草稿/撤销、跨项目隔离、只读预览、窄窗键盘和重启恢复。深浅主题及 900/800px 截图保存于任务临时目录。
- `coverageStatus=partial`；Native Open/Save 保留 MANUAL / blocked。
- `bun run license:check`、当前公开树与新增可达历史署名扫描通过；新增提交带 DCO Signed-off-by。

## 发布与资格

- 发布源码：`75be5764a868afe53b683b97270727c8767c12cb`，相较本地打包源码只补验证文档。
- [CI 34365239119](https://github.com/wangyu-sg/linguist-agent-public/actions/runs/34365239119) 全部通过。下载 `packaged-vertical-34365239119-1` 原始 artifact 后核验：源码 SHA 匹配、工作树干净、六步顺序正确、全部 passed / exitCode=0、各步日志非空。
- CI CAT：31 PASS / 0 FAIL / 2 MANUAL；辅助面板专项：26 PASS / 0 FAIL / 0 MANUAL。
- CI macOS arm64 探针 `app.asar` SHA-256：`7e8059eefdce77faa6162114355f2f4e988e60ca2c0153b9fcddb79907314a0d`。原始证据下载至任务临时目录 `la-ui-ci-evidence`；CI artifact 保留原报告与日志。
- [Auto Release 34366359302](https://github.com/wangyu-sg/linguist-agent-public/actions/runs/34366359302) 已成功完成三个目标构建、macOS 更新清单合并和公开发布。不安装到日用环境。
- 用户报告 macOS 红绿灯按钮问题，并明确要求留到下一轮修复、本次继续发布。已登记 TODO 与已知限制；尚未确认复现条件或根因。

真实 Provider、IME/VoiceOver、Native Open/Save、G8 盲评、AC-009 产品资格与 AC-011 日用证据继续 pending / blocked。Fake Provider 自动链只能证明对应合成路径，不能提升这些资格。

## 公开资产核验

[v0.17.73 Release](https://github.com/wangyu-sg/linguist-agent-public/releases/tag/v0.17.73) 于 2026-09-09 15:04:10 UTC 公开。通过 GitHub latest Release API 确认 `tag_name=v0.17.73`、`draft=false`、`prerelease=false`。Tag 精确指向上述已通过 CI 的发布源码。

7 项资产均非空；下载两份更新清单后确认版本、目标文件名与资产列表一致，macOS 两种架构 ZIP 大小与清单一致，两份清单的本地 SHA-256 与 GitHub digest 相同。下表安装包摘要来自 GitHub asset digest，未在本机重新下载安装全部平台包或验证安装升级。

| 资产 | 字节 | GitHub SHA-256 |
|---|---:|---|
| `latest-mac.yml` | 524 | `0462aa153edcec226f8a895ae02001f3de54bfe5a8bda2e2be755e0d5052af9b` |
| `latest.yml` | 339 | `b980e7730d7822fc7f7668638a14b8f1a3a292c3ac1fabf4a444dbb5f33e3de3` |
| `Linguist-Agent-0.17.73-arm64.dmg` | 232174734 | `82d77527a6741911892e68747b2e953adf457d6a0c66484fcd02d4f0185d3f2d` |
| `Linguist-Agent-0.17.73-arm64.zip` | 222148787 | `95176ca7c485bb6b080445f06a70d1dfe205103f2e15c15ac36758e260de1b97` |
| `Linguist-Agent-0.17.73-x64.dmg` | 243570152 | `8d93441a674fdfe1833cd59290eeccd2e29a13671f677d09c1d401b95036ab5a` |
| `Linguist-Agent-0.17.73-x64.exe` | 173143470 | `55e17bdf5125498fd18a1306c6d5e6582832ac3c5ad7921166bd1aa6042076c6` |
| `Linguist-Agent-0.17.73-x64.zip` | 233520795 | `a1380e82bf038c5d6725e32ea79a04da288753eaf9020460fefd4940960921a9` |

原工作副本未改动；实现和收尾文档均通过独立 worktree 完成并快进推送至远程 main。历史报告保留其原版本和证据，本轮没有安装或改写真实用户数据。
