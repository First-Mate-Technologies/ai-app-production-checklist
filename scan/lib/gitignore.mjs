import fs from "node:fs";
import path from "node:path";

// A small .gitignore matcher for projects that are not git repositories (inside a repo
// the scanner asks git itself). It handles comments, negation, anchoring, directory-only
// rules and * ? ** globs, which covers what .env rules use in practice.

function globToRegex(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        const slashAfter = glob[i + 2] === "/";
        i += slashAfter ? 2 : 1;
        out += slashAfter ? "(?:.*/)?" : ".*";
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else if (c === "\\" && i + 1 < glob.length) {
      out += glob[++i].replace(/[.+^${}()|[\]\\]/g, "\\$&");
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return out;
}

export function parseGitignore(text) {
  const rules = [];
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.replace(/(?<!\\)\s+$/, "");
    if (line === "" || line.startsWith("#")) continue;
    let negate = false;
    if (line.startsWith("!")) {
      negate = true;
      line = line.slice(1);
    }
    const dirOnly = line.endsWith("/");
    if (dirOnly) line = line.slice(0, -1);
    if (line === "") continue;
    const anchored = line.includes("/");
    if (line.startsWith("/")) line = line.slice(1);
    const body = globToRegex(line);
    const regex = new RegExp(anchored ? `^${body}$` : `^(?:.*/)?${body}$`);
    rules.push({ negate, dirOnly, regex });
  }
  return rules;
}

/** true = ignored, false = explicitly re-included, null = no rule matched. */
function decide(rules, rel, isDir) {
  let result = null;
  for (const r of rules) {
    if (r.dirOnly && !isDir) continue;
    if (r.regex.test(rel)) result = !r.negate;
  }
  return result;
}

/**
 * Is `rel` (posix, relative to `root`) ignored by the .gitignore files between root and
 * the file's folder? Folders are checked first: a file inside an ignored folder is ignored.
 */
export function isIgnoredByGitignore(root, rel) {
  const segs = rel.split("/");
  const cache = new Map();
  const rulesFor = (dirRel) => {
    if (!cache.has(dirRel)) {
      let rules = [];
      try {
        rules = parseGitignore(fs.readFileSync(path.join(root, dirRel, ".gitignore"), "utf8"));
      } catch {
        // no .gitignore in this folder
      }
      cache.set(dirRel, rules);
    }
    return cache.get(dirRel);
  };

  for (let end = 1; end <= segs.length; end++) {
    const isDir = end < segs.length;
    let state = null;
    for (let d = 0; d < end; d++) {
      const dirRel = segs.slice(0, d).join("/");
      const sub = segs.slice(d, end).join("/");
      const verdict = decide(rulesFor(dirRel), sub, isDir);
      if (verdict !== null) state = verdict;
    }
    if (state === true) return true;
  }
  return false;
}
