#!/usr/bin/env node
import fs from "node:fs";
import { scanProject } from "./lib/scan.mjs";
import { formatText, formatJson } from "./lib/report.mjs";

const HELP = `ai-app-scan: look for launch blockers in a local project. No network, no secret values printed.

Usage:
  ai-app-scan [directory] [--json]

Options:
  --json       machine-readable output
  -h, --help   show this help
  -v, --version

Exit code: 1 if there is any HIGH finding, 2 on a usage error, otherwise 0.
`;

function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("-")));
  const positional = args.filter((a) => !a.startsWith("-"));
  const known = new Set(["--json", "-h", "--help", "-v", "--version"]);

  const unknown = [...flags].find((f) => !known.has(f));
  if (unknown || positional.length > 1) {
    process.stderr.write(`${unknown ? `Unknown option: ${unknown}\n` : "Too many arguments.\n"}\n${HELP}`);
    process.exitCode = 2;
    return;
  }
  if (flags.has("-h") || flags.has("--help")) {
    process.stdout.write(HELP);
    return;
  }
  if (flags.has("-v") || flags.has("--version")) {
    const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    process.stdout.write(`${pkg.version}\n`);
    return;
  }

  let result;
  try {
    result = scanProject(positional[0] ?? ".");
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 2;
    return;
  }

  process.stdout.write(flags.has("--json") ? formatJson(result) : formatText(result));
  process.exitCode = result.summary.high > 0 ? 1 : 0;
}

main();
