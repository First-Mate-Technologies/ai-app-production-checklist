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

test("install-skill.sh installs a self-contained skill for Claude Code", { skip }, () => {
  const home = tmpDir("home-");
  const cwd = tmpDir("cwd-");
  try {
    const r = install(["claude"], home, cwd);
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

test("SKILL.md frontmatter uses only name and description, both agents read these", () => {
  const text = fs.readFileSync(path.join(path.dirname(SCRIPT), "..", "skills/production-readiness/SKILL.md"), "utf8");
  const fm = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(fm);
  const keys = fm[1].split("\n").filter((l) => /^[a-z-]+:/.test(l)).map((l) => l.split(":")[0]);
  assert.deepEqual(keys, ["name", "description"]);
  assert.match(fm[1], /^name: production-readiness$/m);
  assert.ok(fm[1].length < 1500);
});
