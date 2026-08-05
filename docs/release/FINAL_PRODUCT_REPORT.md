# FINAL_PRODUCT_REPORT — Linguist Agent 最终产品报告（PB-117）

日期：2026-07-27
状态：供最终审计者审阅

## 审计者速查

```text
Repository          /Users/<local>/Desktop/linguist-agent-next（公开镜像 wangyu-sg/linguist-agent-public）
Branch              main（开发）；audit/proma-based-candidate-v1（公开候选，未合并公开 main）
Proma baseline SHA  702a8221bdeb6f3db7dc514b8e93e2a5a52f68df
Candidate SHA       c5020840（main 头）/ 185eb1614ff66e6a2a4658117b339e374ad853d5（公开候选）
Commit range        702a8221..c5020840 = 98 commits
版本                0.15.45（apps/electron/package.json）
```

## 产品定义

桌面本地化 Agent（Electron + bun monorepo）：Proma 通用 agent 底座（多模型 Chat、Agent 工作流、Skills/MCP、自动化、远程 bot 入口）完整保留，上叠面向游戏本地化的 CAT 专业层。路线 = 通用 agent + Gaming Localization agent（用户拍板，通用功能不为 CAT 层让路）。

## 十二批交付总览

| Batch | 内容 | Gate |
|---|---|---|
| 0–1 | 基线冻结、打包基线、产品壳（LA 品牌、feature flags） | G0/G1 passed |
| 2–3 | CAT headless 引擎（cat-core/cat-store/cat-tools）、项目集成（typed IPC 信封） | G2/G3 passed |
| 4–5 | CAT 工具链、Proposal 人工审核流 | G4/G5 passed |
| 6–7 | CAT 工作台 UI、垂直产品贯通（G7 垂直冒烟 11 PASS/2 MANUAL） | G6/G7 passed |
| 8 | 质量策略（Fast/Balanced/Best、Review Skill、Batch Consistency）+ 格式扩展（XLSX/SDLXLIFF/MXLIFF/DOCX） | **G8 blocked**（PB-085 盲评未执行） |
| 9 | Legacy 迁移（scanner/import/隔离/transcript/Migration UI） | **G9 blocked**（等真实数据副本） |
| 10 | UI/性能/无障碍产品化（39 项矩阵：35 PASS/1 FAIL 记档/3 WARN） | G10 passed |
| 11 | 安全审查、备份恢复、隐藏评估、发布面、发行治理、公开镜像 | G11 见 G11_REPORT（blocked） |
| 增补 | PB-089 CAT 资产源文件预览（选项 A，用户拍板） | 随 Batch 11 验收 |

## D-001~D-009 合规

全程遵守：单一 main 分支、旧仓冻结只读（零 data/** 读取）、Proma 触点全登记（106 条，check:boundaries 3/3 强制）、pi 为唯一 v1 runtime（Claude 链路隐藏不删）、无 rebase/push 公共 main、每票单独 commit + 双账本。

## 打包证据（PB-114 实测）

- `smoke:pack` 全链路：renderer build + CLI bundle + runtime-deps 137 个同步 + electron-builder 25.1.8（electron 39.5.1, darwin/arm64）
- 产物：`Linguist Agent.app`（com.linguistagent.app / 0.15.42 实测时）、app.asar + app.asar.unpacked、`Linguist Agent-0.15.42-arm64.dmg`（256MB + blockmap）
- 签名：adhoc（无凭据正确行为）；Developer ID/公证 **blocked**（secrets 清单 .github/workflows/release.yml:6-12 已备）

## 迁移证据

- 合成 fixtures 全链路：scanner 零写 + 字节一致快照、隔离零写 exit 5、transcript 重渲染 sha256 三方一致、幂等 reject + dry-run 零写（G9 gateCriteria 在案）
- **真实数据副本复跑未执行**（G9 硬判据 blocked，协议见 G9_REPORT §6）

## 许可报告

AGPL-3.0（LICENSE 原样）；NOTICE/ATTRIBUTION（Proma 基线 SHA + 修改声明 + Source 链接）；THIRD_PARTY_NOTICES（Anthropic 专有组件等如实登记）；SBOM 415 个第三方包实测（license:scan 门禁零黑名单命中）；OpenWorker/Codex 零复制（PB-115 时点复核）。详见 docs/release/SBOM.md 与 KNOWN_LIMITATIONS.md。

## Gate 总账

passed：G0 G1 G2 G3 G4 G5 G6 G7 G10（9）
blocked：G8（PB-085 盲评）、G9（真实数据复跑）、G11（依赖 G9 + 待最终审计）
