import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Agent } from "../node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-agent-core/dist/index.js";
import {
	fauxAssistantMessage,
	fauxProvider,
	fauxToolCall,
} from "../node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/index.js";
import { Type } from "../node_modules/@earendil-works/pi-coding-agent/node_modules/typebox/build/index.mjs";

export const HARNESS_VERSION = "0.1.0";

export const FIXED_CAPABILITY_MANIFEST = Object.freeze({
	version: 1,
	capabilities: Object.freeze({
		write_run_note: Object.freeze({
			kind: "file.write",
			target: "explicit-output-dir",
		}),
	}),
});

export const FROZEN_CONTROLS = Object.freeze({
	maxLiveModelCalls: 0,
	maxFauxModelCalls: 1,
	maxAutomaticRetries: 0,
	compactionEnabled: false,
	identicalActionLimit: 2,
	noProgressTurnLimit: 2,
});

function stable(value) {
	if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

export function createRunId(now = new Date(), suffix = randomUUID().replaceAll("-", "").slice(0, 8)) {
	const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
	return `R-${stamp}-${suffix}`;
}

function isInside(root, target) {
	const path = relative(root, target);
	return path !== "" && !path.startsWith("..") && !isAbsolute(path);
}

export function estimateRequest(prompt) {
	const input = Math.max(1, Math.ceil(prompt.length / 4));
	return {
		estimatedInputTokens: input,
		estimatedOutputTokens: 64,
		estimatedTotalTokens: input + 64,
		method: "conservative-character-estimate-v1",
	};
}

export class MechanicalGate {
	#outputDir;
	#actions = new Map();
	#noProgressTurns = 0;

	constructor(outputDir) {
		this.#outputDir = resolve(outputDir);
	}

	preflight(name, args) {
		const capability = FIXED_CAPABILITY_MANIFEST.capabilities[name];
		if (!capability) {
			return { allowed: false, terminal: true, code: "CAPABILITY_MISSING", reason: `Capability ${name} is not declared` };
		}
		if (name === "write_run_note") {
			if (!args || typeof args.path !== "string" || isAbsolute(args.path)) {
				return { allowed: false, terminal: true, code: "ALLOWED_CHANGES_REJECTED", reason: "write_run_note requires a relative output path" };
			}
			const target = resolve(this.#outputDir, args.path);
			if (!isInside(this.#outputDir, target)) {
				return { allowed: false, terminal: true, code: "ALLOWED_CHANGES_REJECTED", reason: "Requested file is outside the explicit output_dir" };
			}
		}
		const fingerprint = `${name}:${stable(args)}`;
		const count = this.#actions.get(fingerprint) ?? 0;
		if (count >= FROZEN_CONTROLS.identicalActionLimit) {
			return { allowed: false, terminal: true, code: "REPEATED_ACTION_BLOCKED", reason: "Identical normalized action reached the fixed limit" };
		}
		this.#actions.set(fingerprint, count + 1);
		return { allowed: true, terminal: false, code: "ACCEPTED", fingerprint };
	}

	settleTurn(progress) {
		this.#noProgressTurns = progress ? 0 : this.#noProgressTurns + 1;
		return this.#noProgressTurns >= FROZEN_CONTROLS.noProgressTurnLimit
			? { state: "STUCK", terminal: true }
			: { state: "RUNNING", terminal: false };
	}
}

export function rejectOrdinaryTranscript(candidate) {
	if (!candidate || candidate.kind !== "pi-harness-run" || !candidate.manifest) {
		return { accepted: false, code: "HARNESS_MANIFEST_REQUIRED" };
	}
	return { accepted: true };
}

async function writeJson(path, value) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function sha256File(path) {
	return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function prepareNewRunDirectory(outputDir) {
	await mkdir(outputDir, { recursive: true });
	const entries = await readdir(outputDir);
	if (entries.length > 0) {
		throw new Error("Run output_dir is already closed or occupied; a Run is append-only and cannot be reopened");
	}
}

async function readPiVersion() {
	const here = dirname(fileURLToPath(import.meta.url));
	const packagePath = resolve(here, "../node_modules/@earendil-works/pi-coding-agent/package.json");
	return JSON.parse(await readFile(packagePath, "utf8")).version;
}

function makeRunNoteTool(outputDir, gate, actions) {
	return {
		name: "write_run_note",
		label: "Write run note",
		description: "Write a note only below the explicit harness output directory.",
		parameters: Type.Object({
			path: Type.String(),
			content: Type.String(),
		}),
		async execute(_toolCallId, args) {
			const decision = gate.preflight("write_run_note", args);
			actions.push({ name: "write_run_note", args, decision });
			if (!decision.allowed) {
				return { content: [{ type: "text", text: decision.reason }], details: decision, terminate: true };
			}
			const target = resolve(outputDir, args.path);
			await mkdir(dirname(target), { recursive: true });
			await writeFile(target, args.content, "utf8");
			return { content: [{ type: "text", text: "Run note recorded." }], details: { path: args.path } };
		},
	};
}

/**
 * Run exactly one synthetic Pi Core turn.  The caller must provide output_dir;
 * this function never discovers a session path, auth file, AGENTS file, or tool.
 */
export async function runFauxSmoke({ outputDir, prompt = "Record the approved smoke note.", runId, npmVersion } = {}) {
	if (!outputDir) throw new Error("outputDir is required");
	if (!npmVersion) throw new Error("npmVersion is required by the Environment Contract");
	const resolvedOutputDir = resolve(outputDir);
	const resolvedRunId = runId ?? createRunId();
	await prepareNewRunDirectory(resolvedOutputDir);

	const gate = new MechanicalGate(resolvedOutputDir);
	const actions = [];
	const faux = fauxProvider({
		api: "harness-faux",
		provider: "harness-faux",
		models: [{ id: "harness-faux-1", contextWindow: 4096, maxTokens: 256 }],
	});
	faux.setResponses([
		fauxAssistantMessage(
			fauxToolCall("write_run_note", { path: "artifacts/smoke-note.txt", content: "H-004 faux-provider smoke completed.\n" }, { id: "h004-note" }),
		),
	]);

	const agent = new Agent({
		initialState: {
			systemPrompt: "You have exactly one fixed tool. Do not request undeclared capabilities.",
			model: faux.getModel(),
			thinkingLevel: "off",
			tools: [makeRunNoteTool(resolvedOutputDir, gate, actions)],
		},
		streamFn: (model, context, options) => faux.provider.streamSimple(model, context, options),
		beforeToolCall: ({ toolCall, args }) => {
			if (toolCall.name !== "write_run_note") {
				const decision = gate.preflight(toolCall.name, args);
				actions.push({ name: toolCall.name, args, decision });
				return { block: true, reason: decision.reason, terminate: true };
			}
			return undefined;
		},
		shouldStopAfterTurn: () => faux.state.callCount >= FROZEN_CONTROLS.maxFauxModelCalls,
		toolExecution: "sequential",
	});

	const events = [];
	agent.subscribe((event) => events.push(event.type));
	const startedAt = new Date().toISOString();
	await agent.prompt(prompt);
	await agent.waitForIdle();
	const endedAt = new Date().toISOString();
	const progress = actions.some((action) => action.decision.allowed === true);
	const settlement = gate.settleTurn(progress);
	const piVersion = await readPiVersion();
	const syntheticCalls = agent.state.messages
		.filter((message) => message.role === "assistant")
		.map((message, index) => ({
			ordinal: index + 1,
			provider: "faux",
			usage: message.usage,
			costUsd: 0,
		}));
	const manifest = {
		kind: "pi-harness-run",
		harnessVersion: HARNESS_VERSION,
		taskId: "H-004",
		runId: resolvedRunId,
		status: settlement.state === "STUCK" ? "STUCK" : "COMPLETED",
		outputDir: resolvedOutputDir,
		contextManifest: {
			ambientAgentsFiles: false,
			discoveredContextFiles: [],
			authRead: false,
			network: false,
			builtInPiTools: [],
		},
		capabilityManifest: FIXED_CAPABILITY_MANIFEST,
		controls: FROZEN_CONTROLS,
		environment: {
			runtime: "host",
			node: process.version,
			npm: npmVersion,
			piCodingAgent: piVersion,
			provider: "faux",
			authentication: "not-read",
		},
		estimate: estimateRequest(prompt),
		startedAt,
		endedAt,
	};
	const ledger = {
		kind: "run-ledger",
		runId: resolvedRunId,
		provider: "faux",
		liveModelCalls: 0,
		syntheticFauxCalls: faux.state.callCount,
		syntheticCalls,
		costUsd: 0,
		retries: 0,
		compactions: 0,
		actions,
		settlement,
	};
	const ledgerPath = resolve(resolvedOutputDir, "run-ledger.json");
	const sessionPath = resolve(resolvedOutputDir, "pi-core-session.json");
	const notePath = resolve(resolvedOutputDir, "artifacts/smoke-note.txt");
	const verificationPath = resolve(resolvedOutputDir, "verification-summary.json");
	await writeJson(ledgerPath, ledger);
	await writeJson(sessionPath, {
		kind: "pi-core-session",
		sessionId: resolvedRunId,
		messages: agent.state.messages,
		events,
	});
	await writeJson(verificationPath, {
		status: "PASS",
		runId: resolvedRunId,
		checks: {
			oneFauxCall: faux.state.callCount === 1,
			noLiveModelCall: true,
			noCost: true,
			noRetry: true,
			noCompaction: true,
			progressSettled: settlement.state === "RUNNING",
		},
	});
	manifest.artifactHashes = {
		"artifacts/smoke-note.txt": await sha256File(notePath),
		"run-ledger.json": await sha256File(ledgerPath),
		"pi-core-session.json": await sha256File(sessionPath),
		"verification-summary.json": await sha256File(verificationPath),
	};
	await writeJson(resolve(resolvedOutputDir, "manifest.json"), manifest);
	return { manifest, ledger, session: agent.state.messages, events };
}
