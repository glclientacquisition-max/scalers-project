/**
 * Admin MASTER token-pass guard (Alvin lock-master-token-pass, 23 Oct 2026).
 * Fail if admin/ops/app/admin regain hex fills, brand-as-fill, dark: variants,
 * or literal text-white / bg-black. Focus ring-brand is allowed. Comments and
 * GitHub issue refs (#876) are ignored.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const SCOPES = [
  "dashboard/src/components/admin",
  "dashboard/src/components/ops",
  "dashboard/src/app/admin",
];

function walk(dir, out = []) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx|css)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

function codeLines(src) {
  const lines = src.split("\n");
  const out = [];
  let block = false;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const trimmed = line.trim();
    if (block) {
      if (trimmed.includes("*/")) block = false;
      continue;
    }
    if (trimmed.startsWith("/*")) {
      if (!trimmed.includes("*/")) block = true;
      continue;
    }
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
    // Strip trailing line comments so issue refs in comments do not trip hex.
    const code = line.replace(/\/\/.*$/, "");
    out.push({ n: i + 1, line: code });
  }
  return out;
}

const HEX = /#[0-9a-fA-F]{6}\b/;
const BG_BRAND_FILL = /(?:^|[^-\w])bg-brand(?:\/|\s|"|'|`|$)/;
const DARK = /\bdark:/;
const TEXT_WHITE = /\btext-white\b/;
const BG_BLACK = /\bbg-black\b/;

test("admin/ops token dialect: no hex fills, bg-brand fill, dark:, text-white, bg-black", () => {
  const hits = [];
  for (const scope of SCOPES) {
    for (const rel of walk(scope)) {
      const src = fs.readFileSync(path.join(root, rel), "utf8");
      for (const { n, line } of codeLines(src)) {
        if (HEX.test(line)) hits.push(`${rel}:${n} hex ${line.trim().slice(0, 100)}`);
        if (BG_BRAND_FILL.test(line) && !/ring-brand/.test(line.replace(/bg-brand/g, ""))) {
          // allow focus-visible:ring-brand on same line as other classes; fail only if bg-brand present
          if (/\bbg-brand\b/.test(line)) hits.push(`${rel}:${n} bg-brand ${line.trim().slice(0, 100)}`);
        }
        if (DARK.test(line)) hits.push(`${rel}:${n} dark: ${line.trim().slice(0, 100)}`);
        if (TEXT_WHITE.test(line)) hits.push(`${rel}:${n} text-white ${line.trim().slice(0, 100)}`);
        if (BG_BLACK.test(line)) hits.push(`${rel}:${n} bg-black ${line.trim().slice(0, 100)}`);
      }
    }
  }
  assert.equal(hits.length, 0, hits.join("\n"));
});

test("dangerSolid uses text-attention-on (not text-white)", () => {
  const btn = fs.readFileSync(path.join(root, "dashboard/src/components/ui/Button.tsx"), "utf8");
  assert.match(btn, /dangerSolid:/);
  assert.match(btn, /text-attention-on/);
  assert.doesNotMatch(btn, /dangerSolid:[\s\S]{0,120}text-white/);
});
