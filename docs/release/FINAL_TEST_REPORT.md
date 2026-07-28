# FINAL_TEST_REPORT — 最终测试报告（PB-117）

日期：2026-07-27
基线版本：0.15.45（PB-117 提交时点）

## 常规验收基线（每票强制，最终实测）

| 套件 | 命令 | 结果 |
|---|---|---|
| typecheck | `bun run typecheck` | 11/11 包 exit 0 |
| 根单测 | `bun test` | **967 pass / 2 fail**（113 文件） |
| linguist 域 | `cd apps/electron && bun run test:linguist` | **120/120** |
| cat-store | `cd packages/linguist-cat-store && bun run test` | 125/125 |
| cat-core | node --test | 102/102 |
| cat-tools | node + bun | 30/30 + 10/10 |
| 视觉契约 | `bun test tests/no-raw-palette.test.ts` | 49/49 |
| 上游边界 | `bun run check:boundaries` | 3/3（每次 commit 后强制） |
| 渲染构建 | `cd apps/electron && bun run build:renderer` | ✓（约 13–15s） |

### 根 2 fail 说明（诚实记录，PB-003 起既有）

`agent-session-manager`（BrowserWindow）与 `channel-runtime-api-key`（shell）两例：bun 直接加载 electron 模块的环境性失败，非产品代码回归；全周期保持 2 fail 不增不减（各 Gate gateCriteria 逐项在案）。

## 打包与探针

- `smoke:pack`：全链路实测通过（PB-114，产物 0.15.42 实测；当前 0.15.45 同链路）
- DMG：`electron-builder --mac dmg` 实测产出 256MB + blockmap
- G0 冒烟 18/18；probe-import 28/28；probe-cat-tools 21/21；PB-074 垂直 11 PASS/0 FAIL/2 MANUAL（G8 时点）

## G10 产品化矩阵（2026-07-27）

39 项：**35 PASS / 1 FAIL / 3 axe WARN**；21 张真实渲染截图证据（docs/roadmap/g10-evidence/）。
- FAIL：perf-1000turn-open 10.5s（软阈值 10s，React/markdown 首挂载，带证据记账，另立票）
- axe WARN（仅记录）：scrollable-region-focusable×101、button-name×22、color-contrast×49
- 真机未执行项（如实）：VoiceOver、键盘全流程、IME、拖拽 resize、DMG 安装

## 许可门禁

`bun run license:scan`：415 个第三方包（MIT 271 / Apache-2.0 50 / ISC 46 / BSD 31 / OFL-1.1 1 / 其余各 1），黑名单（GPL-2/3、LGPL、SSPL、Commons-Clause、BUSL 等）零未豁免命中；CI license-scan job 独立标红不阻塞发布。

## 未执行的验证（不伪造）

- Developer ID 签名 / 公证：无凭据 blocked
- update channel 实通：公开仓首个 Release 未建
- PB-085 人工盲评：需真实 API Key + 用户评分（用户已排期至全部工单交付后）
- G9 真实旧数据副本复跑：等用户提供（协议 G9_REPORT §6）
- Windows/Linux 平台构建与真机：未执行（开发机 macOS arm64）
- 盲评/真机/签名类一律记 blocked 或未执行，无一项伪造通过
