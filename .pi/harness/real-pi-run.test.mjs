import assert from "node:assert/strict";
import test from "node:test";
import { REAL_TERRA, preflightRealTerra, prepareRealTerraRuntime } from "./real-pi-run.mjs";

const terra = { id: "gpt-5.6-terra", provider: "openai-codex", api: "responses", maxTokens: 4096, cost: { input: 5, output: 30 } };
test("real Terra preflight fixes model identity and one-call budget before transport", () => {
	const result = preflightRealTerra({ catalogModel: terra, serializedBytes: 200 });
	assert.equal(result.provider, "openai-codex"); assert.equal(result.modelId, "gpt-5.6-terra");
	assert.equal(result.limits.providerCalls, 1); assert.equal(result.limits.retries, 0);
	assert.equal(result.quote.estimatedTotalTokens <= REAL_TERRA.totalTokenCap, true);
	assert.equal(result.catalogMaximumCostUsd <= REAL_TERRA.usdCap, true);
});
test("real Terra preflight rejects catalog substitution and cap breach", () => {
	assert.throws(() => preflightRealTerra({ catalogModel: { ...terra, id: "gpt-5.6-sol" }, serializedBytes: 1 }), /exact Terra/);
	assert.throws(() => preflightRealTerra({ catalogModel: terra, serializedBytes: 100000 }), /cap exceeded/);
});
test("real runner synchronizes local runtime state before any model lookup", async () => {
	const calls = [];
	const runtime = { async refresh(options) { calls.push(["refresh", options]); }, getModel() { calls.push(["getModel"]); return terra; } };
	await prepareRealTerraRuntime(runtime);
	runtime.getModel("openai-codex", "gpt-5.6-terra");
	assert.deepEqual(calls, [["refresh", { allowNetwork: false }], ["getModel"]]);
});
