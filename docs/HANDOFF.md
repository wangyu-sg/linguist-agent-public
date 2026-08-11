# Linguist Agent 当前交接

更新时间：2026-08-11

## 当前状态

- 基线：Proma `v0.17.1@6094036d`；正式 merge `96155d1a`。
- 当前版本：Electron `0.17.2`、Shared `0.1.95`、CAT Core / Formats / Store / Tools `0.0.21 / 0.0.10 / 0.0.37 / 0.0.34`、schema `15`。
- Runtime：Pi `0.82.1` only；Claude 模型仍可经 Provider 使用，但不再打包 Claude Agent SDK / Nowledge Runtime。
- 产品：完整 Proma Agent + Chat + Linguist Vertical Agent Profile；无第二套 Host 能力。

## 本轮已完成

- 合并 Proma v0.17.1，并保留三模式、独立数据根、CAT Store 和安全边界。
- CAT Project 创建真实 Proma Workspace；Linguist Session、复制与分叉保持 `workspaceId + linguistProjectId` 双绑定。
- General 可选择性委派三种专业岗位；子会话冻结 Segment 范围，并共享同一 CAT Store。
- 新增 `cat_confirm_segments`；Reviewer / Proofreader 记录逐段决策，101 段跨页覆盖可正确完成或带阻断完成。
- 术语匹配复用 Store 现有 matcher，并由一个 Core evaluator 统一 context / QA / write gate / verified export；数字术语允许写入，普通数字/换行/token 差异转为 QA。
- 增加五个最小本地化 Skill；受管 Context 图片可通过既有读取工具提供给 Pi 视觉模型。
- Workbench 复用原生 Skills / Memory 管理，并显示阶段覆盖及 QA 层级。
- 修复 packaged 主进程对 ESM-only Pi 包的错误静态加载；同一修复产物已安装到 `/Applications/Linguist Agent.app`。

## 验证

- packaged vertical：Agent `15/15`、Chat `19/19`、Linguist `21/21`，另有 `2 MANUAL`；LF-003 coverage `partial`。
- 安装版本 `0.17.2` 与产物 `app.asar` hash 一致：`f2d05f75249f369c0bb16e14368e658538feee4d76e4d02a087b9530750b0a9d`。
- 真实 Provider 单次请求通过：`ChatGPT 订阅 (Codex) · GPT-5.6 Sol` 返回 `REAL_PROVIDER_OK`。
- 当前树：11 workspace typecheck、根 `1517/1517`、Electron Linguist `212/212`、CAT Store `230/230`、CAT Tools `42/42`、boundary `4/4`、fusion `9/9` 与 license scan 全部通过。

## 仍需真实证据

1. 同模型、同 reasoning 的真实语言任务对照。
2. 真实 Provider 驱动代表性格式完成四岗位全链与 `verified` 交付。
3. 真实 Phrase / memoQ 互操作。
4. Native Open/Save、IME、VoiceOver、完整键盘与 14 天日用。

当前状态见 [SIMPLE_IMPLEMENTATION_STATUS.md](./roadmap/SIMPLE_IMPLEMENTATION_STATUS.md)，未完成项只列在 [TODO.md](../TODO.md)。
