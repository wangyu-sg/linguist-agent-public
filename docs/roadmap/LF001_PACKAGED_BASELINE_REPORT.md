# LF-001：Packaged UI 与 Happy-path 基线

> 执行日期：2026-07-27
>
> 取证代码：`554ac7fb966e05ade09d3511889de566edf7712c`
>
> 结论：**基线已建立；G-F0 仍为 blocked**

## 1. 证据边界

本票在当前源代码重新构建的未签名 macOS arm64 `.app` 上取证。测试使用
`mkdtemp` HOME 和独立 Electron `userData`，只写合成项目、合成会话与 Fake
Provider；没有读取或修改真实用户数据。

取证时的打包产物：

| 项目 | 实际值 |
|---|---|
| App | `apps/electron/out/mac-arm64/Linguist Agent.app` |
| 版本 | `0.15.46` |
| `app.asar` SHA-256 | `4eeaa8660c9c800ae75b93d975b7163e5a3aba26caa09318ab1878397a792742` |
| Node / Bun | `v22.22.2` / `1.3.14` |
| 构建结果 | PASS |

LF-002、LF-004 在取证期间完成，但只修改文档和架构测试，不改变本票截图对应的产品代码。
其他 Agent 的未提交生产代码不属于本基线。

## 2. 当前截图

全部图片来自 Playwright 驱动的真实打包 App，不是源码拼图或历史截图。

| 视图 | Fixture | 证据 |
|---|---|---|
| Agent | 1000 turns / 2000 messages | [`agent-1280x820-light.png`](./lf001-evidence/agent-1280x820-light.png) |
| Chat | 新建空对话，无 Provider | [`chat-1280x820-light.png`](./lf001-evidence/chat-1280x820-light.png) |
| Projects | 合成 10k Segment 项目 | [`projects-1280x820-light.png`](./lf001-evidence/projects-1280x820-light.png) |
| CAT | 合成 10k Segment 项目 | [`cat-1280x820-light.png`](./lf001-evidence/cat-1280x820-light.png) |

文件哈希和 Fixture 见
[`lf001-evidence/manifest.json`](./lf001-evidence/manifest.json)。

## 3. Packaged 验证结果

### 3.1 构建

```bash
cd apps/electron
PATH="/Users/<local>/.bun/bin:$PATH" /Users/<local>/.bun/bin/bun run smoke:pack
```

结果：PASS。Main、Preload、Renderer、CLI、资源和 runtime dependencies 均完成，
electron-builder 产出 `out/mac-arm64/Linguist Agent.app`。

构建仍有已知 warning：

- CJS bundle 中两处 `import.meta` warning；
- Renderer 大 chunk warning；
- `build:resources` 仍包含 `|| true`。

这些 warning 不改变 LF-001 取证结论，分别留给既定工程收口工单处理。

### 3.2 G0 Chat happy path

```bash
cd apps/electron
node scripts/smoke/run-g0-smoke.ts
```

结果：**8 PASS / 1 FAIL**。

已通过：

- 打包二进制存在；
- Fake Model Server 启动；
- 打包 App 启动；
- Preload API 可用；
- 首屏渲染；
- Fake Channel 与设置写入；
- Onboarding 跳过；
- 临时 HOME 隔离成立。

失败点：

```text
创建 G0文本流 对话
→ 点击打开该对话
→ 一个 data-state="open" 的模态遮罩拦截点击
→ locator.click 超时
```

因此文本流、Thinking、Tool roundtrip、Stop/Retry 与重启恢复没有在本轮抵达，
必须记为 **not reached**，不能沿用旧 G0 的 18/18 结果。

### 3.3 Agent / Projects / CAT 视觉与性能矩阵

```bash
cd apps/electron
bun run smoke:vertical
```

历史矩阵结果：**35 PASS / 1 FAIL / 3 WARN**；原矩阵探针已退役，当前入口如上。

已确认：

- Light/Dark × 1280×820、1024×700、800×600 的 Agent/CAT/Projects
  页面级横向溢出均为 0；
- 200% zoom 的 Agent/CAT 无页面级横向溢出；
- Reduced Motion 生效；
- 10k Grid 首屏 709ms、末行可达、DOM row 14、滚动锚点漂移 0；
- 1000-turn 中部跳转 85ms，消息数 2000。

未通过：

- 1000-turn 首次打开 `10474ms`，超过 `10000ms` 软阈值。

WARN：

- Agent Axe serious/critical：5 个规则；
- CAT Axe serious/critical：4 个规则；
- Projects Axe serious/critical：3 个规则。

## 4. 当前 Happy-path 判定

| 路径 | 判定 | 说明 |
|---|---|---|
| Agent | conditional | 打包渲染和大线程状态成立；本票未执行真实 Provider 发送 |
| Chat | blocked | 第一条对话打开被模态遮罩阻断，后续流式路径 not reached |
| Projects | baseline captured | 项目列表与合成项目可打包渲染 |
| CAT | baseline captured | 10k 项目可进入 CAT，虚拟列表成立；本票不证明完整编辑/导出流程 |

## 5. G-F0 判定

**G-F0 仍为 blocked。**

原因：

1. Packaged Chat happy path 未全绿；
2. 1000-turn 首开仍超过阈值；
3. serious/critical Axe 问题仍存在；
4. LF-001 只建立可信基线，不替代 LF-003 的每批纵向 smoke。

LF-001 的完成含义是“当前状态已被真实、可复跑地记录”，不是“产品通过 Gate”。
