import fs from "node:fs";
import path from "node:path";

export const MAX_BYTES = 1024 * 1024; // files larger than 1 MB are skipped

// Dependency and build output. Skipped entirely.
export const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  // Agent skill installs (project-level) bundle copies of scanner code, docs and checklists.
  ".claude",
  ".agents",
  ".next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".vercel",
  ".netlify",
  ".turbo",
  ".expo",
  ".cache",
  ".parcel-cache",
  "dist",
  "build",
  "out",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
]);

// Lockfiles are large, generated and never the place a secret was typed.
const SKIP_FILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "bun.lock",
  ".DS_Store",
]);

/**
 * Walks `root` and returns the files worth reading.
 * Symlinks are not followed. Directories that cannot be read are recorded
 * in `unreadable` instead of throwing.
 */
export function walk(root) {
  const files = [];
  const skippedLarge = [];
  const unreadable = [];

  function visit(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      unreadable.push(toRel(root, dir) || ".");
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        visit(abs);
      } else if (entry.isFile()) {
        if (SKIP_FILES.has(entry.name)) continue;
        let size;
        try {
          size = fs.statSync(abs).size;
        } catch {
          unreadable.push(toRel(root, abs));
          continue;
        }
        if (size > MAX_BYTES) {
          skippedLarge.push(toRel(root, abs));
          continue;
        }
        files.push({ abs, rel: toRel(root, abs) });
      } else {
        // Sockets, FIFOs, devices: never opened, but counted so the totals are honest.
        unreadable.push(toRel(root, abs));
      }
    }
  }

  visit(root);
  return { files, skippedLarge, unreadable };
}

function toRel(root, abs) {
  return path.relative(root, abs).split(path.sep).join("/");
}
