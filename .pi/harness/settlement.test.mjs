import assert from "node:assert/strict";
import test from "node:test";
import { SETTLEMENT_STATES, UNAVAILABLE_REASONS, settleUsage } from "./settlement.mjs";

const estimate = Object.freeze({ reservedInputTokens: 2500, reservedOutputTokens: 400, catalogEstimatedCostUsd: 0.0098 });

test("records complete non-zero Pi usage as provider reported", () => {
	const result = settleUsage({ phase: "response", stopReason: "stop", usage: { input: 123, output: 45 }, estimate });
	assert.deepEqual(result, {
		state: SETTLEMENT_STATES.PROVIDER_REPORTED,
		usageSource: "provider-normalized-by-pi",
		actualUsage: { inputTokens: 123, outputTokens: 45, totalTokens: 168 },
		estimate,
	});
	assert.equal(Object.isFrozen(result), true);
});

test("records a preflight quote without claiming actual usage", () => {
	const result = settleUsage({ phase: "preflight", estimate });
	assert.deepEqual(result, { state: SETTLEMENT_STATES.ESTIMATED_ONLY, estimate });
	assert.equal("actualUsage" in result, false);
});

for (const [name, input, reasonCode] of [
	["error with no usage", { phase: "response", stopReason: "error" }, UNAVAILABLE_REASONS.RESPONSE_ERROR],
	["absent usage", { phase: "response", stopReason: "stop" }, UNAVAILABLE_REASONS.USAGE_MISSING],
	["incomplete usage", { phase: "response", stopReason: "stop", usage: { input: 12 } }, UNAVAILABLE_REASONS.USAGE_INCOMPLETE],
	["ambiguous zero-only usage", { phase: "response", stopReason: "stop", usage: { input: 0, output: 0 } }, UNAVAILABLE_REASONS.USAGE_AMBIGUOUS_ZERO],
]) {
	test(`does not invent actual use for ${name}`, () => {
		const result = settleUsage({ ...input, estimate });
		assert.deepEqual(result, { state: SETTLEMENT_STATES.UNAVAILABLE, reasonCode, estimate });
		assert.equal("actualUsage" in result, false);
	});
}

test("rejects invalid estimates and unsupported phases", () => {
	assert.throws(() => settleUsage({ phase: "preflight", estimate: { reservedInputTokens: 1, reservedOutputTokens: 1, catalogEstimatedCostUsd: -1 } }), /finite non-negative/);
	assert.throws(() => settleUsage({ phase: "unknown", estimate }), /phase/);
});
