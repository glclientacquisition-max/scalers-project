// PR 8 (30 Oct): "Add many" (DESK_ADD_MANY) is one sheet for a pasted list or a CSV/TSV/text file, same preview.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { delimitedToPasteText, parseDelimited } from "../dashboard/src/lib/importCsv.ts";
import { parsePasteList } from "../dashboard/src/lib/kbCore.ts";

test("CSV with a header picks name and price columns", () => {
  const out = delimitedToPasteText('Category,Name,Price\nCleaning,"Sofa, 3 seater","1,500"\nCleaning,Carpet,2k\n');
  assert.equal(out, "Sofa, 3 seater - 1,500\nCarpet - 2k");
  const rows = parsePasteList(out);
  assert.deepEqual(rows.map((r) => [r.name_en, r.price_amount]), [["Sofa, 3 seater", 1500], ["Carpet", 2000]]);
});

test("TSV and semicolons without a header", () => {
  assert.equal(delimitedToPasteText("Deep clean\t6000\nFumigation\tquote"), "Deep clean - 6000\nFumigation - quote");
  assert.equal(delimitedToPasteText("Mattress;1200"), "Mattress - 1200");
});

test("quotes, BOM, blank rows; formulas stay text and are neutralised by the preview", () => {
  assert.deepEqual(parseDelimited('\uFEFFa,"b ""x"""\n\n,\n'), [["a", 'b "x"']]);
  const rows = parsePasteList(delimitedToPasteText("name,price\n=HYPERLINK(1),100"));
  assert.equal(rows[0].name_en.startsWith("="), false);
});

test("sheet wiring", () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, "../dashboard/src/components/catalogue/CatalogueScreen.tsx"), "utf8");
  const flags = fs.readFileSync(path.join(import.meta.dirname, "../dashboard/src/lib/deskFeatureFlags.ts"), "utf8");
  assert.match(src, /addMany \? "Add many" : "Paste a list"/);
  assert.match(src, /IMPORT_FILE_MAX_BYTES/);
  assert.match(flags, /process\.env\.DESK_ADD_MANY/);
});
