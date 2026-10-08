import fs from "node:fs";
import path from "node:path";
import { walk } from "./walk.mjs";
import { scanFile, isEnvFile, isEnvExample, isLowRiskEnv, secretKinds } from "./detectors.mjs";
import { isIgnoredByGitignore } from "./gitignore.mjs";
import { trackedFiles, isIgnored, GitError } from "./git.mjs";

/** .env.test and .env.ci are MEDIUM unless they hold a secret-shaped value; everything else is HIGH. */
function envSeverity(rel, envHasSecret) {
  return isLowRiskEnv(rel) && envHasSecret.get(rel) !== true ? "MEDIUM" : "HIGH";
}

const SEVERITY_RANK = { HIGH: 0, MEDIUM: 1, LOW: 2 };

/** Is `rel` covered by .gitignore? Asks git inside a repository, parses .gitignore files otherwise. */
function covered(root, rel, useGit) {
  if (useGit) {
    try {
      return isIgnored(root, rel);
    } catch {
      // fall through to the pattern matcher
    }
  }
  return isIgnoredByGitignore(root, rel);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Scans a local project directory. No network access. Never returns full secret values.
 * @param {string} rootArg
 */
export function scanProject(rootArg = ".") {
  const root = path.resolve(rootArg);
  let st;
  try {
    st = fs.statSync(root);
  } catch {
    throw new Error(`Cannot read directory: ${rootArg}`);
  }
  if (!st.isDirectory()) throw new Error(`Not a directory: ${rootArg}`);

  const notes = [];
  const findings = [];
  const pkg = readJson(path.join(root, "package.json"));
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const spaProject = ["vite", "react-scripts", "expo"].some((d) => d in deps);
  const nextProject = "next" in deps;

  const { files, skippedLarge, unreadable } = walk(root);
  const skippedBinary = [];
  let scanned = 0;
  let anyVerify = false;
  const webhookCandidates = [];
  const envFilesOnDisk = [];
  const envHasSecret = new Map();
  const envKinds = new Map();

  for (const f of files) {
    const realEnv = isEnvFile(f.rel) && !isEnvExample(f.rel);
    if (realEnv) envFilesOnDisk.push(f.rel);
    let buf;
    try {
      buf = fs.readFileSync(f.abs);
    } catch {
      unreadable.push(f.rel);
      continue;
    }
    if (buf.subarray(0, 8000).includes(0)) {
      skippedBinary.push(f.rel);
      continue;
    }
    scanned++;
    const text = buf.toString("utf8");
    if (realEnv) {
      const kinds = secretKinds(text);
      envHasSecret.set(f.rel, kinds.length > 0);
      envKinds.set(f.rel, kinds);
    }
    const result = scanFile({ rel: f.rel, text, spaProject, nextProject });
    findings.push(...result.findings);
    if (result.verifies) anyVerify = true;
    if (result.webhook) webhookCandidates.push({ rel: f.rel, ...result.webhook });
  }

  // Stripe webhook handlers that never verify the signature.
  for (const w of webhookCandidates) {
    findings.push({
      rule: "stripe-webhook-unverified",
      severity: anyVerify ? "MEDIUM" : "HIGH",
      file: w.rel,
      line: w.line,
      message: anyVerify
        ? "This looks like a Stripe webhook handler and it does not call constructEvent. Another file in the project does, so check it is verified through a helper."
        : "This looks like a Stripe webhook handler and nothing in the project calls constructEvent. Anyone can post a fake payment event.",
      fix: "Read the raw request body and verify it with stripe.webhooks.constructEvent and your endpoint secret before trusting the event.",
    });
  }

  // .env files tracked by git.
  let tracked = null;
  let gitFailed = false;
  try {
    tracked = trackedFiles(root);
  } catch (err) {
    gitFailed = true;
    const reason = err instanceof GitError ? err.reason : "unexpected git failure";
    notes.push(`could not read git state: ${reason}. Skipped the committed .env check.`);
  }
  if (tracked) {
    for (const rel of [...tracked].sort()) {
      if (isEnvFile(rel) && !isEnvExample(rel)) {
        findings.push({
          rule: "committed-env-file",
          severity: envSeverity(rel, envHasSecret),
          file: rel,
          line: null,
          message:
            "This env file is tracked by git, so its secrets are in the repository history." +
            ((envKinds.get(rel) ?? []).length ? ` It contains: ${envKinds.get(rel).join(", ")}.` : ""),
          fix: "Run git rm --cached on it, add it to .gitignore, and rotate every secret it contained. Removing the file does not remove it from history.",
        });
      }
    }
  } else if (!gitFailed) {
    notes.push("Not a git repository: skipped the committed .env check.");
  }

  // Env files that no .gitignore rule covers. --no-index means a tracked .env that is also
  // ignored is reported once (committed-env-file), not twice.
  const looksLikeProject = pkg !== null || tracked !== null || envFilesOnDisk.length > 0;
  const useGit = tracked !== null;
  if (envFilesOnDisk.length > 0) {
    for (const rel of envFilesOnDisk.sort()) {
      if (covered(root, rel, useGit)) continue;
      findings.push({
        rule: "gitignore-missing-env",
        severity: envSeverity(rel, envHasSecret),
        file: rel,
        line: null,
        message: `${rel} exists and no .gitignore rule ignores it. The next git add . will commit it.`,
        fix: "Add .env and .env.* (with !.env.example if you keep one) to .gitignore.",
      });
    }
  } else if (looksLikeProject && !covered(root, ".env", useGit)) {
    findings.push({
      rule: "gitignore-missing-env",
      severity: "LOW",
      file: ".gitignore",
      line: null,
      message: ".gitignore does not ignore .env. It will bite the first time someone creates one.",
      fix: "Add .env and .env.* (with !.env.example if you keep one) to .gitignore.",
    });
  }

  // Stable, deduplicated output.
  const seen = new Set();
  const unique = findings.filter((f) => {
    const key = `${f.rule}|${f.file}|${f.line}|${f.evidence ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  unique.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.file.localeCompare(b.file) ||
      (a.line ?? 0) - (b.line ?? 0),
  );

  const count = (s) => unique.filter((f) => f.severity === s).length;
  return {
    root,
    summary: {
      high: count("HIGH"),
      medium: count("MEDIUM"),
      low: count("LOW"),
      total: unique.length,
      filesScanned: scanned,
      skippedLarge: skippedLarge.length,
      skippedBinary: skippedBinary.length,
      unreadable: unreadable.length,
    },
    findings: unique,
    notes,
  };
}
