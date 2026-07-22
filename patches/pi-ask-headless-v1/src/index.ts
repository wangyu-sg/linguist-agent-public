import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerAskTool } from "./ask-tool.ts";
import { resetAskConfigStore } from "./config/store.ts";
import { createRemoteAskRuntime } from "./remote-ask.ts";

export default function askExtension(pi: ExtensionAPI) {
	resetAskConfigStore();
	const remoteAsk = createRemoteAskRuntime(pi.events);
	pi.on("session_shutdown", () => {
		remoteAsk.disposeAll();
	});
	registerAskTool(pi, remoteAsk);
}
