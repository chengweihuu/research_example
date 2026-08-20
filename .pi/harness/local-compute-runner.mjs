import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { writeHarnessStatus } from "./harness-status.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const inside = (root, path) => { const r = relative(root, path); return r && !r.startsWith("..") && !isAbsolute(r); };
export function validateLocalComputeRequest(r) {
	if (!r || !isAbsolute(r.scratchRoot) || !isAbsolute(r.outputDir) || !Array.isArray(r.argv) || r.argv.length < 2 || r.argv[0] !== process.execPath || !Array.isArray(r.artifacts) || !r.artifacts.length || !Number.isInteger(r.timeoutMs) || r.timeoutMs < 1 || r.timeoutMs > 30000) throw new TypeError("invalid local-compute request");
	if (!inside(resolve(r.scratchRoot), resolve(r.argv[1])) || r.artifacts.some(x => typeof x !== "string" || x.includes("..") || isAbsolute(x))) throw new TypeError("local-compute path escapes declared root");
	return r;
}
export async function verifyLocalComputeRun({ outputDir }) {
	try { const m = JSON.parse(await readFile(resolve(outputDir,"local-compute-manifest.json"),"utf8")); for (const [name, expected] of Object.entries(m.artifactHashes)) if (hash(await readFile(resolve(outputDir,name))) !== expected) return {accepted:false,code:"LOCAL_ARTIFACT_HASH_INVALID"}; return {accepted:true,code:"LOCAL_COMPUTE_VERIFIED",runId:m.runId}; } catch { return {accepted:false,code:"LOCAL_COMPUTE_INVALID"}; }
}
export async function runLocalCompute(r) {
	validateLocalComputeRequest(r); const root=resolve(r.scratchRoot), out=resolve(r.outputDir), stage=`${out}.work`; await rm(stage,{recursive:true,force:true}); await mkdir(stage,{recursive:true}); await mkdir(resolve(out,".."),{recursive:true});
	const start=Date.now(), status=(phase,extra={})=>writeHarnessStatus({outputDir:out,status:{taskId:r.taskId,runId:r.runId,phase,model:{provider:"local-compute",id:"node"},calls:{used:0,limit:0},usage:{state:phase==="FAILED"?"UNAVAILABLE":"PENDING"},startedAtMs:start,...extra}}); await status("PREFLIGHT"); await status("RUNNING");
	const outcome=await new Promise(resolveCode=>{let timedOut=false;const p=spawn(r.argv[0],r.argv.slice(1),{cwd:root,shell:false,env:{...process.env,HARNESS_OUTPUT_DIR:stage}}); const t=setTimeout(()=>{timedOut=true;p.kill("SIGTERM");},r.timeoutMs); p.on("close",c=>{clearTimeout(t);resolveCode({code:c??-1,timedOut});});});
	if(outcome.code!==0){const code=outcome.timedOut?"LOCAL_TIMEOUT":"LOCAL_EXIT_NONZERO";await status("FAILED",{finishedAtMs:Date.now(),diagnosticCode:code});return {accepted:false,code};}
	const hashes={}; try { for(const name of r.artifacts){const p=resolve(stage,name); if(!inside(stage,p)||(await stat(p)).isFile()===false) throw new Error(); hashes[name]=hash(await readFile(p));} } catch {await status("FAILED",{finishedAtMs:Date.now(),diagnosticCode:"LOCAL_ARTIFACT_MISSING"});return {accepted:false,code:"LOCAL_ARTIFACT_MISSING"};}
	await mkdir(out); for(const name of r.artifacts) await rename(resolve(stage,name),resolve(out,name)); const manifest={kind:"local-compute-run",version:1,taskId:r.taskId,runId:r.runId,exitCode:0,artifactHashes:hashes}; await writeFile(resolve(out,"local-compute-manifest.json"),JSON.stringify(manifest)); await status("SETTLED",{finishedAtMs:Date.now(),usage:{state:"UNAVAILABLE"}}); return verifyLocalComputeRun({outputDir:out});
}
