import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AssistantMessageEventStream } from "../node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/utils/event-stream.js";
import { runPiHarnessTask } from "./pi-task-adapter.mjs";

const model = { id: "harness-faux-1", provider: "harness-faux", api: "responses", maxTokens: 256, cost: { input: 0, output: 0 } };

function successfulStream() {
	const stream = new AssistantMessageEventStream();
	const message = { role: "assistant", api: "responses", provider: model.provider, model: model.id, content: [{ type: "text", text: "H022_OK" }], usage: { input: 5, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 7, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: 0 };
	queueMicrotask(() => {
		stream.push({ type: "start", partial: message });
		stream.push({ type: "text_start", contentIndex: 0, partial: message });
		stream.push({ type: "text_delta", contentIndex: 0, delta: "H022_OK", partial: message });
		stream.push({ type: "text_end", contentIndex: 0, content: "H022_OK", partial: message });
		stream.push({ type: "done", reason: "stop", message });
	});
	return stream;
}

test("runs one isolated Pi Session through canonical sealing and bounded Evidence promotion", async t => {
	const root = await mkdtemp(join(tmpdir(), "h022-adapter-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	let calls = 0;
	const result = await runPiHarnessTask({
		ideaId: "I-h022",
		taskId: "T-h022",
		runId: "R-h022",
		question: "Return the fixed fixture result.",
		outputDir: join(root, "run"),
		branch: "task/H-022-pi-core-adapter",
		ref: "d52fd6a",
		catalogModel: model,
		streamFn: async () => { calls += 1; if (calls > 1) throw new Error("second stream"); return successfulStream(); },
	});
	assert.equal(calls, 1);
	assert.equal(result.streamCalls, 1);
	assert.equal(result.sessionId, result.runId);
	assert.equal(result.manifestStatus, "COMPLETED");
	assert.equal(result.verification.accepted, true);
	assert.equal(result.promotion.code, "EVIDENCE_PROMOTION_ELIGIBLE");
	assert.equal("messages" in result, false);
	const session = JSON.parse(await readFile(join(root, "run", "pi-core-session.json"), "utf8"));
	assert.deepEqual(session.messages.map(message => message.role), ["user", "assistant"]);
	assert.equal(session.agentEventTypes.includes("agent_start"), true);
	assert.deepEqual(session.providerEventTypes.at(-1), "done");
});

test("rejects incomplete adapter input before creating a Pi Session", async () => {
	await assert.rejects(() => runPiHarnessTask({ ideaId: "I", taskId: "T", runId: "R", question: "q", outputDir: "/tmp/h022-invalid", branch: "b", ref: "r", catalogModel: model }), /streamFn/);
	await assert.rejects(() => runPiHarnessTask({ ideaId: "I", taskId: "I", runId: "R", question: "q", outputDir: "/tmp/h022-invalid", branch: "b", ref: "r", catalogModel: model, streamFn: async () => successfulStream() }), /distinct/);
});
