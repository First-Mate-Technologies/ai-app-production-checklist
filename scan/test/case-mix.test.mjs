import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpDir, cleanup } from "./helpers.mjs";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "skills/break-my-app/scripts/case-mix.mjs");
const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });

const c = (id, type, trace = "R-01", pri = "P1") =>
  `### ${id}: title\n- **Priority:** ${pri}\n- **Type:** ${type}\n- **Traces to:** ${trace}\n- **Steps:** x\n- **Expected:** y\n\n`;

function withFiles(cases, reqs) {
  const dir = tmpDir("qa-");
  fs.writeFileSync(path.join(dir, "TEST_CASES.md"), cases);
  if (reqs !== undefined) fs.writeFileSync(path.join(dir, "REQUIREMENTS.md"), reqs);
  return dir;
}

test("case-mix reports counts and mix for a healthy catalogue", () => {
  const dir = withFiles(
    c("A-001", "happy") + c("A-002", "negative") + c("A-003", "boundary") + c("A-004", "security", "R-02") +
      c("A-005", "concurrency") + c("A-006", "timezone") + c("A-007", "role", "R-02") + c("A-008", "edge", "R-02") +
      c("A-009", "edge") + c("A-010", "negative", "R-02"),
    "- R-01 one\n- R-02 two\n",
  );
  try {
    const r = run([path.join(dir, "TEST_CASES.md"), "--json"]);
    assert.equal(r.status, 0, r.stdout);
    const j = JSON.parse(r.stdout);
    assert.equal(j.total, 10);
    assert.equal(j.happy, 1);
    assert.equal(j.byType.negative, 2);
    assert.equal(j.requirements, 2);
    const text = run([path.join(dir, "TEST_CASES.md")]);
    assert.match(text.stdout, /1 of 10 happy path \(10%\)/);
  } finally { cleanup(dir); }
});

test("case-mix warns when happy path is too large", () => {
  const dir = withFiles(c("A-001", "happy") + c("A-002", "happy") + c("A-003", "edge"));
  try {
    const r = run([path.join(dir, "TEST_CASES.md")]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /above the 15% target/);
  } finally { cleanup(dir); }
});

test("case-mix warns on bad type, bad priority, missing trace, duplicate id, uncovered requirement", () => {
  const dir = withFiles(
    c("A-001", "wacky") + c("A-002", "edge", "R-01", "P9") + "### A-003: no trace\n- **Priority:** P1\n- **Type:** edge\n\n" + c("A-003", "edge") + c("A-004", "happy", "R-03"),
    "- R-01 a\n- R-02 b\n- R-03 c\n",
  );
  try {
    const out = run([path.join(dir, "TEST_CASES.md")]).stdout;
    assert.match(out, /A-001: type "wacky"/);
    assert.match(out, /A-002: priority/);
    assert.match(out, /A-003: no "Traces to"/);
    assert.match(out, /Duplicate case ID A-003/);
    assert.match(out, /R-02 has no cases/);
    assert.match(out, /R-03 has only happy-path cases/);
  } finally { cleanup(dir); }
});

test("case-mix accepts em dash and hyphen headings and handles an empty or missing file", () => {
  const dir = withFiles("### B-001 — dash\n- **Priority:** P0\n- **Type:** edge\n- **Traces to:** R-01\n### B-002 - hyphen\n- **Priority:** P0\n- **Type:** Edge\n- **Traces to:** R-01\n");
  try {
    const j = JSON.parse(run([path.join(dir, "TEST_CASES.md"), "--json"]).stdout);
    assert.equal(j.total, 2);
    assert.equal(j.byType.edge, 2);
    fs.writeFileSync(path.join(dir, "TEST_CASES.md"), "");
    const e = run([path.join(dir, "TEST_CASES.md")]);
    assert.equal(e.status, 1);
    assert.match(e.stdout, /No cases found/);
    assert.equal(run([path.join(dir, "missing.md")]).status, 2);
    assert.equal(run(["--bogus"]).status, 2);
  } finally { cleanup(dir); }
});

const withDesigned = (line) => {
  const dir = withFiles(`Designed by: ${line}\n\n` + c("A-001", "edge") + c("A-002", "negative") + c("A-003", "security"));
  return { dir, out: run([path.join(dir, "TEST_CASES.md")]) };
};

test("case-mix warns when 'different model' names equal or unknown models", () => {
  for (const [line, re] of [
    ["designer: gpt-5.6-sol, builder: gpt-5.6-sol. Independence: different model + fresh context.", /both "gpt-5.6-sol"/],
    ["designer: gpt-5.6-sol, builder: unknown. Independence: different model + fresh context.", /unknown or generic/],
    ["gpt-5.6-sol. Independence: different model + fresh context.", /does not name both models/],
  ]) {
    const { dir, out } = withDesigned(line);
    try { assert.equal(out.status, 1, line); assert.match(out.stdout, re); } finally { cleanup(dir); }
  }
});

test("case-mix accepts honest independence lines", () => {
  for (const line of [
    "designer: sonnet, builder: opus. Independence: different model + fresh context.",
    "designer: gpt-5.6-sol, builder: gpt-5.6-sol. Independence: fresh context only.",
  ]) {
    const { dir, out } = withDesigned(line);
    try { assert.equal(out.status, 0, out.stdout); } finally { cleanup(dir); }
  }
});
