# LA-CI-001 基线与修复证据

更新时间：2026-07-29

## 已确认的远端事实

- 仓库：`wangyu-sg/linguist-agent-public`
- GitHub Actions Run：`30408252952`
- Commit：`a879f185ecb77397f9c07b0d22002b5ad4aa379b`
- 结果：失败

该 Run 的 frozen install、typecheck、测试、边界与融合检查通过；失败步骤是 `bun run license:scan`。Linux runner 安装了 SDK `0.3.201` 的平台包，但扫描器未登记其专有许可例外：

```text
@anthropic-ai/claude-agent-sdk-linux-x64@0.3.201
@anthropic-ai/claude-agent-sdk-linux-x64-musl@0.3.201
```

同一 Run 的 `actions/checkout@v4` 与 `oven-sh/setup-bun@v2.0.2` 仍声明 Node 20，由 GitHub 强制改用 Node 24；这是告警，不是该次失败原因。

## 已实施的本地修复

- 对 SDK `0.3.201` 已锁定的 Linux glibc/musl arm64/x64 变体逐项登记许可例外，不使用吞掉未来包的通配符。
- 同步 `THIRD_PARTY_NOTICES.md` 与 SBOM 生成规则。
- `actions/checkout` 固定到 v6.1.0 commit；
  `actions/setup-node` 固定到 v6.5.0 commit；
  `oven-sh/setup-bun` 固定到 v2.2.0 commit。
- 三个 Action 的 `action.yml` 已核对为 Node 24 Runtime。

## 最终本地证据

验证实现 HEAD：`24b6e6f8b1a0f8030748664345bb16ce648a5eef`

| 检查 | 结果 |
|---|---|
| Bun | `1.3.14` |
| frozen install | exit 0 |
| workspace typecheck | 11 / 11 |
| 根 Bun 测试 | 1,320 pass / 0 fail |
| Architecture boundaries | 4 pass / 0 fail |
| Fusion architecture | 9 pass / 0 fail |
| Electron Linguist | 164 pass / 0 fail |
| CAT Core / Store / Tools | 116 / 209 / 39，均 0 fail |
| license scan | 417 个第三方依赖；门禁通过 |
| Electron build / runtime sync | 通过；137 个 runtime 依赖同步 |
| smoke:pack | 未签名 macOS arm64 打包通过 |
| packaged Agent / Chat / Linguist | 12 / 18 / 17，均 0 fail；Linguist 2 manual |

## 尚未验证

用户已授权公开源码同步，但当前尚未 push。远端最近状态仍是上述失败 Run，不能把本地绿色矩阵写成“远端 CI 已绿”。只有净化快照推送触发同一 reusable workflow 并成功后，LA-CI-001 的远端门禁才可关闭。
