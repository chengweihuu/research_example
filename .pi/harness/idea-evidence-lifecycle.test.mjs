import assert from "node:assert/strict";
import { appendFile, mkdtemp, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { executeCanary } from "./canary-executor.mjs";
import { closeIdeaTask, createIdeaTask, inspectIdeaTask, promoteEvidence, sealIdeaRun } from "./idea-evidence-lifecycle.mjs";

const model = { id: "gpt-5.6-sol", provider: "openai-codex", api: "responses", maxTokens: 4096, cost: { input: 3, output: 18 } };

async function fauxResult(runId) {
	return executeCanary({
		runId,
		provider: model.provider,
		modelId: model.id,
		catalogModel: model,
		serializedBytes: 20,
		outputTokens: 20,
		totalTokenCap: 2900,
		usdCap: 0.05,
		session: { sessionId: runId, eventTypes: ["agent_start", "agent_end"] },
		transport: async () => ({ stages: ["before_request", "agent_start", "stream_start", "assistant_message", "stream_end", "agent_end", "after_request", "after_settlement"], sseEvents: ["opened", "usage_complete", "done"], assistant: { stopReason: "stop", usage: { input: 5, output: 2 } } }),
	});
}

function makeTask(outputDir, { ideaId = "I-fixed", taskId = "T-fixed", runId = "R-fixed" } = {}) {
	return createIdeaTask({ ideaId, taskId, runId, sessionId: runId, question: "Can the fixture become bounded evidence?", outputDir, branch: "task/H-021-idea-evidence-lifecycle", ref: "e68a211" });
}

test("seals one Idea-bound Run, rejects ineligible candidates, and closes permanently", async t => {
	const root = await mkdtemp(join(tmpdir(), "h021-lifecycle-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const outputDir = join(root, "run");
	const task = makeTask(outputDir);
	assert.equal(inspectIdeaTask(task).status, "ACTIVE");
	assert.notEqual(task.ideaId, task.taskId);
	assert.notEqual(task.taskId, task.runId);
	assert.equal(task.sessionId, task.runId);
	assert.equal((await promoteEvidence({ task, candidate: { role: "assistant", content: "ordinary Pi output" } })).code, "HARNESS_MANIFEST_REQUIRED");
	const malformedSessionResult = await fauxResult(task.runId);
	await assert.rejects(() => sealIdeaRun({ task, executorResult: malformedSessionResult, piSession: { sessionId: "R-wrong" }, capabilityManifest: {}, environment: {} }), /Session/);
	const sealed = await sealIdeaRun({
		task,
		executorResult: await fauxResult(task.runId),
		piSession: { kind: "pi-core-session", sessionId: task.sessionId, messages: [{ role: "user", content: task.question }], events: [] },
		capabilityManifest: { modelRequest: { maximumCalls: 1 }, tools: [] },
		environment: { runtime: "host", node: process.version, provider: "faux" },
		contextManifest: { ambientContext: false, authRead: false, network: false },
	});
	assert.equal(sealed.verification.accepted, true);
	const secondWriterResult = await fauxResult(task.runId);
	await assert.rejects(() => sealIdeaRun({ task, executorResult: secondWriterResult, piSession: { sessionId: task.sessionId }, capabilityManifest: {}, environment: {} }), /exactly one Run writer attempt/);
	const promoted = await promoteEvidence({ task, outputDir });
	assert.equal(promoted.accepted, true);
	assert.equal(promoted.code, "RUN_REGISTERED_NOT_EVIDENCE");
	assert.equal("session" in promoted, false);
	assert.equal(inspectIdeaTask(task).promoted, true);

	const mismatch = makeTask(outputDir, { ideaId: "I-other", taskId: task.taskId, runId: task.runId });
	assert.equal((await promoteEvidence({ task: mismatch, outputDir })).code, "HARNESS_IDEA_BINDING_INVALID");
	await appendFile(join(outputDir, "settlement.json"), " ", "utf8");
	assert.equal((await promoteEvidence({ task, outputDir })).code, "HARNESS_ARTIFACT_HASH_INVALID");
	const closed = closeIdeaTask(task);
	assert.equal(closed.status, "CLOSED");
	const afterCloseResult = await fauxResult(task.runId);
	await assert.rejects(() => sealIdeaRun({ task, executorResult: afterCloseResult, piSession: { sessionId: task.sessionId }, capabilityManifest: {}, environment: {} }), /closed/);
	await assert.rejects(() => promoteEvidence({ task, outputDir }), /closed/);
});

test("rejects missing Manifest and invalid canonical Session binding at creation", async t => {
	const root = await mkdtemp(join(tmpdir(), "h021-missing-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	assert.throws(() => createIdeaTask({ ideaId: "I", taskId: "T", runId: "R", sessionId: "S", question: "q", outputDir: join(root, "run"), branch: "b", ref: "r" }), /Session ID/);
	const outputDir = join(root, "run");
	const task = makeTask(outputDir, { ideaId: "I-missing", taskId: "T-missing", runId: "R-missing" });
	await sealIdeaRun({ task, executorResult: await fauxResult(task.runId), piSession: { sessionId: task.sessionId, messages: [] }, capabilityManifest: {}, environment: {}, contextManifest: {} });
	await unlink(join(outputDir, "manifest.json"));
	assert.equal((await promoteEvidence({ task, outputDir })).code, "HARNESS_MANIFEST_REQUIRED");
});
