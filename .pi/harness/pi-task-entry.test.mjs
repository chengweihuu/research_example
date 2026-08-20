import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runEntryRequest, validateEntryRequest } from "./pi-task-entry.mjs";

const model = { id: "harness-faux-1", provider: "harness-faux", api: "responses", maxTokens: 256, cost: { input: 0, output: 0 } };
function request(outputDir) { return { ideaId: "I-h023", taskId: "T-h023", runId: "R-h023", question: "Return the fixture result.", outputDir, branch: "task/H-023-pi-task-entry", ref: "f60c796", catalogModel: model, mode: "fixture" }; }

test("entry creates one canonical fixture Run and returns a bounded summary", async t => {
	const root = await mkdtemp(join(tmpdir(), "h023-entry-")); t.after(() => rm(root, { recursive: true, force: true }));
	const result = await runEntryRequest(request(join(root, "run")));
	assert.equal(result.manifestStatus, "COMPLETED");
	assert.equal(result.verification.accepted, true);
	assert.equal(result.promotion.code, "RUN_REGISTERED_NOT_EVIDENCE");
	assert.equal("messages" in result, false);
	const session = JSON.parse(await readFile(join(root, "run", "pi-core-session.json"), "utf8"));
	assert.equal(session.messages.at(-1).content[0].text, "PI_HARNESS_FIXTURE_OK");
});

test("entry rejects malformed or implicit-boundary requests before execution", async () => {
	assert.throws(() => validateEntryRequest({ ...request("relative/run"), outputDir: "relative/run" }), /absolute/);
	assert.throws(() => validateEntryRequest({ ...request("/tmp/run"), unexpected: true }), /unknown request field/);
	await assert.rejects(() => runEntryRequest({ ...request("/tmp/run"), mode: "provider" }), /mode must be fixture/);
});
