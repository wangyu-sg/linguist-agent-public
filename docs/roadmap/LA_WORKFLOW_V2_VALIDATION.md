# LA 通用工作流 v2：有限合成验证

记录日期：2026-09-24。实施前仓库 HEAD 为 `24bd60648be35a5c3bfab66c7a2cacc2e3a21a80`；下表测的是本轮代码改动，不是发布版。测试使用 Bun 1.3.14、Node 22.22.1 和仓库内的合成数据；没有读取客户文件、真实会话，也没有发起真实 Provider 网络请求。

方法：W1a 使用 `browser-input.test.ts` 的状态 fixture 计算 `JSON.stringify` 的字节数；W1b、W6 在 `packages/linguist-cat-tools/src/tools.nodetest.ts` 的现有 fixture 中临时打印真实工具 `content[0].text` 与相应 `details`/`content` 字节，临时测试副本已删除。回归命令是 `bun test` 对应浏览器、协作测试文件，以及 `bun run --filter='@linguist/cat-tools' test`。测试对应本轮实现，不能把实施前的 HEAD 当作补丁提交 SHA。

## 可复验的结果

| 范围 | 合成输入与可观察结果 | 模型工具文本 UTF-8 字节 |
| --- | --- | ---: |
| W1a 浏览器动作回执 | 双标签、30 条历史记录的状态 fixture；回执指向实际操作标签并携带 `documentRevision`，未带用户标签或历史。旧状态与新回执使用同一 JSON 序列化方式计算；这是**结构体序列化代理**，不是保存的旧 Provider 请求。 | 完整状态 1,447 → 回执 143 |
| W1b CAT 导入结果投影 | 两文件，其中一项需补映射；一个未知 Tag 模式有 500 个合成例。模型结果仍包含两个文件的状态、频次、例数与首例；`details` 保留全部 500 例供 UI/后续查询。 | 完整 `details` JSON 40,830 → 本次实际模型 `content[0].text` 526 |
| W6 `cat_get_segments` 索引视图 | 同一筛选的两条短句段，`index` 与 `content` 的总数、顺序、分页一致；索引不含 Source/Target，默认 `content` 未变。 | 本次实际 `content` 843 → `index` 815；**仅少 28 字节**，短文本样本不足以证明普遍省量 |

上述字节是合成 fixture 的单次工具正文或明确标注的序列化代理，**不是 token、费用或整轮上下文**。W1b 的比较基准是同一结果的完整业务 `details` JSON，不表示当前 UI 数据被删除。W6 的目的首先是让导航请求无需返回正文，不能据这两条短句推断大量长句的收益。

新增 `pi-tool-result-provider-projection.test.ts` 合成测试调用已锁定 Pi 的 `convertToLlm → normalizeContext → convertResponsesMessages`（Codex/OpenAI Responses 实际请求转换链）。测试在 Pi 消息中保留 500 条 `details` 例子，同时验证最终 `function_call_output` **只等于两项工具各自的 `content` 文本**；浏览器完整状态中的历史标记、CAT `details` 标记均未进入该 Provider 输入。该测试 1/1 通过，Electron 包 typecheck 通过；未发起网络请求。这证明本地 Codex Provider 转换链没有把大型 `details` 再注入最终工具结果，不代表所有 Provider 或历史会话的真实请求都已逐一复测。

业务回归：浏览器输入合同 5/5（含已识别错误的稳定原因码）；协作等待与显式文件交接 10/10；CAT tools 56/56。协作单元测试验证 `timeoutSeconds=120` 时预算函数给出 125,000 毫秒。另做一次**非客户真实跨进程 smoke**：在临时用户目录启动 Electron `utilityProcess`，将合成触发器临时注入实际 `agent-runtime.ts`，经原生 `MessagePort` 调用实际 `requestParent`；主进程 `AgentRuntimeClient` 的合成业务 handler 等待 121,000 毫秒后返回。以 `timeoutSeconds=122` 请求时，utility 在 **121,004 毫秒**收到业务返回，没有在原 120 秒 RPC 边界超时。第二次请求从 utility 取消，主进程收到一次 `CAPABILITY_CANCEL`，合成等待监听归零、utility 待响应请求归零，合成 child 状态仍为 `running`。这证明当前 utility→main 传输预算与取消消息链路；合成 handler 不等于真实模型或完整子任务执行。测试只运行一次，临时触发器未写入生产代码。单元测试另验证取消等待不停止子任务，以及父子不同 cwd 时仅引用或复制明确指定文件；缺失、指纹错误和越权软链接在启动子任务前阻断。CAT 测试也验证导入状态不丢、默认正文不截断、索引筛选/分页一致。

W4 的两项真实 Chromium 合成测试在独立复测中通过：`browser-download.browser.test.ts` 验证双标签操作目标、同名下载、`in_progress` 收据、重复派发拦截，以及关闭原标签后仍按 operationId 取得完成收据；`browser-input.browser.test.ts` 验证组合键、焦点和同队列序列不污染正文。测试仅用本地合成页面与临时用户目录。默认沙箱中 Electron 子进程曾无输出退出 134；获得测试进程权限后两项通过。下载回执中的文件路径不等于 CAT 导入授权，也不单独证明作业、语言或版本身份。

W7 的合成导入验证：Phrase adapter 10/10，`project-import-preview.nodetest.ts` 与 `context-import.nodetest.ts` 各 1/1。预检和正式导入共用 prepare；损坏 XML、JSON working-copy sidecar、反序包装、Target 独有标记、占位符数量超出 master、歧义或错误 master 均不能报告 ready；有效 Phrase 内容改为 `.xlf` 后仍须满足相同恢复条件。split 与 master 首次导入、原样重复导入时，master 都是 supporting，不会新增独立批次。原生 Tag、锁定段与无修改原件导出仍由 adapter 回归覆盖。边界检查 4/4、架构测试 14/14、全仓 typecheck 和 `git diff --check` 通过。

## 尚不能推出的结论

- 没有同条件的真实模型运行，因此无法证明模型往返数、Pi input/cache/output token、实际费用或总墙钟改善。
- 没有最终 Provider 请求的 system、工具 schema、Skill、历史和工具正文分解，也没有长/短会话及压缩起止事件；无法判断频繁压缩的成因或改动对压缩耗时的因果效果。
- 没有完整的合成审校真值实验；此处的工具合同回归不等于语言问题检出率、误改率或全范围决定已经验证。
- 本记录不把工具调用数当作模型请求数，也不把字节节省直接换算成 token。后续若做性能对照，须固定模型、有效 effort、权限、任务真值和所需证据，并分别报告 Provider 请求与业务结果。
