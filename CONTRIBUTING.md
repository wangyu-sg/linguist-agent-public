# Contributing to Linguist Agent

## 许可与 DCO

Linguist Agent 以 AGPL-3.0 发布（Proma 衍生作品）。本项目采用 DCO
（Developer Certificate of Origin）轻量方案，不引入 CLA：每个提交必须带
`Signed-off-by` 行（`git commit -s`），表示你确认有权提交该贡献，并同意
你的贡献按 AGPL-3.0 作为整体产品的一部分发布（DCO 1.1 全文见
<https://developercertificate.org/>）。

```text
Signed-off-by: Your Name <you@example.com>
```

## 来源与归属规则（强制）

- 不得删除任何上游 Proma 版权头与许可声明；
- 复制第三方代码前必须先在 `docs/attribution/SOURCE_PROVENANCE.md` 登记
  （来源仓@commit:路径 → 目标路径 → 许可证处置），先登记后合入；
- 复制 MIT/Apache-2.0 代码时保留原版权与许可全文（Apache-2.0 另需保留
  NOTICE 内容并在修改文件头加 "Modifications:" 说明）；
- 禁止引入任何闭源产品（含闭源桌面客户端）的代码、文案、图标、字体、
  文件/chunk/class 命名——见 `docs/attribution/PRIVATE_RESEARCH_POLICY.md`；
- 新文件许可头：

  ```text
  Copyright (C) 2026 Henry Wang (wangyu-sg) and contributors
  SPDX-License-Identifier: AGPL-3.0-only
  ```

- 修改的上游文件：保留原版权头，并在其后追加一行：

  ```text
  Modifications Copyright (C) 2026 Henry Wang (wangyu-sg) and contributors.
  ```

## 开发流程

```bash
bun install --frozen-lockfile
bun run typecheck        # 各包 tsc --noEmit
bun test                 # 单元测试
bun run electron:dev     # 开发模式（数据写入 ~/.proma-dev）
```

- PR 前必须通过 typecheck 与 test；涉及 CAT 包（`packages/linguist-*`）的
  改动需跑对应 `bun run test`（node --test 套件）；
- 改动 `bun.lock` 的 PR 会触发依赖许可扫描门禁（`bun run license:scan`）；
- 提交信息使用英文，祈使句，说明 why 而不只是 what。
