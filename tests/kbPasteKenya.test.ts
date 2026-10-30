// PR 5 (30 Oct): imported text is normalised, spreadsheet formulas are neutralised, and Kenyan price writing parses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliseImportText, neutraliseFormula, parsePasteList } from "../dashboard/src/lib/kbCore.ts";

const one = (line: string) => {
  const [r] = parsePasteList(line);
  return [r.name_en, r.price_mode, r.price_amount ?? r.price_min, r.price_max, r.error];
};

test("Kenyan price forms", () => {
  assert.deepEqual(one("Sofa cleaning 1,500/="), ["Sofa cleaning", "fixed", 1500, null, null]);
  assert.deepEqual(one("Carpet wash - 2k"), ["Carpet wash", "fixed", 2000, null, null]);
  assert.deepEqual(one("Mattress 1.5k"), ["Mattress", "fixed", 1500, null, null]);
  assert.deepEqual(one("Car wash 500 bob"), ["Car wash", "fixed", 500, null, null]);
  assert.deepEqual(one("Seedlings @ 30 per seedling"), ["Seedlings", "fixed", 30, null, null]);
  assert.deepEqual(one("Deep clean bei 6000"), ["Deep clean", "fixed", 6000, null, null]);
  assert.deepEqual(one("Move-in clean kuanzia 8,000"), ["Move-in clean", "from", 8000, null, null]);
  assert.deepEqual(one("Office clean 5,000 hadi 9,000"), ["Office clean", "range", 5000, 9000, null]);
  assert.deepEqual(one("Fumigation - call for quote"), ["Fumigation", "quote", null, null, null]);
  assert.deepEqual(one("Kitchen deep clean: bei ya maongezi"), ["Kitchen deep clean", "quote", null, null, null]);
  assert.deepEqual(one("Consultation - bure"), ["Consultation", "free", 0, null, null]);
  assert.deepEqual(one("Gutter repair - site visit"), ["Gutter repair", "site_visit", null, null, null]);
});

test("units and plain names still work", () => {
  assert.equal(parsePasteList("5 kg bag of rice")[0].price_mode, "none");
  assert.equal(parsePasteList("Tomatoes - 120 per kg")[0].unit, "kg");
});

test("normalise strips hidden characters and keeps lines", () => {
  assert.equal(normaliseImportText("A\u200B\u202Eb\u00A0c\r\nＤ１２\u0007"), "Ab c\nD12");
  assert.equal(parsePasteList("Sofa\u200B clean\u00A0- 1,500").at(0)?.name_en, "Sofa clean");
});

test("formula names are neutralised", () => {
  assert.equal(neutraliseFormula("=HYPERLINK(\"x\")"), "HYPERLINK(\"x\")");
  assert.equal(parsePasteList("+Deep clean - 500")[0].name_en, "Deep clean");
  assert.equal(parsePasteList("@cmd - 500")[0].name_en, "cmd");
});

test("in-batch duplicates and long lines", () => {
  const rows = parsePasteList("Sofa - 100\nsofa - 200");
  assert.equal(rows[1].error, "Same name as a line above.");
  assert.equal(parsePasteList("x".repeat(400))[0].error, "Name is over 120 letters.");
});
