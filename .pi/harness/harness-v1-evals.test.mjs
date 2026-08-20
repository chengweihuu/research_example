import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { rejectOrdinaryTranscript } from "./runner.mjs";
import { runEntryRequest } from "./pi-task-entry.mjs";
import { runLocalCompute, verifyLocalComputeRun, validateLocalComputeRequest } from "./local-compute-runner.mjs";
import { readHarnessStatus } from "./harness-status.mjs";

const model={id:"harness-faux-1",provider:"harness-faux",api:"responses",maxTokens:256,cost:{input:0,output:0}};
test("Harness v1 fixed cases accept bounded successes and reject unsafe paths",async t=>{const root=await mkdtemp(join(tmpdir(),"h031-"));t.after(()=>rm(root,{recursive:true,force:true}));const fixture=await runEntryRequest({ideaId:"I-031",taskId:"T-031",runId:"R-031",question:"fixture",outputDir:join(root,"fixture"),branch:"task/H-031-harness-v1-evals",ref:"148ce84",catalogModel:model,mode:"fixture"});assert.equal(fixture.verification.accepted,true);assert.equal((await readHarnessStatus({outputDir:join(root,"fixture")})).phase,"SETTLED");const script=join(root,"ok.mjs");await writeFile(script,'import{writeFile}from"node:fs/promises";await writeFile(process.env.HARNESS_OUTPUT_DIR+"/result.json","ok")');const out=join(root,"local");const local=await runLocalCompute({taskId:"H-031",runId:"R-local",scratchRoot:root,outputDir:out,argv:[process.execPath,script],artifacts:["result.json"],timeoutMs:1000});assert.equal(local.accepted,true);await writeFile(join(out,"result.json"),"tamper");assert.equal((await verifyLocalComputeRun({outputDir:out})).accepted,false);assert.deepEqual(rejectOrdinaryTranscript({role:"assistant",content:"ordinary"}),{accepted:false,code:"HARNESS_MANIFEST_REQUIRED"});assert.throws(()=>validateLocalComputeRequest({scratchRoot:root,outputDir:join(root,"x"),argv:["sh","-c","x"],artifacts:["x"],timeoutMs:1}),/invalid/);});
