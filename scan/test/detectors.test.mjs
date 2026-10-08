import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { scanProject } from "../lib/scan.mjs";
import { formatText, formatJson } from "../lib/report.mjs";
import { copyFixture, tmpDir, write, cleanup, withProject, hasGit, find, FAKE_SECRETS, FAKES } from "./helpers.mjs";

function withFixture(name, fn) {
  const dir = copyFixture(name);
  try {
    return fn(dir);
  } finally {
    cleanup(dir);
  }
}

// ---- Supabase service role ------------------------------------------------

test("service_role JWT in a use-client file is HIGH and masked", () =>
  withFixture("service-role-client", (dir) => {
    const r = scanProject(dir);
    const hits = find(r, "service-role-in-client").filter((f) => f.file === "src/app/page.tsx");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].severity, "HIGH");
    assert.equal(hits[0].line, 7);
    assert.equal(hits[0].evidence, "eyJh********");
  }));

test("SUPABASE_SERVICE_ROLE_KEY referenced under src/components is HIGH", () =>
  withFixture("service-role-client", (dir) => {
    const hits = find(scanProject(dir), "service-role-in-client").filter(
      (f) => f.file === "src/components/Admin.tsx",
    );
    assert.equal(hits.length, 1);
    assert.equal(hits[0].severity, "HIGH");
  }));

test("service role in an API route is not flagged as client code", () =>
  withFixture("service-role-client", (dir) => {
    const files = find(scanProject(dir), "service-role-in-client").map((f) => f.file);
    assert.ok(!files.includes("src/app/api/admin/route.ts"));
  }));

test("hard-coded service_role JWT in server code is MEDIUM, anon JWT is ignored", () =>
  withFixture("service-role-server", (dir) => {
    const r = scanProject(dir);
    assert.deepEqual(find(r, "service-role-in-client"), []);
    const hard = find(r, "service-role-hardcoded");
    assert.equal(hard.length, 1);
    assert.equal(hard[0].severity, "MEDIUM");
    assert.equal(r.summary.high, 0);
  }));

test("a file with import server-only is never client code, even under app/", () => {
  const dir = tmpDir();
  try {
    write(dir, "package.json", "{}");
    write(dir, "app/admin.ts", 'import "server-only";\nexport const k = process.env.SUPABASE_SERVICE_ROLE_KEY;\n');
    assert.deepEqual(find(scanProject(dir), "service-role-in-client"), []);
  } finally {
    cleanup(dir);
  }
});

test("Vite projects treat src/ as browser code", () => {
  const dir = tmpDir();
  try {
    write(dir, "package.json", JSON.stringify({ devDependencies: { vite: "5.0.0" } }));
    write(dir, "src/lib/db.ts", "export const k = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;\n");
    assert.equal(find(scanProject(dir), "service-role-in-client").length, 1);
  } finally {
    cleanup(dir);
  }
});

// ---- Public-prefixed secrets ---------------------------------------------

test("public-prefixed secret names are flagged in env files and code", () =>
  withFixture("public-prefix", (dir) => {
    const r = scanProject(dir);
    const hits = find(r, "public-env-secret");
    const byFile = (f) => hits.filter((h) => h.file === f);
    assert.equal(byFile(".env.local").length, 2); // NEXT_PUBLIC_..._SECRET_KEY and VITE_..._PRIVATE_KEY
    assert.ok(byFile(".env.local").every((h) => h.severity === "HIGH" && h.evidence.startsWith("fake")));
    assert.equal(byFile("src/config.ts").length, 2); // EXPO_PUBLIC_..._SECRET, REACT_APP_SECRET_TOKEN
    assert.equal(byFile(".env.example")[0].severity, "MEDIUM");
  }));

test("anon key and publishable key names are not flagged", () =>
  withFixture("public-prefix", (dir) => {
    const text = JSON.stringify(scanProject(dir).findings);
    assert.ok(!text.includes("ANON_KEY"));
    assert.ok(!text.includes("PUBLISHABLE"));
    assert.ok(!text.includes("SUPABASE_URL"));
  }));

// ---- Stripe keys ---------------------------------------------------------

test("Stripe secret keys: live and restricted are HIGH, test is MEDIUM, publishable is ignored", () =>
  withFixture("stripe-keys", (dir) => {
    const hits = find(scanProject(dir), "stripe-secret-key");
    assert.deepEqual(
      hits.map((h) => [h.line, h.severity]),
      [[2, "HIGH"], [3, "HIGH"], [4, "MEDIUM"]],
    );
    assert.ok(hits.every((h) => h.evidence.startsWith("sk_l") || h.evidence.startsWith("rk_l") || h.evidence.startsWith("sk_t")));
  }));

test("Stripe key in an .env.example placeholder is ignored", () => {
  const dir = tmpDir();
  try {
    write(dir, "package.json", "{}");
    write(dir, ".env.example", `STRIPE_SECRET_KEY=${["sk", "test", "x".repeat(24)].join("_")}\n`);
    assert.deepEqual(find(scanProject(dir), "stripe-secret-key"), []);
  } finally {
    cleanup(dir);
  }
});

// ---- Stripe webhooks -----------------------------------------------------

test("webhook handler without constructEvent is HIGH", () =>
  withFixture("stripe-webhook-bad", (dir) => {
    const hits = find(scanProject(dir), "stripe-webhook-unverified");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].severity, "HIGH");
    assert.equal(hits[0].file, "src/app/api/webhooks/stripe/route.ts");
  }));

test("webhook handler with constructEvent is clean", () =>
  withFixture("stripe-webhook-good", (dir) => {
    assert.deepEqual(find(scanProject(dir), "stripe-webhook-unverified"), []);
  }));

test("webhook handler that verifies through a helper elsewhere is downgraded to MEDIUM", () =>
  withFixture("stripe-webhook-helper", (dir) => {
    const hits = find(scanProject(dir), "stripe-webhook-unverified");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].severity, "MEDIUM");
  }));

// ---- .env files and .gitignore -------------------------------------------

test("committed .env file is HIGH; .env.example is fine", { skip: !hasGit() }, () => {
  const dir = tmpDir();
  try {
    const git = (...a) => execFileSync("git", ["-C", dir, ...a], { stdio: "ignore" });
    git("init", "-q");
    write(dir, ".env", "SECRET=1\n");
    write(dir, ".env.production", "SECRET=2\n");
    write(dir, ".env.example", "SECRET=\n");
    git("add", "-A", "-f");
    const hits = find(scanProject(dir), "committed-env-file");
    assert.deepEqual(hits.map((h) => h.file).sort(), [".env", ".env.production"]);
    assert.ok(hits.every((h) => h.severity === "HIGH"));
  } finally {
    cleanup(dir);
  }
});

test("an untracked .env in a git repo is not reported as committed", { skip: !hasGit() }, () => {
  const dir = tmpDir();
  try {
    execFileSync("git", ["-C", dir, "init", "-q"], { stdio: "ignore" });
    write(dir, ".gitignore", ".env\n");
    write(dir, ".env", "SECRET=1\n");
    const r = scanProject(dir);
    assert.deepEqual(find(r, "committed-env-file"), []);
    assert.deepEqual(find(r, "gitignore-missing-env"), []);
  } finally {
    cleanup(dir);
  }
});

test("a project that is not a git repository still scans, with a note", () => {
  const dir = tmpDir();
  try {
    write(dir, "package.json", "{}");
    write(dir, ".gitignore", ".env\n");
    write(dir, ".env", "SECRET=1\n");
    const r = scanProject(dir);
    assert.deepEqual(find(r, "committed-env-file"), []);
    assert.ok(r.notes.some((n) => /not a git repository/i.test(n)));
    assert.equal(r.summary.high, 0);
  } finally {
    cleanup(dir);
  }
});

test(".gitignore without .env is HIGH when a .env exists", () => {
  const dir = tmpDir();
  try {
    write(dir, "package.json", "{}");
    write(dir, ".gitignore", "node_modules\n");
    write(dir, ".env", "SECRET=1\n");
    const hits = find(scanProject(dir), "gitignore-missing-env");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].severity, "HIGH");
  } finally {
    cleanup(dir);
  }
});

test(".gitignore without .env is LOW when no .env exists, and .env.* patterns count as covered", () => {
  const dir = tmpDir();
  try {
    write(dir, "package.json", "{}");
    assert.equal(find(scanProject(dir), "gitignore-missing-env")[0].severity, "LOW");
    write(dir, ".gitignore", ".env*\n");
    assert.deepEqual(find(scanProject(dir), "gitignore-missing-env"), []);
  } finally {
    cleanup(dir);
  }
});

// ---- Skipping and robustness ---------------------------------------------

test("a clean app has no findings", () =>
  withFixture("clean-app", (dir) => {
    const r = scanProject(dir);
    assert.deepEqual(r.findings, []);
    assert.equal(r.summary.total, 0);
  }));

test("empty directory: no findings", () => {
  const dir = tmpDir();
  try {
    const r = scanProject(dir);
    assert.deepEqual(r.findings, []);
    assert.equal(r.summary.filesScanned, 0);
  } finally {
    cleanup(dir);
  }
});

test("node_modules, .git and build output are skipped", () => {
  const dir = tmpDir();
  try {
    const leak = `export const k = "${FAKES.SK_LIVE}";\n`;
    for (const d of ["node_modules/pkg", ".git/hooks", "dist", "build", ".next/server"]) {
      write(dir, `${d}/index.js`, leak);
    }
    const r = scanProject(dir);
    assert.deepEqual(r.findings, []);
    assert.equal(r.summary.filesScanned, 0);
  } finally {
    cleanup(dir);
  }
});

test("files over 1 MB and binary files are skipped and counted", () => {
  const dir = tmpDir();
  try {
    const leak = `export const k = "${FAKES.SK_LIVE}";\n`;
    write(dir, "big.js", leak + "x".repeat(1024 * 1024 + 10));
    fs.writeFileSync(path.join(dir, "blob.bin"), Buffer.concat([Buffer.from([0, 1, 2, 3]), Buffer.from(leak)]));
    write(dir, "small.js", "export const a = 1;\n");
    const r = scanProject(dir);
    assert.deepEqual(r.findings, []);
    assert.equal(r.summary.skippedLarge, 1);
    assert.equal(r.summary.skippedBinary, 1);
    assert.equal(r.summary.filesScanned, 1);
  } finally {
    cleanup(dir);
  }
});

test("an unreadable file does not crash the scan", { skip: process.platform === "win32" || process.getuid?.() === 0 }, () => {
  const dir = tmpDir();
  try {
    const locked = write(dir, "locked.js", `export const k = "${FAKES.SK_LIVE}";\n`);
    write(dir, "ok.js", `export const k = "${FAKES.SK_LIVE}";\n`);
    fs.chmodSync(locked, 0o000);
    const r = scanProject(dir);
    assert.equal(r.summary.unreadable, 1);
    assert.deepEqual(find(r, "stripe-secret-key").map((f) => f.file), ["ok.js"]);
    fs.chmodSync(locked, 0o644);
  } finally {
    cleanup(dir);
  }
});

test("scanning a missing directory throws a clear error", () => {
  assert.throws(() => scanProject("/definitely/not/a/real/dir"), /Cannot read directory/);
});

// ---- Output never leaks secret values ------------------------------------

test("text and JSON reports never contain a full fake secret", () => {
  for (const name of ["service-role-client", "public-prefix", "stripe-keys"]) {
    withFixture(name, (dir) => {
      const r = scanProject(dir);
      const out = formatText(r) + formatJson(r);
      for (const secret of FAKE_SECRETS) assert.ok(!out.includes(secret), `${name} leaked ${secret.slice(0, 6)}`);
      assert.ok(!/eyJ[A-Za-z0-9_-]{20,}/.test(out), `${name} printed a long JWT segment`);
    });
  }
});

test("evidence never shows more than the first 4 characters of a value", () =>
  withFixture("stripe-keys", (dir) => {
    for (const f of find(scanProject(dir), "stripe-secret-key")) {
      assert.match(f.evidence, /^.{4}\*{8}$/);
    }
  }));

test("files named *.env are treated as env files, not source", () => {
  const dir = tmpDir();
  try {
    write(dir, "package.json", "{}");
    write(dir, ".gitignore", ".env\n");
    write(dir, "docker.env", `SUPABASE_SERVICE_ROLE_KEY=${FAKES.JWT_SERVICE_ROLE}\n`);
    assert.deepEqual(find(scanProject(dir), "service-role-hardcoded"), []);
  } finally {
    cleanup(dir);
  }
});

// ---- Next.js server vs client code ----------------------------------------

const NEXT_PKG = JSON.stringify({ dependencies: { next: "15.0.0" } });
const ADMIN_CLIENT =
  'import { createClient } from "@supabase/supabase-js";\nexport const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);\n';

test("Next.js: a server component under app/ is not client code", () =>
  withProject({ "package.json": NEXT_PKG, "src/app/admin/page.tsx": ADMIN_CLIENT + "export default function P() { return null; }\n" }, (dir) => {
    const r = scanProject(dir);
    assert.equal(r.summary.high, 0);
    assert.deepEqual(find(r, "service-role-in-client"), []);
  }));

test('Next.js: a "use server" action under app/ is server code', () =>
  withProject({ "package.json": NEXT_PKG, "app/actions.ts": '"use server";\n' + ADMIN_CLIENT }, (dir) => {
    assert.deepEqual(find(scanProject(dir), "service-role-in-client"), []);
  }));

test("Next.js: a pages/ file with getServerSideProps is server code", () =>
  withProject(
    { "package.json": NEXT_PKG, "pages/admin.tsx": ADMIN_CLIENT + "export async function getServerSideProps() { return { props: {} }; }\nexport default function A() { return null; }\n" },
    (dir) => assert.deepEqual(find(scanProject(dir), "service-role-in-client"), []),
  ));

test("Next.js: a pages/ file with getStaticProps is server code", () =>
  withProject(
    { "package.json": NEXT_PKG, "src/pages/x.tsx": ADMIN_CLIENT + "export const getStaticProps = async () => ({ props: {} });\n" },
    (dir) => assert.deepEqual(find(scanProject(dir), "service-role-in-client"), []),
  ));

test('Next.js: a "use client" component under app/ is HIGH', () =>
  withProject({ "package.json": NEXT_PKG, "src/app/widget.tsx": '"use client";\n' + ADMIN_CLIENT }, (dir) => {
    const hits = find(scanProject(dir), "service-role-in-client");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].severity, "HIGH");
  }));

test('"use client" is found after a BOM, comments and with single quotes', () => {
  const variants = [
    "\uFEFF'use client';\n",
    '// header comment\n/* block\n comment */\n"use client"\n',
    "\uFEFF// c\n'use client'\n",
  ];
  for (const head of variants) {
    withProject({ "package.json": NEXT_PKG, "app/w.tsx": head + ADMIN_CLIENT }, (dir) => {
      assert.equal(find(scanProject(dir), "service-role-in-client").length, 1, JSON.stringify(head));
    });
  }
});

test('a "use client" that is not at the top of the file does not count', () =>
  withProject({ "package.json": NEXT_PKG, "app/w.tsx": 'import x from "y";\n"use client";\n' + ADMIN_CLIENT }, (dir) => {
    assert.deepEqual(find(scanProject(dir), "service-role-in-client"), []);
  }));

test("Next.js: public/ stays client code", () =>
  withProject({ "package.json": NEXT_PKG, "public/sdk.js": "const k = process.env.SUPABASE_SERVICE_ROLE_KEY;\n" }, (dir) => {
    assert.equal(find(scanProject(dir), "service-role-in-client").length, 1);
  }));

test("Next.js: a hard-coded service_role JWT in an unknown-side file is still MEDIUM", () =>
  withProject({ "package.json": NEXT_PKG, "app/page.tsx": `export const k = "${FAKES.JWT_SERVICE_ROLE}";\n` }, (dir) => {
    const r = scanProject(dir);
    assert.deepEqual(find(r, "service-role-in-client"), []);
    assert.equal(find(r, "service-role-hardcoded")[0].severity, "MEDIUM");
  }));

test("without Next.js, app/ without a directive is still client code", () =>
  withProject({ "package.json": "{}", "src/app/admin.tsx": ADMIN_CLIENT }, (dir) => {
    assert.equal(find(scanProject(dir), "service-role-in-client").length, 1);
  }));

// ---- Webhook verification in other languages --------------------------------

const WEBHOOKS = {
  python: ["api/webhooks/stripe.py", 'import stripe\nevent = stripe.Webhook.construct_event(payload, sig_header, endpoint_secret)\nif event["type"] == "checkout.session.completed":\n    pass\n'],
  ruby: ["app/controllers/stripe_webhooks_controller.rb", 'event = Stripe::Webhook.construct_event(payload, sig_header, endpoint_secret)\n# checkout.session.completed\n'],
  go: ["internal/stripe_webhook.go", 'event, err := webhook.ConstructEvent(payload, req.Header.Get("Stripe-Signature"), endpointSecret)\n'],
  "node async": ["src/stripe-webhook.ts", 'const e = await stripe.webhooks.constructEventAsync(body, sig, secret); // checkout.session.completed\n'],
};

for (const [lang, [file, code]] of Object.entries(WEBHOOKS)) {
  test(`${lang} webhook handler that verifies the signature is clean`, () =>
    withProject({ [file]: code }, (dir) => assert.deepEqual(find(scanProject(dir), "stripe-webhook-unverified"), [])));
}

test("python webhook handler that never verifies is HIGH", () =>
  withProject(
    { "api/webhooks/stripe.py": 'import stripe\nevent = json.loads(request.body)\nif event["type"] == "checkout.session.completed":\n    pass\n' },
    (dir) => assert.equal(find(scanProject(dir), "stripe-webhook-unverified")[0].severity, "HIGH"),
  ));

// ---- git is run with the target's config switched off ----------------------

test("a target repo's core.fsmonitor command is never executed", { skip: !hasGit() }, () => {
  const dir = tmpDir();
  const marker = path.join(tmpDir("marker-"), "fsmonitor-ran");
  try {
    const git = (...a) => execFileSync("git", ["-C", dir, ...a], { stdio: "ignore" });
    git("init", "-q");
    write(dir, "package.json", "{}");
    write(dir, ".env", "SECRET=1\n");
    git("add", "-A", "-f");
    git("config", "core.fsmonitor", `touch ${marker}`);
    const r = scanProject(dir);
    assert.ok(!fs.existsSync(marker), "fsmonitor command ran");
    assert.equal(find(r, "committed-env-file").length, 1);
  } finally {
    cleanup(dir);
    cleanup(path.dirname(marker));
  }
});

// ---- Webhook signing secrets and Supabase secret keys -----------------------

test("a hard-coded whsec_ webhook secret is HIGH and masked", () =>
  withProject({ "package.json": "{}", "src/lib/stripe.ts": `export const s = "${FAKES.WHSEC}";\n` }, (dir) => {
    const hits = find(scanProject(dir), "stripe-webhook-secret");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].severity, "HIGH");
    assert.equal(hits[0].evidence, "whse********");
  }));

test("an sb_secret key in server code is MEDIUM, in client code HIGH", () =>
  withProject(
    {
      "package.json": "{}",
      "src/lib/server.ts": `export const s = "${FAKES.SB_SECRET}";\n`,
      "src/components/Client.tsx": `export const s = "${FAKES.SB_SECRET}";\n`,
    },
    (dir) => {
      const r = scanProject(dir);
      assert.deepEqual(find(r, "service-role-hardcoded").map((f) => [f.file, f.severity]), [["src/lib/server.ts", "MEDIUM"]]);
      assert.deepEqual(find(r, "service-role-in-client").map((f) => [f.file, f.severity]), [["src/components/Client.tsx", "HIGH"]]);
    },
  ));

test("an sb_publishable_ key is not flagged", () =>
  withProject({ "package.json": "{}", ".gitignore": ".env\n", "src/components/C.tsx": `export const p = "${FAKES.SB_PUBLISHABLE}";\n` }, (dir) => {
    assert.deepEqual(scanProject(dir).findings, []);
  }));

// ---- Every env file must be ignored, not just .env -------------------------

test(".gitignore covers .env but not .env.local: .env.local is reported (no git)", () =>
  withProject({ "package.json": "{}", ".gitignore": ".env\n", ".env.local": `STRIPE_SECRET_KEY=${FAKES.SK_LIVE}\n` }, (dir) => {
    const hits = find(scanProject(dir), "gitignore-missing-env");
    assert.deepEqual(hits.map((h) => [h.file, h.severity]), [[".env.local", "HIGH"]]);
  }));

test(".gitignore covers .env but not .env.local: .env.local is reported (git repo)", { skip: !hasGit() }, () =>
  withProject({ "package.json": "{}", ".gitignore": ".env\n", ".env": "A=1\n", ".env.local": "B=2\n" }, (dir) => {
    execFileSync("git", ["-C", dir, "init", "-q"], { stdio: "ignore" });
    assert.deepEqual(find(scanProject(dir), "gitignore-missing-env").map((h) => h.file), [".env.local"]);
  }));

test("env files in a subfolder are checked against nested and negated rules", () =>
  withProject(
    { "package.json": "{}", ".gitignore": "*.env\n.env*\n!.env.example\n", "apps/web/.env.production": "A=1\n", "apps/web/.env.example": "A=\n" },
    (dir) => assert.deepEqual(find(scanProject(dir), "gitignore-missing-env"), []),
  ));

test("a tracked .env that is also ignored produces exactly one finding", { skip: !hasGit() }, () =>
  withProject({ "package.json": "{}", ".gitignore": ".env\n", ".env": "SECRET=1\n" }, (dir) => {
    const git = (...a) => execFileSync("git", ["-C", dir, ...a], { stdio: "ignore" });
    git("init", "-q");
    git("add", "-A", "-f");
    const r = scanProject(dir);
    assert.deepEqual(r.findings.map((f) => [f.rule, f.file]), [["committed-env-file", ".env"]]);
  }));

test(".env.local.example and .env.vault are never HIGH", { skip: !hasGit() }, () =>
  withProject(
    {
      "package.json": "{}",
      ".gitignore": "node_modules\n",
      ".env.local.example": "STRIPE_SECRET_KEY=\n",
      ".env.vault": "DOTENV_VAULT=encrypted\n",
    },
    (dir) => {
      const git = (...a) => execFileSync("git", ["-C", dir, ...a], { stdio: "ignore" });
      git("init", "-q");
      git("add", "-A", "-f");
      const r = scanProject(dir);
      assert.equal(r.summary.high, 0);
      assert.deepEqual(find(r, "committed-env-file"), []);
    },
  ));

test(".env.test is MEDIUM when tracked, HIGH once it holds a secret-shaped value", { skip: !hasGit() }, () => {
  for (const [body, expected] of [["DATABASE_URL=postgres://localhost/test\n", "MEDIUM"], [`STRIPE_SECRET_KEY=${FAKES.SK_LIVE}\n`, "HIGH"]]) {
    withProject({ "package.json": "{}", ".gitignore": ".env\n", ".env.test": body }, (dir) => {
      const git = (...a) => execFileSync("git", ["-C", dir, ...a], { stdio: "ignore" });
      git("init", "-q");
      git("add", "-A", "-f");
      assert.equal(find(scanProject(dir), "committed-env-file")[0].severity, expected);
    });
  }
});

// ---- Placeholders and comments ----------------------------------------------

test("placeholder keys in docs and code are not reported", () =>
  withProject(
    {
      "package.json": "{}",
      ".gitignore": ".env\n",
      "README.md": `Set STRIPE_SECRET_KEY=${["sk", "live", "x".repeat(24)].join("_")} in Vercel.\n`,
      "docs/setup.md": `STRIPE_SECRET_KEY=${["sk", "test", "YOUR", "KEY", "HERE0000"].join("_")}\n`,
      "src/pay.ts": `const k = "${["sk", "live", "<paste-your-key-here-now>"].join("_")}";\nconst w = "${["wh" + "sec", "1".repeat(32)].join("_")}";\n`,
    },
    (dir) => assert.deepEqual(scanProject(dir).findings, []),
  ));

test("service-role names that only appear in comments of a client file are not reported", () =>
  withProject(
    {
      "package.json": "{}",
      ".gitignore": ".env\n",
      "src/components/Note.tsx":
        '"use client";\n// Never use SUPABASE_SERVICE_ROLE_KEY in here.\n/* NEXT_PUBLIC_STRIPE_SECRET is wrong too\n   SUPABASE_SERVICE_ROLE_KEY */\nexport const N = () => null; // SUPABASE_SERVICE_ROLE_KEY\n',
    },
    (dir) => assert.deepEqual(scanProject(dir).findings, []),
  ));

test("a service-role name in real code next to a comment is still reported", () =>
  withProject(
    { "package.json": "{}", ".gitignore": ".env\n", "src/components/A.tsx": 'const k = process.env.SUPABASE_SERVICE_ROLE_KEY; // oops\n' },
    (dir) => assert.equal(find(scanProject(dir), "service-role-in-client").length, 1),
  ));

// ---- Symlinks, odd targets, unreadable entries ------------------------------

test("symlinks are not followed: outside secrets are not read, loops end, unreadable stays 0", { skip: process.platform === "win32" }, () => {
  const dir = tmpDir();
  const outside = tmpDir("outside-");
  try {
    write(outside, "leak.js", `export const k = "${FAKES.SK_LIVE}";\n`);
    write(dir, "package.json", "{}");
    write(dir, ".gitignore", ".env\n");
    fs.symlinkSync(outside, path.join(dir, "linked-dir"));
    fs.symlinkSync(path.join(outside, "leak.js"), path.join(dir, "linked-file.js"));
    fs.symlinkSync(dir, path.join(dir, "loop"));
    fs.symlinkSync(path.join(dir, "nope"), path.join(dir, "dangling"));
    const r = scanProject(dir);
    assert.deepEqual(r.findings, []);
    assert.equal(r.summary.unreadable, 0);
    assert.equal(r.summary.filesScanned, 2);
  } finally {
    cleanup(dir);
    cleanup(outside);
  }
});

test("scanning a file instead of a folder throws a clear error without printing its content", () =>
  withProject({ "secret.js": `export const k = "${FAKES.SK_LIVE}";\n` }, (dir) => {
    assert.throws(
      () => scanProject(path.join(dir, "secret.js")),
      (err) => /Not a directory/.test(err.message) && !err.message.includes(FAKES.SK_LIVE),
    );
  }));

test("an invalid or non-file package.json does not stop the scan", () => {
  for (const setup of [
    (dir) => write(dir, "package.json", "{ not json"),
    (dir) => fs.mkdirSync(path.join(dir, "package.json")),
  ]) {
    const dir = tmpDir();
    try {
      setup(dir);
      write(dir, "src/lib/pay.ts", `const k = "${FAKES.SK_LIVE}";\n`);
      assert.equal(find(scanProject(dir), "stripe-secret-key").length, 1);
    } finally {
      cleanup(dir);
    }
  }
});
