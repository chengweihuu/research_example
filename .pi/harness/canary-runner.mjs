import { createModelProfile } from "./model-profile.mjs";
import { settleUsage } from "./settlement.mjs";
import { classifySseBoundary } from "./sse-boundary.mjs";
import { observePiEventStages } from "./pi-event-observer.mjs";
import { HashLedger, verifyLedger } from "./ledger.mjs";

export function projectCanary({ runId, provider, modelId, catalogModel, serializedBytes, outputTokens, totalTokenCap, usdCap, stages, sseEvents, assistant, invoke }) {
	const profile = createModelProfile({ provider, modelId, catalogModel, serializedBytes, outputTokens, totalTokenCap, usdCap });
	let calls = 0;
	const request = () => { if (calls >= 1) throw new Error("Canonical Runner call cap exceeded"); calls += 1; return invoke?.(); };
	const ledger = new HashLedger(runId); ledger.append("run_preflight", { profile }); request();
	const stageReceipt = observePiEventStages(stages), sseOutcome = classifySseBoundary(sseEvents);
	const settlement = settleUsage({ phase: "response", stopReason: assistant?.stopReason === "stop" && sseOutcome.outcome === "response_settled" ? "stop" : "error", usage: assistant?.usage, estimate: { reservedInputTokens: totalTokenCap - outputTokens, reservedOutputTokens: outputTokens, catalogEstimatedCostUsd: profile.request.catalogMaximumCostUsd } });
	ledger.append("model_call_finished", { settlement, stageReceipt, sseOutcome }); ledger.append("session_settled", { sessionId: runId });
	return Object.freeze({ packet: Object.freeze({ kind: "harness-execution-packet", runId, provider, modelId, profile, tools: [] }), profile, stageReceipt, sseOutcome, settlement, requestCount: calls, ledgerEvents: ledger.events(), ledgerVerification: verifyLedger(ledger.events(), runId) });
}
