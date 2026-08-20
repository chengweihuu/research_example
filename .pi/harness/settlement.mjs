export const SETTLEMENT_STATES = Object.freeze({
	PROVIDER_REPORTED: "provider_reported",
	ESTIMATED_ONLY: "estimated_only",
	UNAVAILABLE: "unavailable",
});

export const UNAVAILABLE_REASONS = Object.freeze({
	RESPONSE_ERROR: "response_error",
	USAGE_MISSING: "usage_missing",
	USAGE_INCOMPLETE: "usage_incomplete",
	USAGE_AMBIGUOUS_ZERO: "usage_ambiguous_zero",
});

function finiteNonNegative(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function requireEstimate(estimate) {
	const fields = ["reservedInputTokens", "reservedOutputTokens", "catalogEstimatedCostUsd"];
	if (!estimate || fields.some((field) => !finiteNonNegative(estimate[field]))) {
		throw new TypeError("Settlement requires finite non-negative reservation and catalog estimate fields");
	}
	return Object.freeze({
		reservedInputTokens: estimate.reservedInputTokens,
		reservedOutputTokens: estimate.reservedOutputTokens,
		catalogEstimatedCostUsd: estimate.catalogEstimatedCostUsd,
	});
}

function unavailable(estimate, reasonCode) {
	return Object.freeze({
		state: SETTLEMENT_STATES.UNAVAILABLE,
		reasonCode,
		estimate,
	});
}

/**
 * Project a Pi-normalized response into an auditable accounting result.
 * `usage` is deliberately accepted only as normalized numeric fields; raw
 * provider payloads and errors must remain outside the Run ledger.
 */
export function settleUsage({ phase, stopReason, usage, estimate }) {
	const normalizedEstimate = requireEstimate(estimate);
	if (phase === "preflight") {
		return Object.freeze({ state: SETTLEMENT_STATES.ESTIMATED_ONLY, estimate: normalizedEstimate });
	}
	if (phase !== "response") throw new TypeError("Settlement phase must be preflight or response");
	if (stopReason === "error") return unavailable(normalizedEstimate, UNAVAILABLE_REASONS.RESPONSE_ERROR);
	if (!usage || typeof usage !== "object") return unavailable(normalizedEstimate, UNAVAILABLE_REASONS.USAGE_MISSING);

	const inputTokens = usage.input;
	const outputTokens = usage.output;
	if (!finiteNonNegative(inputTokens) || !finiteNonNegative(outputTokens)) {
		return unavailable(normalizedEstimate, UNAVAILABLE_REASONS.USAGE_INCOMPLETE);
	}
	if (inputTokens === 0 && outputTokens === 0) {
		return unavailable(normalizedEstimate, UNAVAILABLE_REASONS.USAGE_AMBIGUOUS_ZERO);
	}

	return Object.freeze({
		state: SETTLEMENT_STATES.PROVIDER_REPORTED,
		usageSource: "provider-normalized-by-pi",
		actualUsage: Object.freeze({ inputTokens, outputTokens, totalTokens: inputTokens + outputTokens }),
		estimate: normalizedEstimate,
	});
}
