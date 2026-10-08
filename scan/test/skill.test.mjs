import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const skill = fileURLToPath(new URL("../../skills/production-readiness/SKILL.md", import.meta.url));

// Agents and GitHub parse the frontmatter as YAML. A plain scalar containing
// ": " is a parse error, so the description must be a block or quoted scalar.
test("SKILL.md frontmatter is valid for YAML loaders", () => {
  const text = readFileSync(skill, "utf8");
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, "frontmatter block missing");
  const lines = match[1].split("\n");
  assert.equal(lines[0], "name: production-readiness");
  const desc = lines.find((l) => l.startsWith("description:"));
  assert.ok(desc, "description missing");
  const value = desc.slice("description:".length).trim();
  if (!/^(>-?|\|-?|".*"|'.*')$/.test(value)) {
    assert.ok(!value.includes(": "), "plain description contains ': '; use a block scalar (>-)");
  }
  for (const line of lines.slice(1)) {
    if (!line.startsWith("description:") && !line.startsWith("  ")) assert.match(line, /^[a-z-]+: /);
  }
});
