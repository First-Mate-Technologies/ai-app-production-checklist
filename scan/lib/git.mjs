import { execFileSync } from "node:child_process";

// The scanned project is untrusted input. Git config inside it can name programs
// (core.fsmonitor, hooks), so every call switches those off and ignores the
// system config. Read-only commands only.
const SAFE_CONFIG = [
  "-c", "core.fsmonitor=false",
  "-c", "core.useBuiltinFSMonitor=false",
  "-c", "core.hooksPath=/dev/null",
];

function gitEnv() {
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_CONFIG_NOSYSTEM: "1", LC_ALL: "C" };
  // A caller (a git hook, for example) may have pointed git somewhere else.
  for (const k of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_CEILING_DIRECTORIES"]) {
    delete env[k];
  }
  return env;
}

export class GitError extends Error {
  /** @param {string} reason @param {{notRepo?: boolean, status?: number|null}} [info] */
  constructor(reason, info = {}) {
    super(reason);
    this.reason = reason;
    this.notRepo = Boolean(info.notRepo);
    this.status = info.status ?? null;
  }
}

function describe(err) {
  const stderr = err.stderr ? err.stderr.toString("utf8") : "";
  if (err.code === "ENOENT") return new GitError("git is not installed or not on PATH");
  if (err.code === "ENOBUFS" || err.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
    return new GitError("git output was too large to read");
  }
  if (err.code === "ETIMEDOUT" || err.signal === "SIGTERM") return new GitError("git took too long");
  if (/not a git repository/i.test(stderr)) return new GitError("not a git repository", { notRepo: true });
  if (/dubious ownership/i.test(stderr)) {
    return new GitError("git refused to open the repository because of who owns the folder (dubious ownership)");
  }
  return new GitError(`git exited with status ${err.status ?? "unknown"}`, { status: err.status });
}

function git(root, args) {
  try {
    return execFileSync("git", ["-C", root, ...SAFE_CONFIG, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
      timeout: 15000,
      env: gitEnv(),
    });
  } catch (err) {
    throw describe(err);
  }
}

/**
 * Returns the set of tracked files (relative to `root`, posix) when `root` is inside a
 * git work tree, or null when it is not a repository. Throws GitError for any other
 * failure, so the caller can say why it could not look.
 */
export function trackedFiles(root) {
  try {
    const inside = git(root, ["rev-parse", "--is-inside-work-tree"]).toString().trim();
    if (inside !== "true") return null;
  } catch (err) {
    if (err instanceof GitError && err.notRepo) return null;
    throw err;
  }
  const out = git(root, ["ls-files", "-z", "--", "."]).toString("utf8");
  return new Set(out.split("\0").filter(Boolean));
}

/**
 * True if the .gitignore rules cover `rel`, whether or not the file is tracked
 * (--no-index), so a tracked .env that is also ignored counts as ignored.
 */
export function isIgnored(root, rel) {
  try {
    git(root, ["check-ignore", "--no-index", "-q", "--", rel]);
    return true;
  } catch (err) {
    if (err instanceof GitError && err.status === 1) return false;
    throw err;
  }
}
