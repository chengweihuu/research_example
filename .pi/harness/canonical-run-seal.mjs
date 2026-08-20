import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { normalizeRelativePath, sha256, stableJson } from "./execution-packet.mjs";
import { HashLedger, verifyLedger } from "./ledger.mjs";

export const CANONICAL_RUN_VERSION = 1;
export const CANONICAL_ARTIFACTS = Object.freeze([
	"execution-packet.json",
	"model-profile.json",
	"stage-receipt.json",
	"sse-outcome.json",
	"settlement.json",
	"pi-core-session.json",
	"run-ledger.jsonl",
	"reconciliation-summary.json",
]);

const CREDENTIAL_KEYS = new Set([
	"auth", "authorization", "credentials", "apikey", "accesskey", "password", "secret",
	"accesstoken", "refreshtoken", "sessiontoken", "cookie", "setcookie",
]);
const CREDENTIAL_VALUES = [/(?:^|\s)Bearer\s+[A-Za-z0-9._~+/=-]+/i, /\bsk-[A-Za-z0-9_-]{12,}\b/];

function requiredString(value, name) {
	if (typeof value !== "string" || value.length === 0) throw new TypeError(`${name} must be a non-empty string`);
	return value;
}

function jsonValue(value, name) {
	let serialized;
	try { serialized = JSON.stringify(value); } catch { throw new TypeError(`${name} must be JSON serializable`); }
	if (serialized === undefined) throw new TypeError(`${name} must be JSON serializable`);
	return JSON.parse(serialized);
}

function requiredRecord(value, name) {
	const normalized = jsonValue(value, name);
	if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) throw new TypeError(`${name} must be a JSON object`);
	return normalized;
}

function jsonText(value) {
	return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256Bytes(value) {
	return createHash("sha256").update(value).digest("hex");
}

function isSha256(value) {
	return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isRecord(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizedCredentialKey(key) {
	return key.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

function assertNoCredentials(value, path = "session", seen = new Set()) {
	if (typeof value === "string") {
		if (CREDENTIAL_VALUES.some(pattern => pattern.test(value))) throw new Error(`Credential-like value is forbidden at ${path}`);
		return;
	}
	if (!value || typeof value !== "object") return;
	if (seen.has(value)) throw new TypeError("Session must not contain cycles");
	seen.add(value);
	for (const [key, child] of Object.entries(value)) {
		if (CREDENTIAL_KEYS.has(normalizedCredentialKey(key))) throw new Error(`Credential field is forbidden at ${path}.${key}`);
		assertNoCredentials(child, `${path}.${key}`, seen);
	}
	seen.delete(value);
}

function derivedStatus(sseOutcome, settlement) {
	return sseOutcome?.outcome === "response_settled" && settlement?.state === "provider_reported"
		? "COMPLETED"
		: "INCOMPLETE_RESPONSE";
}

function validateExecutorResult(result) {
	if (!result || result.kind !== "canonical-executor-result" || result.version !== 1) throw new Error("Canonical executor result is required");
	const runId = requiredString(result.packet?.runId, "executorResult.packet.runId");
	if (result.packet.kind !== "harness-execution-packet" || result.packet.provider !== result.profile?.provider || result.packet.modelId !== result.profile?.modelId || sha256(result.packet.profile) !== sha256(result.profile)) {
		throw new Error("Canonical executor profile identity is invalid");
	}
	if (result.executorCalls !== 1 || result.requestCount !== 1 || result.noSecondCall !== true) throw new Error("Canonical Run requires exactly one call and a no-second-call decision");
	if (result.session?.sessionId !== runId || !Array.isArray(result.session?.eventTypes)) throw new Error("Canonical executor Session receipt is invalid");
	const projectionLedger = verifyLedger(result.ledgerEvents ?? [], runId);
	if (!projectionLedger.valid || result.ledgerVerification?.valid !== true || result.ledgerVerification.terminalHash !== projectionLedger.terminalHash) {
		throw new Error("Canonical executor projection Ledger is invalid");
	}
	if (result.stageReceipt?.kind !== "pi-event-stage-receipt" || !result.sseOutcome?.outcome || !result.settlement?.state) throw new Error("Canonical executor projections are incomplete");
	return { runId, projectionTerminalHash: projectionLedger.terminalHash };
}

function createCanonicalPacket({ taskId, branch, ref, outputDir, result, sessionId, contextManifest, capabilityManifest, environment, projectionTerminalHash }) {
	const unsigned = {
		kind: "harness-execution-packet",
		version: CANONICAL_RUN_VERSION,
		taskId,
		branch,
		ref,
		outputDir,
		runId: result.packet.runId,
		sessionId,
		provider: result.profile.provider,
		modelId: result.profile.modelId,
		profileHash: sha256(result.profile),
		projectionLedgerTerminalHash: projectionTerminalHash,
		contextManifest,
		capabilityManifest,
		environment,
		controls: { maximumModelCalls: 1, maximumRetries: 0, secondCallAllowed: false },
	};
	return { ...unsigned, packetHash: sha256(unsigned) };
}

async function prepareEmptyDirectory(outputDir) {
	await mkdir(outputDir, { recursive: true });
	if ((await readdir(outputDir)).length !== 0) throw new Error("Run outputDir is already sealed or occupied");
}

async function writeExclusive(path, content) {
	await writeFile(path, content, { encoding: "utf8", flag: "wx" });
}

function artifactMap(values) {
	return new Map([
		["execution-packet.json", jsonText(values.packet)],
		["model-profile.json", jsonText(values.profile)],
		["stage-receipt.json", jsonText(values.stageReceipt)],
		["sse-outcome.json", jsonText(values.sseOutcome)],
		["settlement.json", jsonText(values.settlement)],
		["pi-core-session.json", jsonText(values.session)],
	]);
}

/** Write one complete canonical Run. A valid Manifest is created last and no path is reopened. */
export async function sealCanonicalRun(input) {
	const taskId = requiredString(input?.taskId, "taskId");
	const branch = requiredString(input?.branch, "branch");
	const ref = requiredString(input?.ref, "ref");
	if (!isAbsolute(input?.outputDir ?? "")) throw new TypeError("outputDir must be absolute");
	const outputDir = resolve(input.outputDir);
	const result = requiredRecord(input.executorResult, "executorResult");
	const { runId, projectionTerminalHash } = validateExecutorResult(result);
	assertNoCredentials(input.piSession);
	const session = requiredRecord(input.piSession, "piSession");
	if (session.sessionId !== runId) throw new Error("Pi Session ID must equal canonical Run ID");
	const contextManifest = requiredRecord(input.contextManifest, "contextManifest");
	const capabilityManifest = requiredRecord(input.capabilityManifest, "capabilityManifest");
	const environment = requiredRecord(input.environment, "environment");
	assertNoCredentials({ result, contextManifest, capabilityManifest, environment }, "runInput");
	const packet = createCanonicalPacket({ taskId, branch, ref, outputDir, result, sessionId: session.sessionId, contextManifest, capabilityManifest, environment, projectionTerminalHash });
	const texts = artifactMap({ packet, profile: result.profile, stageReceipt: result.stageReceipt, sseOutcome: result.sseOutcome, settlement: result.settlement, session });
	const sessionHash = sha256Bytes(texts.get("pi-core-session.json"));
	const ledger = new HashLedger(runId);
	ledger.append("run_preflight", { taskId, packetHash: packet.packetHash, projectionLedgerTerminalHash: projectionTerminalHash });
	ledger.append("model_call_finished", {
		executorCalls: result.executorCalls,
		requestCount: result.requestCount,
		noSecondCall: result.noSecondCall,
		stageReceiptHash: sha256(result.stageReceipt),
		sseOutcomeHash: sha256(result.sseOutcome),
		settlementHash: sha256(result.settlement),
	});
	ledger.append("session_settled", { sessionId: session.sessionId, sessionArtifactHash: sessionHash });
	ledger.append("run_reconciled", { executorCalls: 1, requestCount: 1, noSecondCallDecision: "STOP_AFTER_FIRST_RESPONSE" });
	const ledgerVerification = verifyLedger(ledger.events(), runId);
	const reconciliation = {
		kind: "canonical-run-reconciliation",
		version: CANONICAL_RUN_VERSION,
		runId,
		sessionId: session.sessionId,
		executorCalls: result.executorCalls,
		requestCount: result.requestCount,
		noSecondCall: result.noSecondCall,
		noSecondCallDecision: "STOP_AFTER_FIRST_RESPONSE",
		stageReceiptHash: sha256(result.stageReceipt),
		sseOutcomeHash: sha256(result.sseOutcome),
		settlementHash: sha256(result.settlement),
		ledgerEventCount: ledgerVerification.eventCount,
		terminalLedgerHash: ledgerVerification.terminalHash,
	};
	texts.set("run-ledger.jsonl", ledger.toJsonl());
	texts.set("reconciliation-summary.json", jsonText(reconciliation));

	await prepareEmptyDirectory(outputDir);
	for (const artifact of CANONICAL_ARTIFACTS) await writeExclusive(resolve(outputDir, artifact), texts.get(artifact));
	const artifactHashes = Object.fromEntries(CANONICAL_ARTIFACTS.map(artifact => [artifact, sha256Bytes(texts.get(artifact))]));
	const manifest = {
		kind: "pi-harness-run",
		version: CANONICAL_RUN_VERSION,
		taskId,
		runId,
		sessionId: session.sessionId,
		status: derivedStatus(result.sseOutcome, result.settlement),
		packetHash: packet.packetHash,
		terminalLedgerHash: ledgerVerification.terminalHash,
		artifactHashes,
	};
	await writeExclusive(resolve(outputDir, "manifest.json"), jsonText(manifest));
	const verification = await verifyCanonicalRun({ outputDir });
	if (!verification.accepted) throw new Error(`Canonical Run failed post-write verification: ${verification.code}`);
	return Object.freeze({ manifest: Object.freeze(manifest), verification });
}

async function readJson(path) {
	return JSON.parse(await readFile(path, "utf8"));
}

function invalid(code, artifact) {
	return Object.freeze({ accepted: false, code, ...(artifact ? { artifact } : {}) });
}

/** Reload and independently verify a canonical Run using only its on-disk files. */
export async function verifyCanonicalRun({ outputDir } = {}) {
	try {
		if (!isAbsolute(outputDir ?? "")) return invalid("HARNESS_OUTPUT_DIR_INVALID");
		const root = resolve(outputDir);
		const entries = (await readdir(root)).sort();
		if (!entries.includes("manifest.json")) return invalid("HARNESS_MANIFEST_REQUIRED");
		const expectedEntries = [...CANONICAL_ARTIFACTS, "manifest.json"].sort();
		if (stableJson(entries) !== stableJson(expectedEntries)) return invalid("HARNESS_ARTIFACT_SET_INVALID");
		const manifest = await readJson(resolve(root, "manifest.json"));
		if (manifest.kind !== "pi-harness-run" || manifest.version !== CANONICAL_RUN_VERSION || typeof manifest.taskId !== "string" || manifest.taskId.length === 0 || typeof manifest.runId !== "string" || manifest.runId.length === 0 || typeof manifest.sessionId !== "string" || manifest.sessionId.length === 0 || !isSha256(manifest.packetHash) || !isSha256(manifest.terminalLedgerHash)) return invalid("HARNESS_MANIFEST_INVALID");
		const hashEntries = Object.entries(manifest.artifactHashes ?? {});
		if (stableJson(hashEntries.map(([name]) => name).sort()) !== stableJson([...CANONICAL_ARTIFACTS].sort())) return invalid("HARNESS_ARTIFACT_SET_INVALID");
		for (const [artifact, expectedHash] of hashEntries) {
			if (normalizeRelativePath(artifact) !== artifact || !isSha256(expectedHash) || sha256Bytes(await readFile(resolve(root, artifact))) !== expectedHash) return invalid("HARNESS_ARTIFACT_HASH_INVALID", artifact);
		}
		const packet = await readJson(resolve(root, "execution-packet.json"));
		const profile = await readJson(resolve(root, "model-profile.json"));
		const stageReceipt = await readJson(resolve(root, "stage-receipt.json"));
		const sseOutcome = await readJson(resolve(root, "sse-outcome.json"));
		const settlement = await readJson(resolve(root, "settlement.json"));
		const session = await readJson(resolve(root, "pi-core-session.json"));
		const reconciliation = await readJson(resolve(root, "reconciliation-summary.json"));
		const { packetHash, ...unsignedPacket } = packet;
		if (packet.kind !== "harness-execution-packet" || packet.version !== CANONICAL_RUN_VERSION || typeof packet.branch !== "string" || packet.branch.length === 0 || typeof packet.ref !== "string" || packet.ref.length === 0 || !isRecord(packet.contextManifest) || !isRecord(packet.capabilityManifest) || !isRecord(packet.environment) || stableJson(packet.controls) !== stableJson({ maximumModelCalls: 1, maximumRetries: 0, secondCallAllowed: false }) || sha256(unsignedPacket) !== packetHash || packet.profileHash !== sha256(profile)) return invalid("HARNESS_PACKET_INVALID");
		if (packet.outputDir !== root || packet.taskId !== manifest.taskId || packet.runId !== manifest.runId || packet.sessionId !== manifest.sessionId || packetHash !== manifest.packetHash || packet.provider !== profile.provider || packet.modelId !== profile.modelId || session.sessionId !== manifest.sessionId) return invalid("HARNESS_IDENTITY_INVALID");
		if (profile.kind !== "harness-model-profile" || profile.version !== 1 || stageReceipt.kind !== "pi-event-stage-receipt" || !Array.isArray(stageReceipt.stages) || !new Set(["response_settled", "stream_interrupted", "response_invalid"]).has(sseOutcome.outcome) || !new Set(["provider_reported", "unavailable"]).has(settlement.state) || reconciliation.kind !== "canonical-run-reconciliation" || reconciliation.version !== CANONICAL_RUN_VERSION) return invalid("HARNESS_PROJECTION_INVALID");
		const ledgerText = await readFile(resolve(root, "run-ledger.jsonl"), "utf8");
		if (!ledgerText.endsWith("\n")) return invalid("HARNESS_LEDGER_INVALID");
		const ledgerEvents = ledgerText.trimEnd().split("\n").map(line => JSON.parse(line));
		assertNoCredentials({ manifest, packet, profile, stageReceipt, sseOutcome, settlement, session, reconciliation, ledgerEvents }, "persistedRun");
		const ledgerCheck = verifyLedger(ledgerEvents, manifest.runId);
		if (!ledgerCheck.valid || ledgerCheck.terminalHash !== manifest.terminalLedgerHash || ledgerCheck.terminalHash !== reconciliation.terminalLedgerHash || ledgerCheck.eventCount !== reconciliation.ledgerEventCount) return invalid("HARNESS_LEDGER_INVALID");
		if (stableJson(ledgerEvents.map(event => event.type)) !== stableJson(["run_preflight", "model_call_finished", "session_settled", "run_reconciled"])) return invalid("HARNESS_LEDGER_INVALID");
		const [preflight, call, settled, reconciled] = ledgerEvents.map(event => event.data);
		if (preflight.packetHash !== packetHash || preflight.taskId !== manifest.taskId || preflight.projectionLedgerTerminalHash !== packet.projectionLedgerTerminalHash) return invalid("HARNESS_CHAIN_INVALID");
		const stageHash = sha256(stageReceipt), sseHash = sha256(sseOutcome), settlementHash = sha256(settlement);
		if (call.stageReceiptHash !== stageHash || call.sseOutcomeHash !== sseHash || call.settlementHash !== settlementHash || reconciliation.stageReceiptHash !== stageHash || reconciliation.sseOutcomeHash !== sseHash || reconciliation.settlementHash !== settlementHash) return invalid("HARNESS_PROJECTION_INVALID");
		const sessionHash = sha256Bytes(await readFile(resolve(root, "pi-core-session.json")));
		if (settled.sessionId !== manifest.sessionId || settled.sessionArtifactHash !== sessionHash || reconciliation.runId !== manifest.runId || reconciliation.sessionId !== manifest.sessionId) return invalid("HARNESS_IDENTITY_INVALID");
		if (call.executorCalls !== 1 || call.requestCount !== 1 || call.noSecondCall !== true || reconciled.executorCalls !== 1 || reconciled.requestCount !== 1 || reconciled.noSecondCallDecision !== "STOP_AFTER_FIRST_RESPONSE" || reconciliation.executorCalls !== 1 || reconciliation.requestCount !== 1 || reconciliation.noSecondCall !== true || reconciliation.noSecondCallDecision !== "STOP_AFTER_FIRST_RESPONSE") return invalid("HARNESS_CALL_RECONCILIATION_INVALID");
		if (manifest.status !== derivedStatus(sseOutcome, settlement)) return invalid("HARNESS_STATUS_INVALID");
		return Object.freeze({ accepted: true, code: "CANONICAL_RUN_VERIFIED", runId: manifest.runId, terminalHash: ledgerCheck.terminalHash, artifactHashesVerified: true });
	} catch {
		return invalid("HARNESS_ARTIFACT_INVALID");
	}
}
