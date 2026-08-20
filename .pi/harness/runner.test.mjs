import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	FIXED_CAPABILITY_MANIFEST,
	FROZEN_CONTROLS,
	MechanicalGate,
	createRunId,
	rejectOrdinaryTranscript,
	runFauxSmoke,
	sha256File,
} from "./runner.mjs";

const runId = createRunId(new Date(), `h${process.pid}`);
const runOutputDir = await mkdtemp(join(tmpdir(), "pi-harness-h004-"));
const npmUserAgent = process.env.npm_config_user_agent ?? "";
const npmVersion = /^npm\/([^\s]+)/.exec(npmUserAgent)?.[1] ?? "not-invoked-through-npm";
const outputDir = runOutputDir;
const gate = new MechanicalGate(outputDir);

assert.equal(Object.isFrozen(FIXED_CAPABILITY_MANIFEST), true, "capabilities must be frozen");
assert.equal(FROZEN_CONTROLS.maxAutomaticRetries, 0);
assert.equal(FROZEN_CONTROLS.compactionEnabled, false);
assert.equal(gate.preflight("undeclared_tool", {}).code, "CAPABILITY_MISSING");
assert.equal(gate.preflight("write_run_note", { path: "../outside.txt", content: "no" }).code, "ALLOWED_CHANGES_REJECTED");

const repeatGate = new MechanicalGate(outputDir);
assert.equal(repeatGate.preflight("write_run_note", { path: "a.txt", content: "same" }).allowed, true);
assert.equal(repeatGate.preflight("write_run_note", { content: "same", path: "a.txt" }).allowed, true);
assert.equal(repeatGate.preflight("write_run_note", { path: "a.txt", content: "same" }).code, "REPEATED_ACTION_BLOCKED");

const stuckGate = new MechanicalGate(outputDir);
assert.equal(stuckGate.settleTurn(false).state, "RUNNING");
assert.deepEqual(stuckGate.settleTurn(false), { state: "STUCK", terminal: true });
assert.deepEqual(rejectOrdinaryTranscript([{ role: "assistant", content: "unmanifested" }]), {
	accepted: false,
	code: "HARNESS_MANIFEST_REQUIRED",
});

const result = await runFauxSmoke({ outputDir: runOutputDir, runId, npmVersion });
assert.equal(result.ledger.liveModelCalls, 0);
assert.equal(result.ledger.syntheticFauxCalls, 1, "exactly one faux provider call is permitted");
assert.equal(result.ledger.syntheticCalls.length, 1, "the Ledger must retain per-call usage");
assert.equal(result.ledger.syntheticCalls[0].settlement.state, "provider_reported");
assert.equal(result.ledger.syntheticCalls[0].settlement.actualUsage.totalTokens > 0, true);
assert.equal("usage" in result.ledger.syntheticCalls[0], false);
assert.equal("costUsd" in result.ledger.syntheticCalls[0], false);
assert.equal(result.ledger.catalogEstimatedCostUsd, 0);
assert.equal(result.ledger.retries, 0);
assert.equal(result.ledger.compactions, 0);
assert.equal(result.ledger.actions.length, 1);
assert.equal(result.ledger.actions[0].decision.allowed, true);
assert.equal(result.manifest.contextManifest.authRead, false);
assert.equal(result.manifest.contextManifest.ambientAgentsFiles, false);
assert.deepEqual(result.manifest.contextManifest.discoveredContextFiles, []);
assert.deepEqual(result.manifest.contextManifest.builtInPiTools, []);
assert.equal(result.manifest.environment.npm, npmVersion);
assert.equal(result.manifest.estimate.estimatedTotalTokens > 0, true);
assert.equal(result.events.includes("agent_end"), true);
const note = await readFile(join(runOutputDir, "artifacts", "smoke-note.txt"), "utf8");
assert.match(note, /H-004 faux-provider smoke completed/);
const session = JSON.parse(await readFile(join(runOutputDir, "pi-core-session.json"), "utf8"));
assert.equal(session.sessionId, runId, "Run and Session identifiers must reconcile");
const verification = JSON.parse(await readFile(join(runOutputDir, "verification-summary.json"), "utf8"));
assert.equal(verification.status, "PASS");
assert.equal(session.messages.length >= 3, true, "full Pi Core transcript must be retained in the Run");
assert.equal(
	await sha256File(join(runOutputDir, "run-ledger.json")),
	result.manifest.artifactHashes["run-ledger.json"],
	"manifest and ledger must reconcile",
);
await assert.rejects(() => runFauxSmoke({ outputDir: runOutputDir, runId, npmVersion }), /cannot be reopened/);

await rm(runOutputDir, { recursive: true, force: true });

console.log(JSON.stringify({ status: "PASS", outputDir: runOutputDir, syntheticFauxCalls: result.ledger.syntheticFauxCalls }));
