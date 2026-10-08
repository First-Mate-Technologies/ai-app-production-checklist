import path from "node:path";
import { mask } from "./mask.mjs";

// ---------------------------------------------------------------------------
// File classification
// ---------------------------------------------------------------------------

const CODE_EXT = new Set([
  ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts",
  ".vue", ".svelte", ".astro", ".html", ".htm",
  ".py", ".rb", ".php", ".go",
]);
const DOC_EXT = new Set([".md", ".mdx", ".txt", ".rst"]);

const ENV_FILE = /^(\.env(\..+)?|.+\.env)$/;
// .env.example, .env.local.example, .env.production.sample, ...
const ENV_EXAMPLE = /^\.env(\..+)?\.(example|sample|template|dist|defaults)$/;
// dotenv-vault files are encrypted, so they are not plaintext secrets.
const ENV_ENCRYPTED = /^\.env\.vault$/;
// Files that usually hold throwaway values for tests and CI.
const ENV_LOW_RISK = /^\.env\.(test|ci)$/;

export function isEnvFile(rel) {
  const base = path.posix.basename(rel);
  return ENV_FILE.test(base) && !ENV_ENCRYPTED.test(base);
}
export function isEnvExample(rel) {
  return ENV_EXAMPLE.test(path.posix.basename(rel));
}
/** .env.test and .env.ci: reported at MEDIUM unless they hold a secret-shaped value. */
export function isLowRiskEnv(rel) {
  return ENV_LOW_RISK.test(path.posix.basename(rel));
}
function isTestFile(rel) {
  return /(^|\/)(__tests__|tests?|e2e)\//.test(rel) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel);
}

// Directories whose contents are treated as running in the browser.
const CLIENT_DIRS = new Set(["app", "pages", "components", "public"]);
// Directories and file names that run on the server even inside the above.
const SERVER_DIRS = new Set([
  "api", "server", "functions", "scripts", "supabase", "prisma",
  "test", "tests", "__tests__", "e2e",
]);

/**
 * Reads the directive prologue: the string statements at the very top of a file,
 * after an optional BOM, whitespace and comments. Returns the directives found.
 */
export function directives(text) {
  const found = new Set();
  let rest = text.replace(/^\uFEFF/, "");
  for (;;) {
    rest = rest.replace(/^(?:\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/)+/, "");
    const m = rest.match(/^(["'])([^"'\n]*)\1\s*;?/);
    if (!m) break;
    found.add(m[2]);
    rest = rest.slice(m[0].length);
  }
  return found;
}

const NEXT_DATA_FUNCTIONS = /\b(getServerSideProps|getStaticProps|getStaticPaths)\b/;
const NEXT_MIXED_DIRS = new Set(["app", "pages", "components"]);

/**
 * Decides whether a file is browser code. Deliberately simple, in this order:
 *  1. `import "server-only"` or a "use server" directive      -> server
 *  2. a "use client" directive                                 -> client
 *  3. path has an api/server/functions/scripts/... directory,
 *     or is route.ts, middleware.ts or *.server.ts             -> server
 *  4. public/ folder                                           -> client
 *  5. Next.js project, file under app/, pages/ or components/:
 *     getServerSideProps and friends -> server, otherwise      -> unknown
 *     (Next runs these on the server unless they say "use client")
 *  6. any folder in the path is app, pages, components or
 *     public (so monorepos like apps/web/src/app work too)     -> client
 *  7. project uses Vite, Create React App or Expo and the
 *     file is under a src/ folder                              -> client
 *  8. anything else                                            -> unknown
 *
 * @param {string} rel
 * @param {string} text
 * @param {{spaProject?: boolean, nextProject?: boolean}} project
 */
export function classify(rel, text, project = {}) {
  const ext = path.posix.extname(rel).toLowerCase();
  const segs = rel.split("/");
  const dirs = segs.slice(0, -1);
  const base = segs[segs.length - 1];
  const underPublic = dirs.includes("public");

  if (!CODE_EXT.has(ext) && !underPublic) return "unknown";

  const prologue = directives(text);
  if (
    /^\s*import\s+["']server-only["']/m.test(text) ||
    prologue.has("use server") ||
    (!prologue.has("use client") && /^\s*["']use server["']/m.test(text.slice(0, 2000)))
  ) {
    return "server";
  }
  if (prologue.has("use client")) return "client";
  if (
    dirs.some((d) => SERVER_DIRS.has(d)) ||
    /^(route|middleware)\.[cm]?[jt]sx?$/.test(base) ||
    /\.server\.[cm]?[jt]sx?$/.test(base)
  ) {
    return "server";
  }
  if (underPublic) return "client";
  if (project.nextProject && dirs.some((d) => NEXT_MIXED_DIRS.has(d))) {
    return NEXT_DATA_FUNCTIONS.test(text) ? "server" : "unknown";
  }
  if (dirs.some((d) => CLIENT_DIRS.has(d))) return "client";
  if (project.spaProject && dirs.includes("src")) return "client";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g;
const STRIPE_KEY = /\b(sk|rk)_(live|test)_[A-Za-z0-9]{16,}/g;
const WEBHOOK_SECRET = /\bwhsec_[A-Za-z0-9]{20,}/g;
// Supabase's newer secret API key. sb_publishable_ is the public key and is deliberately not matched.
// Built from two parts so this file does not itself look like a key to secret scanners.
const SB_SECRET_KEY = new RegExp("\\bsb_" + "secret_[A-Za-z0-9_-]{20,}", "g");
const PUBLIC_NAME = /\b((?:NEXT_PUBLIC_|VITE_|EXPO_PUBLIC_|REACT_APP_)[A-Z0-9_]*)/g;
const SECRET_NAME = /SECRET|SERVICE_ROLE|PRIVATE|SK_LIVE|SK_TEST|STRIPE_SECRET/;
const SERVICE_ROLE_NAME = /\b([A-Z0-9_]*SERVICE_ROLE[A-Z0-9_]*)\b/g;
const PUBLIC_PREFIX = /^(NEXT_PUBLIC_|VITE_|EXPO_PUBLIC_|REACT_APP_)/;

const WEBHOOK_HINT =
  /stripe-signature|checkout\.session\.completed|payment_intent\.succeeded|invoice\.(paid|payment_succeeded|payment_failed)|customer\.subscription\./i;
// constructEvent (Node), construct_event (Python, Ruby), ConstructEvent (Go).
const VERIFY = /construct_?event(async)?\b/i;

/** True for obvious stand-ins: runs of one character, XXX, YOUR..., <...>. */
export function isPlaceholder(value) {
  return /(.)\1{7,}|XXX|xxxx|YOUR|<[^>]*>/.test(value);
}

/** True if the text holds a real-looking secret: a Stripe key, a webhook secret, or a Supabase secret key. */
export function secretKinds(text) {
  const out = [];
  const add = (re, label, kindOf) => {
    for (const m of text.matchAll(re)) {
      if (isPlaceholder(m[0])) continue;
      out.push(`${kindOf ? kindOf(m) : label} (${mask(m[0])})`);
    }
  };
  add(STRIPE_KEY, "", (m) => `Stripe ${m[2] === "live" ? "live" : "test"} ${m[1] === "rk" ? "restricted" : "secret"} key`);
  add(WEBHOOK_SECRET, "Stripe webhook signing secret");
  add(SB_SECRET_KEY, "Supabase secret key");
  for (const m of text.matchAll(JWT)) if (isServiceRoleJwt(m[0])) out.push(`Supabase service_role key (${mask(m[0])})`);
  return [...new Set(out)];
}

export function hasSecretShapedValue(text) {
  return secretKinds(text).length > 0;
}

const SLASH_LANGS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts", ".vue", ".svelte", ".astro", ".php", ".go"]);
const HASH_LANGS = new Set([".py", ".rb", ".php"]);

/**
 * Blanks out line comments (and single-line or multi-line block comments) so names that
 * only appear in a comment are not reported. Not a parser: a comment marker inside a
 * string literal is rare enough to ignore.
 */
function stripComments(lines, ext) {
  const slash = SLASH_LANGS.has(ext);
  const hash = HASH_LANGS.has(ext);
  let inBlock = false;
  return lines.map((raw) => {
    let line = raw;
    if (slash) {
      if (inBlock) {
        const end = line.indexOf("*/");
        if (end === -1) return "";
        line = line.slice(end + 2);
        inBlock = false;
      }
      line = line.replace(/\/\*.*?\*\//g, " ");
      const open = line.indexOf("/*");
      if (open !== -1) {
        line = line.slice(0, open);
        inBlock = true;
      }
      line = line.replace(/(^|\s)\/\/.*$/, "$1");
    }
    if (hash) line = line.replace(/(^|\s)#.*$/, "$1");
    return line;
  });
}

function isServiceRoleJwt(token) {
  try {
    const payload = token.split(".")[1];
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return json && json.role === "service_role";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Per-file detection
// ---------------------------------------------------------------------------

/**
 * @param {{rel:string,text:string,spaProject?:boolean,nextProject?:boolean}} file
 * @returns {{findings: object[], webhook: {line:number}|null, verifies: boolean}}
 */
export function scanFile({ rel, text, spaProject = false, nextProject = false }) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  const env = isEnvFile(rel);
  const example = isEnvExample(rel);
  const realEnv = env && !example;
  const ext = path.posix.extname(rel).toLowerCase();
  const isDoc = DOC_EXT.has(ext);
  const side = classify(rel, text, { spaProject, nextProject });

  const add = (rule, severity, line, message, fix, evidence) =>
    findings.push({
      rule,
      severity,
      file: rel,
      line,
      message,
      fix,
      ...(evidence ? { evidence } : {}),
    });

  const code = env || isDoc ? lines : stripComments(lines, ext);

  lines.forEach((raw, i) => {
    const line = i + 1;
    const trimmed = raw.trim();
    if (env && (trimmed === "" || trimmed.startsWith("#"))) return;

    // Secrets with a public prefix (names only, in env files and in code).
    if (!isDoc) {
      for (const m of code[i].matchAll(PUBLIC_NAME)) {
        const name = m[1];
        if (!SECRET_NAME.test(name)) continue;
        let evidence;
        let severity = "HIGH";
        if (env) {
          const assigned = raw.match(/^\s*(?:export\s+)?[A-Z0-9_]+\s*=\s*(.*)$/);
          const value = assigned ? assigned[1].trim().replace(/^["']|["']$/g, "") : "";
          if (example || value === "" || isPlaceholder(value)) severity = "MEDIUM";
          if (value) evidence = mask(value);
        }
        add(
          "public-env-secret",
          severity,
          line,
          `${name} has a public prefix, so its value is bundled into the browser and visible to anyone.`,
          "Rename it without the public prefix and read it only on the server. If it was ever real, rotate it.",
          evidence,
        );
      }
    }

    // Supabase service_role key referenced by name in client code.
    if (side === "client" && !isDoc) {
      for (const m of code[i].matchAll(SERVICE_ROLE_NAME)) {
        if (PUBLIC_PREFIX.test(m[1])) continue; // already reported as public-env-secret
        add(
          "service-role-in-client",
          "HIGH",
          line,
          `${m[1]} is referenced in client-side code. The service_role key bypasses Row Level Security.`,
          "Use it only in server-side code (route handlers, server actions, edge functions). Client code should use the anon key.",
        );
      }
    }

    if (!realEnv && !example) {
      // Supabase service_role keys: the legacy JWT and the newer sb-secret key.
      const serviceKeys = [
        ...[...raw.matchAll(JWT)].map((m) => m[0]).filter(isServiceRoleJwt),
        ...[...raw.matchAll(SB_SECRET_KEY)].map((m) => m[0]).filter((k) => !isPlaceholder(k)),
      ];
      for (const key of serviceKeys) {
        if (side === "client") {
          add(
            "service-role-in-client",
            "HIGH",
            line,
            "A Supabase service_role key is hard-coded in client-side code. Anyone who loads the page can read and write every table.",
            "Remove it, rotate the key in the Supabase dashboard, and use the service role only on the server.",
            mask(key),
          );
        } else {
          add(
            "service-role-hardcoded",
            "MEDIUM",
            line,
            "A Supabase service_role key is hard-coded in source. It is in your git history even if you delete it.",
            "Move it to an environment variable and rotate it.",
            mask(key),
          );
        }
      }

      // Stripe webhook signing secrets.
      for (const m of raw.matchAll(WEBHOOK_SECRET)) {
        if (isPlaceholder(m[0])) continue;
        add(
          "stripe-webhook-secret",
          "HIGH",
          line,
          "A Stripe webhook signing secret is in source. With it anyone can forge a signed payment event.",
          "Move it to an environment variable. If it was ever committed, roll the signing secret in the Stripe dashboard.",
          mask(m[0]),
        );
      }

      // Stripe secret keys.
      for (const m of raw.matchAll(STRIPE_KEY)) {
        if (isPlaceholder(m[0])) continue;
        const live = m[2] === "live";
        add(
          "stripe-secret-key",
          live ? "HIGH" : "MEDIUM",
          line,
          live
            ? "A live Stripe secret key is in source. It can move real money."
            : "A Stripe test secret key is in source. Test keys are low risk, but the habit leaks live keys later.",
          "Move it to an environment variable. If it was ever committed, roll the key in the Stripe dashboard.",
          mask(m[0]),
        );
      }
    }
  });

  // Stripe webhook handler heuristic.
  let webhook = null;
  let verifies = false;
  if (CODE_EXT.has(ext) && !isTestFile(rel)) {
    verifies = VERIFY.test(text);
    const mentionsStripe = /stripe/i.test(text);
    const hinted = lines.findIndex((l) => WEBHOOK_HINT.test(l));
    const pathHint = /webhook/i.test(rel);
    if (mentionsStripe && (hinted !== -1 || pathHint) && !verifies) {
      webhook = { line: hinted !== -1 ? hinted + 1 : 1 };
    }
  }

  return { findings, webhook, verifies };
}
