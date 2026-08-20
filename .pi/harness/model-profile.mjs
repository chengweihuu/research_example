const QUOTE_METHOD = "utf8-bytes-divided-by-2-plus-64-v1";

function finiteNonNegative(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function requiredString(value, name) {
	if (typeof value !== "string" || value.length === 0) throw new TypeError(`${name} must be a non-empty string`);
	return value;
}

function freeze(value) {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value;
}

export function quoteConservativeRequest(serializedBytes, outputTokens) {
	if (!Number.isInteger(serializedBytes) || serializedBytes < 0 || !Number.isInteger(outputTokens) || outputTokens < 1) {
		throw new TypeError("serializedBytes and outputTokens must be non-negative/integer request values");
	}
	const estimatedInputTokens = Math.ceil(serializedBytes / 2) + 64;
	return freeze({ serializedBytes, estimatedInputTokens, estimatedOutputTokens: outputTokens, estimatedTotalTokens: estimatedInputTokens + outputTokens, method: QUOTE_METHOD });
}

/** Freeze one exact model record supplied by a caller-provided Pi catalog snapshot. */
export function createModelProfile({ provider, modelId, catalogModel, serializedBytes, outputTokens, totalTokenCap, usdCap, transport = "sse", maxRetries = 0 }) {
	requiredString(provider, "provider");
	requiredString(modelId, "modelId");
	if (!catalogModel || typeof catalogModel !== "object" || catalogModel.provider !== provider || catalogModel.id !== modelId) {
		throw new Error("Catalog record must exactly match the requested provider and model");
	}
	if (transport !== "sse" || maxRetries !== 0) throw new Error("Only SSE transport with zero retries is permitted");
	if (!Number.isInteger(catalogModel.maxTokens) || catalogModel.maxTokens < 1 || !finiteNonNegative(catalogModel.cost?.input) || !finiteNonNegative(catalogModel.cost?.output)) {
		throw new Error("Catalog record has invalid token or price terms");
	}
	if (!Number.isInteger(totalTokenCap) || totalTokenCap < 1 || !finiteNonNegative(usdCap)) throw new TypeError("Token and USD caps must be finite request limits");
	const quote = quoteConservativeRequest(serializedBytes, outputTokens);
	if (outputTokens > catalogModel.maxTokens || quote.estimatedTotalTokens > totalTokenCap) throw new Error("Request token cap exceeded");
	const catalogMaximumCostUsd = (quote.estimatedInputTokens * catalogModel.cost.input + outputTokens * catalogModel.cost.output) / 1_000_000;
	if (catalogMaximumCostUsd > usdCap) throw new Error("Catalog cost cap exceeded");
	return freeze({
		kind: "harness-model-profile",
		version: 1,
		provider,
		modelId,
		catalog: { api: requiredString(catalogModel.api, "catalogModel.api"), contextWindow: catalogModel.contextWindow ?? null, maxTokens: catalogModel.maxTokens, costPerMillion: { input: catalogModel.cost.input, output: catalogModel.cost.output } },
		request: { transport, maxRetries, maxTokens: outputTokens, quote, totalTokenCap, usdCap, catalogMaximumCostUsd },
	});
}
