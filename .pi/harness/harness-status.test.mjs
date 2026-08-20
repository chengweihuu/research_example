import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readHarnessStatus, writeHarnessStatus } from "./harness-status.mjs";
import { runEntryRequest } from "./pi-task-entry.mjs";

const model = { id: "harness-faux-1", provider: "harness-faux", api: "responses", maxTokens: 256, cost: { input: 0, output: 0 } };
test("adjacent status sidecar exposes a bounded settled fixture Run", async t => {
	const outputDir = await mkdtemp(join(tmpdir(), "h025-status-")); t.after(() => rm(outputDir, { recursive: true, force: true }));
	await runEntryRequest({ ideaId: "I-h025", taskId: "T-h025", runId: "R-h025", question: "fixture", outputDir, branch: "task/H-025-harness-status-cli", ref: "9d0648f", catalogModel: model, mode: "fixture" });
	const status = await readHarnessStatus({ outputDir });
	assert.deepEqual(status.model, { provider: "harness-faux", id: "harness-faux-1" });
	assert.equal(status.phase, "SETTLED"); assert.deepEqual(status.usage, { state: "ACTUAL", inputTokens: 5, outputTokens: 2 });
	assert.equal("messages" in status, false);
});
test("status reader never fabricates missing or malformed telemetry", async t => {
	const outputDir = await mkdtemp(join(tmpdir(), "h025-invalid-")); t.after(() => rm(outputDir, { recursive: true, force: true }));
	assert.deepEqual(await readHarnessStatus({ outputDir }), { phase: "FAILED", diagnosticCode: "STATUS_UNAVAILABLE" });
	await writeHarnessStatus({ outputDir, status: { phase: "RUNNING" } });
	assert.deepEqual(await readHarnessStatus({ outputDir }), { phase: "FAILED", diagnosticCode: "STATUS_INVALID" });
	await assert.rejects(() => writeHarnessStatus({ outputDir: "relative", status: {} }), /absolute/);
});
