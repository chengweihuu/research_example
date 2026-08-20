import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createExecutionPacket } from "./execution-packet.mjs";
import { HashLedger, verifyLedger } from "./ledger.mjs";
import { GIT_ONLY_CAPABILITY_MANIFEST, GitToolPlane, createMockGitFileAdapter } from "./tool-plane.mjs";
import { checkEvidenceEligibility, createRunId, rejectOrdinaryTranscript, runGitToolPlaneSmoke, sha256File, verifyRunArtifacts } from "./runner.mjs";

const runId = createRunId(new Date(), `h${process.pid}`);
const outputDir = await mkdtemp(join(tmpdir(), "pi-harness-h005-"));
const npmVersion = /^npm\/([^\s]+)/.exec(process.env.npm_config_user_agent ?? "")?.[1] ?? "not-invoked-through-npm";

assert.throws(() => createExecutionPacket({}), /requires taskId/);
const packet = createExecutionPacket({
	taskId: "H-005",
	branch: "task/H-005-git-tool-plane",
	ref: "fixture",
	outputDir,
	allowedChanges: [".pi/harness/"],
	capabilityManifest: GIT_ONLY_CAPABILITY_MANIFEST,
	contextManifest: { ambientAgentsFiles: false },
	budgetQuote: { liveModelCalls: 0, fauxModelCalls: 1, tokenReservation: 0, currencyReservation: 0, retryLimit: 0, compactionLimit: 0 },
});
const directLedger = new HashLedger(runId);
const plane = new GitToolPlane({ packet, ledger: directLedger, adapter: createMockGitFileAdapter() });
assert.equal(plane.preflight("bash", {}).code, "CAPABILITY_MISSING");
assert.equal(plane.preflight("repo_read", { path: "/etc/passwd" }).code, "ALLOWED_CHANGES_REJECTED");
assert.equal(plane.preflight("repo_read", { path: "../escape" }).code, "ALLOWED_CHANGES_REJECTED");
assert.equal(plane.preflight("repo_read", { path: "state/TASK.md" }).code, "ALLOWED_CHANGES_REJECTED");
assert.equal(plane.preflight("repo_read", { path: ".pi/harness/fixture.txt" }).allowed, true);
assert.equal(plane.preflight("repo_read", { path: ".pi/harness/fixture.txt" }).allowed, true);
assert.equal(plane.preflight("repo_read", { path: ".pi/harness/fixture.txt" }).code, "REPEATED_ACTION_BLOCKED");
assert.equal(plane.settleTurn(false).state, "RUNNING");
assert.deepEqual(plane.settleTurn(false), { state: "STUCK", terminal: true });
assert.deepEqual(GIT_ONLY_CAPABILITY_MANIFEST.tools, ["repo_read", "repo_search", "repo_apply_patch", "git_status", "git_diff"]);
assert.equal(GIT_ONLY_CAPABILITY_MANIFEST.forbidden.includes("git_commit"), true);
assert.equal(GIT_ONLY_CAPABILITY_MANIFEST.forbidden.includes("process"), true);
assert.equal(typeof GIT_ONLY_CAPABILITY_MANIFEST.toolSchemaHash, "string");

const result = await runGitToolPlaneSmoke({ outputDir, runId, npmVersion });
assert.equal(result.syntheticFauxCalls, 1);
assert.equal(result.ledgerVerification.valid, true);
assert.equal(result.packetHash, result.packet.packetHash);
assert.equal(typeof result.packet.contextManifestHash, "string");
assert.equal(result.ledgerEvents.filter((event) => event.type === "tool_preflight").length, 5);
const receipts = result.ledgerEvents.filter((event) => event.type === "progress_receipt");
assert.deepEqual(receipts.map((event) => event.data.kind), ["DISCOVERY", "DISCOVERY", "CHANGE", "VERIFICATION", "VERIFICATION"]);
assert.equal(result.ledgerEvents.some((event) => event.type === "session_settled"), true);
assert.deepEqual(result.manifest.capabilityManifest.tools, GIT_ONLY_CAPABILITY_MANIFEST.tools);
assert.equal(result.manifest.actionFingerprints.length, 5);
assert.equal(result.manifest.sessionId, runId);
assert.deepEqual(result.manifest.contextManifest.builtInPiTools, []);
assert.deepEqual(result.events.includes("agent_end"), true);
assert.deepEqual(checkEvidenceEligibility({ manifest: result.manifest, packet: result.packet, ledgerEvents: result.ledgerEvents }).accepted, true);
assert.deepEqual((await verifyRunArtifacts({ outputDir, manifest: result.manifest, packet: result.packet, ledgerEvents: result.ledgerEvents })).artifactHashesVerified, true);
const wrongHashManifest = structuredClone(result.manifest);
wrongHashManifest.artifactHashes["run-ledger.jsonl"] = "0".repeat(64);
assert.equal((await verifyRunArtifacts({ outputDir, manifest: wrongHashManifest, packet: result.packet, ledgerEvents: result.ledgerEvents })).code, "HARNESS_ARTIFACT_HASH_INVALID");
assert.deepEqual(checkEvidenceEligibility({ manifest: null, packet: null, ledgerEvents: [] }), { accepted: false, code: "HARNESS_MANIFEST_REQUIRED" });
assert.deepEqual(rejectOrdinaryTranscript([{ role: "assistant", content: "unmanifested" }]), { accepted: false, code: "HARNESS_MANIFEST_REQUIRED" });
const serializedLedger = (await readFile(join(outputDir, "run-ledger.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
assert.equal(verifyLedger(serializedLedger, runId).valid, true);
const tampered = structuredClone(serializedLedger);
tampered[1].data = { changed: true };
assert.equal(verifyLedger(tampered, runId).valid, false, "ledger verifier must reject tampering");
const budgetSnapshot = result.ledgerEvents.find((event) => event.type === "budget_snapshot");
assert.deepEqual(budgetSnapshot.data, { liveModelCalls: 0, syntheticFauxCalls: 1, costUsd: 0, retries: 0, compactions: 0 });
assert.equal(
	await sha256File(join(outputDir, "run-ledger.jsonl")),
	result.manifest.artifactHashes["run-ledger.jsonl"],
	"manifest must bind the JSONL ledger",
);
const summary = JSON.parse(await readFile(join(outputDir, "verification-summary.json"), "utf8"));
assert.equal(summary.status, "PASS");
assert.equal(summary.progressReceipts.length, 5);
await assert.rejects(() => runGitToolPlaneSmoke({ outputDir, runId, npmVersion }), /cannot be reopened/);

await rm(outputDir, { recursive: true, force: true });

console.log(JSON.stringify({ status: "PASS", outputDir, runId, ledgerEvents: result.ledgerEvents.length }));
