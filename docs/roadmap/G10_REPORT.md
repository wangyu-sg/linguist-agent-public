# G10 门禁报告：UI、性能、无障碍产品化（计划 §23 / PB-100~105）

> 日期：2026-07-27　当前判定：**AUTOMATION PASSED / PRODUCT QUALIFICATION BLOCKED**
> 基线 commit：`407cabd4`（PB-105）
> 硬标准（计划原文）：**不允许以源码字符串截图替代真实渲染。**

## 1. 结论

Batch 10 六张实现票（PB-100 Design Tokens、PB-101 Thread/Composer、PB-102 Shell/Right Rail、PB-103 Approval/Plan/Compaction、PB-104 CAT 视觉精修、PB-105 矩阵）均达到 integration_verified；真实打包渲染和自动化矩阵大部分成立。但本报告不能据此宣布 G10 产品资格通过。

矩阵结果 **35 PASS / 1 FAIL / 3 WARN**：
- 唯一 FAIL（perf-1000turn-open = 10522ms，软阈值 10s）带完整证据记账，属 React/markdown 首挂载成本，非 CSS 层问题，见 §7。
- axe 三视图 WARN（serious/critical 存量规则违反）仅记录未修复，明细在证据包 axe-report.json，见 §7。
- 矩阵实测抓出一个真实破版（200% zoom 主区 39px），已在票内修复并复验（§3 修复项）。

手工项（VoiceOver / keyboard only / IME / drag-resize / DMG 真机）未执行；当时还存在性能 FAIL 与 serious/critical Axe。因此正确聚合状态是“自动化矩阵有证据、产品资格阻断”，而不是 Gate Passed。后续 AC-007/AC-008 的更正见 §9/§10。

## 2. 环境与隔离

| 项 | 实际值 |
| --- | --- |
| Node / bun | v22.22.2 / 1.3.14 |
| Electron / 应用版本 | 39.5.1 / 0.15.40 |
| 探针 | 历史 PB-105 packaged matrix（已退役；结果保留作历史证据） |
| 被测物 | `bun run smoke:pack` 产出的打包 .app（electron-builder --dir） |
| 隔离 | mkdtemp 临时 HOME + `--user-data-dir` + `LINGUIST_SMOKE_PLAINTEXT_CREDENTIALS=1`（不触真实 ~/.proma / Keychain） |
| 播种 | settings.json 预写（1280×820/light/onboarding）；10k 段 CAT 项目（cat-store CLI 导入 371ms）；1000-turn/2000 条消息 Agent 会话（JSONL + 索引 + 工作区） |
| axe | axe-core@4.12.1（精确版本 devDep），page.addScriptTag 注入 node_modules 本地文件，运行时零网络 |
| 证据 | `docs/roadmap/g10-evidence/`：21 张截图 + matrix-results.json（39 项逐格）+ axe-report.json（节点级全量） |

## 3. Gate 逐项结果

| 矩阵项 | 实际结果 |
| --- | --- |
| Light/Dark × 1280×820 / 1024×700 / 800×600（最小窗口）× Agent/CAT/Projects（18 格） | **全 PASS**：每格 scrollWidth === innerWidth，无页面级横向溢出（CAT 编辑器容器内部滚动为组件固有行为，单列记录） |
| 200% zoom（1280×820，CSS 视口 640×410）Agent + CAT | **PASS**（修复后复验）：scrollWidth=640 无溢出 |
| reduced motion | **PASS**：matchMedia reduce=true；对照元素 transition-duration 0.1s → 1e-05s（globals.css 安全网生效） |
| 10k Segment 网格 | **PASS**：首屏 765ms；跳底末行可见；DOM rows=14（<80，虚拟化生效）；滚动锚点 delta 0.0px |
| 1000-turn thread | 2/3 PASS：滚动到第 500 轮 34ms（≤3s）；[data-message-role] 计数=2000。**FAIL**：打开会话 10522ms（软阈值 ≤10s），分段计时显示 10444ms 在首 turn React/markdown 挂载 |
| axe（Agent/CAT/Projects，light） | **WARN**：serious/critical —— agent 5 规则（scrollable-region-focusable×101、button-name×12、color-contrast×6、nested-interactive×2、aria-command-name×1）；cat 4 规则（color-contrast×34、button-name×5、aria-required-children×1、nested-interactive×1）；projects 3 规则（color-contrast×9、button-name×5、nested-interactive×2） |
| 硬标准：真实渲染截图 | **PASS**：21 张 page.screenshot 真实渲染证据；zoom200 成像比例经 Electron 原生 capturePage 对照确认布局正常（page.screenshot 在 zoom 下为 CDP 等效放大 artifact，布局断言一律以 in-page 几何为准） |

**矩阵驱动的真实修复（票内完成并复验）**：zoom 200%（1280×820 → CSS 视口 640×410）下左栏 ≥300 + 右栏 ≥300 把主内容区挤到 39px，消息全部不可见。修复（AppShell.tsx）：`MIN_MAIN_AREA_WIDTH=320` + `useViewportWidth()`，视口放不下「左栏+右栏+主区最小宽度」时右侧面板整体让位不渲染，视口加宽自动恢复，不改写用户面板开关状态。修复前 FAIL → 修复后两轮 PASS。

## 4. Batch 10 票级状态

| 票 | 内容 | 状态 | resultCommit |
| --- | --- | --- | --- |
| PB-100 | LA Design Tokens（token 层，2 新触点） | integration_verified | 见 git log |
| PB-101 | Thread/Composer 精修（Thinking 双态、divider、content-visibility、22 站点迁色） | integration_verified | `9bfcd217` |
| PB-102 | Shell/Right Rail 精修（Skills 降 footer、right-rail-policy、交付物区、布局锚点） | integration_verified | `1143be45` |
| PB-103 | Approval/Plan/Compaction 精修（inline banner、permission-scope、Plan 条件展示） | integration_verified | `8a2f942f` |
| PB-104 | CAT 视觉精修（九项 + review token + linguist 域迁色收尾） | integration_verified | `60234d13` |
| PB-105 | 视觉/无障碍/性能自动化矩阵（39 项探针 + axe + 破版修复） | integration_verified | `407cabd4` |

## 5. 回归基线（本 Gate 复核）

| 检查 | 实际结果 |
| --- | --- |
| `bun run typecheck` | 11/11 exit 0 |
| 根 `bun test` | 967 pass / 2 fail（仅 PB-003 起既有 pure-Bun Electron named-export 环境失败） |
| `cd apps/electron && bun run test:linguist` | 110/110 |
| `bun test tests/no-raw-palette.test.ts` | 49/49 |
| `bun run check:boundaries` | 3/3 |
| build:main / build:preload / build:renderer | 全过 |

## 6. 证据清单（docs/roadmap/g10-evidence/）

- 截图 21 张：`{agent|cat|projects}-{1280x820|1024x700|800x600}-{light|dark}.png` + `agent-1280x820-light-zoom200.png`、`cat-1280x820-light-zoom200.png`、`agent-1280x820-light-rm.png`
- `matrix-results.json`：39 项逐格证据（含性能计时、DOM 计数、axe 汇总）
- `axe-report.json`：三视图节点级 violation 全量明细

## 7. 已知限制（如实记录，不伪造通过）

1. **perf-1000turn-open = 10.5s（软阈值 10s）**：三次运行稳定复现（10632/10557/10522ms），耗时集中在 2000 条消息的 React 首挂载/markdown 渲染（content-visibility 已启用但首挂载成本不在 CSS 层）。后续方向：渐进式挂载或真虚拟化，另立票决策。
2. **axe WARN 存量违反**：button-name（22 节点）、color-contrast（49 节点）、scrollable-region-focusable（101 节点）等，全部仅记录未修复，明细在 axe-report.json，建议另立无障碍专项票。
3. **zoom200 截图为 CDP 等效放大画面**（非真实窗口比例）；布局断言以 in-page 几何为准，native capturePage 对照已确认真实渲染正常。
4. **手工项未执行**：VoiceOver 读屏、keyboard only 全流程、IME 输入、drag/resize 手感、DMG 真机安装验证——需人工在真机执行，本 Gate 不伪造。

## 8. 最终判定

PB-100~105 的实现与真实渲染自动化证据成立；但一项性能 FAIL、serious/critical Axe 与未执行的人工项意味着当时只能判 **CONDITIONAL / PRODUCT QUALIFICATION BLOCKED**。annotated tag `pb-g10-productization` 只标记 Batch 10 代码状态，不代表最终产品资格。

## 9. AC-007 后续更正（2026-07-27）

AC-007 复查确认：本报告把 `perf-1000turn-open` 的约 10.5 秒归因于 React/Markdown
首挂载并不成立。旧探针在计时区间内先等待一个仅折叠侧栏存在的 selector 10 秒，
随后才通过 fallback 真正打开会话。

修正 selector 并加入 120-group 历史窗口后，打包 App 专项结果为：

- 首开 451ms；
- 顶部补载 104ms，锚点漂移 0.3px；
- 第 500 轮导航跳转 1312ms；
- 8 PASS / 0 FAIL。

完整证据与范围见 `AC007_LONG_THREAD_REPORT.md`。本更正只关闭长线程性能项，
不改变本报告中 Axe 与手工验收未完成的事实。

## 10. AC-008 与当前聚合状态（2026-07-29 同步）

AC-008 后续打包矩阵已把 Agent/CAT/Projects 的 serious/critical Axe 清零，
并记录为 `packaged_verified`。这关闭了原报告中的严重/关键自动化无障碍缺口，
但不等于 VoiceOver、完整键盘流、IME、拖拽/resize 等人工体验已经验证。

因此当前状态仍是：

```text
Long-thread automation: passed
Serious/critical Axe automation: passed
Manual product qualification: blocked
G10 Product Qualification: blocked
```
