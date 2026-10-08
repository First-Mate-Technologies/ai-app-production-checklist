import test from "node:test";
import assert from "node:assert/strict";
import { mask } from "../lib/mask.mjs";

test("mask keeps only the first 4 characters", () => {
  const secret = ["sk", "live", "ABCDEFGHIJKLMNOP"].join("_");
  const out = mask(secret);
  assert.equal(out.slice(0, 4), "sk_l");
  assert.ok(!out.includes("ive_"));
  assert.ok(!out.includes(secret.slice(5)));
  assert.match(out.slice(4), /^\*+$/);
});

test("mask output length does not depend on the secret length", () => {
  assert.equal(mask("a".repeat(20)).length, mask("a".repeat(400)).length);
});

test("mask shows nothing for short values", () => {
  assert.equal(mask("abc"), "********");
  assert.equal(mask("12345678"), "********");
});
