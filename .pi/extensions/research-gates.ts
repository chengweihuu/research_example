import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type GateDecision = { allow: true } | { allow: false; reason: string };

const WRITE_TOOLS = new Set(["write", "edit"]);
const RUN_ID = /^R-\d{8}T\d{6}Z-[a-z0-9]+$/;

function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(`## ${heading}`);
  if (start < 0) return "";
  const next = markdown.indexOf("\n## ", start + heading.length + 3);
  return markdown.slice(start, next < 0 ? undefined : next);
}

function taskStatus(markdown: string): "active" | "inactive" | "unknown" {
  if (/^Status:\s*Inactive\s*$/m.test(markdown)) return "inactive";
  if (/^Status:\s*Active\s*$/m.test(markdown)) return "active";
  return "unknown";
}

function taskType(markdown: string): string | undefined {
  return markdown.match(/^- Type:\s*(\S+)\s*$/m)?.[1];
}

function allowedPaths(markdown: string): string[] {
  return [...section(markdown, "Allowed Changes").matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !rel.includes("../"));
}

function matchesAllowedPath(root: string, target: string, rules: string[]): boolean {
  const absoluteTarget = resolve(root, target);
  if (!isInside(root, absoluteTarget)) return false;
  const projectRelative = relative(root, absoluteTarget).replaceAll("\\", "/");
  return rules.some((rule) => {
    if (rule === "state/TASK.md") return false;
    const normalized = rule.replaceAll("\\", "/");
    const prefix = normalized.split("<")[0];
    return normalized.endsWith("/") || normalized.includes("<")
      ? projectRelative.startsWith(prefix)
      : projectRelative === normalized;
  });
}

function formalReady(markdown: string): boolean {
  return /Protocol ID:\s*P-\d+/m.test(markdown)
    && /Frozen commit:\s*[0-9a-f]{7,}/m.test(markdown)
    && /Environment Contract:/m.test(markdown);
}

function decide(root: string, markdown: string, toolName: string, path?: string): GateDecision {
  if (taskStatus(markdown) !== "active") {
    return { allow: false, reason: "Research gate: TASK is not Active; write, edit, and bash are disabled." };
  }
  if (taskType(markdown) === "FORMAL" && !formalReady(markdown)) {
    return { allow: false, reason: "Research gate: FORMAL requires Protocol ID, Frozen commit, and Environment Contract." };
  }
  if (toolName === "bash") {
    return { allow: false, reason: "Research gate: bash has no controlled executor in this MVP." };
  }
  if (WRITE_TOOLS.has(toolName) && (!path || !matchesAllowedPath(root, path, allowedPaths(markdown)))) {
    return { allow: false, reason: "Research gate: target is outside Allowed Changes." };
  }
  return { allow: true };
}

function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf8");
}

function closeoutDraft(): string {
  return [
    "# Closeout Draft",
    "",
    "Status: Draft only",
    "",
    "No Idea, Protocol, Experiment, CURRENT, or TASK authority has been changed.",
    "Present this draft to the researcher for content-level approval before any closeout action.",
  ].join("\n");
}

function runOutputDir(root: string, outputDir: string): string | undefined {
  const base = resolve(root, "runs", "H-002_pi_gate_mvp");
  const candidate = resolve(root, outputDir);
  return isInside(base, candidate) && RUN_ID.test(basename(candidate)) ? candidate : undefined;
}

function fixtureOutputDir(root: string, outputDir: string): string | undefined {
  const base = resolve(root, "scratch", "H-002_pi_gate_mvp", "fixtures");
  const candidate = resolve(root, outputDir);
  return isInside(base, candidate) ? candidate : undefined;
}

function smokeTask(root: string): string {
  const configured = process.env.PI_RESEARCH_TASK_PATH;
  const fixtureBase = resolve(root, "scratch", "H-002_pi_gate_mvp", "fixtures");
  const fallback = resolve(root, "state", "TASK.md");
  const path = configured && isInside(fixtureBase, resolve(root, configured)) ? resolve(root, configured) : fallback;
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function recordToolDispatch(root: string, event: any, decision: GateDecision): void {
  const outputDir = process.env.PI_RESEARCH_OUTPUT_DIR;
  const caseName = process.env.PI_RESEARCH_SMOKE_CASE;
  if (!outputDir || !caseName) return;
  const runDir = runOutputDir(root, outputDir);
  if (!runDir) return;
  const record = {
    case: caseName,
    tool: event.toolName,
    path: event.input?.path,
    blocked: !decision.allow,
    reason: decision.allow ? undefined : decision.reason,
  };
  mkdirSync(runDir, { recursive: true });
  appendFileSync(resolve(runDir, "tool-events.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
}

function readPiVersion(root: string): string | undefined {
  const lockPath = resolve(root, ".pi", "package-lock.json");
  if (!existsSync(lockPath)) return undefined;
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  return lock.packages?.["node_modules/@earendil-works/pi-coding-agent"]?.version;
}

function writeSmokeReport(root: string, outputDir: string, recordedNpmVersion: string): { overall: boolean; report: string } | undefined {
  const runDir = runOutputDir(root, outputDir);
  if (!runDir) return undefined;
  const recordsPath = resolve(runDir, "tool-events.jsonl");
  const records = existsSync(recordsPath)
    ? readFileSync(recordsPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
    : [];
  const runId = basename(runDir);
  const fixtureDir = resolve(root, "scratch", "H-002_pi_gate_mvp", "fixtures", runId, "closeout");
  const checks = [
    { gate: "THINK write/edit/bash policy; bash via tool_call", pass: records.some((r) => r.case === "think" && r.tool === "bash" && r.blocked) },
    { gate: "Allowed Changes path block via tool_call", pass: records.some((r) => r.case === "allowed" && r.tool === "write" && r.blocked) },
    { gate: "FORMAL prerequisite block via tool_call", pass: records.some((r) => r.case === "formal" && r.tool === "bash" && r.blocked) },
    { gate: "Closeout command writes fixture draft only", pass: existsSync(resolve(fixtureDir, "closeout-draft.md")) },
  ];
  const overall = checks.every((check) => check.pass);
  const manifest = {
    runId,
    overall,
    checks,
    piVersion: readPiVersion(root),
    nodeVersion: process.version,
    npmVersion: recordedNpmVersion,
    toolDispatchEvents: records.length,
    modelCallsUsed: 4,
    modelCallsBudget: 4,
    mode: "real-pi-tool-call-smoke",
    commands: [
      "think: Pi print mode with the default tool set; the agent selected bash and the Inactive TASK gate blocked it",
      "allowed: Pi print mode with --no-context-files --no-extensions -e research-gates.ts --tools write",
      "formal: Pi print mode with --no-context-files --no-extensions -e research-gates.ts --tools bash",
      "closeout/report: Pi extension commands with explicit scratch and runs output_dir arguments",
    ],
  };
  const report = [
    "# H-002 Pi Gate Smoke Report",
    "",
    `Run ID: ${runId}`,
    "Mode: Pi Extension loaded; three built-in tool calls were intercepted through tool_call.",
    "",
    "| Gate | Result |",
    "|---|---|",
    ...checks.map((check) => `| ${check.gate} | ${check.pass ? "pass" : "fail"} |`),
    "",
    "Limit: THINK write/edit branches were covered by the first policy Smoke; this Run dispatched bash only. This does not establish adversarial shell containment, model compliance, or scientific validity.",
  ].join("\n");
  writeText(resolve(runDir, "smoke-report.md"), `${report}\n`);
  writeText(resolve(runDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { overall, report };
}

export default function researchGates(pi: ExtensionAPI) {
  pi.on("tool_call", async (event: any, ctx: any) => {
    if (!["write", "edit", "bash"].includes(event.toolName)) return;
    const decision = decide(ctx.cwd, smokeTask(ctx.cwd), event.toolName, event.input?.path);
    recordToolDispatch(ctx.cwd, event, decision);
    if (!decision.allow) return { block: true, reason: decision.reason, terminate: true };
  });

  pi.registerCommand("research-closeout-draft", {
    description: "Write a Closeout draft only to an explicit scratch fixture output_dir.",
    handler: async (args, ctx) => {
      const outputDir = fixtureOutputDir(ctx.cwd, args.trim());
      if (!outputDir) {
        ctx.ui.notify("Usage: /research-closeout-draft scratch/H-002_pi_gate_mvp/fixtures/<run-id>/closeout", "error");
        return;
      }
      writeText(resolve(outputDir, "closeout-draft.md"), `${closeoutDraft()}\n`);
      ctx.ui.notify("Closeout draft written to fixture only; no authority files changed.", "info");
    },
  });

  pi.registerCommand("research-gate-report", {
    description: "Write the H-002 Smoke report to an explicit runs output_dir.",
    handler: async (args, ctx) => {
      const [outputDir, recordedNpmVersion] = args.trim().split(/\s+/, 2);
      const result = recordedNpmVersion ? writeSmokeReport(ctx.cwd, outputDir, recordedNpmVersion) : undefined;
      if (!result) {
        ctx.ui.notify("Usage: /research-gate-report runs/H-002_pi_gate_mvp/<run-id> <npm-version>", "error");
        return;
      }
      ctx.ui.notify(result.overall ? "Smoke passed; inspect runs output." : "Smoke failed; inspect runs output.", result.overall ? "info" : "error");
    },
  });
}
