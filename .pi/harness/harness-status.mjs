import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

const PHASES = new Set(["PREFLIGHT", "RUNNING", "SETTLED", "FAILED"]);
const USAGE_STATES = new Set(["PENDING", "ACTUAL", "ESTIMATED", "UNAVAILABLE"]);

function absoluteOutputDir(outputDir) {
	if (!isAbsolute(outputDir ?? "")) throw new TypeError("outputDir must be absolute");
	return resolve(outputDir);
}
function safeString(value, name) {
	if (typeof value !== "string" || value.length === 0) throw new TypeError(`status.${name} must be a non-empty string`);
	return value;
}
function safeInteger(value, name) {
	if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`status.${name} must be a non-negative safe integer`);
	return value;
}

/** Write non-evidentiary operational telemetry. This file is deliberately outside canonical artifacts. */
export async function writeHarnessStatus({ outputDir, status }) {
	const target = absoluteOutputDir(outputDir);
	await writeFile(`${target}.status.json`, `${JSON.stringify(status)}\n`);
}

/** Read and constrain the only status view Codex may relay into a conversation. */
export async function readHarnessStatus({ outputDir, nowMs = Date.now() }) {
	const target = absoluteOutputDir(outputDir);
	let raw;
	try { raw = JSON.parse(await readFile(`${target}.status.json`, "utf8")); }
	catch { return Object.freeze({ phase: "FAILED", diagnosticCode: "STATUS_UNAVAILABLE" }); }
	try {
		if (!raw || typeof raw !== "object" || Array.isArray(raw) || !PHASES.has(raw.phase)) throw new TypeError("phase");
		const startedAtMs = safeInteger(raw.startedAtMs, "startedAtMs");
		const finishedAtMs = raw.finishedAtMs === undefined ? undefined : safeInteger(raw.finishedAtMs, "finishedAtMs");
		const usage = raw.usage;
		if (!usage || typeof usage !== "object" || !USAGE_STATES.has(usage.state)) throw new TypeError("usage.state");
		const result = {
			kind: "harness-run-status", version: 1,
			taskId: safeString(raw.taskId, "taskId"), runId: safeString(raw.runId, "runId"),
			phase: raw.phase,
			model: { provider: safeString(raw.model?.provider, "model.provider"), id: safeString(raw.model?.id, "model.id") },
			calls: { used: safeInteger(raw.calls?.used, "calls.used"), limit: safeInteger(raw.calls?.limit, "calls.limit") },
			usage: { state: usage.state },
			elapsedMs: Math.max(0, (finishedAtMs ?? nowMs) - startedAtMs),
			diagnosticCode: typeof raw.diagnosticCode === "string" ? raw.diagnosticCode : "STATUS_OK",
		};
		if (usage.state === "ACTUAL") {
			result.usage.inputTokens = safeInteger(usage.inputTokens, "usage.inputTokens");
			result.usage.outputTokens = safeInteger(usage.outputTokens, "usage.outputTokens");
		}
		return Object.freeze(result);
	} catch {
		return Object.freeze({ phase: "FAILED", diagnosticCode: "STATUS_INVALID" });
	}
}

async function main() {
	if (process.argv.length !== 4 || process.argv[2] !== "--output-dir") throw new TypeError("usage: harness-status.mjs --output-dir <absolute-dir>");
	process.stdout.write(`${JSON.stringify(await readHarnessStatus({ outputDir: process.argv[3] }))}\n`);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch(error => { process.stderr.write(`${error.name}: ${error.message}\n`); process.exitCode = 2; });
