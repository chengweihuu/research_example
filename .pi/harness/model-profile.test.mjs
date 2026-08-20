import assert from "node:assert/strict";
import test from "node:test";
import { createModelProfile, quoteConservativeRequest } from "./model-profile.mjs";

const terra = { id: "gpt-5.6-terra", provider: "openai-codex", api: "responses", contextWindow: 128000, maxTokens: 4096, cost: { input: 2, output: 12 } };
const sol = { id: "gpt-5.6-sol", provider: "openai-codex", api: "responses", contextWindow: 128000, maxTokens: 4096, cost: { input: 3, output: 18 } };
const input = (catalogModel, modelId = catalogModel.id) => ({ provider: "openai-codex", modelId, catalogModel, serializedBytes: 200, outputTokens: 400, totalTokenCap: 2900, usdCap: 0.05 });

test("freezes exact Terra and Sol records without fallback", () => {
	const terraProfile = createModelProfile(input(terra));
	const solProfile = createModelProfile(input(sol));
	assert.equal(terraProfile.modelId, terra.id);
	assert.equal(solProfile.modelId, sol.id);
	assert.notEqual(terraProfile.request.catalogMaximumCostUsd, solProfile.request.catalogMaximumCostUsd);
	assert.equal(Object.isFrozen(solProfile), true);
	assert.equal(Object.isFrozen(solProfile.request.quote), true);
});

test("quotes conservatively and rejects mismatched or invalid catalog records", () => {
	assert.deepEqual(quoteConservativeRequest(0, 1), { serializedBytes: 0, estimatedInputTokens: 64, estimatedOutputTokens: 1, estimatedTotalTokens: 65, method: "utf8-bytes-divided-by-2-plus-64-v1" });
	assert.throws(() => createModelProfile(input(terra, sol.id)), /exactly match/);
	assert.throws(() => createModelProfile(input({ ...terra, cost: { input: -1, output: 12 } })), /invalid token or price/);
	assert.throws(() => createModelProfile({ ...input(terra), outputTokens: 5000 }), /token cap/);
	assert.throws(() => createModelProfile({ ...input(terra), usdCap: 0.0001 }), /cost cap/);
});
