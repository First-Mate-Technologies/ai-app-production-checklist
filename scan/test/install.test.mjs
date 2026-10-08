import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpDir, cleanup } from "./helpers.mjs";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "install-skill.sh");
const skip = process.platform === "win32";

function install(args, home, cwd) {
  return spawnSync("bash", [SCRIPT, ...args], { encoding: "utf8", env: { ...process.env, HOME: home }, cwd });
}

test("install-skill.sh installs a self-contained production-readiness skill for Claude Code", { skip }, () => {
  const home = tmpDir("home-");
  const cwd = tmpDir("cwd-");
  try {
    const r = install(["claude", "--skill", "production-readiness"], home, cwd);
    assert.equal(r.status, 0, r.stderr);
    const dest = path.join(home, ".claude/skills/production-readiness");
    for (const f of ["SKILL.md", "references/CHECKLIST.md", "references/supabase-rls-audit.sql", "scripts/scan/cli.mjs"]) {
      assert.ok(fs.existsSync(path.join(dest, f)), f);
    }
    const v = spawnSync(process.execPath, [path.join(dest, "scripts/scan/cli.mjs"), "--version"], { encoding: "utf8" });
    assert.match(v.stdout, /^\d+\.\d+\.\d+/);
    assert.deepEqual(fs.readdirSync(cwd), []);
  } finally {
    cleanup(home);
    cleanup(cwd);
  }
});

test("install-skill.sh refuses to overwrite without --force", { skip }, () => {
  const home = tmpDir("home-");
  const cwd = tmpDir("cwd-");
  try {
    assert.equal(install(["claude"], home, cwd).status, 0);
    const again = install(["claude"], home, cwd);
    assert.equal(again.status, 1);
    assert.match(again.stderr, /--force/);
    assert.equal(install(["claude", "--force"], home, cwd).status, 0);
  } finally {
    cleanup(home);
    cleanup(cwd);
  }
});

test("install-skill.sh --project writes into the current folder for Codex", { skip }, () => {
  const home = tmpDir("home-");
  const cwd = tmpDir("cwd-");
  try {
    assert.equal(install(["codex", "--project"], home, cwd).status, 0);
    assert.ok(fs.existsSync(path.join(cwd, ".agents/skills/production-readiness/SKILL.md")));
    assert.deepEqual(fs.readdirSync(home), []);
  } finally {
    cleanup(home);
    cleanup(cwd);
  }
});

test("install-skill.sh rejects an unknown target", { skip }, () => {
  const home = tmpDir("home-");
  try {
    assert.equal(install(["vim"], home, home).status, 2);
  } finally {
    cleanup(home);
  }
});

test("install-skill.sh installs both skills by default", { skip }, () => {
  const home = tmpDir("home-");
  const cwd = tmpDir("cwd-");
  try {
    const r = install(["claude"], home, cwd);
    assert.equal(r.status, 0, r.stderr);
    for (const f of [
      "production-readiness/SKILL.md",
      "production-readiness/scripts/scan/cli.mjs",
      "break-my-app/SKILL.md",
      "break-my-app/references/templates.md",
      "break-my-app/references/attack-angles.md",
      "break-my-app/references/independence.md",
      "break-my-app/references/execution.md",
      "break-my-app/scripts/case-mix.mjs",
    ]) assert.ok(fs.existsSync(path.join(home, ".claude/skills", f)), f);
    // The installed helper runs standalone.
    const h = spawnSync(process.execPath, [path.join(home, ".claude/skills/break-my-app/scripts/case-mix.mjs"), "--help"], { encoding: "utf8" });
    assert.equal(h.status, 0, h.stderr);
  } finally {
    cleanup(home);
    cleanup(cwd);
  }
});

test("install-skill.sh --skill break-my-app installs only that skill", { skip }, () => {
  const home = tmpDir("home-");
  const cwd = tmpDir("cwd-");
  try {
    assert.equal(install(["codex", "--skill", "break-my-app"], home, cwd).status, 0);
    assert.ok(fs.existsSync(path.join(home, ".agents/skills/break-my-app/SKILL.md")));
    assert.ok(!fs.existsSync(path.join(home, ".agents/skills/production-readiness")));
    assert.equal(install(["codex", "--skill=break-my-app"], home, cwd).status, 1);
  } finally {
    cleanup(home);
    cleanup(cwd);
  }
});

test("install-skill.sh rejects an unknown skill and a missing --skill value", { skip }, () => {
  const home = tmpDir("home-");
  try {
    assert.equal(install(["claude", "--skill", "nope"], home, home).status, 2);
    assert.equal(install(["claude", "--skill"], home, home).status, 2);
    assert.deepEqual(fs.readdirSync(home), []);
  } finally {
    cleanup(home);
  }
});

test("install-skill.sh leaves nothing half installed when one skill already exists", { skip }, () => {
  const home = tmpDir("home-");
  try {
    assert.equal(install(["claude", "--skill", "production-readiness"], home, home).status, 0);
    const r = install(["claude"], home, home);
    assert.equal(r.status, 1);
    assert.ok(!fs.existsSync(path.join(home, ".claude/skills/break-my-app")));
    assert.equal(install(["claude", "--force"], home, home).status, 0);
    assert.ok(fs.existsSync(path.join(home, ".claude/skills/break-my-app/SKILL.md")));
  } finally {
    cleanup(home);
  }
});
