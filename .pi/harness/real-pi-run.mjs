import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Agent } from "../node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-agent-core/dist/index.js";
import { AssistantMessageEventStream } from "../node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/utils/event-stream.js";
import { ModelRuntime } from "../node_modules/@earendil-works/pi-coding-agent/dist/index.js";
import { executeCanary } from "./canary-executor.mjs";
import { sealCanonicalRun, verifyCanonicalRun } from "./canonical-run-seal.mjs";
import { createModelProfile } from "./model-profile.mjs";
import { writeHarnessStatus } from "./harness-status.mjs";

export const REAL_TERRA = Object.freeze({ provider: "openai-codex", modelId: "gpt-5.6-terra", outputTokens: 256, totalTokenCap: 768, usdCap: 0.012 });
const SYSTEM_PROMPT = "You have no tools. Answer only the user request, state assumptions, and do not claim physical execution.";
const PROMPT = "For the one-dimensional cubic B-spline with control points [0,1,2,1,3,2], open knot vector [0,0,0,0,1,2,3,3,3,3], and parameter domain [0,3], explain why simple time scaling can reduce velocity and acceleration without changing the geometric curve. State the scaling laws and the minimum scale needed when max velocity is 3.0 (limit 3.5) and max acceleration is 11.2 (limit 6.0).";

export function preflightRealTerra({ catalogModel, serializedBytes }) {
	if (!catalogModel || catalogModel.provider !== REAL_TERRA.provider || catalogModel.id !== REAL_TERRA.modelId) throw new Error("Preflight failed: exact Terra catalog record is unavailable");
	const profile = createModelProfile({ provider: REAL_TERRA.provider, modelId: REAL_TERRA.modelId, catalogModel, serializedBytes, outputTokens: REAL_TERRA.outputTokens, totalTokenCap: REAL_TERRA.totalTokenCap, usdCap: REAL_TERRA.usdCap });
	if (profile.request.quote.estimatedTotalTokens > REAL_TERRA.totalTokenCap || profile.request.catalogMaximumCostUsd > REAL_TERRA.usdCap) throw new Error("Preflight failed: quote exceeds frozen budget");
	return Object.freeze({ provider: profile.provider, modelId: profile.modelId, quote: profile.request.quote, catalogMaximumCostUsd: profile.request.catalogMaximumCostUsd, limits: { providerCalls: 1, retries: 0, ...REAL_TERRA } });
}
/** Match Pi's standard service initialization: synchronize local auth/catalog state without network. */
export async function prepareRealTerraRuntime(runtime) {
	if (!runtime || typeof runtime.refresh !== "function" || typeof runtime.getModel !== "function") throw new TypeError("runtime must provide refresh and getModel");
	await runtime.refresh({ allowNetwork: false });
	return runtime;
}
function makeRunId() { return `R-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}-${randomUUID().replaceAll("-", "").slice(0, 8)}`; }
function observeStream(source, eventTypes) { const observed = new AssistantMessageEventStream(); void (async () => { for await (const event of source) { eventTypes.push(event.type); observed.push(event); } })(); return observed; }

/** One real Pi Core request. Caller must explicitly pass --execute after reviewing --preflight. */
export async function executeRealTerra({ runtime, runtimePrepared = false, runId = makeRunId(), outputDir = resolve("runs/H-026", runId), branch, ref }) {
	if (!runtimePrepared) await prepareRealTerraRuntime(runtime);
	const model = runtime.getModel(REAL_TERRA.provider, REAL_TERRA.modelId);
	const serializedBytes = Buffer.byteLength(JSON.stringify({ model: `${REAL_TERRA.provider}/${REAL_TERRA.modelId}`, systemPrompt: SYSTEM_PROMPT, prompt: PROMPT, tools: [], maxTokens: REAL_TERRA.outputTokens, retries: 0 }), "utf8");
	const preflight = preflightRealTerra({ catalogModel: model, serializedBytes });
	await mkdir(dirname(outputDir), { recursive: true });
	const startedAtMs = Date.now();
	const status = (phase, extra = {}) => writeHarnessStatus({ outputDir, status: { taskId: "H-026", runId, phase, model: { provider: REAL_TERRA.provider, id: REAL_TERRA.modelId }, calls: { used: phase === "PREFLIGHT" ? 0 : 1, limit: 1 }, usage: { state: phase === "SETTLED" ? "ACTUAL" : phase === "FAILED" ? "UNAVAILABLE" : "PENDING" }, startedAtMs, ...extra } });
	await status("PREFLIGHT"); await status("RUNNING");
	const agentEventTypes = [], providerEventTypes = []; let agent; let streamCalls = 0;
	try {
		const executorResult = await executeCanary({ runId, provider: REAL_TERRA.provider, modelId: REAL_TERRA.modelId, catalogModel: model, serializedBytes, outputTokens: REAL_TERRA.outputTokens, totalTokenCap: REAL_TERRA.totalTokenCap, usdCap: REAL_TERRA.usdCap, session: { sessionId: runId, eventTypes: agentEventTypes }, transport: async () => {
			agent = new Agent({ initialState: { systemPrompt: SYSTEM_PROMPT, model, thinkingLevel: "off", tools: [] }, sessionId: runId, transport: "sse", streamFn: (requestedModel, context, options) => { if (streamCalls >= 1) throw new Error("Second provider call forbidden"); streamCalls += 1; return observeStream(runtime.streamSimple(requestedModel, context, { ...options, maxTokens: REAL_TERRA.outputTokens, maxRetries: 0, timeoutMs: 60000, transport: "sse", sessionId: runId }), providerEventTypes); }, shouldStopAfterTurn: () => true, toolExecution: "sequential" });
			agent.subscribe(event => agentEventTypes.push(event.type)); await agent.prompt(PROMPT); await agent.waitForIdle();
			const assistant = agent.state.messages.findLast(message => message.role === "assistant");
			const done = providerEventTypes.at(-1) === "done"; const usage = assistant?.usage;
			return { stages: ["before_request", ...(agentEventTypes.includes("agent_start") ? ["agent_start"] : []), "stream_start", ...(assistant ? ["assistant_message"] : []), ...(providerEventTypes.length ? ["stream_end"] : []), ...(agentEventTypes.includes("agent_end") ? ["agent_end"] : []), "after_request", "after_settlement"], sseEvents: providerEventTypes.includes("start") ? ["opened", ...(providerEventTypes.includes("text_delta") ? ["text_delta"] : []), ...(done && Number.isFinite(usage?.input) && Number.isFinite(usage?.output) && usage.input + usage.output > 0 ? ["usage_complete", "done"] : ["interrupted"])] : [], assistant };
		} });
		if (streamCalls !== 1) throw new Error("Real runner did not complete exactly one provider stream");
		const sealed = await sealCanonicalRun({ outputDir, taskId: "H-026", branch, ref, executorResult, piSession: { kind: "pi-core-session", sessionId: runId, messages: agent?.state.messages ?? [], agentEventTypes, providerEventTypes }, contextManifest: { ambientAgentsFiles: false, discoveredContextFiles: [], authRead: true, network: true, builtInPiTools: [], adapter: "pi-core-real-stream-v1" }, capabilityManifest: { modelRequest: { provider: REAL_TERRA.provider, modelId: REAL_TERRA.modelId, maximumCalls: 1 }, tools: [] }, environment: { runtime: "host", node: process.version, piCodingAgent: "0.84.2", authentication: "existing-openai-codex-login" } });
		const verification = await verifyCanonicalRun({ outputDir }); const actual = executorResult.settlement.actualUsage;
		if (actual && verification.accepted) await status("SETTLED", { finishedAtMs: Date.now(), usage: { state: "ACTUAL", inputTokens: actual.inputTokens, outputTokens: actual.outputTokens } });
		else await status("FAILED", { finishedAtMs: Date.now(), diagnosticCode: actual ? "RUN_UNVERIFIED" : "USAGE_UNAVAILABLE" });
		return Object.freeze({ runId, outputDir, preflight, provider: REAL_TERRA.provider, modelId: REAL_TERRA.modelId, executorCalls: executorResult.executorCalls, requestCount: executorResult.requestCount, settlement: executorResult.settlement.state, manifestStatus: sealed.manifest.status, verification, packetHash: sealed.manifest.packetHash, terminalLedgerHash: sealed.manifest.terminalLedgerHash });
	} catch (error) { await status("FAILED", { finishedAtMs: Date.now(), diagnosticCode: "RUN_FAILED" }); throw error; }
}

async function main() {
	const mode = process.argv[2]; if (!new Set(["--preflight", "--execute"]).has(mode)) throw new Error("Use --preflight or --execute");
	const valueFor = flag => { const index = process.argv.indexOf(flag); return index < 0 ? undefined : process.argv[index + 1]; };
	const runtime = await ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: false });
	await prepareRealTerraRuntime(runtime);
	const model = runtime.getModel(REAL_TERRA.provider, REAL_TERRA.modelId);
	const serializedBytes = Buffer.byteLength(JSON.stringify({ model: `${REAL_TERRA.provider}/${REAL_TERRA.modelId}`, systemPrompt: SYSTEM_PROMPT, prompt: PROMPT, tools: [], maxTokens: REAL_TERRA.outputTokens, retries: 0 }), "utf8");
	const preflight = preflightRealTerra({ catalogModel: model, serializedBytes });
	if (mode === "--preflight") { process.stdout.write(`${JSON.stringify(preflight)}\n`); return; }
	const runId = valueFor("--run-id"); const outputDir = valueFor("--output-dir");
	if (!runId || !outputDir) throw new Error("--execute requires --run-id <id> --output-dir <absolute-dir>");
	process.stdout.write(`${JSON.stringify(await executeRealTerra({ runtime, runtimePrepared: true, runId, outputDir, branch: "task/H-026-real-terra-bspline-run", ref: process.env.HARNESS_REF ?? "HEAD" }))}\n`);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch(error => { process.stderr.write(`${error.name}: ${error.message}\n`); process.exitCode = 2; });
