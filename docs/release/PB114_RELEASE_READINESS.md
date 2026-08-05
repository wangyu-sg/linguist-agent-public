# PB-114 发布就绪评估：签名、公证和更新

日期：2026-07-27
范围：PB-114 票面 11 项逐项裁定。依据：发布面只读侦察（2026-07-27）+ 本地实测。
纪律：没有真实凭据的项标记 blocked，不伪造通过。

## 逐项裁定

| # | 票面项 | 裁定 | 证据 / 说明 |
|---|--------|------|-------------|
| 1 | 自有 app id | 已就绪 | `apps/electron/electron-builder.yml:4` `com.linguistagent.app`；Info.plist 实测一致 |
| 2 | icon | 已就绪 | `apps/electron/resources/` icon.icns / icon.png / icon.ico / icon.svg 齐全，LA 图形；归属：用户本人基于旧 LA 图标修改，本人确认可用于自有 app（POST_G7_KICKOFF.md:145 待验证项闭环） |
| 3 | electron-builder | 已就绪 | `electron-builder.yml` 160 行完整配置；本地 `--dir` 打包链路实测（见「实测记录」） |
| 4 | ASAR / unpack | 已就绪 | `asar: true` + asarUnpack 5 条 native 规则（yml:22-28）；产物含 `app.asar` + `app.asar.unpacked`（实测） |
| 5 | runtime deps | 已就绪 | `scripts/sync-runtime-deps.ts` 同步依赖闭包、版本冲突即抛错、校验无绝对 symlink；产物 node_modules 实测含完整闭包 |
| 6 | Developer ID | **blocked（无凭据）** | 仓内无证书/Team ID；本地产物实测 adhoc（`codesign -dv` → `flags=0x20002(adhoc,linker-signed)`）；CI 所需 secrets 清单已列于 `.github/workflows/release.yml:6-12`，凭据注入后链路即可用 |
| 7 | notarization | **blocked（无凭据）** | 无 notarize 配置与 Apple 凭据；release.yml:75-85 注入 APPLE_* 后 electron-builder 自动走公证，机制已备 |
| 8 | DMG | 已就绪（配置） | yml:111-126 dmg target + 窗口布局；实测记录见下 |
| 9 | update channel | 部分就绪 + blocked 项 | updater 代码完整（`auto-updater.ts`，electron-updater ^6.7.3，启动 10s 首查 + 4h 轮询，仅 packaged 初始化）；**本票将 publish 从 ErlichLiu/Proma 改为 wangyu-sg/linguist-agent-public**（计划 PB-116 指定的公开仓，此前「刻意不变」是因 LA 仓尚不存在）；实际 channel 可用性 blocked：公开仓与首个 Release 尚不存在 |
| 10 | previous version rollback | 不做（有缓解，记限制） | 无 app 级回滚机制，electron-updater `allowDowngrade` 保持默认 false（刻意：降级 app 打开新版库会被 `StoreSchemaTooNewError` fail-closed 拒绝，见 cat-store `database.ts:56,159`，静默降级反而破坏数据）。回滚路径 = 重新安装旧版 DMG + PB-111 全量备份恢复。此项不新建机制 |
| 11 | user data retention | 已就绪 | `USERDATA_LAYOUT.md`：packaged `~/.proma/`、dev `~/.proma-dev/`，卸载 .app 不触碰用户数据；JSON 侧多处 CONFIG_VERSION 迁移、SQLite 侧 schema_migrations（当前 v7）+ 备份恢复迁移判定（`project-service.ts:899-919`） |

## 本票实际改动

1. `apps/electron/electron-builder.yml`
   - `publish.owner/repo`：ErlichLiu/Proma → wangyu-sg/linguist-agent-public（update channel 指向 LA 自有发布位；上游同步笔记见 `UPSTREAM_SYNC.md`，该文件已是登记触点，reason 追加）
   - win `fileAssociations` 显示名 "Proma Personal Backup"/"Proma Share Package" → LA 名称（mac 端 PB-010 已改，win 端遗漏补齐）
2. 版本 bump（随当轮 patch 序号）
3. 本文档新建

## 实测记录（2026-07-27 本机实测）

- 打包命令：`CSC_IDENTITY_AUTO_DISCOVERY=false bun run smoke:pack`（build + build:cli + sync:runtime-deps + `electron-builder --dir`）
- 结果：renderer build ✓（14.94s）；CLI bundle ✓；runtime-deps 同步 137 个（跳过未安装 optional 25 个）；electron-builder 25.1.8 打包 darwin/arm64 electron 39.5.1 ✓；签名步骤按预期跳过（CSC_IDENTITY_AUTO_DISCOVERY=false）
- 产物实测（`out/mac-arm64/Linguist Agent.app`）：
  - `CFBundleIdentifier` = `com.linguistagent.app`；`CFBundleShortVersionString` = 0.15.42（当轮版本）
  - `codesign -dv` → `flags=0x20002(adhoc,linker-signed)`、`Signature=adhoc`、`TeamIdentifier=not set` —— 无凭据环境下的正确行为，Developer ID 项因此 blocked
  - `Contents/Resources/app.asar` 与 `app.asar.unpacked` 均存在（ASAR/unpack 项实测通过）
- DMG：`electron-builder --mac dmg`（CSC_IDENTITY_AUTO_DISCOVERY=false）实测产出 `out/Linguist Agent-0.15.42-arm64.dmg`（256MB，APFS）+ blockmap ✓

## 遗留与 blocked 汇总

- Developer ID 签名、公证：blocked，等 Apple Developer 凭据（secrets 清单 release.yml:6-12）。
- update channel 实通：blocked，等 wangyu-sg/linguist-agent-public 建仓与首个 Release（PB-116 之后）。
- app 级版本回滚机制：不建设，缓解与回滚路径见上表 #10。
- release-notes 缺 v0.15.4–v0.15.40 共 34 篇：不在本票范围，另立票或 PB-117 审计时记录。
