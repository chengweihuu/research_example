import { Agent } from "../node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-agent-core/dist/index.js";
import { AssistantMessageEventStream } from "../node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/utils/event-stream.js";
import { executeCanary } from "./canary-executor.mjs";
import { createIdeaTask, inspectIdeaTask, promoteEvidence, sealIdeaRun } from "./idea-evidence-lifecycle.mjs";

const SYSTEM_PROMPT = "You have no tools. Answer the user's request directly.";

function requiredFunction(value, name) {
	if (typeof value !== "function") throw new TypeError(`${name} must be a function`);
	return value;
}

function observedStream(source, providerEventTypes) {
	const observed = new AssistantMessageEventStream();
	void (async () => {
		for await (const event of source) {
			providerEventTypes.push(event.type);
			observed.push(event);
		}
	})();
	return observed;
}

function stageReceipt(agentEventTypes, providerEventTypes, assistant) {
	return [
		"before_request",
		...(agentEventTypes.includes("agent_start") ? ["agent_start"] : []),
		"stream_start",
		...(assistant ? ["assistant_message"] : []),
		...(providerEventTypes.length > 0 ? ["stream_end"] : []),
		...(agentEventTypes.includes("agent_end") ? ["agent_end"] : []),
		"after_request",
		"after_settlement",
	];
}

function sseBoundary(providerEventTypes, assistant) {
	if (!providerEventTypes.includes("start")) return [];
	const settled = providerEventTypes.at(-1) === "done";
	const usageReported = Number.isFinite(assistant?.usage?.input) && Number.isFinite(assistant?.usage?.output) && assistant.usage.input + assistant.usage.output > 0;
	return [
		"opened",
		...(providerEventTypes.includes("text_delta") ? ["text_delta"] : []),
		...(settled && usageReported ? ["usage_complete", "done"] : ["interrupted"]),
	];
}

/** Run exactly one isolated Pi Core Agent Session over an injected, non-network stream. */
export async function runPiHarnessTask({ ideaId, taskId, runId, question, outputDir, branch, ref, catalogModel, streamFn }) {
	requiredFunction(streamFn, "streamFn");
	const task = createIdeaTask({ ideaId, taskId, runId, sessionId: runId, question, outputDir, branch, ref });
	const agentEventTypes = [];
	const providerEventTypes = [];
	let streamCalls = 0;
	let agent;
	const executorResult = await executeCanary({
		runId,
		provider: catalogModel?.provider,
		modelId: catalogModel?.id,
		catalogModel,
		serializedBytes: Buffer.byteLength(JSON.stringify({ systemPrompt: SYSTEM_PROMPT, question, tools: [] }), "utf8"),
		outputTokens: 64,
		totalTokenCap: 1024,
		usdCap: 0.05,
		session: { sessionId: runId, eventTypes: agentEventTypes },
		transport: async () => {
			agent = new Agent({
				initialState: { systemPrompt: SYSTEM_PROMPT, model: catalogModel, thinkingLevel: "off", tools: [] },
				sessionId: runId,
				transport: "sse",
				streamFn: async (model, context, options) => {
					if (streamCalls >= 1) throw new Error("Pi adapter forbids a second stream invocation");
					streamCalls += 1;
					return observedStream(await streamFn(model, context, { ...options, maxTokens: 64, maxRetries: 0, transport: "sse", sessionId: runId }), providerEventTypes);
				},
				shouldStopAfterTurn: () => true,
				toolExecution: "sequential",
			});
			agent.subscribe(event => { agentEventTypes.push(event.type); });
			await agent.prompt(question);
			await agent.waitForIdle();
			const assistant = agent.state.messages.findLast(message => message.role === "assistant");
			return { stages: stageReceipt(agentEventTypes, providerEventTypes, assistant), sseEvents: sseBoundary(providerEventTypes, assistant), assistant };
		},
	});
	if (streamCalls !== 1) throw new Error("Pi adapter did not complete exactly one stream invocation");
	const piSession = {
		kind: "pi-core-session",
		sessionId: runId,
		messages: agent?.state.messages ?? [],
		agentEventTypes,
		providerEventTypes,
	};
	const sealed = await sealIdeaRun({
		task,
		executorResult,
		piSession,
		capabilityManifest: { modelRequest: { provider: catalogModel.provider, modelId: catalogModel.id, maximumCalls: 1 }, tools: [] },
		environment: { runtime: "host", node: process.version, piCodingAgent: "0.84.2", mode: "injected-stream" },
		contextManifest: { ambientAgentsFiles: false, discoveredContextFiles: [], authRead: false, network: false, builtInPiTools: [], adapter: "pi-core-injected-stream-v1" },
	});
	const promotion = await promoteEvidence({ task, outputDir });
	if (!promotion.accepted) throw new Error(`Pi adapter produced ineligible evidence: ${promotion.code}`);
	return Object.freeze({
		lifecycle: inspectIdeaTask(task),
		ideaId: task.ideaId,
		taskId: task.taskId,
		runId: task.runId,
		sessionId: task.sessionId,
		provider: executorResult.profile.provider,
		modelId: executorResult.profile.modelId,
		streamCalls,
		manifestStatus: sealed.manifest.status,
		verification: sealed.verification,
		promotion,
		packetHash: sealed.manifest.packetHash,
		terminalLedgerHash: sealed.manifest.terminalLedgerHash,
	});
}
