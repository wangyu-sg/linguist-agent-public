import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { appendAskPayload } from "./ask-payload-store.ts";
import {
	ASK_TOOL_DESCRIPTION,
	ASK_TOOL_PROMPT_GUIDELINES,
	invalidPayloadResponse,
	nonInteractiveResponse,
	renderAskToolCall,
	renderAskToolResult,
	successfulResponse,
	validateParams,
} from "./ask-tool-helpers.ts";
import { getAskConfigStore } from "./config/store.ts";
import {
	applyRemoteAskResponse,
	type RemoteAskRuntime,
} from "./remote-ask.ts";
import { AskParamsSchema } from "./schema.ts";
import { toAskResult } from "./state/result.ts";
import type { AskParams, AskResult, AskState } from "./types.ts";
import { runAskFlow } from "./ui/controller.ts";

export function registerAskTool(
	pi: ExtensionAPI,
	remoteAsk?: RemoteAskRuntime
) {
	pi.registerTool({
		name: "ask_user",
		label: "Ask User",
		description: ASK_TOOL_DESCRIPTION,
		promptSnippet:
			"Clarify ambiguous or preference-sensitive decisions with a short interactive interview before proceeding",
		promptGuidelines: [...ASK_TOOL_PROMPT_GUIDELINES],
		parameters: AskParamsSchema,
		execute: (toolCallId, params, signal, onUpdate, ctx) =>
			executeAskTool(
				pi,
				toolCallId,
				params as AskParams,
				signal,
				onUpdate,
				ctx,
				remoteAsk
			),
		renderCall: renderAskToolCall,
		renderResult: renderAskToolResult,
	});
}

async function executeAskTool(
	pi: Pick<ExtensionAPI, "appendEntry">,
	toolCallId: string,
	params: AskParams,
	signal: AbortSignal | undefined,
	_onUpdate: unknown,
	ctx: ExtensionContext,
	remoteAsk?: RemoteAskRuntime
) {
	const config = await getAskConfigStore().getConfig();
	const validation = validateParams(params, {
		presentSingleAsMulti: config.behaviour.presentSingleAsMulti,
	});
	if (!validation.ok) {
		return invalidPayloadResponse(params, validation.issues);
	}
	appendAskPayload(pi, {
		params,
		source: "tool",
		sourceEntryId: toolCallId,
	});
	if (ctx.mode !== "tui") {
		if (!remoteAsk) {
			return nonInteractiveResponse(validation.state);
		}
		return successfulResponse(
			await runHeadlessAskFlow(
				validation.state,
				remoteAsk,
				toolCallId,
				signal
			)
		);
	}
	ctx.ui.setWorkingVisible(false);
	try {
		const result = await runAskFlow(ctx, params, {
			remote: remoteAsk
				? { runtime: remoteAsk, source: "tool", toolCallId }
				: undefined,
		});
		return successfulResponse(result);
	} finally {
		ctx.ui.setWorkingVisible(true);
	}
}

function runHeadlessAskFlow(
	initialState: AskState,
	remoteAsk: RemoteAskRuntime,
	toolCallId: string,
	signal?: AbortSignal
): Promise<AskResult> {
	return new Promise((resolve) => {
		let state = initialState;
		let settled = false;
		let flow: ReturnType<RemoteAskRuntime["startFlow"]> | undefined;
		const finish = (nextState: AskState) => {
			if (settled) {
				return;
			}
			settled = true;
			signal?.removeEventListener("abort", abort);
			const result = toAskResult(nextState);
			flow?.complete(result);
			resolve(result);
		};
		const abort = () =>
			finish({ ...state, cancelled: true, completed: true });

		flow = remoteAsk.startFlow({
			source: "tool",
			toolCallId,
			title: state.title,
			questions: state.questions,
			onSubmit: (response) => {
				const resolution = applyRemoteAskResponse(state, response);
				if (!resolution.ok) {
					return resolution;
				}
				state = resolution.state;
				finish(state);
				return { ok: true };
			},
		});
		if (signal?.aborted) {
			abort();
		} else {
			signal?.addEventListener("abort", abort, { once: true });
		}
	});
}
