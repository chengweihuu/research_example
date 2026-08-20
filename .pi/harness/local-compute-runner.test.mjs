import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runLocalCompute, verifyLocalComputeRun, validateLocalComputeRequest } from "./local-compute-runner.mjs";

const script = 'import{readFile,writeFile}from"node:fs/promises";await writeFile(process.env.HARNESS_OUTPUT_DIR+"/result.json",await readFile("input.txt"))';
const request = (root, name, overrides = {}) => ({ taskId: "H-034", runId: `R-${name}`, scratchRoot: root, outputDir: join(root, name), argv: [process.execPath, join(root, "run.mjs")], inputs: ["input.txt"], artifacts: ["result.json"], timeoutMs: 1000, ...overrides });

test("declared command, input, environment and artifact root verify together", async t => {
	const root = await mkdtemp(join(tmpdir(), "h034-")); t.after(() => rm(root, { recursive: true, force: true }));
	await writeFile(join(root, "run.mjs"), script); await writeFile(join(root, "input.txt"), "ok");
	const r = request(root, "good"); assert.equal((await runLocalCompute(r)).accepted, true); assert.equal((await verifyLocalComputeRun({ outputDir: r.outputDir })).accepted, true);
});

test("missing inputs and undeclared outputs fail before sealing", async t => {
	const root = await mkdtemp(join(tmpdir(), "h034-negative-")); t.after(() => rm(root, { recursive: true, force: true }));
	await writeFile(join(root, "run.mjs"), script); await writeFile(join(root, "input.txt"), "ok");
	assert.equal((await runLocalCompute(request(root, "missing-input", { inputs: ["absent.txt"] }))).code, "LOCAL_INPUT_INVALID");
	await writeFile(join(root, "extra.mjs"), 'import{writeFile}from"node:fs/promises";await writeFile(process.env.HARNESS_OUTPUT_DIR+"/result.json","ok");await writeFile(process.env.HARNESS_OUTPUT_DIR+"/extra.txt","x")');
	assert.equal((await runLocalCompute(request(root, "extra", { argv: [process.execPath, join(root, "extra.mjs")], inputs: [] }))).code, "LOCAL_UNDECLARED_OUTPUT");
});

test("empty or substituted manifest bindings never verify", async t => {
	const root = await mkdtemp(join(tmpdir(), "h034-tamper-")); t.after(() => rm(root, { recursive: true, force: true }));
	const out = join(root, "forged"); await mkdir(out); await writeFile(join(root, "run.mjs"), script); await writeFile(join(root, "input.txt"), "ok");
	await writeFile(join(out, "local-compute-manifest.json"), JSON.stringify({ artifactHashes: {}, runId: "R-forged" }));
	assert.equal((await verifyLocalComputeRun({ outputDir: out })).code, "LOCAL_BINDING_INVALID");
	const r = request(root, "good"); await runLocalCompute(r); const manifestPath = join(r.outputDir, "local-compute-manifest.json"); const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
	manifest.argv = [process.execPath, "other.mjs"]; await writeFile(manifestPath, JSON.stringify(manifest)); assert.equal((await verifyLocalComputeRun({ outputDir: r.outputDir })).code, "LOCAL_BINDING_INVALID");
	manifest.argvHash = "0".repeat(64); manifest.environmentFingerprint = "0".repeat(64); await writeFile(manifestPath, JSON.stringify(manifest)); assert.equal((await verifyLocalComputeRun({ outputDir: r.outputDir })).code, "LOCAL_BINDING_INVALID");
	const fresh = request(root, "fresh"); await runLocalCompute(fresh); const freshManifestPath = join(fresh.outputDir, "local-compute-manifest.json"); const freshManifest = JSON.parse(await readFile(freshManifestPath, "utf8"));
	freshManifest.scriptHash = "0".repeat(64); await writeFile(freshManifestPath, JSON.stringify(freshManifest)); assert.equal((await verifyLocalComputeRun({ outputDir: fresh.outputDir })).code, "LOCAL_BINDING_INVALID");
	const inputChanged = request(root, "input"); await runLocalCompute(inputChanged); const inputManifestPath = join(inputChanged.outputDir, "local-compute-manifest.json"); const inputManifest = JSON.parse(await readFile(inputManifestPath, "utf8")); inputManifest.inputManifest[0][1] = "0".repeat(64); await writeFile(inputManifestPath, JSON.stringify(inputManifest)); assert.equal((await verifyLocalComputeRun({ outputDir: inputChanged.outputDir })).code, "LOCAL_BINDING_INVALID");
	const environmentChanged = request(root, "environment"); await runLocalCompute(environmentChanged); const environmentPath = join(environmentChanged.outputDir, "local-compute-manifest.json"); const environmentManifest = JSON.parse(await readFile(environmentPath, "utf8")); environmentManifest.environmentFingerprint = "0".repeat(64); await writeFile(environmentPath, JSON.stringify(environmentManifest)); assert.equal((await verifyLocalComputeRun({ outputDir: environmentChanged.outputDir })).code, "LOCAL_BINDING_INVALID");
	const rootChanged = request(root, "root"); await runLocalCompute(rootChanged); const rootPath = join(rootChanged.outputDir, "local-compute-manifest.json"); const rootManifest = JSON.parse(await readFile(rootPath, "utf8")); rootManifest.artifactRootHash = "0".repeat(64); await writeFile(rootPath, JSON.stringify(rootManifest)); assert.equal((await verifyLocalComputeRun({ outputDir: rootChanged.outputDir })).code, "LOCAL_BINDING_INVALID");
	assert.throws(() => validateLocalComputeRequest({ scratchRoot: root, outputDir: out, argv: ["sh", "-c", "x"], inputs: [], artifacts: ["x"], timeoutMs: 1 }));
});
