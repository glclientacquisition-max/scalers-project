// PR 7 (30 Oct): Catalogue taps are at least 44px, rows stack under 400px, price type comes first, nothing saves
// by itself, and Remove has Undo.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.join(import.meta.dirname, "../dashboard/src/components/catalogue/CatalogueScreen.tsx"), "utf8");

test("no small buttons; text Fix targets are 44px", () => {
  assert.doesNotMatch(src, /size="sm"/);
  for (const m of src.matchAll(/>\s*Fix\s*</g)) {
    const before = src.slice(Math.max(0, (m.index ?? 0) - 260), m.index);
    assert.match(before, /min-h-11|<Button/);
  }
});

test("rows wrap to two lines on a narrow phone", () => {
  assert.match(src, /data-row-two-line=""/);
  assert.match(src, /max-\[399px\]:basis-full/);
});

test("price type is first and never saves by itself", () => {
  const sec = src.slice(src.indexOf("data-price-section"));
  assert.ok(sec.indexOf('aria-label="Price type"') < sec.indexOf('aria-label="Price in KSh"'));
  assert.doesNotMatch(src, /savesInstantly|Price changes\?|save as soon as you pick/);
});

test("Remove offers Undo", () => {
  assert.match(src, /label: "Undo"/);
  assert.match(src, /row_version: undefined/);
});
