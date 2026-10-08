import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { copyFixture, tmpDir, cleanup, runCli, FAKE_SECRETS, FAKES, write } from "./helpers.mjs";

test("empty directory exits 0 with no findings", () => {
  const dir = tmpDir();
  try {
    const r = runCli([dir]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /No findings/);
  } finally {
    cleanup(dir);
  }
});

test("a HIGH finding exits 1", () => {
  const dir = copyFixture("stripe-keys");
  try {
    const r = runCli([dir]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /HIGH \(2\)/);
    assert.match(r.stdout, /src\/lib\/billing\.ts:2/);
    for (const s of FAKE_SECRETS) assert.ok(!r.stdout.includes(s));
  } finally {
    cleanup(dir);
  }
});

test("only MEDIUM findings exit 0", () => {
  const dir = copyFixture("service-role-server");
  try {
    const r = runCli([dir]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /MEDIUM \(1\)/);
  } finally {
    cleanup(dir);
  }
});

test("--json prints the documented shape", () => {
  const dir = copyFixture("stripe-keys");
  try {
    const r = runCli([dir, "--json"]);
    assert.equal(r.code, 1);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(Object.keys(out).sort(), ["findings", "notes", "root", "summary"]);
    assert.deepEqual(Object.keys(out.summary).sort(), [
      "filesScanned", "high", "low", "medium", "skippedBinary", "skippedLarge", "total", "unreadable",
    ]);
    assert.equal(out.summary.total, out.findings.length);
    const f = out.findings[0];
    for (const key of ["rule", "severity", "file", "line", "message", "fix"]) assert.ok(key in f, key);
    assert.ok(["HIGH", "MEDIUM", "LOW"].includes(f.severity));
    for (const s of FAKE_SECRETS) assert.ok(!r.stdout.includes(s));
  } finally {
    cleanup(dir);
  }
});

test("defaults to the current directory", () => {
  // The repo's own scan/ folder is a safe, read-only target for a smoke test.
  const r = runCli(["--json"]);
  assert.ok(r.code === 0 || r.code === 1);
  assert.ok(JSON.parse(r.stdout).root);
});

test("a missing directory exits 2", () => {
  const r = runCli(["/definitely/not/a/real/dir"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /Cannot read directory/);
});

test("an unknown flag exits 2", () => {
  const r = runCli(["--nope"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /Unknown option/);
});

test("--help and --version exit 0", () => {
  assert.equal(runCli(["--help"]).code, 0);
  assert.match(runCli(["--version"]).stdout, /^\d+\.\d+\.\d+/);
});

// ---- git missing or failing ------------------------------------------------

test("git absent from PATH: scan completes with a note and exits 0", () => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, "package.json"), "{}");
    const r = runCli([dir, "--json"], { PATH: "" });
    assert.equal(r.code, 0);
    const out = JSON.parse(r.stdout);
    assert.ok(out.notes.some((n) => /could not read git state: git is not installed/.test(n)), JSON.stringify(out.notes));
  } finally {
    cleanup(dir);
  }
});

test("git failing with dubious ownership is reported honestly, not as 'not a repository'", { skip: process.platform === "win32" }, () => {
  const bin = tmpDir("fakegit-");
  const dir = tmpDir();
  try {
    const script = path.join(bin, "git");
    fs.writeFileSync(script, "#!/bin/sh\necho 'fatal: detected dubious ownership in repository' >&2\nexit 128\n", { mode: 0o755 });
    const r = runCli([dir, "--json"], { PATH: bin });
    assert.equal(r.code, 0);
    const notes = JSON.parse(r.stdout).notes.join("\n");
    assert.match(notes, /could not read git state: .*dubious ownership/);
    assert.doesNotMatch(notes, /Not a git repository/);
  } finally {
    cleanup(bin);
    cleanup(dir);
  }
});

test("--json, text output and stderr never contain a full runtime-built secret", () => {
  const dir = tmpDir();
  try {
    write(dir, "package.json", "{}");
    write(dir, "src/app/page.tsx", `"use client";\nconst a = "${FAKES.JWT_SERVICE_ROLE}";\nconst b = "${FAKES.SK_LIVE}";\nconst c = "${FAKES.WHSEC}";\nconst d = "${FAKES.SB_SECRET}";\n`);
    write(dir, ".env.local", `NEXT_PUBLIC_STRIPE_SECRET_KEY=${FAKES.SK_LIVE}\nVITE_X_PRIVATE_KEY=${FAKES.WHSEC}\n`);
    for (const args of [[dir], [dir, "--json"], [path.join(dir, "package.json")], ["/no/such/dir"]]) {
      const r = runCli(args);
      for (const secret of FAKE_SECRETS) {
        assert.ok(!r.stdout.includes(secret) && !r.stderr.includes(secret), `leaked ${secret.slice(0, 6)}`);
      }
    }
    assert.equal(runCli([path.join(dir, "package.json")]).code, 2);
  } finally {
    cleanup(dir);
  }
});
