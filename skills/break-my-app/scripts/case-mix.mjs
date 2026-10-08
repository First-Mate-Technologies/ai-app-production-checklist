#!/usr/bin/env node
// Counts cases in qa/TEST_CASES.md and reports the mix. No dependencies, reads one file.
//   node case-mix.mjs [qa/TEST_CASES.md] [--requirements qa/REQUIREMENTS.md] [--json]
// Exit 0 when the file is well formed, 1 when there are warnings, 2 on usage error.
import { readFileSync } from "node:fs";

const TYPES = ["happy", "edge", "negative", "boundary", "security", "concurrency", "timezone", "role"];
const HAPPY_LIMIT = 0.15;

const args = process.argv.slice(2);
let casesPath = "qa/TEST_CASES.md";
let reqPath = null;
let json = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--json") json = true;
  else if (args[i] === "--requirements") reqPath = args[++i];
  else if (args[i] === "-h" || args[i] === "--help") {
    console.log("usage: case-mix.mjs [TEST_CASES.md] [--requirements REQUIREMENTS.md] [--json]");
    process.exit(0);
  } else if (args[i].startsWith("-")) {
    console.error(`Unknown option: ${args[i]}`);
    process.exit(2);
  } else casesPath = args[i];
}
if (!reqPath) {
  const guess = casesPath.replace(/TEST_CASES\.md$/, "REQUIREMENTS.md");
  if (guess !== casesPath) { try { readFileSync(guess, "utf8"); reqPath = guess; } catch { /* optional */ } }
}

let text;
try { text = readFileSync(casesPath, "utf8"); } catch (e) {
  console.error(`Cannot read ${casesPath}: ${e.code || e.message}`);
  process.exit(2);
}

// Case heading: "### B-013: title", "### B-013 - title" or with an em dash.
const heading = /^###\s+([A-Z]{1,3}-\d{1,4})\b\s*[:\-–—]?\s*(.*)$/;
const cases = [];
let cur = null;
for (const line of text.split("\n")) {
  const h = line.match(heading);
  if (h) {
    cur = { id: h[1], title: h[2].trim(), type: null, priority: null, traces: [] };
    cases.push(cur);
    continue;
  }
  if (!cur) continue;
  let m;
  if ((m = line.match(/^\s*[-*]\s*\*\*Type:\*\*\s*(.+)$/i))) cur.type = m[1].trim().toLowerCase().replace(/[`.]/g, "");
  else if ((m = line.match(/^\s*[-*]\s*\*\*Priority:\*\*\s*(.+)$/i))) cur.priority = m[1].trim().toUpperCase().slice(0, 2);
  else if ((m = line.match(/^\s*[-*]\s*\*\*Traces to:\*\*\s*(.+)$/i))) cur.traces = m[1].match(/R-\d+/gi)?.map((s) => s.toUpperCase()) ?? [];
}

const warnings = [];
const byType = Object.fromEntries(TYPES.map((t) => [t, 0]));
const byPriority = {};
const seen = new Set();
const traced = new Map();
for (const c of cases) {
  if (seen.has(c.id)) warnings.push(`Duplicate case ID ${c.id}`);
  seen.add(c.id);
  if (!c.type || !(c.type in byType)) warnings.push(`${c.id}: type "${c.type ?? ""}" is missing or not one of ${TYPES.join(", ")}`);
  else byType[c.type]++;
  if (!/^P[0-2]$/.test(c.priority ?? "")) warnings.push(`${c.id}: priority missing or not P0-P2`);
  else byPriority[c.priority] = (byPriority[c.priority] ?? 0) + 1;
  if (!c.traces.length) warnings.push(`${c.id}: no "Traces to" requirement`);
  for (const r of c.traces) {
    if (!traced.has(r)) traced.set(r, []);
    traced.get(r).push(c);
  }
}

const total = cases.length;
if (total === 0) warnings.push("No cases found. Expected headings like '### A-001: title'.");
const happy = byType.happy;
const share = total ? happy / total : 0;
if (share > HAPPY_LIMIT) warnings.push(`Happy path is ${(share * 100).toFixed(0)}% of cases, above the ${HAPPY_LIMIT * 100}% target. Add edge, negative, boundary, security and concurrency cases.`);

let requirements = [];
if (reqPath) {
  try {
    const req = readFileSync(reqPath, "utf8");
    requirements = [...new Set((req.match(/^\s*[-*]?\s*(R-\d+)\b/gm) ?? []).map((s) => s.match(/R-\d+/)[0]))];
  } catch { warnings.push(`Could not read requirements file ${reqPath}`); }
  for (const r of requirements) {
    const list = traced.get(r) ?? [];
    if (!list.length) warnings.push(`${r} has no cases`);
    else if (list.every((c) => c.type === "happy")) warnings.push(`${r} has only happy-path cases`);
  }
  for (const r of traced.keys()) if (!requirements.includes(r)) warnings.push(`Cases trace to ${r}, which is not in ${reqPath}`);
}

const result = { file: casesPath, total, happy, happyShare: Number(share.toFixed(3)), byType, byPriority, requirements: requirements.length, warnings };
if (json) console.log(JSON.stringify(result, null, 2));
else {
  console.log(`${total} cases in ${casesPath}`);
  console.log(`${happy} of ${total} happy path (${(share * 100).toFixed(0)}%), ${total - happy} edge/negative/boundary/security/concurrency/timezone/role`);
  console.log("By type: " + TYPES.map((t) => `${t} ${byType[t]}`).join(", "));
  console.log("By priority: " + (Object.keys(byPriority).sort().map((p) => `${p} ${byPriority[p]}`).join(", ") || "none"));
  if (requirements.length) console.log(`Requirements: ${requirements.length}`);
  for (const w of warnings) console.log(`WARNING: ${w}`);
}
process.exit(warnings.length ? 1 : 0);
