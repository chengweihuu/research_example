import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFile, mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { executeCanary } from "./canary-executor.mjs";
import { CANONICAL_ARTIFACTS, sealCanonicalRun, verifyCanonicalRun } from "./canonical-run-seal.mjs";

const model = { id: "gpt-5.6-sol", provider: "openai-codex", api: "responses", maxTokens: 4096, cost: { input: 3, output: 18 } };
const stages = ["before_request", "agent_start", "stream_start", "assistant_message", "stream_end", "agent_end", "after_request", "after_settlement"];

async function executorResult(runId = "R-H019-fixed") {
	return executeCanary({
		runId,
		provider: model.provider,
		modelId: model.id,
		catalogModel: model,
		serializedBytes: 20,
		outputTokens: 20,
		totalTokenCap: 2900,
		usdCap: 0.05,
		session: { sessionId: runId, eventTypes: stages.slice(1, -2) },
		transport: async () => ({ stages, sseEvents: ["opened", "usage_complete", "done"], assistant: { stopReason: "stop", usage: { input: 12, output: 3 } } }),
	});
}

async function fixture(t, overrides = {}) {
	const root = await mkdtemp(join(tmpdir(), "h019-seal-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const runId = overrides.runId ?? "R-H019-fixed";
	const input = {
		outputDir: root,
		taskId: "H-019",
		branch: "task/H-019-canonical-run-seal",
		ref: "5639fc7",
		executorResult: overrides.executorResult ?? await executorResult(runId),
		piSession: overrides.piSession ?? { kind: "pi-core-session", sessionId: runId, messages: [{ role: "user", content: "fixed" }], events: stages },
		contextManifest: { ambientContext: false, authRead: false },
		capabilityManifest: { modelRequest: { maximumCalls: 1 }, tools: [] },
		environment: { runtime: "host", node: process.version, piCodingAgent: "0.84.2" },
	};
	return { root, input, sealed: await sealCanonicalRun(input) };
}

function digest(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}

async function rewriteArtifactAndManifest(root, artifact, value) {
	await writeFile(join(root, artifact), `${JSON.stringify(value, null, 2)}\n`, "utf8");
	const manifestPath = join(root, "manifest.json");
	const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
	manifest.artifactHashes[artifact] = digest(await readFile(join(root, artifact)));
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

test("writes the exact artifact set, Manifest last, and independently verifies it", async t => {
	const { root, input, sealed } = await fixture(t);
	assert.deepEqual((await readdir(root)).sort(), [...CANONICAL_ARTIFACTS, "manifest.json"].sort());
	assert.equal(sealed.manifest.status, "COMPLETED");
	assert.equal(sealed.verification.accepted, true);
	assert.equal((await verifyCanonicalRun({ outputDir: root })).accepted, true);
	await assert.rejects(() => sealCanonicalRun(input), /sealed or occupied/);
});

test("rejects a missing Manifest and changed artifact bytes", async t => {
	const missing = await fixture(t, { runId: "R-H019-missing" });
	await unlink(join(missing.root, "manifest.json"));
	assert.equal((await verifyCanonicalRun({ outputDir: missing.root })).code, "HARNESS_MANIFEST_REQUIRED");
	const changed = await fixture(t, { runId: "R-H019-changed" });
	await appendFile(join(changed.root, "settlement.json"), " ", "utf8");
	assert.equal((await verifyCanonicalRun({ outputDir: changed.root })).code, "HARNESS_ARTIFACT_HASH_INVALID");
});

test("rejects identity, Ledger, and call-reconciliation tampering even with refreshed artifact hashes", async t => {
	const identity = await fixture(t, { runId: "R-H019-identity" });
	const session = JSON.parse(await readFile(join(identity.root, "pi-core-session.json"), "utf8"));
	session.sessionId = "R-other";
	await rewriteArtifactAndManifest(identity.root, "pi-core-session.json", session);
	assert.equal((await verifyCanonicalRun({ outputDir: identity.root })).code, "HARNESS_IDENTITY_INVALID");

	const ledgerFixture = await fixture(t, { runId: "R-H019-ledger" });
	const ledgerPath = join(ledgerFixture.root, "run-ledger.jsonl");
	const events = (await readFile(ledgerPath, "utf8")).trim().split("\n").map(JSON.parse);
	events[1].data.executorCalls = 2;
	await writeFile(ledgerPath, `${events.map(event => JSON.stringify(event)).join("\n")}\n`, "utf8");
	const ledgerManifest = JSON.parse(await readFile(join(ledgerFixture.root, "manifest.json"), "utf8"));
	ledgerManifest.artifactHashes["run-ledger.jsonl"] = digest(await readFile(ledgerPath));
	await writeFile(join(ledgerFixture.root, "manifest.json"), `${JSON.stringify(ledgerManifest, null, 2)}\n`, "utf8");
	assert.equal((await verifyCanonicalRun({ outputDir: ledgerFixture.root })).code, "HARNESS_LEDGER_INVALID");

	const calls = await fixture(t, { runId: "R-H019-calls" });
	const reconciliation = JSON.parse(await readFile(join(calls.root, "reconciliation-summary.json"), "utf8"));
	reconciliation.executorCalls = 2;
	await rewriteArtifactAndManifest(calls.root, "reconciliation-summary.json", reconciliation);
	assert.equal((await verifyCanonicalRun({ outputDir: calls.root })).code, "HARNESS_CALL_RECONCILIATION_INVALID");
});

test("rejects a second-call record and credential-bearing full Session before writing", async t => {
	const secondRoot = await mkdtemp(join(tmpdir(), "h019-second-"));
	t.after(() => rm(secondRoot, { recursive: true, force: true }));
	const second = structuredClone(await executorResult("R-H019-second"));
	second.executorCalls = 2;
	await assert.rejects(() => sealCanonicalRun({
		outputDir: secondRoot, taskId: "H-019", branch: "task/H-019-canonical-run-seal", ref: "5639fc7", executorResult: second,
		piSession: { sessionId: "R-H019-second", messages: [] }, contextManifest: {}, capabilityManifest: {}, environment: {},
	}), /exactly one call/);
	assert.deepEqual(await readdir(secondRoot), []);

	const credentialRoot = await mkdtemp(join(tmpdir(), "h019-credential-"));
	t.after(() => rm(credentialRoot, { recursive: true, force: true }));
	const credentialResult = await executorResult("R-H019-credential");
	await assert.rejects(() => sealCanonicalRun({
		outputDir: credentialRoot, taskId: "H-019", branch: "task/H-019-canonical-run-seal", ref: "5639fc7", executorResult: credentialResult,
		piSession: { sessionId: "R-H019-credential", authorization: "Bearer should-never-be-written" }, contextManifest: {}, capabilityManifest: {}, environment: {},
	}), /Credential/);
	assert.deepEqual(await readdir(credentialRoot), []);
});

test("verifier rejects injected credentials even when the Session artifact hash is refreshed", async t => {
	const injected = await fixture(t, { runId: "R-H019-injected" });
	const session = JSON.parse(await readFile(join(injected.root, "pi-core-session.json"), "utf8"));
	session.apiKey = "sk-this-must-never-be-evidence";
	await rewriteArtifactAndManifest(injected.root, "pi-core-session.json", session);
	assert.equal((await verifyCanonicalRun({ outputDir: injected.root })).accepted, false);
});
