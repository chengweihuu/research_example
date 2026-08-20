import assert from "node:assert/strict";
import test from "node:test";
import { sha256 } from "./execution-packet.mjs";
import { HashLedger, verifyLedger } from "./ledger.mjs";
import { createModelProfile } from "./model-profile.mjs";
import { MechanicalGate, rejectOrdinaryTranscript } from "./runner.mjs";
import { SETTLEMENT_STATES, settleUsage } from "./settlement.mjs";
import { classifyTransportObservation } from "./transport-diagnostic.mjs";
import { observePiEventStages } from "./pi-event-observer.mjs";
import { projectCanary } from "./canary-runner.mjs";

const estimate = { reservedInputTokens: 2500, reservedOutputTokens: 400, catalogEstimatedCostUsd: 0.0098 };
const terra = { id: "gpt-5.6-terra", provider: "openai-codex", api: "responses", maxTokens: 4096, cost: { input: 2, output: 12 } };

test("fixed profile, tool, and no-progress gates reject invalid paths", () => {
	assert.throws(() => createModelProfile({ provider: "openai-codex", modelId: "gpt-5.6-sol", catalogModel: terra, serializedBytes: 10, outputTokens: 1, totalTokenCap: 10, usdCap: 1 }), /exactly match/);
	const gate = new MechanicalGate("/tmp/h010-eval-only");
	assert.equal(gate.preflight("undeclared", {}).code, "CAPABILITY_MISSING");
	assert.equal(gate.preflight("write_run_note", { path: "same.txt", content: "x" }).allowed, true);
	assert.equal(gate.preflight("write_run_note", { path: "same.txt", content: "x" }).allowed, true);
	assert.equal(gate.preflight("write_run_note", { path: "same.txt", content: "x" }).code, "REPEATED_ACTION_BLOCKED");
	assert.equal(gate.settleTurn(false).state, "RUNNING");
	assert.equal(gate.settleTurn(false).state, "STUCK");
});

test("fixed settlement cases never turn unavailable data into actual usage", () => {
	assert.equal(settleUsage({ phase: "preflight", estimate }).state, SETTLEMENT_STATES.ESTIMATED_ONLY);
	assert.equal(settleUsage({ phase: "response", stopReason: "stop", usage: { input: 10, output: 5 }, estimate }).state, SETTLEMENT_STATES.PROVIDER_REPORTED);
	for (const input of [
		{ phase: "response", stopReason: "error" },
		{ phase: "response", stopReason: "stop" },
		{ phase: "response", stopReason: "stop", usage: { input: 1 } },
		{ phase: "response", stopReason: "stop", usage: { input: 0, output: 0 } },
	]) {
		const result = settleUsage({ ...input, estimate });
		assert.equal(result.state, SETTLEMENT_STATES.UNAVAILABLE);
		assert.equal("actualUsage" in result, false);
	}
});

test("fixed diagnostics, ledger, artifacts, and evidence cases detect tampering", () => {
	assert.deepEqual(classifyTransportObservation({ event: "response_invalid" }), { phase: "response_parsing", reasonCode: "invalid_response", terminal: true });
	assert.throws(() => classifyTransportObservation({ event: "stream_interrupted", message: "raw" }));
	const ledger = new HashLedger("R-fixed");
	ledger.append("run_preflight", { packetHash: "a" });
	ledger.append("session_settled", { sessionId: "R-fixed" });
	const events = ledger.events();
	assert.equal(verifyLedger(events, "R-fixed").valid, true);
	const tamperedLedger = structuredClone(events);
	tamperedLedger[1].data = { changed: true };
	assert.equal(verifyLedger(tamperedLedger, "R-fixed").valid, false);
	assert.notEqual(sha256("artifact original"), sha256("artifact tampered"), "artifact hash must bind exact bytes");
	assert.deepEqual(rejectOrdinaryTranscript({ role: "assistant", content: "ordinary output" }), { accepted: false, code: "HARNESS_MANIFEST_REQUIRED" });
});

test("fixed observer cases retain stage names only", () => {
	const receipt = observePiEventStages(["before_request", "agent_start", "stream_start", "agent_end", "after_request", "after_settlement"]);
	assert.equal(receipt.stages.includes("stream_start"), true);
	assert.throws(() => observePiEventStages(["before_request", { event: "agent_start" }, "after_request", "after_settlement"]));
});

test("fixed canonical Runner case binds one request to all projections", () => {
	const model = { id: "gpt-5.6-sol", provider: "openai-codex", api: "responses", maxTokens: 4096, cost: { input: 3, output: 18 } };
	const result = projectCanary({ runId: "R-eval", provider: model.provider, modelId: model.id, catalogModel: model, serializedBytes: 10, outputTokens: 10, totalTokenCap: 2900, usdCap: .05, stages: ["before_request", "agent_start", "stream_start", "assistant_message", "stream_end", "agent_end", "after_request", "after_settlement"], sseEvents: ["opened", "usage_complete", "done"], assistant: { stopReason: "stop", usage: { input: 2, output: 1 } }, invoke: () => {} });
	assert.equal(result.requestCount, 1); assert.equal(result.ledgerVerification.valid, true);
});
