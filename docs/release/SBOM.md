# SBOM — 第三方依赖与许可

扫描日期：2026-09-14

- 命令：`bun run license:scan`
- 机读全量真源：[sbom-full.json](./sbom-full.json)
- 口径：生产依赖闭包与实际 Electron framework；第一方 `@proma/*` / `@linguist/*` workspace 不计入第三方统计。
- 第三方依赖：519 个。

| License | 数量 |
|---|---:|
| MIT | 374 |
| Apache-2.0 | 52 |
| ISC | 46 |
| BSD-3-Clause | 24 |
| BSD-2-Clause | 7 |
| BlueOak-1.0.0 | 2 |
| Apache-2.0* | 3 |
| Unlicense | 2 |
| 其他单项许可 | 9 |

单项许可为 `(MIT AND Zlib)`、`(MIT OR GPL-3.0-or-later)`、`(MPL-2.0 OR Apache-2.0)`、`0BSD`、`BSD*`、`EPL-2.0`、`LGPL-3.0-or-later`、`MIT*`、`OFL-1.1`，各 1 个。

许可门禁对禁止许可 fail closed。`jszip` 按 MIT 采用；DOMPurify 按 Apache-2.0 采用；sharp 随附的未修改动态 libvips 平台包按已登记 LGPL 义务处理。处置与归属见 [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md)。当前清单不含 Claude Agent SDK 专有包。

本文件只保留摘要，不复制 519 行易漂移的包表；精确包名、版本、许可和仓库以 JSON 与 lockfile 为准。
