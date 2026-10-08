import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fill, FAKES, FAKE_SECRETS } from "./fake-secrets.mjs";

export { FAKES, FAKE_SECRETS, fill };

const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES = path.join(here, "fixtures");
export const CLI = path.join(here, "..", "cli.mjs");


/** Makes an empty temp directory outside any git repo. Caller removes it. */
export function tmpDir(prefix = "ai-app-scan-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Copies a fixture into a temp directory so the repo's own git state cannot affect the result. */
export function copyFixture(name) {
  const dest = tmpDir(`fixture-${name}-`);
  fs.cpSync(path.join(FIXTURES, name), dest, { recursive: true });
  fillTokens(dest);
  return dest;
}

/** Swaps the __NAME__ tokens in fixture files for runtime-built fake secrets. */
function fillTokens(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const abs = path.join(entry.parentPath, entry.name);
    const text = fs.readFileSync(abs, "utf8");
    const filled = fill(text);
    if (filled !== text) fs.writeFileSync(abs, filled);
  }
}

export function write(dir, rel, content) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

/** Makes a temp project from a { relPath: content } map, runs fn(dir), then removes it. */
export function withProject(files, fn) {
  const dir = tmpDir();
  try {
    for (const [rel, content] of Object.entries(files)) write(dir, rel, content);
    return fn(dir);
  } finally {
    cleanup(dir);
  }
}

export function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

export function runCli(args, env) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", ...(env ? { env } : {}) });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

export function hasGit() {
  return spawnSync("git", ["--version"]).status === 0;
}

export function rules(result) {
  return result.findings.map((f) => f.rule);
}

export function find(result, rule) {
  return result.findings.filter((f) => f.rule === rule);
}
