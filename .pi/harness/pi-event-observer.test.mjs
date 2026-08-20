import assert from "node:assert/strict";
import test from "node:test";
import { observePiEventStages } from "./pi-event-observer.mjs";

test("records payload-free normal and interrupted Pi stage timelines", () => {
	const normal = observePiEventStages(["before_request", "agent_start", "stream_start", "assistant_message", "stream_end", "agent_end", "after_request", "after_settlement"]);
	const interrupted = observePiEventStages(["before_request", "agent_start", "stream_start", "agent_end", "after_request", "after_settlement"]);
	assert.deepEqual(normal.stages.at(-1), "after_settlement");
	assert.deepEqual(interrupted.stages.includes("stream_end"), false);
	assert.equal(Object.isFrozen(normal.stages), true);
});

test("rejects unknown events, payloads, and invalid ordering", () => {
	assert.throws(() => observePiEventStages(["before_request", "unknown", "after_request", "after_settlement"]));
	assert.throws(() => observePiEventStages(["before_request", { type: "agent_start", content: "raw" }, "after_request", "after_settlement"]));
	assert.throws(() => observePiEventStages(["before_request", "after_settlement", "after_request"]));
});
