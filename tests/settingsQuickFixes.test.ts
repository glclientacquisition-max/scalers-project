// Desk: Settings quick fixes (18 Oct owner review). Import parser, catalogue link route,
// owner policy copy filter, and the small guards that ride with them.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

const catalog = await import("../dashboard/src/lib/productCatalog.ts");
const nav = await import("../dashboard/src/lib/businessSettingsNav.ts");
const copy = await import("../dashboard/src/lib/ownerPolicyCopy.ts");
const policies = await import("../dashboard/src/lib/businessPolicies.ts");

const pick = (rows: Array<{ name: string; price: string; in_stock: string }>) =>
  rows.map((r) => [r.name, r.price, r.in_stock]);

// --- 1. "Add prices" / "Check prices" open the Catalogue -----------------------

test("route: ?tab=train&panel=catalog opens the Catalogue, not Identity", () => {
  assert.equal(nav.parseBusinessSettingsTab("train", "catalog"), "catalog");
  assert.equal(nav.parseBusinessSettingsTab("catalog", null), "catalog");
  assert.equal(nav.parseBusinessSettingsTab("train", "policies"), "train");
  assert.equal(nav.parseBusinessSettingsTab("identity", "catalog"), "train");
  assert.equal(nav.businessSettingsHref("catalog"), "/settings?tab=catalog");
});

test("route: Overview links use the Catalogue tab and both pages pass the panel", () => {
  const slots = read("dashboard/src/components/structured/StructuredSettingsSlots.tsx");
  assert.doesNotMatch(slots, /businessSettingsHref\("train", "catalog"\)/);
  // KB v2: the Catalogue page owns the filter (with Show all); before the v2 tables it forwards to ?tab=catalog&filter=unpriced.
  assert.match(slots, /UNPRICED_HREF = "\/settings\/knowledge\?filter=unpriced"/);
  assert.match(read("dashboard/src/app/(desk)/settings/knowledge/page.tsx"), /\/settings\?tab=catalog\$\{needPrice \? "&filter=unpriced" : ""\}/);
  for (const page of ["dashboard/src/app/(desk)/settings/page.tsx", "dashboard/src/app/dev/settings-jobs/page.tsx"]) {
    assert.match(read(page), /parseBusinessSettingsTab\(tabRaw, panelRaw\)/);
  }
});

// --- 2. Policies copy ------------------------------------------------------------

test("copy: never shows prompt text, a leading colon, or a double full stop", () => {
  assert.equal(copy.ownerPolicySummary("The receptionist should route the caller to Mary."), null);
  assert.equal(copy.ownerPolicySummary(": the assistant must say we close at 6"), null);
  assert.equal(copy.ownerPolicySummary(": Returns within 7 days."), "Returns within 7 days.");
  assert.equal(copy.ownerPolicySummary("Old text: Exchanges only.."), "Exchanges only.");
  assert.equal(copy.ownerPolicySummary("Delivery in Nairobi"), "Delivery in Nairobi.");
  assert.equal(copy.ownerPolicySummary("Ask the receptionist for a receipt."), "Ask your Business Assistant for a receipt.");
  assert.equal(copy.ownerPolicySummary("   "), null);
  const long = copy.ownerPolicySummary("word ".repeat(60));
  assert.ok(long && long.length <= 121 && long.endsWith("…"));
});

test("copy: the row says Tap only on touch screens", () => {
  assert.equal(copy.legacyRuleRowText("Returns within 7 days.", "coarse"), "Returns within 7 days. Tap to set it up.");
  assert.equal(copy.legacyRuleRowText("Returns within 7 days.", "fine"), "Returns within 7 days. Click to set it up.");
  assert.equal(copy.legacyRuleRowText("Returns within 7 days.", null), "Returns within 7 days. Not set up yet.");
  assert.doesNotMatch(copy.legacyRuleRowText("x.", null), /Tap|\.\./);
  const rules = read("dashboard/src/components/structured/PolicyRulesEditor.tsx");
  assert.doesNotMatch(rules, /Old text:/);
  assert.match(rules, /legacyRuleRowText\(legacy\[LEGACY_KEY\[t\]!\], pointer\)/);
  assert.match(read("dashboard/src/components/ui/usePointerKind.ts"), /\(pointer: coarse\)/);
});

test("copy: payment banner quotes a clean summary, no double full stop", () => {
  const pay = read("dashboard/src/components/structured/PaymentsEditor.tsx");
  assert.match(pay, /ownerPolicySummary\(legacyText \|\| value\?\.parsed_from\)/);
  assert.match(pay, /: “\$\{source\}”` : "\."/);
  assert.doesNotMatch(pay, /”\.` : "\."/);
});

test("copy: starter text shows once, and the deposit starter is not called Deposit", () => {
  const rows = policies.seedStarterPolicies(
    policies.normalizeBusinessPolicies({ deposit: "We can hold items for pickup when we have the caller name and pickup time." })
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, "Holds and deposits");
  const form = read("dashboard/src/components/TenantForm.tsx");
  assert.match(form, /legacyText=\{ownerLegacy\("payment"\)\}/);
  assert.match(form, /quoteSource=\{!starterKeys\.has\("payment"\)\}/);
  assert.match(form, /policies\.deposit && !starterKeys\.has\("deposit"\)/);
  assert.match(form, /returns: ownerLegacy\("returns"\)/);
  assert.doesNotMatch(read("dashboard/src/components/CallFaqSuggestions.tsx"), /receptionist/i);
});

// --- 3. Back gesture --------------------------------------------------------------

test("leave guard: Back (Android gesture / browser) asks before dropping edits", () => {
  const guard = read("dashboard/src/components/SettingsLeaveGuard.tsx");
  assert.match(guard, /addEventListener\("popstate", onPop\)/);
  assert.match(guard, /window\.history\.pushState\(\{ \.\.\.state, \[GUARD_KEY\]: true \}/);
  assert.match(guard, /if \(href === BACK\) window\.history\.back\(\)/);
  assert.match(guard, /onClose=\{keepEditing\}/);
});

// --- 4. Remove place / area -------------------------------------------------------

// Areas: ServiceAreasEditor's remove confirm went with it in #964 (43d9870b). In AreaPicker a removal is an
// untick that stays a draft until Save, so it needs no confirm.
test("locations: removing a place asks first", () => {
  const places = read("dashboard/src/components/structured/PlacesEditor.tsx");
  assert.match(places, /<ConfirmSheet[\s\S]*onConfirm=\{confirmRemoveNow\}/);
  assert.match(places, /setConfirmRemove\(index\)/);
});

// --- 5. Catalogue import ----------------------------------------------------------

test("import: forgiving headers (Product Name, Price (KES), In stock Y/N)", () => {
  const rows = catalog.parseProductCsv("Product Name,Price (KES),In stock\nAtomic Habits,2500,Y\nDune,1800,N\n");
  assert.deepEqual(pick(rows), [
    ["Atomic Habits", "2500", "yes"],
    ["Dune", "1800", "no"],
  ]);
  const plain = catalog.parseProductCsv("Item,Price,Stock (Y/N)\nPen,50,yes\nRuler,80,No");
  assert.deepEqual(pick(plain), [
    ["Pen", "50", "yes"],
    ["Ruler", "80", "no"],
  ]);
});

test("import: semicolon files, with commas inside prices", () => {
  const rows = catalog.parseProductCsv("Name;Price;In stock\nAtomic Habits;2,500;yes\nDune;1,800 KES;no");
  assert.deepEqual(pick(rows), [
    ["Atomic Habits", "2,500", "yes"],
    ["Dune", "1,800 KES", "no"],
  ]);
  // parseBulkProducts routes steady semicolons to the table parser too.
  assert.deepEqual(pick(catalog.parseBulkProducts("Name;Price\nPen;50\nRuler;80")), [
    ["Pen", "50", ""],
    ["Ruler", "80", ""],
  ]);
  // A stray semicolon in loose lines is not a table.
  assert.equal(catalog.parseBulkProducts("Open daily; closed Sunday\nA4 paper - 500 KES")[1].price, "500 KES");
});

test("import: quoted \"2,500\" and unambiguous unquoted thousands keep the price", () => {
  const quoted = catalog.parseProductCsv('name,price,in_stock\nAtomic Habits,"2,500",yes');
  assert.deepEqual(pick(quoted), [["Atomic Habits", "2,500", "yes"]]);
  const unquoted = catalog.parseProductCsv("name,price,in_stock\nAtomic Habits,2,500,yes\nBig Atlas,12,500,no\nPen,50,yes");
  assert.deepEqual(pick(unquoted), [
    ["Atomic Habits", "2,500", "yes"],
    ["Big Atlas", "12,500", "no"],
    ["Pen", "50", "yes"],
  ]);
  const million = catalog.parseProductCsv("name,price\nPiano,1,250,000");
  assert.equal(million[0].price, "1,250,000");
  // No header: rows with two cells set the shape, so "2,500" in a three-cell row joins.
  const bare = catalog.parseProductCsv("Pen,50\nAtomic Habits,2,500\nRuler,80");
  assert.equal(bare[1].price, "2,500");
  // Ambiguous: the extra cell is not a 3-digit group, so nothing is joined.
  const odd = catalog.parseProductCsv("name,price,in_stock\nMug,2,50,yes");
  assert.equal(odd[0].price, "2");
});

test("import: per-row warnings for the preview", () => {
  assert.deepEqual(catalog.productImportWarnings({ name: "Dune", price: "" }), ["No price"]);
  assert.deepEqual(catalog.productImportWarnings({ name: "Dune", price: "cheap" }), ["Check the price"]);
  assert.deepEqual(catalog.productImportWarnings({ name: "Dune", price: "Ask" }), []);
  assert.deepEqual(catalog.productImportWarnings({ name: "Dune", price: "2,500 KES" }), []);
  const sheet = read("dashboard/src/components/settings/catalog/CatalogImportSheet.tsx");
  assert.match(sheet, /warningsFor\?\.\(row\)\.length/);
});

test("import: Update prices of existing items matches by name, any case, and removes nothing", () => {
  const base = (name: string, price: string) => ({ ...catalog.emptyProduct(), name, price });
  const existing = [{ ...base("Atomic Habits", "2000"), id: "prd_1", category: "Self-help" }, base("Dune", "1500")];
  const incoming = [base("atomic habits", "2,500"), base("Pen", "50"), base("Dune", "")];
  const updated = catalog.mergeProductCatalog(existing, incoming, "update");
  assert.deepEqual(updated.map((p) => [p.name, p.price]), [
    ["Atomic Habits", "2,500"],
    ["Dune", "1500"],
    ["Pen", "50"],
  ]);
  assert.equal(updated[0].id, "prd_1");
  assert.equal(updated[0].category, "Self-help");
  const kept = catalog.mergeProductCatalog(existing, incoming, "merge");
  assert.equal(kept[0].price, "2000");
  assert.equal(catalog.mergeProductCatalog(existing, incoming, "replace").length, 3);
  assert.match(read("dashboard/src/components/TenantForm.tsx"), /bulkProductsUpdate \? "update" : "merge"/);
});

test("import: a file picker sits next to the paste box", () => {
  for (const f of ["dashboard/src/components/settings/catalog/CatalogImportSheet.tsx"]) {
    const src = read(f);
    assert.match(src, /type="file"/);
    assert.match(src, /Choose a file/);
    assert.match(src, /await file\.text\(\)/);
  }
});

// --- 6–9. Small fixes -------------------------------------------------------------

test("catalogue: phone service rows show their labels", () => {
  const form = read("dashboard/src/components/TenantForm.tsx");
  assert.match(form, /CatalogPriceEditor/);
  for (const id of ["svc-name-m", "svc-notes-m", "svc-oos-m"]) {
    assert.match(form, new RegExp(`<label className=\\{serviceMobileLabelClass\\} htmlFor=\\{\`${id}-`));
    assert.doesNotMatch(form, new RegExp(`<label className="sr-only" htmlFor=\\{\`${id}-`));
  }
});

test("identity: no other business's name as a placeholder; the toast names the field", () => {
  const form = read("dashboard/src/components/TenantForm.tsx");
  assert.doesNotMatch(form, /placeholder="Done and Dusted"/);
  const structured = read("dashboard/src/app/(desk)/settings/structuredActions.ts");
  assert.doesNotMatch(structured, /Business type saved/);
  assert.match(structured, /Saved what you sell\./);
});

test("payments: Yes, this is right is a 44px button", () => {
  const pay = read("dashboard/src/components/structured/PaymentsEditor.tsx");
  assert.match(pay, /<Button variant="tonal" size="md" onClick=\{\(\) => onChange\(\{ \.\.\.p, source: "owner", confirmed: true \}\)\}>\s*Yes, this is right/);
  assert.match(read("dashboard/src/components/ui/Button.tsx"), /md: "h-11/);
});
