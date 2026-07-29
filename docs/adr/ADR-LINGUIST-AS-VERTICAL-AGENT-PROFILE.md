# ADR：Linguist 作为 Proma Agent 的垂直 Profile

- 状态：Accepted
- 日期：2026-07-29
- 关联：LA-ARCH-001

## 背景

Linguist Agent 需要同时具备 Proma 的通用 Agent 能力，以及项目绑定的 CAT
上下文、工具和质量规则。另建 Runtime 或复制 Agent UI 会让权限、Provider、
Skills、MCP、会话恢复和后续上游升级形成两套实现。

## 决策

1. 只保留一套 Agent Runtime 和一套 `AgentView`。Linguist 是
   `AgentProfile` 的一等 `linguist/project` 变体，不是临时 Prompt。
2. Tool、Prompt 和 Skill 采用“Proma Base + Linguist Overlay”组合。通用能力
   从 Base 动态继承，不复制静态清单；CAT 工具只叠加到项目绑定会话。
3. 保留 Proma 原有权限模式，包括 `bypassPermissions`。Linguist 不另建
   CAT-only 权限系统；CAT 写入仍由 project authority、revision CAS、lock、
   hard rule 和 Proposal 工作流约束。
4. Agent 从 Rail 展开为 Full 时仍位于 Linguist Shell，仅改变 presentation；
   不切换为普通 Agent Workspace，也不复制会话状态。
5. 每个 Linguist Session 使用独立、可恢复的项目执行目录。该目录与通用
   `AgentWorkspace` 分开，项目身份来自持久化 Session binding，而不是 Renderer
   传入的任意路径。
6. 风险通过可见变更摘要、事件记录、快照、撤销和可恢复删除治理；安全与数据
   完整性边界继续 fail closed。

## 结果

- 新增的 Proma 通用能力可由组合契约自动进入 Linguist Session。
- Agent / Chat 保持上游行为；Linguist 只维护差异层。
- CAT 数据写入与通用文件能力分开治理，避免把“能操作文件”误写成“能绕过
  CAT Store”。
- Session 生命周期、运行目录和项目绑定必须一起测试，不能只验证 UI mode。

## 不采用的方案

- 第二套 Linguist Runtime 或 Session Store：重复 Provider、权限和恢复链路。
- 复制一份通用 Tool / Skill 清单：新增能力会静默漂移。
- 强制 CAT-only 权限：会破坏 OCR、脚本、表格和 MCP 等明确保留的通用能力。
- 展开 Rail 时切换到 Agent mode：丢失项目导航与 Workbench 上下文。

## 重新评估条件

出现以下任一事实时重新评估本决策：

- Proma Runtime 无法为垂直 Profile 提供可测试的组合 seam；
- 权限隔离要求升级为进程或操作系统级安全边界；
- Linguist 需要独立发布、独立兼容周期或与 Proma 不兼容的 Provider 协议；
- 项目级并发或远程执行使本地 Session CWD 不再能提供正确 authority；
- 恢复、审计或数据完整性证据表明 Overlay 模型无法 fail closed。
