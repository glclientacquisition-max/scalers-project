// PR 11 (30 Oct): Add many from a photo or a website (DESK_IMPORT_PHOTO). Both become paste lines for the same preview.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { photoReplyToLines, underImportLimit, websiteTextToLines } from "../dashboard/src/lib/importPhoto.ts";
import { parsePasteList } from "../dashboard/src/lib/kbCore.ts";

test("photo reply: JSON items become lines the paste parser prices", () => {
  const raw = '```json\n{"items":[{"name":"Chapati","price":"KSh 30"},{"name":"Pilau, beef","price":"350/="},{"name":"Delivery","price":""},{"name":"  "}]}\n```';
  const text = photoReplyToLines(raw);
  assert.equal(text, "Chapati, KSh 30\nPilau beef, 350/=\nDelivery");
  const rows = parsePasteList(text, []);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].price_amount, 30);
  assert.equal(rows[1].price_amount, 350);
});

test("photo reply: anything else is no lines", () => {
  assert.equal(photoReplyToLines("Sorry, I cannot read that."), "");
  assert.equal(photoReplyToLines('{"items":"nope"}'), "");
  assert.equal(photoReplyToLines(""), "");
});

test("website text: only short lines with a price, no repeats", () => {
  const plain = "Welcome to Mama Shop\nOur services\nHaircut KSh 500\nHaircut KSh 500\nBraids 1,500 - 3,000\nCall us on Monday\nWe have served Nairobi since 2010 with love and care and great prices for everyone who visits us daily KSh 1";
  assert.equal(websiteTextToLines(plain), "Haircut KSh 500\nBraids 1,500 - 3,000");
});

test("in-memory limit: 10 an hour per workspace", () => {
  const t0 = 1_000_000;
  for (let i = 0; i < 10; i += 1) assert.equal(underImportLimit("w1", t0 + i), true);
  assert.equal(underImportLimit("w1", t0 + 11), false);
  assert.equal(underImportLimit("w2", t0 + 11), true);
  assert.equal(underImportLimit("w1", t0 + 61 * 60_000), true);
});

test("server actions are flag-gated and use the hardened fetch", () => {
  const read = (p: string) => fs.readFileSync(path.join(import.meta.dirname, "..", p), "utf8");
  const act = read("dashboard/src/app/(desk)/settings/knowledge/addManyActions.ts");
  assert.match(act, /if \(!deskImportPhoto\(\)\)/);
  assert.match(act, /memberDenied\("settings\.edit"\)/);
  assert.match(act, /fetchPublicUrlSafe\(/);
  assert.doesNotMatch(act, /writeKbItems|importPaste|\.insert\(|\.update\(/);
  assert.match(read("dashboard/src/app/(desk)/settings/knowledge/page.tsx"), /importPhoto=\{deskImportPhoto\(\)\}/);
  const ui = read("dashboard/src/components/catalogue/CatalogueScreen.tsx");
  assert.match(ui, /data-add-many-photo/);
  assert.match(ui, /data-add-many-site/);
});
