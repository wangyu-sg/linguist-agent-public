# 2026-09-05 优化实施记录

本轮依据用户提供的新实施方案，逐批本地提交。起点为 `8fe9fe2e938698443bf07fea1bc04360094e19f7`，工作树干净；开发真源为本仓库。固定 Proma `v0.19.26@bbf577a8eb768225fdf1ac49ab9ef07a11413b24`，Pi 锁定 `0.84.4`，Bun `1.3.14`，App `0.17.70`，CAT schema `19`，实际工具数 `32`。本轮不移动上游基线。

## A / B1：自含多模态与历史恢复

- 真实失败：合法 GIF 经原 CAT projection 后，Pi 模型消息中的图片数为 0；移除投影后为 1。原投影通过 details 重建纯文本，根因得到生产转换链验证。
- 修改：`tool-runtime.ts` 输出自含正文；删除 `cat-tool-result-projection.ts` 及 adapter 的 CAT import/请求覆盖。既有 host extension 经 orchestrator 向 adapter 提供可选 `prepareSessionFile`，在 SDK 打开旧会话之前执行集中迁移。
- 存量保护：只处理正在恢复的会话中已知旧摘要；Pi SDK 解析记录；补回记录中已有 details 正文并保留图片和树 ID。首次写入前保留 `.before-cat-content-v1` 原件，原子替换，重复恢复不重写。缺失的历史图片无法重建，应重新读取受管资料。
- Touchpoint：删除 CAT request projection 跨层调用；已有 adapter/orchestrator 接入增加一次恢复前通知，登记原因同步。文件级账本数量未变。
- 验证：生产 sanitizer + SDK `convertToLlm` 的文本、混合图片、非法图片、非 CAT 内容；真实 `SessionManager.open`、压缩保留、分支与重复恢复。`test:evidence-workflow-v1` 3/3、`test:tools-critical` 44/44、全仓 typecheck、boundaries 4/4、fusion architecture 14/14、host seams 9/9 通过。Tools 废弃摘要断言改为自含 JSON，保留字节预算和隐私断言。
- 限制：B1 不改变旧工具执行时 Receipt 语义；该错误留给 B2，现有三岗位用例通过不能证明 Provider 收到资料。真实 Provider 与最终候选包尚未验收。

## B2：最终请求与回执

- 真实失败：原工具返回后、尚无下一次请求时已有 1 条 Receipt；生产回归先得到 `1 !== 0`，修复后为 0。
- 修改：Tools 只通知受信准备描述及实际 content；Linguist observer 核对最终 payload 的正文/视觉内容，再以 SDK `onResponse` 的 2xx HTTP 响应确认。adapter 只包装既有 SDK 回调并保留其他 extension 的修改，orchestrator 只传递 observer。
- 旧记录：既有 `evidence_json` 增加 `submission=provider-response-v1`、资料版本和视觉标记；无标记的旧工具级回执保留但不计新覆盖。未增加表或迁移 Schema。
- Touchpoint：已有 adapter/orchestrator 两个文件增加一个可选通用观察接入；未重新引入 CAT import、Provider 客户端、请求代理或全局 patch。计数未变。
- 验证：真实 CatStore → CAT tool → Pi Agent → SDK OpenAI Completions 序列化 → 127.0.0.1 合成 SSE Provider → 2xx 回调 → Receipt → 三岗位确认。实际 HTTP 包含正文和合法 GIF；非视觉模型与 sanitizer 删除的图片不签收；空 payload/503 不签收；记账故障不使模型调用失败，后续只重试记账；重复请求不重复记录。Evidence 3/3、Tools 44/44、Store 57/57、Delivery 2/2、全仓 typecheck、host seams 9/9 通过。
- 边界：2xx 证明实际请求获得 HTTP 响应，不证明流完整、模型理解或语言质量。尚未确认的准备信息只在当前 runtime turn 内保留；进程/turn 结束前未记账的内容保持未验证，需要再次读取，不能借历史图片目录补签。未知图像协议或未发出 SDK 响应通知的 Provider 保守少计；真实收费 Provider 未验证。

## 发布与数据边界

本轮仅本地提交，不推送、创建 PR/Tag/Release 或替换安装版。不使用客户文件、生产数据库或未授权凭据。README / AGENTS 本轮不改；需要同步的准确事实在最终记录列出。单元、生产链模拟、目录包与真实 Provider 资格分别记录。
