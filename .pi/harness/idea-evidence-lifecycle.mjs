import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { rejectOrdinaryTranscript } from "./runner.mjs";
import { sealCanonicalRun, verifyCanonicalRun } from "./canonical-run-seal.mjs";
import { sha256 } from "./execution-packet.mjs";

const states = new WeakMap();

function requiredString(value, name) {
	if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(`${name} must be a non-empty string`);
	return value;
}

function requireTask(task) {
	const state = states.get(task);
	if (!state) throw new Error("Unknown Idea task record");
	return state;
}

function assertActive(task) {
	const state = requireTask(task);
	if (state.status !== "ACTIVE") throw new Error("Idea task is closed");
	return state;
}

function bindingFor(task) {
	return Object.freeze({
		version: 1,
		ideaId: task.ideaId,
		taskId: task.taskId,
		runId: task.runId,
		sessionId: task.sessionId,
		questionHash: sha256(task.question),
	});
}

function sameBinding(left, right) {
	return left && right
		&& left.version === 1
		&& left.ideaId === right.ideaId
		&& left.taskId === right.taskId
		&& left.runId === right.runId
		&& left.sessionId === right.sessionId
		&& left.questionHash === right.questionHash;
}

/** Create one in-memory lifecycle control record from a human-language question. */
export function createIdeaTask({ ideaId, taskId, runId, sessionId = runId, question, outputDir, branch, ref }) {
	requiredString(ideaId, "ideaId");
	requiredString(taskId, "taskId");
	requiredString(runId, "runId");
	requiredString(sessionId, "sessionId");
	requiredString(question, "question");
	requiredString(branch, "branch");
	requiredString(ref, "ref");
	if (!isAbsolute(outputDir ?? "")) throw new TypeError("outputDir must be absolute");
	if (new Set([ideaId, taskId, runId]).size !== 3) throw new Error("Idea, Task, and Run IDs must be distinct");
	if (sessionId !== runId) throw new Error("Session ID must equal Run ID under the canonical Run contract");
	const task = Object.freeze({
		kind: "idea-evidence-task",
		version: 1,
		ideaId,
		taskId,
		runId,
		sessionId,
		question,
		outputDir: resolve(outputDir),
		branch,
		ref,
	});
	states.set(task, { status: "ACTIVE", writerAttempted: false, sealed: false, promoted: false });
	return task;
}

export function inspectIdeaTask(task) {
	const state = requireTask(task);
	return Object.freeze({
		kind: task.kind,
		version: task.version,
		ideaId: task.ideaId,
		taskId: task.taskId,
		runId: task.runId,
		sessionId: task.sessionId,
		status: state.status,
		writerAttempted: state.writerAttempted,
		sealed: state.sealed,
		promoted: state.promoted,
	});
}

/** Seal the task's only permitted Run through H-019, binding Idea metadata in its Packet context. */
export async function sealIdeaRun({ task, executorResult, piSession, capabilityManifest, environment, contextManifest = {} }) {
	const state = assertActive(task);
	if (state.writerAttempted) throw new Error("Idea task permits exactly one Run writer attempt");
	if (!contextManifest || typeof contextManifest !== "object" || Array.isArray(contextManifest) || "ideaBinding" in contextManifest) {
		throw new TypeError("contextManifest must be an object without ideaBinding");
	}
	if (piSession?.sessionId !== task.sessionId) throw new Error("Pi Session does not match the Idea task binding");
	state.writerAttempted = true;
	const sealed = await sealCanonicalRun({
		outputDir: task.outputDir,
		taskId: task.taskId,
		branch: task.branch,
		ref: task.ref,
		executorResult,
		piSession,
		contextManifest: { ...contextManifest, ideaBinding: bindingFor(task) },
		capabilityManifest,
		environment,
	});
	state.sealed = true;
	return sealed;
}

/** Promote only a verified, identity-bound Manifest; never return the Session itself. */
export async function promoteEvidence({ task, outputDir, candidate } = {}) {
	const state = assertActive(task);
	if (!outputDir) return rejectOrdinaryTranscript(candidate);
	if (!isAbsolute(outputDir)) return Object.freeze({ accepted: false, code: "HARNESS_OUTPUT_DIR_INVALID" });
	const resolvedOutputDir = resolve(outputDir);
	if (resolvedOutputDir !== task.outputDir) return Object.freeze({ accepted: false, code: "HARNESS_RUN_BINDING_INVALID" });
	const verification = await verifyCanonicalRun({ outputDir: resolvedOutputDir });
	if (!verification.accepted) return verification;
	try {
		const [manifest, packet] = await Promise.all([
			JSON.parse(await readFile(resolve(resolvedOutputDir, "manifest.json"), "utf8")),
			JSON.parse(await readFile(resolve(resolvedOutputDir, "execution-packet.json"), "utf8")),
		]);
		if (manifest.taskId !== task.taskId || manifest.runId !== task.runId || manifest.sessionId !== task.sessionId || !sameBinding(packet.contextManifest?.ideaBinding, bindingFor(task))) {
			return Object.freeze({ accepted: false, code: "HARNESS_IDEA_BINDING_INVALID" });
		}
		state.promoted = true;
		return Object.freeze({
			accepted: true,
			code: "EVIDENCE_PROMOTION_ELIGIBLE",
			ideaId: task.ideaId,
			taskId: task.taskId,
			runId: task.runId,
			sessionId: task.sessionId,
			manifestPath: resolve(resolvedOutputDir, "manifest.json"),
			packetHash: manifest.packetHash,
			terminalLedgerHash: manifest.terminalLedgerHash,
		});
	} catch {
		return Object.freeze({ accepted: false, code: "HARNESS_ARTIFACT_INVALID" });
	}
}

/** Close the control record; no further Run sealing or promotion is permitted. */
export function closeIdeaTask(task) {
	const state = requireTask(task);
	if (state.status !== "ACTIVE") throw new Error("Idea task is already closed");
	state.status = "CLOSED";
	return inspectIdeaTask(task);
}
