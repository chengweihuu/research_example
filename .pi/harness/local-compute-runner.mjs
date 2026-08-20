import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { writeHarnessStatus } from "./harness-status.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const jsonHash = value => hash(JSON.stringify(value));
const inside = (root, path) => { const r = relative(root, path); return r && !r.startsWith("..") && !isAbsolute(r); };
const flatName = value => typeof value === "string" && value.length > 0 && !value.includes("/") && !value.includes("\\") && !value.includes("..") && !isAbsolute(value);
const environment = () => ({ node: process.version, platform: process.platform, arch: process.arch });

export function validateLocalComputeRequest(r) {
	if (!r || !isAbsolute(r.scratchRoot) || !isAbsolute(r.outputDir) || !Array.isArray(r.argv) || r.argv.length < 2 || r.argv[0] !== process.execPath || !Array.isArray(r.artifacts) || !r.artifacts.length || !Array.isArray(r.inputs) || !Number.isInteger(r.timeoutMs) || r.timeoutMs < 1 || r.timeoutMs > 30000) throw new TypeError("invalid local-compute request");
	if (!inside(resolve(r.scratchRoot), resolve(r.argv[1])) || !r.artifacts.every(flatName) || !r.inputs.every(flatName)) throw new TypeError("local-compute path escapes declared root");
	if (new Set(r.artifacts).size !== r.artifacts.length || new Set(r.inputs).size !== r.inputs.length) throw new TypeError("duplicate local-compute declaration");
	return r;
}

export async function verifyLocalComputeRun({ outputDir }) {
	try {
		const m = JSON.parse(await readFile(resolve(outputDir, "local-compute-manifest.json"), "utf8"));
		const entries = Object.entries(m.artifactHashes ?? {}).sort();
		const inputManifest = [...(m.inputManifest ?? [])].sort();
		if (m.kind !== "local-compute-run" || m.version !== 2 || m.executionKind !== "local-compute" || m.isolation !== "none" || !entries.length || !Array.isArray(m.declaredArtifacts) || m.declaredArtifacts.length !== entries.length || !m.declaredArtifacts.every(flatName) || m.artifactRootHash !== jsonHash(entries) || !Array.isArray(m.argv) || m.argvHash !== jsonHash(m.argv) || m.scriptSnapshot !== "execution-script.mjs" || typeof m.scriptHash !== "string" || !/^[a-f0-9]{64}$/.test(m.scriptHash) || hash(await readFile(resolve(outputDir, m.scriptSnapshot))) !== m.scriptHash || !Array.isArray(m.inputManifest) || !inputManifest.every(([name, digest]) => flatName(name) && /^[a-f0-9]{64}$/.test(digest)) || m.inputManifestHash !== jsonHash(inputManifest) || !m.environment || m.environmentFingerprint !== jsonHash(m.environment)) return { accepted: false, code: "LOCAL_BINDING_INVALID" };
		for (const [name, expected] of entries) if (!m.declaredArtifacts.includes(name) || !/^[a-f0-9]{64}$/.test(expected) || hash(await readFile(resolve(outputDir, name))) !== expected) return { accepted: false, code: "LOCAL_ARTIFACT_HASH_INVALID" };
		return { accepted: true, code: "LOCAL_COMPUTE_VERIFIED", runId: m.runId };
	} catch { return { accepted: false, code: "LOCAL_COMPUTE_INVALID" }; }
}

export async function runLocalCompute(r) {
	validateLocalComputeRequest(r);
	const root = resolve(r.scratchRoot), out = resolve(r.outputDir), stage = `${out}.work`;
	await rm(stage, { recursive: true, force: true }); await mkdir(stage, { recursive: true }); await mkdir(resolve(out, ".."), { recursive: true });
	const inputManifest = [];
	try { for (const name of r.inputs) { const path = resolve(root, name); if (!inside(root, path) || !(await stat(path)).isFile()) throw new Error(); inputManifest.push([name, hash(await readFile(path))]); } } catch { return { accepted: false, code: "LOCAL_INPUT_INVALID" }; }
	const scriptHash = hash(await readFile(r.argv[1])); const env = environment();
	const start = Date.now();
	const status = (phase, extra = {}) => writeHarnessStatus({ outputDir: out, status: { taskId: r.taskId, runId: r.runId, phase, model: { provider: "local-compute", id: "node" }, calls: { used: 0, limit: 0 }, usage: { state: phase === "FAILED" ? "UNAVAILABLE" : "PENDING" }, startedAtMs: start, ...extra } });
	await status("PREFLIGHT"); await status("RUNNING");
	const outcome = await new Promise(resolveCode => { let timedOut = false; const p = spawn(r.argv[0], r.argv.slice(1), { cwd: root, shell: false, env: { ...process.env, HARNESS_OUTPUT_DIR: stage } }); const t = setTimeout(() => { timedOut = true; p.kill("SIGTERM"); }, r.timeoutMs); p.on("close", code => { clearTimeout(t); resolveCode({ code: code ?? -1, timedOut }); }); });
	if (outcome.code !== 0) { const code = outcome.timedOut ? "LOCAL_TIMEOUT" : "LOCAL_EXIT_NONZERO"; await status("FAILED", { finishedAtMs: Date.now(), diagnosticCode: code }); return { accepted: false, code }; }
	const stageNames = (await readdir(stage)).sort();
	if (JSON.stringify(stageNames) !== JSON.stringify([...r.artifacts].sort())) { await status("FAILED", { finishedAtMs: Date.now(), diagnosticCode: "LOCAL_UNDECLARED_OUTPUT" }); return { accepted: false, code: "LOCAL_UNDECLARED_OUTPUT" }; }
	const hashes = {};
	try { for (const name of r.artifacts) { const path = resolve(stage, name); if (!inside(stage, path) || !(await stat(path)).isFile()) throw new Error(); hashes[name] = hash(await readFile(path)); } } catch { await status("FAILED", { finishedAtMs: Date.now(), diagnosticCode: "LOCAL_ARTIFACT_MISSING" }); return { accepted: false, code: "LOCAL_ARTIFACT_MISSING" }; }
	await mkdir(out); for (const name of r.artifacts) await rename(resolve(stage, name), resolve(out, name)); await writeFile(resolve(out, "execution-script.mjs"), await readFile(r.argv[1]));
	const entries = Object.entries(hashes).sort();
	const manifest = { kind: "local-compute-run", version: 2, executionKind: "local-compute", isolation: "none", taskId: r.taskId, runId: r.runId, exitCode: 0, declaredArtifacts: r.artifacts, artifactHashes: hashes, artifactRootHash: jsonHash(entries), argv: r.argv, argvHash: jsonHash(r.argv), scriptSnapshot: "execution-script.mjs", scriptHash, inputManifest, inputManifestHash: jsonHash([...inputManifest].sort()), environment: env, environmentFingerprint: jsonHash(env) };
	await writeFile(resolve(out, "local-compute-manifest.json"), JSON.stringify(manifest)); await status("SETTLED", { finishedAtMs: Date.now(), usage: { state: "UNAVAILABLE" } }); return verifyLocalComputeRun({ outputDir: out });
}
