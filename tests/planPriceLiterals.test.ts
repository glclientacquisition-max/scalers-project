/**
 * Plan prices, allowances, and the extra-seat price come from package versions.
 * Dev fixtures may keep sample numbers. Everywhere else under dashboard/src must not.
 * Run: node --experimental-strip-types --test tests/planPriceLiterals.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "dashboard/src");

/** Current catalogue, annual totals and savings, and the retired straw monthly prices. */
const PLAN_PRICES = [7000, 18000, 35000, 69720, 194400, 378000, 14280, 21600, 42000, 5000, 12000, 25000];

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(ts|tsx|js|jsx)$/.test(entry.name) ? [full] : [];
  });
}

function stripStringsAndComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/`(?:\\.|[^`])*`/g, "\"\"")
    .replace(/"(?:\\.|[^"\\])*"/g, "\"\"")
    .replace(/'(?:\\.|[^'\\])*'/g, "\"\"");
}

function deskSources(): Array<{ rel: string; text: string }> {
  return walk(src).flatMap((file) => {
    const rel = path.relative(root, file).split(path.sep).join("/");
    if (rel.startsWith("dashboard/src/app/dev/")) return [];
    return [{ rel, text: fs.readFileSync(file, "utf8") }];
  });
}

describe("plan price literals", () => {
  it("does not hardcode plan prices under dashboard/src outside dev fixtures", () => {
    const hits: string[] = [];
    for (const { rel, text } of deskSources()) {
      const lines = text.split("\n");
      lines.forEach((raw, index) => {
        // Same digits as a plan price, used as a timer, a character cap, or a legacy spend preset.
        if (/_MS\b|TIMEOUT|setInterval|setTimeout|PRESETS_|slice\s*\(|truncated/.test(raw)) return;
        if (rel === "dashboard/src/components/plan/PaymentCheck.tsx") return;
        if (rel === "dashboard/src/lib/inboxArchiveUndo.ts") return;
        const line = stripStringsAndComments(raw);
        for (const token of line.match(/\b\d[\d_]*\b/g) || []) {
          const value = Number(token.replace(/_/g, ""));
          if (!PLAN_PRICES.includes(value)) continue;
          hits.push(`${rel}:${index + 1} ${token}`);
        }
      });
    }
    assert.deepEqual(hits, []);
  });

  it("does not keep a seat-price constant or a plan-price table", () => {
    const joined = deskSources().map((file) => file.text).join("\n");
    assert.doesNotMatch(joined, /EXTRA_SEAT_MONTHLY_KES/);
    assert.doesNotMatch(joined, /strawPublicBoard/);
    assert.doesNotMatch(joined, /STRAW_OFFERS/);
    assert.doesNotMatch(joined, /monthlyPriceKes\s*[:=]\s*\d/);
    assert.doesNotMatch(joined, /extraSeatMonthlyKes\s*[:=]\s*\d/);
    assert.doesNotMatch(joined, /extra_seat_monthly_kes\s*=\s*\d/);
  });
});
