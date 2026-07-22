import type { AssistantMessage, Context } from "@earendil-works/pi-ai/compat";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { TaskUsage } from "@linguist-agent/cat-data";
import { normalizePiRuntimeModel } from "@linguist-agent/cat-runtime";

export interface SessionTitleInput {
  projectId?: string;
  userMessage: string;
  assistantText: string;
  provider?: string;
  modelId?: string;
  modelRuntime?: ModelRuntime;
  generateTitle?: (input: SessionTitleInput) => Promise<{ text: string; usage?: TaskUsage } | undefined>;
}

export interface GeneratedAgentTitle {
  title: string;
  usage?: TaskUsage;
}

const MAX_TITLE_CHARS = 32;

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function compactSessionTitle(firstMessage: string, fallback: string): string {
  const request = /(?:^|\n)User request:\s*([^\n]+)/.exec(firstMessage)?.[1]?.trim();
  const candidate = collapseWhitespace(request || firstMessage || "");
  const text = candidate.startsWith("/") ? fallback : candidate || fallback;
  return text.length > 72 ? `${text.slice(0, 71)}…` : text || fallback;
}

export function sanitizeGeneratedSessionTitle(rawTitle: string, fallback: string): string {
  const cleaned = collapseWhitespace(rawTitle)
    .replace(/^```(?:json|text)?/i, "")
    .replace(/```$/i, "")
    .replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, "")
    .replace(/^(?:title|标题|session\s*name)\s*[:：-]\s*/i, "")
    .replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, "")
    .replace(/[。.!！?？；;，,]+$/g, "")
    .replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, "")
    .trim();
  const candidate = cleaned || fallback;
  return candidate.length > MAX_TITLE_CHARS ? `${candidate.slice(0, MAX_TITLE_CHARS - 1)}…` : candidate;
}

function responseText(response: AssistantMessage): string {
  return response.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function titlePrompt(input: SessionTitleInput): Context {
  const userMessage = input.userMessage.slice(0, 2400);
  const assistantText = input.assistantText.slice(0, 3200);
  const scope = `Project agent session: ${input.projectId ?? "project"}`;
  return {
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              "Generate a concise session title for this agent conversation.",
              "Rules:",
              "- Return only the title text, no JSON, no quotes, no punctuation wrapper.",
              "- Prefer the user's language. If the request is Chinese, use Chinese.",
              "- Summarize the actual task, not just the first sentence.",
              "- 6 to 14 Chinese characters or 3 to 7 English words is ideal.",
              "- Do not include the project id unless it is needed to disambiguate.",
              "",
              `Scope: ${scope}`,
              "",
              "<user_request>",
              userMessage,
              "</user_request>",
              "",
              "<assistant_result>",
              assistantText,
              "</assistant_result>",
            ].join("\n"),
          },
        ],
        timestamp: Date.now(),
      },
    ],
  };
}

async function generateTitleWithModel(input: SessionTitleInput): Promise<{ text: string; usage: TaskUsage } | undefined> {
  if (!input.provider || !input.modelId) return undefined;
  const modelRuntime = input.modelRuntime ?? await ModelRuntime.create({ allowModelNetwork: false });
  const model = normalizePiRuntimeModel(modelRuntime.getModel(input.provider, input.modelId));
  if (!model) return undefined;
  if (!await modelRuntime.getAuth(model)) return undefined;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await modelRuntime.complete(model, titlePrompt(input), {
      maxTokens: 80,
      temperature: 0.2,
      signal: controller.signal,
    });
    return {
      text: responseText(response),
      usage: {
        inputTokens: response.usage.input,
        outputTokens: response.usage.output,
        cacheReadTokens: response.usage.cacheRead,
        cacheWriteTokens: response.usage.cacheWrite,
        totalTokens: response.usage.totalTokens,
        costUSD: response.usage.cost.total,
        modelCalls: 1,
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateAgentTitle(input: SessionTitleInput): Promise<GeneratedAgentTitle | undefined> {
  const generated = input.generateTitle ? await input.generateTitle(input) : await generateTitleWithModel(input);
  if (!generated?.text) return undefined;
  const fallback = input.projectId ?? "Task";
  return {
    title: sanitizeGeneratedSessionTitle(generated.text, compactSessionTitle(input.userMessage, fallback)),
    usage: generated.usage,
  };
}
