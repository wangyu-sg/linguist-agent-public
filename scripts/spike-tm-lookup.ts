import { ensureDemoWorkspace } from "@linguist-agent/cat-data";
import { createCatAgentSession } from "@linguist-agent/cat-runtime";

const workspace = await ensureDemoWorkspace(process.cwd());
const { session } = await createCatAgentSession({
  workspace,
  modelProvider: process.env.LA_MODEL_PROVIDER ?? "deepseek",
  modelId: process.env.LA_MODEL_ID ?? "deepseek-chat",
});

let toolCalls = 0;
session.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
  if (event.type === "tool_execution_start") {
    toolCalls += 1;
    process.stdout.write(`\n[tool_start] ${event.toolName}\n`);
  }
  if (event.type === "tool_execution_end") {
    process.stdout.write(`[tool_end] ${event.toolName}\n`);
  }
});

try {
  await session.prompt(
    "查 TM：source=`勇者徽记`。必须调用 tm_lookup，然后只输出最终英文译名和一行证据。",
  );
  process.stdout.write(`\n\n[summary] tool_calls=${toolCalls}\n`);
  if (toolCalls < 1) {
    throw new Error("Pi session completed without calling tm_lookup.");
  }
} finally {
  session.dispose();
}
