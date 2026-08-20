import assert from "node:assert/strict";
import test from "node:test";
import { classifySseBoundary } from "./sse-boundary.mjs";
import { SSE_FIXTURES } from "./sse-fixtures.mjs";

test("classifies all fixed synthetic SSE boundary fixtures", () => {
	assert.deepEqual(classifySseBoundary(SSE_FIXTURES.completed), { outcome: "response_settled" });
	assert.deepEqual(classifySseBoundary(SSE_FIXTURES.interruptedAfterOpen), { outcome: "stream_interrupted" });
	assert.deepEqual(classifySseBoundary(SSE_FIXTURES.interruptedAfterText), { outcome: "stream_interrupted" });
	for (const fixture of [SSE_FIXTURES.malformed, SSE_FIXTURES.missingUsage, SSE_FIXTURES.duplicateOpen, SSE_FIXTURES.unstarted]) {
		assert.deepEqual(classifySseBoundary(fixture), { outcome: "response_invalid" });
	}
});

test("rejects payloads, unknown kinds, and terminally impossible sequences", () => {
	assert.throws(() => classifySseBoundary([{ kind: "opened", text: "raw" }]));
	assert.throws(() => classifySseBoundary(["opened", "unknown"]));
	assert.deepEqual(classifySseBoundary(["opened", "done", "usage_complete"]), { outcome: "response_invalid" });
	assert.equal(Object.isFrozen(classifySseBoundary(SSE_FIXTURES.completed)), true);
});
