import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const skillsDir = fileURLToPath(new URL("../../skills/", import.meta.url));
const names = readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

test("the kit ships both skills", () => {
  assert.deepEqual(names.sort(), ["break-my-app", "production-readiness"]);
});

// Agents and GitHub parse the frontmatter as YAML. A plain scalar containing
// ": " is a parse error, so the description must be a block or quoted scalar.
for (const name of names) {
  test(`${name}: SKILL.md frontmatter is valid for YAML loaders`, () => {
    const text = readFileSync(path.join(skillsDir, name, "SKILL.md"), "utf8");
    const match = text.match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(match, "frontmatter block missing");
    const lines = match[1].split("\n");
    assert.equal(lines[0], `name: ${name}`);
    const desc = lines.find((l) => l.startsWith("description:"));
    assert.ok(desc, "description missing");
    const value = desc.slice("description:".length).trim();
    assert.match(value, /^>-$/, "description must be a >- block scalar");
    for (const line of lines.slice(1)) {
      if (!line.startsWith("description:") && !line.startsWith("  ")) assert.match(line, /^[a-z-]+: /);
    }
    const keys = lines.filter((l) => /^[a-z-]+:/.test(l)).map((l) => l.split(":")[0]);
    assert.deepEqual(keys, ["name", "description"]);
    assert.ok(match[1].length < 1500, "frontmatter too long");
  });

  test(`${name}: SKILL.md has no em dashes and stays concise`, () => {
    const dir = path.join(skillsDir, name);
    const files = ["SKILL.md", ...readdirSync(path.join(dir, "references")).map((f) => `references/${f}`)];
    for (const f of files) {
      const t = readFileSync(path.join(dir, f), "utf8");
      assert.ok(!t.includes("—"), `${f} contains an em dash`);
    }
    const lines = readFileSync(path.join(dir, "SKILL.md"), "utf8").split("\n").length;
    assert.ok(lines < 120, `SKILL.md is ${lines} lines; move detail into references/`);
  });

  test(`${name}: every references/ file named in SKILL.md exists`, () => {
    const dir = path.join(skillsDir, name);
    const text = readFileSync(path.join(dir, "SKILL.md"), "utf8");
    for (const ref of text.match(/references\/[\w.-]+\.\w+/g) ?? []) {
      // CHECKLIST.md and the SQL file are copied in by the installer.
      if (["references/CHECKLIST.md", "references/supabase-rls-audit.sql"].includes(ref)) continue;
      assert.ok(existsSync(path.join(dir, ref)), ref);
    }
  });
}

test("break-my-app ends with the exact soft CTA", () => {
  const t = readFileSync(path.join(skillsDir, "break-my-app/SKILL.md"), "utf8");
  assert.ok(t.includes("https://www.firstmate.tech/vibe-code-rescue?utm_source=skill&utm_medium=referral&utm_campaign=break-my-app"));
  assert.ok(!/restaurants (already )?(use|run)/i.test(t));
});
