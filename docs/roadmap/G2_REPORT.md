# G2 门禁报告：Headless CAT CLI Vertical Slice 完全通过（计划 §14 / PB-025）

> 日期：2026-07-25　执行：G2 Batch Gate（PB-025 之后）　状态：**GATE PASSED**
> 基线 commit：`e450103c`（PB-024）　结果 commit：`SELF`（本报告与 CLI 所在提交）
> 门禁标准（唯一硬标准）：**「CLI Vertical Slice 必须完全通过。未通过前禁止开始 UI 和 Agent Tool。」**
> 结论：**CLI 垂直切片对全部三种 fixture 格式（XLIFF/CSV/JSON）完整通过**——建项目 → 导入 → 列段 → CAS 编辑 → 最小 QA → 导出 → 重导入比对，含 CAS 冲突路径、锁定段拒绝、QA 发现占位符/空目标问题、导出结构保持、篡改导出被拒，全程无 UI、无 Agent、无网络。

## 1. 环境与版本

| 项 | 版本 |
| --- | --- |
| 运行 CLI 与 store 测试的 Node | v22.22.2（node:sqlite 自 22.5 起免 flag；bun 无 node:sqlite，**CLI 必须在 node 下运行**，PB-024 已固化） |
| bun | 1.3.14（`~/.bun/bin/bun`，用于 typecheck / bun test / boundaries） |
| TS 运行方式 | `node --experimental-transform-types` + 包内 ESM resolve hook（与 cat-store `test` 脚本完全同一套 runner flags） |
| 机器 | macOS Apple Silicon（arm64） |
| 数据 | 全部 synthetic fixtures（`tests/linguist-fixtures/`），mkdtemp 临时 root，无真实用户数据 |

## 2. 交付物（PB-025 + 本门禁）

| 文件 | 说明 |
| --- | --- |
| `packages/linguist-cat-store/src/cli.ts` | **CLI 本体**：7 个子命令，`runCli(argv, io)` 可注入 IO/时钟/熵，main guard 仅直执行时触发；类型化错误映射到退出码 |
| `packages/linguist-cat-store/src/minimal-qa.ts` | **INTERIM 最小 QA**（占位符多重集比对 + 空目标，cat-core `OpenQaFindingInput` 形状；代码头/CLI 文档/本报告三处明确标注 interim，PB-070 替换） |
| `packages/linguist-cat-store/src/asset-source.ts` + `project-database.ts`（新增两个方法） | **store 新能力**（PB-024 交接缺口）：`ProjectDatabase.saveAssetSource(assetId, bytes)` / `readAssetSource(assetId)`——原始字节持久化到项目 `source/<assetId><ext>`，原子写（tmp+rename），读写两侧校验 `asset.sourceSha256`（CAS 锚），不匹配抛新类型化错误 `StoreAssetSourceMismatchError`（新稳定码 `STORE_ASSET_SOURCE_MISMATCH`）；只读句柄拒写 |
| `packages/linguist-cat-store/src/errors.ts` / `index.ts` | 新错误类登记 + barrel 导出 |
| `packages/linguist-cat-store/src/asset-source.nodetest.ts` | 7 条：往返字节一致、缺 blob/未知 asset → STORE_NOT_FOUND、sha 不匹配拒写且不落盘、篡改 blob 拒读、只读句柄拒写允许读、覆盖幂等/无扩展名 |
| `packages/linguist-cat-store/src/minimal-qa.nodetest.ts` | 8 条：空目标/空源不报/锁定跳过/占位符匹配/丢失/多余/多重性/multiset 助手 |
| `packages/linguist-cat-store/src/cli-slice.nodetest.ts` | 4 条：**3 条为逐格式端到端切片**（真子进程跑文档化 CLI 调用，每格式 ~16 次调用，含全部正反路径 + 进程内只读重开库断言审计），1 条退出码矩阵 |
| `packages/linguist-cat-store/package.json` | 新增 `cli` 脚本（= 文档化 node 调用），`test` 脚本不变 |
| `docs/roadmap/G2_REPORT.md`（本报告）、账本两文件、`docs/attribution/SOURCE_PROVENANCE.md` | 门禁与登记 |

未触碰：UI / Agent / Pi / Electron 任何代码；旧仓零改动；无新增外部依赖（`bun.lock` 未变）。

## 3. CLI 用法（文档化精确调用）

```bash
cd packages/linguist-cat-store
node --experimental-transform-types --import ./test/register-ts-loader.mjs src/cli.ts <command> [flags]
# 等价简写：bun run cli -- <command> [flags]（内部仍 spawn node）
```

- 通用 flag：`--root <dir>`（linguist 根目录，每命令必给）、`--now <iso>`（钉住本次调用全部时间戳）；`create-project` 另有 `--seed <s>`（确定性项目 id）。
- 子命令：`create-project` / `import` / `segments` / `edit` / `qa` / `export` / `verify`（签名见 `cli.ts` 头注释与 `--help`）。
- 输出约定：stdout 为 `key: value` 摘要行 + 集合条目每行一个 JSON 对象；错误走 stderr `error[<CODE>]: <message>`。
- 退出码：`0` 成功；`1` 未预期；`2` 用法错误；`3` 未找到（项目/资产/段/文件）；`4` 领域拒绝（`REVISION_CONFLICT`/`SEGMENT_LOCKED`/`UNKNOWN_SEGMENT`…）；`5` 格式错误（`FORMAT_PARSE_ERROR`/`FORMAT_UNSUPPORTED`…）；`6` verify 不一致。
- node 会在 stderr 打印 `ExperimentalWarning`（transform-types 与 node:sqlite 各一条），属预期，不影响 stdout 与退出码。

## 4. 门禁标准逐项结果

### 标准 1：CLI Vertical Slice 完全通过（三格式）— **PASS**

判据：每格式在独立 mkdtemp root 走完全部阶段；正反路径均断言；下方为 2026-07-25 实跑输出（root 为 `/tmp/g2-evidence-<fmt>-*`，命令行省略统一前缀 `node --experimental-transform-types --import ./test/register-ts-loader.mjs src/cli.ts`；自动化版本即 `cli-slice.nodetest.ts`，逐格式含以下全部断言且更多）。

#### 4.1 XLIFF（`mini_game_ui.xliff`，7 段）

```
+ create-project --root <R> --name G2-xliff --source en --target zh-CN --seed g2-xliff
project: prj-80df8d33c50f2e7d                                  [exit=0]
+ import --project prj-80df8d33c50f2e7d --file mini_game_ui.xliff
asset: ast-a86c04bb97a9ae3c
format: xliff_1_2
segments: 7
source-sha256: 5a6ce10ce092f16d32734b70d0f7acff051a08a20a2c184842631d420a6d90be
source-blob: source/ast-a86c04bb97a9ae3c.xliff
warnings: 0                                                    [exit=0]
+ segments --project prj-80df8d33c50f2e7d
{"id":"seg-f06b041c05449ef3",...,"key":"menu.start","status":"translated","revision":0,"source":"Start Game","target":"开始游戏"}
{"id":"seg-d1f82b1d29851ba1",...,"key":"player.welcome","status":"untranslated","source":"Welcome back, {player}!","target":""}
{"id":"seg-0e9a27be15f67496",...,"key":"legal.copyright","locked":true,...}
segments: 7                                                    [exit=0]
+ edit --segment seg-52200dbf7f898042 --target 选项设置 --expected-revision 1   # 陈旧 revision
error[REVISION_CONFLICT]: Segment seg-52200dbf7f898042 revision conflict: expected 1, current 0.   [exit=4]
+ edit --segment seg-52200dbf7f898042 --target 选项设置 --expected-revision 0   # 正确 revision
segment: seg-52200dbf7f898042
revision: 1
status: draft                                                  [exit=0]
+ edit --segment seg-0e9a27be15f67496 --target X --expected-revision 0          # 锁定段（translate="no"）
error[SEGMENT_LOCKED]: Segment seg-0e9a27be15f67496 is locked; target edits and proposals are rejected.   [exit=4]
+ edit --segment seg-df5ef4ce3fc8b8c1 --target 得分 --expected-revision 0       # 故意丢掉 {score}
revision: 1 / status: draft                                    [exit=0]
+ qa --project prj-80df8d33c50f2e7d
{"id":"qaf-0569653d7c358227","segment":"seg-df5ef4ce3fc8b8c1","code":"PLACEHOLDER_MISMATCH","severity":"warning","status":"open","message":"Placeholder mismatch (missing in target: {score})."}
{"id":"qaf-4fe94eedf7817bfa","segment":"seg-d1f82b1d29851ba1","code":"EMPTY_TARGET","severity":"warning","status":"open","message":"Target is empty (source: Welcome back, {player}!)."}
segments-checked: 7
findings: 2                                                    [exit=0]
+ edit --segment seg-df5ef4ce3fc8b8c1 --target 得分：{score}！ --expected-revision 1   # 修复占位符
revision: 2                                                    [exit=0]
+ qa --project prj-80df8d33c50f2e7d                                          # rerun：mismatch 消除
{"id":"qaf-4fe94eedf7817bfa",...,"code":"EMPTY_TARGET",...}
findings: 1                                                    [exit=0]
+ export --project prj-80df8d33c50f2e7d --asset ast-a86c04bb97a9ae3c
export: exp-897adc540cd9eb05
path: .../projects/prj-80df8d33c50f2e7d/exports/mini_game_ui.xliff
sha256: 2fa39a166627049a05f6cea7775c6f6dacc793c64caf4707f000a303ac7d919d
segments: 7                                                    [exit=0]
+ verify --asset ast-a86c04bb97a9ae3c --export .../exports/mini_game_ui.xliff
verify: OK
segments: 7                                                    [exit=0]
+ verify --asset ast-a86c04bb97a9ae3c --export .../exports/tampered.xliff       # 篡改副本
mismatch: menu.options: expected "选项设置", export has "TAMPERED译文"
verify: FAILED
mismatches: 1                                                  [exit=6]
```

自动化测试另断言：未修改导出与 fixture **逐字节一致**（sha256 相同）；导出文件保留 `<tool tool-id="LA"` header、7 个 trans-unit、`translate="no"`、未编辑 inline 标签段字节不动；进程内只读重开库确认 2 条 exports 审计记录、`menu.options` revision 历史 `[1,2]`、open findings 1 条。

#### 4.2 CSV（`mini_dialogue.csv`，8 段）

```
+ create-project --seed g2-csv → project: prj-f9c3edb92298bf9f               [exit=0]
+ import --file mini_dialogue.csv
asset: ast-9fed57aa1162ae53
format: csv_rfc4180
segments: 8
source-sha256: 7a3b67c1eab30f49da31192a3ee770ec04d9b38ceba32a3ad0b25ad639ea5030
source-blob: source/ast-9fed57aa1162ae53.csv
warnings: 0                                                    [exit=0]
+ segments（节选）
{"key":"dlg.arya.intro",...,"source":"I'm Arya, a traveling merchant.\nNice to meet you.","target":"我是阿雅，一名旅行商人。\n很高兴认识你。"}
{"key":"legal.eula","locked":true,...}
segments: 8                                                    [exit=0]
+ edit dlg.arya.shop --expected-revision 1 → error[REVISION_CONFLICT]         [exit=4]
+ edit dlg.arya.shop --expected-revision 0 → revision: 1 / status: draft      [exit=0]
+ edit legal.eula（locked=yes）→ error[SEGMENT_LOCKED]                        [exit=4]
+ edit dlg.guard.bribe --target 站住！{who} 说明你的来意。（多余占位符）       [exit=0]
+ qa
{"segment":"seg-159b11850aeefdb5","code":"PLACEHOLDER_MISMATCH",...,"message":"Placeholder mismatch (not in source: {who})."}
{"segment":"seg-8c3be7a9a3b9053d","code":"EMPTY_TARGET",...,"message":"Target is empty (source: Round as a coin, bright as the sun. What am I?)."}
{"segment":"seg-14da141927797f55","code":"EMPTY_TARGET",...,"message":"Target is empty (source: …you shouldn't be here, 凡人。)."}
findings: 3                                                    [exit=0]
+ edit dlg.guard.bribe --target 贿赂？你好大的胆子！ --expected-revision 1     [exit=0]
+ qa → findings: 2（仅剩两个空目标，mismatch 消除）                            [exit=0]
+ export → path: .../exports/mini_dialogue.csv
  sha256: ecdc0b866f7546a815828ad42aa7a250e7d5ac9806db6dde4f7d17dfff15b11a    [exit=0]
+ verify → verify: OK / segments: 8                                          [exit=0]
+ verify tampered.csv → mismatch: dlg.arya.shop: expected "小店商品齐全，朋友。", export has "TAMPERED译文"
  verify: FAILED / mismatches: 1                                             [exit=6]
```

自动化测试另断言：未修改导出逐字节一致；导出文件表头行与锁定行（`legal.eula`）逐字节不动、总行数一致（含引号内嵌换行段）；库内 2 条 exports 记录、CAS 段 revision `[1,2]`。

#### 4.3 JSON（`mini_items.json`，8 段，flat i18n 形状）

```
+ create-project --seed g2-json → project: prj-8e4cf3bc8468e2a3              [exit=0]
+ import --file mini_items.json
asset: ast-2d88e6efbd04a900
format: json_i18n
segments: 8
source-sha256: add36030c063cd808e87ac249017a8939a4e22bea6d839e5429a2f6586ab647a
source-blob: source/ast-2d88e6efbd04a900.json
warnings: 0                                                    [exit=0]
+ segments（节选：flat 形状导入即源文件语义，target 全空）
{"key":"items.potion.desc",...,"source":"Restores {count} HP.\n\"Drink up, traveler!\"","target":""}
{"key":"ui.compare_hint",...,"source":"","target":""}
segments: 8                                                    [exit=0]
+ edit items.potion.name --expected-revision 1 → error[REVISION_CONFLICT]     [exit=4]
+ edit items.potion.name --target 高级生命药水 --expected-revision 0 → revision: 1   [exit=0]
+ edit items.potion.desc --target 恢复生命。"喝吧，旅人！"（丢 {count}）       [exit=0]
+ qa
{"code":"PLACEHOLDER_MISMATCH",...,"message":"Placeholder mismatch (missing in target: {count})."}
{"code":"EMPTY_TARGET",...} ×5（potion.lore / sword.name / sword.desc / sword.flavor / ui.equip）
findings: 6                                                    [exit=0]
```

（`ui.compare_hint` 源文为空字符串，**正确地不产生** EMPTY_TARGET——空源无可译内容。）

```
+ edit items.potion.desc --target 恢复 {count} 点生命。"喝吧，旅人！" --expected-revision 1   [exit=0]
+ qa → findings: 5（mismatch 消除）                                          [exit=0]
+ export → path: .../exports/mini_items.json
  sha256: 1ca71d92a261bea5d67f48a819d0ab686113fe2b7e7db872a38136ce1b0d8c37    [exit=0]
+ verify → verify: OK / segments: 8                                          [exit=0]
+ verify tampered.json → mismatch: items.potion.name: expected "高级生命药水", export has "TAMPERED译文"
  verify: FAILED / mismatches: 1                                             [exit=6]
```

自动化测试另断言：未修改导出逐字节一致；导出 JSON 可解析，`meta`（version/premium_only/event_end 非字符串叶）原样、未编辑 CJK 叶 `items.potion.lore` 原样、被编辑叶持有译文。JSON fixture 无 locked 条目，锁定拒绝路径由 XLIFF/CSV 两腿覆盖（`mini_items.json` 无 `locked` 字段的设计所致，已如实记录）。

#### 4.4 verify 的比对语义（如实说明）

`verify` 逐段（按 ordinal+key 对齐）比较**有效文本**（有 target 取 target，否则取 source）：双语格式（XLIFF/CSV）导出把 target 写进模板，重导入即得 target；flat-JSON 导出是「源文件 → 译文文件」语义，被编辑叶重导入时读作新源文——同一条规则两种语义都覆盖。另断言段数相等、键集合无缺漏；任一不一致 exit 6 并逐行列出 mismatch。

### 标准 2：静态检查与测试基线 — **PASS**

| 检查 | 实际结果 |
| --- | --- |
| 根 `bun run typecheck` | **9/9 包 exit 0**（@proma/shared、session-core、core、cli、ui、electron、@linguist/cat-core、cat-formats、cat-store 全部 `Exited with code 0`） |
| 根 `bun test` | **588 pass / 2 fail** / 590 tests / 78 files——与 PB-023/PB-024 基线逐数一致；`*.nodetest.ts` 不被 bun 拾取（实测确认计数不变）；2 条失败为 PB-003 起既有上游环境限制（纯 Bun 无法 import electron 命名导出），未变差 |
| `cd packages/linguist-cat-store && bun run test`（node --test） | **59 pass / 0 fail**（40 PB-024 基线 + 7 asset-source + 8 minimal-qa + 4 cli-slice 端到端） |
| 根 `bun run check:boundaries` | **3 pass / 0 fail**（提交前 + 提交后复跑均 3/3；全部新文件位于白名单 `packages/linguist-*` 与 `docs/`） |
| CLI 退出码矩阵（cli-slice 第 4 条） | 未知命令/缺 flag/未知 flag → 2；缺文件/未知项目 → 3；未知段 → 4（`UNKNOWN_SEGMENT`）；不支持格式（PNG 字节）→ 5（`FORMAT_UNSUPPORTED`）；CAS 冲突/锁定 → 4；verify 不一致 → 6 |

## 5. Hermetic 性质

- 无网络：CLI 无任何网络调用；registry 只注册本地三个 adapter。
- 无真实用户数据：全部输入为仓库内 synthetic fixtures；每次运行 root 为 `mkdtemp`（`/tmp/cat-cli-slice-*`、`/tmp/g2-evidence-*`），不触碰 `~/.proma` 或任何真实目录。
- 确定性：`--seed`（createSeededEntropy）决定项目 id；`--now` 钉住索引/迁移/修订/导出记录全部时间戳；段/资产/finding id 均为内容派生，重跑可复现（本报告中的 id 即为种子 `g2-<fmt>` 的确定产物）。
- 无后台残留：CLI 单进程执行即退；测试用 `spawnSync` 同步子进程。

## 6. 已知限制

1. **CLI 必须在 Node 下运行**（node:sqlite）：bun 1.3.14 完全没有 node:sqlite（PB-024 实测）。`bun run cli` 只是 spawn node 的壳。Electron 主进程接入（PB-025 之后的 IPC 票）天然满足此约束。
2. **最小 QA 是 interim**：只有 EMPTY_TARGET 与 PLACEHOLDER_MISMATCH（{curly} + inline `<tag>` 多重集比对）两条规则，无数字/术语/模糊规则；inline 标签按逐字 token 比对，合法改写标签属性的译文会误报——PB-070 的 QA Core 到来后整体替换（代码头/CLI 文档/本报告三处标注）。
3. **重复导入同一文件**（同内容同名 → 同内容派生 asset id）会以 sqlite 主键冲突失败，退出码 1（未类型化为专门错误）；v1 CLI 不声明重复导入语义。
4. **同毫秒同内容重复导出**会使 exports 审计记录 id（内容派生自 assetId|sha256|createdAt）冲突报错；CLI 场景 `--now` 由调用方控制，实测流程各导出时间戳不同，未做冲突重命名。
5. **`--now` 为单次调用常量**：一次调用内多步写入共享同一时间戳（可预期的确定性取舍）。
6. 打包 smoke 不适用（纯 CLI/存储面，无 Electron 面）；`real_machine_verified`/`packaged_app_verified` 不声明。
7. `segments --limit` 默认 500（仓库默认值），更大清单需显式 `--limit`；export/qa/verify 内部自动分页取全量。

## 7. G2 结论

门禁唯一硬标准「CLI Vertical Slice 必须完全通过」**达成**：三种格式全部阶段 PASS、正反路径均有类型化错误与退出码、导出结构保持且篡改必现形、全部静态检查与测试基线不劣化。**G2 = GATE PASSED — 自本提交起解除「禁止开始 UI 和 Agent Tool」的限制**（Batch 3 的 IPC/UI 票与 Agent Tool 票可启动）。
