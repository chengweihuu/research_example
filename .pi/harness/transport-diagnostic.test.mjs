import assert from "node:assert/strict";
import test from "node:test";
import { classifyTransportObservation } from "./transport-diagnostic.mjs";

test("maps only allowlisted lifecycle events", () => {
	assert.deepEqual(classifyTransportObservation({ event: "model_missing" }), { phase: "model_resolution", reasonCode: "model_unavailable", terminal: true });
	assert.deepEqual(classifyTransportObservation({ event: "transport_opened" }), { phase: "transport_open", reasonCode: "opened", terminal: false });
	assert.deepEqual(classifyTransportObservation({ event: "response_settled" }), { phase: "settled", reasonCode: "completed", terminal: true });
});

test("rejects raw error, headers, URL, credential, and unknown fields", () => {
	for (const observation of [
		{ event: "stream_interrupted", error: "provider error" },
		{ event: "transport_opened", headers: { authorization: "secret" } },
		{ event: "request_rejected", url: "https://example.invalid" },
		{ event: "model_missing", credential: "secret" },
		{ event: "unknown" },
	]) assert.throws(() => classifyTransportObservation(observation));
});
