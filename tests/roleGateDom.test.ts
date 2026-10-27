/** Run: npx tsx --tsconfig dashboard/tsconfig.json --test tests/roleGateDom.test.ts (needs linkedom; skips otherwise) */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { it } from "node:test";

// Works under plain node (ESM, --experimental-strip-types) and tsx alike.
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));

const req = createRequire(import.meta.url);
let parseHTML: ((html: string) => { document: Document }) | null = null;
for (const p of [process.env.LINKEDOM_PATH, "linkedom"].filter(Boolean) as string[]) {
  try {
    parseHTML = req(p).parseHTML;
    break;
  } catch {
    /* optional */
  }
}

const html = `<div id="root">
  <input id="name" type="text" value="Westlands" />
  <textarea id="policy">No refunds</textarea>
  <input id="cb" type="checkbox" />
  <select id="sel"><option>a</option></select>
  <button id="save" type="submit">Save</button>
  <button id="expand" type="button" aria-expanded="false">More</button>
  <button id="loc" type="button" data-role-exempt="">Details</button>
  <div data-role-exempt=""><button id="inner" type="button">Inner</button></div>
</div>`;

it("viewer lock: edits locked, expand/collapse stays usable", { skip: !parseHTML && "linkedom not installed" }, async () => {
  const { lockControls } = await import("../dashboard/src/components/DeskRole.tsx");
  const { document } = parseHTML!(html);
  const root = document.getElementById("root")!;
  const n = lockControls(root, "You have view-only access.");
  const $ = (id: string) => document.getElementById(id)!;
  assert.equal(n, 5);
  assert.ok($("name").hasAttribute("readonly"));
  assert.ok($("policy").hasAttribute("readonly"));
  for (const id of ["cb", "sel", "save"]) assert.ok($(id).hasAttribute("disabled"), id);
  for (const id of ["expand", "loc", "inner"]) assert.ok(!$(id).hasAttribute("disabled") && !$(id).hasAttribute("aria-disabled"), id);
  assert.equal($("save").getAttribute("title"), "You have view-only access.");
  assert.equal(lockControls(root, "x"), 0, "idempotent");
});

it("places gate edits by role; gate no longer uses a disabled fieldset", () => {
  const root = path.join(TEST_DIR, "..");
  // PlacesEditor (list plus sheet). Add follows canEdit; rows always open. Without edit rights the
  // row is exempt from the view-only lock and opens a details-only drawer (no fields, Done or Remove).
  const places = fs.readFileSync(path.join(root, "dashboard/src/components/structured/PlacesEditor.tsx"), "utf8");
  assert.doesNotMatch(places, /disabled=\{!canEdit\}/);
  assert.match(places, /<div key=\{`place-\$\{i\}`\} data-role-exempt="">\s*<OpenRow/);
  assert.match(places, /canEdit && value\.length < LOCATIONS_MAX \?/);
  assert.match(places, /open=\{index != null && !canEdit\}/);
  assert.match(places, /open=\{index != null && canEdit\}/);
  const ro = places.slice(places.indexOf('data-place-readonly=""'), places.indexOf("open={index != null && canEdit}"));
  assert.ok(ro.length > 0, "read-only drawer present");
  assert.doesNotMatch(ro, /TextField|TextAreaField|<Switch|<Button|onSave|data-place-save/, "read-only drawer has no edit controls");
  assert.match(ro, /deniedMessage\(role\)/);
  assert.match(places, /function save\(\) \{\s*if \(index == null \|\| !canEdit\) return;/);
  assert.match(places, /function remove\(\) \{\s*if \(index == null \|\| !canEdit\) return;/);
  const form = fs.readFileSync(path.join(root, "dashboard/src/components/TenantForm.tsx"), "utf8");
  assert.match(form, /const canEditSettings = useCan\("settings\.edit"\);/);
  assert.match(form, /<PlacesEditor[\s\S]{0,800}canEdit=\{canEditSettings\}/);
  const gate = fs.readFileSync(path.join(root, "dashboard/src/components/DeskRole.tsx"), "utf8");
  assert.doesNotMatch(gate, /<fieldset disabled/);
  assert.match(gate, /onSubmitCapture=\{\(e\) => e\.preventDefault\(\)\}/);
});
