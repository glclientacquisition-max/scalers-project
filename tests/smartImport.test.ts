import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseKesPrice, kesAmount } from "../dashboard/src/lib/smartImport/kes.ts";
import { fuzzyKey, nameSimilarity } from "../dashboard/src/lib/smartImport/catalogMatch.ts";
import { parseSmartImportJson, smartItem, SMART_IMPORT_RESPONSE_SCHEMA } from "../dashboard/src/lib/smartImport/schema.ts";
import { diffImport, diffCounts, groupByTarget, type SavedSettings } from "../dashboard/src/lib/smartImport/diffImport.ts";
import { buildApplyPlan } from "../dashboard/src/lib/smartImport/plan.ts";
import { smartImportEnabled } from "../dashboard/src/lib/smartImport/flag.ts";
import { classifyImportFile, countPdfPages, prepareImportFile } from "../dashboard/src/lib/ingest/fileInput.ts";
import { catalogBaseline, settleCatalogPrices } from "../dashboard/src/lib/catalogPricing.ts";
import { formatServicesForCompiler, parseServicesCatalogField, type ServiceItem } from "../dashboard/src/lib/servicesCatalog.ts";
import { formatProductsForCompiler, parseProductCatalogField, type ProductItem } from "../dashboard/src/lib/productCatalog.ts";
import { formatServiceAreasForCompiler, parseServiceAreasField, emptyServiceAreas } from "../dashboard/src/lib/serviceAreas.ts";
import { formatLocationsForCompiler, parseBusinessLocationsField, placeLocationLine } from "../dashboard/src/lib/businessLocations.ts";
import { formatHoursForCompiler, parseHoursSchedule } from "../dashboard/src/lib/hoursSchedule.ts";
import { normalizeBusinessPolicies } from "../dashboard/src/lib/businessPolicies.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

const svc = (name: string, price_range: string): ServiceItem => ({ id: `svc_${name.toLowerCase().replace(/\W+/g, "")}`, name, price_range, notes: "", out_of_scope: "", in_stock: "", category: "" });
const prd = (name: string, price: string): ProductItem => ({ id: `prd_${name.toLowerCase().replace(/\W+/g, "")}`, name, sku: "", category: "", price, unit: "", in_stock: "", notes: "", aliases: [] });

function saved(): SavedSettings {
  return {
    services: [svc("Deep cleaning", "3000"), svc("Sofa cleaning", "1500")],
    products: [prd("Chapati (1pc)", "30"), prd("Chips mayai", "250")],
    faqs: [{ question: "Do you deliver?", answer: "Yes, within Nairobi." }],
    locations: [{ label: "Main", address: "Kimathi Street, Nairobi CBD", landmark: "", directions: "", coverage_notes: "" }],
    serviceAreas: { ...emptyServiceAreas("retail"), areas: [{ id: "place:ruaka", modes: ["delivery"], fee_mode: "fixed", fee_ksh: 200, eta: null, min_order_ksh: null, source: "owner", confirmed: true }] },
    policies: normalizeBusinessPolicies({ payment: "" }),
    hours: parseHoursSchedule({ days: { mon: { open: "08:00", close: "18:00" }, tue: { open: "08:00", close: "18:00" } } }),
  };
}
const ctx = { tenantId: "t1", servicesNotes: "", locationNotes: "Main · Kimathi Street, Nairobi CBD", sourceLabel: "import:paste", vertical: "retail" };

test("KES formats, ranges and from-prices", () => {
  assert.equal(parseKesPrice("Ksh 1,500/=").text, "1500");
  assert.equal(parseKesPrice("KSh1500").text, "1500");
  assert.equal(parseKesPrice("1,500/-").text, "1500");
  assert.equal(parseKesPrice("1.5k").text, "1500");
  assert.equal(parseKesPrice("500 - 800").text, "500-800");
  assert.equal(parseKesPrice("500 hadi 800 bob").text, "500-800");
  assert.equal(parseKesPrice("from 300").text, "from 300");
  assert.equal(parseKesPrice("kuanzia 300").text, "from 300");
  assert.equal(parseKesPrice("Price on request").text, "ask");
  assert.equal(parseKesPrice("").text, "");
  assert.equal(kesAmount("2k"), 2000);
});

test("fuzzy keys merge sizes, plurals and case", () => {
  assert.equal(fuzzyKey("Chapati (1pc)"), fuzzyKey("chapatis"));
  assert.ok(nameSimilarity("Chips Mayai", "chips mayai") === 1);
  assert.ok(nameSimilarity("Deep cleaning", "Sofa cleaning") < 0.86);
});

test("schema parsing: structured output is sanitized, capped and routed", () => {
  const raw = JSON.stringify({
    items: [
      { target: "products", confidence: "high", evidence: "Chapati 30", name: " Chapati ", price: "Ksh 30/=" },
      { target: "coverage", confidence: "high", evidence: "Ruaka 250", area: "Ruaka", fee_ksh: 250 },
      { target: "hours", confidence: "high", evidence: "Mon 8-6", days: { mon: "8:00-18:00", sun: "closed" } },
      { target: "payments", confidence: "high", evidence: "Till 123456", text: "M-Pesa till 123456" },
      { target: "policies", confidence: "medium", evidence: "No refunds", policy_kind: "returns", text: "No refunds on food." },
      { target: "faqs", confidence: "high", evidence: "q", question: "Parking?", answer: "Yes, free." },
      { target: "teleport", name: "x" },
      { target: "products", confidence: "high", name: "" },
      { target: "policies", confidence: "high", text: "no kind" },
    ],
  });
  const items = parseSmartImportJson(raw);
  assert.deepEqual(items.map((i) => i.target), ["products", "coverage", "hours", "payments", "policies", "faqs"]);
  assert.equal(items[0].name, "Chapati");
  assert.equal(items[0].price, "30");
  assert.deepEqual(items[2].days, { mon: "08:00-18:00", sun: "closed" });
  // Text with stray prose around the JSON still parses (fallback).
  assert.equal(parseSmartImportJson(`Here you go: ${raw} thanks`).length, 6);
  assert.equal(parseSmartImportJson("not json").length, 0);
  // Schema is a plain object Gemini accepts (type + properties, no $ref).
  assert.equal((SMART_IMPORT_RESPONSE_SCHEMA as { type: string }).type, "object");
  assert.ok(!JSON.stringify(SMART_IMPORT_RESPONSE_SCHEMA).includes("$ref"));
});

test("diffImport: New, Price change, Already saved; no silent duplicates", () => {
  const items = [
    smartItem("products", { name: "Chapati", price: "35", confidence: "high" }),
    smartItem("products", { name: "chips mayai", price: "250", confidence: "high" }),
    smartItem("products", { name: "Mutura", price: "100", confidence: "high" }),
    smartItem("products", { name: "Mutura", price: "100", confidence: "high" }),
    smartItem("services", { name: "Carpet cleaning", price: "2000", confidence: "low" }),
    smartItem("coverage", { area: "Ruaka", fee_ksh: 250, confidence: "high" }),
    smartItem("coverage", { area: "Atlantis", fee_ksh: 100, confidence: "high" }),
    smartItem("faqs", { question: "Do you deliver?", answer: "Yes, within Nairobi.", confidence: "high" }),
  ];
  const rows = diffImport(items, saved());
  const by = (name: string) => rows.find((r) => r.item.name === name || r.item.area === name)!;
  assert.equal(by("Chapati").status, "update");
  assert.equal(by("Chapati").change, "Price 30 to 35");
  assert.equal(by("Chapati").decision, "update");
  assert.equal(by("chips mayai").status, "same");
  assert.equal(by("chips mayai").decision, "skip");
  assert.equal(rows.filter((r) => r.item.name === "Mutura").length, 1, "duplicate inside one import collapses");
  assert.equal(by("Mutura").status, "new");
  assert.equal(by("Carpet cleaning").needsReview, true);
  assert.equal(by("Carpet cleaning").decision, "skip", "low confidence is not ticked by default");
  assert.equal(by("Ruaka").status, "update");
  assert.equal(by("Ruaka").areaId, "place:ruaka");
  assert.equal(by("Atlantis").applicable, false);
  const counts = diffCounts(rows);
  assert.equal(counts.total, rows.length);
  assert.deepEqual(groupByTarget(rows).map((g) => g.target), ["unsure", "products", "faqs", "coverage"], "low confidence lands in Not sure where this goes");
});

test("routing: each target goes to its existing save path and scope", () => {
  const items = [
    smartItem("products", { name: "Chapati", price: "35", confidence: "high" }),
    smartItem("products", { name: "Mutura", price: "100", confidence: "high" }),
    smartItem("services", { name: "Carpet cleaning", price: "2000", confidence: "high" }),
    smartItem("faqs", { question: "Is there parking?", answer: "Yes, free.", confidence: "high" }),
    smartItem("payments", { text: "M-Pesa till 123456", confidence: "high" }),
    smartItem("policies", { policy_kind: "returns", text: "No refunds on food.", confidence: "high" }),
    smartItem("hours", { days: { sat: "09:00-14:00", sun: "closed" }, confidence: "high" }),
    smartItem("coverage", { area: "Kileleshwa", fee_ksh: 300, confidence: "high" }),
    smartItem("locations", { name: "Westlands", address: "Mpaka Road, Westlands", confidence: "high" }),
  ];
  const steps = buildApplyPlan(diffImport(items, saved()), saved(), ctx);
  assert.deepEqual(steps.map((s) => s.kind), ["catalog", "ingest", "catalogImport", "hours", "locations"]);
  const scope = (k: string) => steps.find((s) => s.kind === k)!.fields.settings_scope;
  assert.equal(scope("catalog"), "catalog");
  assert.equal(scope("hours"), "hours");
  assert.equal(scope("locations"), "locations");
  const ingest = steps.find((s) => s.kind === "ingest")!;
  assert.equal(ingest.action, "ingest");
  const draft = JSON.parse(ingest.fields.draft_json);
  assert.deepEqual(draft.services.map((s: ServiceItem) => s.name), ["Carpet cleaning"]);
  assert.equal(draft.policies.payment, "M-Pesa till 123456");
  assert.equal(draft.policies.returns, "No refunds on food.");
  assert.equal(ingest.fields.include_locations, "0", "places and areas go through the Locations scope, not ingest");
  const cat = steps.find((s) => s.kind === "catalogImport")!;
  assert.equal(cat.action, "catalogImport");
  assert.deepEqual(JSON.parse(cat.fields.products_json).map((p: ProductItem) => p.name), ["Mutura"]);
  const loc = steps.find((s) => s.kind === "locations")!;
  const areas = parseServiceAreasField(loc.fields.service_areas, "retail")!;
  const added = areas.areas.find((a) => a.id === "place:kileleshwa")!;
  assert.equal(added.fee_ksh, 300);
  assert.equal(added.source, "import");
  assert.equal(added.confirmed, false, "imported areas stay suggestions");
  assert.ok(areas.areas.find((a) => a.id === "place:ruaka"), "saved areas are kept");
  // Nothing outside its scope rides along.
  for (const s of steps) assert.ok(!("business_policies" in s.fields) && !("llm_system_prompt" in s.fields));
});

test("compile parity: import then apply posts the same compile inputs as the equivalent manual save", () => {
  const before = saved();
  // Import: a price change on a saved product and service, plus a new delivery area and hours.
  const items = [
    smartItem("products", { name: "Chapati", price: "35", confidence: "high" }),
    smartItem("services", { name: "Sofa cleaning", price: "1800", confidence: "high" }),
    smartItem("coverage", { area: "Kileleshwa", fee_ksh: 300, confidence: "high" }),
    smartItem("hours", { days: { sat: "09:00-14:00" }, confidence: "high" }),
  ];
  const steps = buildApplyPlan(diffImport(items, before), before, ctx);
  const step = (k: string) => steps.find((s) => s.kind === k)!.fields;

  // Manual: the owner types the new prices into the Catalog form (TenantForm posts these fields).
  const manualServices = before.services.map((s) => (s.name === "Sofa cleaning" ? { ...s, price_range: "1800" } : s));
  const manualProducts = before.products.map((p) => (p.name === "Chapati (1pc)" ? { ...p, price: "35" } : p));
  const manualCatalog = {
    services_catalog: JSON.stringify(manualServices.filter((s) => s.name.trim())),
    product_catalog: JSON.stringify(manualProducts.filter((p) => p.name.trim())),
    catalog_baseline: JSON.stringify({
      ...catalogBaseline(before.services as never, "service"),
      ...catalogBaseline(before.products as never, "product"),
    }),
    services_notes: "",
  };
  for (const k of Object.keys(manualCatalog) as Array<keyof typeof manualCatalog>) {
    assert.deepEqual(step("catalog")[k], manualCatalog[k], `catalog field ${k}`);
  }
  // What saveAndCompileSettings derives for the compiler from those fields.
  const derive = (f: Record<string, string>) => {
    const baseline = JSON.parse(f.catalog_baseline);
    const services = settleCatalogPrices(parseServicesCatalogField(f.services_catalog), before.services as never, "service", { baseline, unitFallback: "job" });
    const products = settleCatalogPrices(parseProductCatalogField(f.product_catalog), before.products as never, "product", { baseline });
    return [formatServicesForCompiler(services, f.services_notes), formatProductsForCompiler(products)];
  };
  assert.deepEqual(derive(step("catalog")), derive(manualCatalog));
  assert.match(derive(step("catalog"))[0], /Sofa cleaning - price 1800/);

  // Manual Locations save adding the same area as an unconfirmed suggestion with the same fee.
  const manualAreas = {
    ...before.serviceAreas,
    areas: [...before.serviceAreas.areas, { id: "place:kileleshwa", modes: ["delivery" as const], fee_mode: "fixed" as const, fee_ksh: 300, eta: null, min_order_ksh: null, source: "import" as const, confirmed: false }],
  };
  const locText = (areasJson: string, locJson: string) => {
    const areas = parseServiceAreasField(areasJson, "retail");
    return [formatLocationsForCompiler(parseBusinessLocationsField(locJson), { noPremises: areas?.no_premises }), formatServiceAreasForCompiler(areas)].join("\n\n");
  };
  assert.equal(
    locText(step("locations").service_areas, step("locations").business_locations),
    locText(JSON.stringify(manualAreas), JSON.stringify(before.locations))
  );
  assert.equal(step("locations").location_notes, placeLocationLine(before.locations[0]));

  // Hours: the same grid a manual Hours save posts.
  const manualHours = { ...before.hours!, days: { ...before.hours!.days, sat: { open: "09:00", close: "14:00" } } };
  assert.equal(formatHoursForCompiler(parseHoursSchedule(step("hours").hours_schedule)), formatHoursForCompiler(manualHours));
});

test("compile path untouched: no smart import code in the compiler, flag gates the panel", () => {
  assert.ok(!read("dashboard/src/lib/promptCompiler.ts").includes("smartImport"));
  const shell = read("dashboard/src/components/BusinessSettingsShell.tsx");
  assert.match(shell, /if \(smartImport\) return <SmartImportPanel/);
  assert.match(shell, /<CatalogImportPanel tenant=\{tenant\} \/>/);
  assert.equal(smartImportEnabled({}), false);
  assert.equal(smartImportEnabled({ DESK_SMART_IMPORT: "1" }), true);
  const action = read("dashboard/src/app/(desk)/settings/smartImportActions.ts");
  assert.ok(!/\.update\(|\.insert\(|\.upsert\(/.test(action), "extract action never writes");
});

test("file input: types, size, HEIC and XLSX messages, PDF page cap", () => {
  assert.equal(classifyImportFile({ name: "menu.jpg", type: "image/jpeg", size: 100 }).ok, true);
  assert.equal(classifyImportFile({ name: "IMG.HEIC", type: "image/heic", size: 100 }).ok, false);
  const x = classifyImportFile({ name: "prices.xlsx", type: "", size: 100 });
  assert.ok(!x.ok && /CSV/.test(x.error));
  assert.equal(classifyImportFile({ name: "big.pdf", type: "application/pdf", size: 11 * 1024 * 1024 }).ok, false);
  const pdf = (pages: number) =>
    new TextEncoder().encode(`%PDF-1.4\n1 0 obj << /Type /Pages /Count ${pages} >>\n` + Array.from({ length: pages }, () => "<< /Type /Page >>").join("\n"));
  assert.equal(countPdfPages(pdf(3)), 3);
  assert.equal(prepareImportFile({ name: "a.pdf", type: "application/pdf", size: 1 }, pdf(3)).ok, true);
  const tooMany = prepareImportFile({ name: "a.pdf", type: "application/pdf", size: 1 }, pdf(12));
  assert.ok(!tooMany.ok && /12 pages/.test(tooMany.error));
  const fake = prepareImportFile({ name: "a.png", type: "image/png", size: 4 }, new Uint8Array([1, 2, 3, 4]));
  assert.equal(fake.ok, false);
  const csv = prepareImportFile({ name: "p.csv", type: "text/csv", size: 1 }, new TextEncoder().encode("name,price\nChapati,30\n"));
  assert.ok(csv.ok && csv.kind === "csv");
});

test("smart import UI copy: no em or en dashes, says business", () => {
  const ui = read("dashboard/src/components/settings/SmartImportPanel.tsx") + read("dashboard/src/lib/smartImport/diffImport.ts") + read("dashboard/src/lib/ingest/fileInput.ts");
  assert.ok(!/[\u2013\u2014]/.test(ui));
  assert.ok(!/tenant/i.test(read("dashboard/src/lib/smartImport/diffImport.ts")));
});

test("#611: import preview lists every row and the services header shows a count", () => {
  const sheet = read("dashboard/src/components/settings/catalog/CatalogImportSheet.tsx");
  assert.ok(!sheet.includes("slice(0, 8)"));
  assert.match(sheet, /overflow-y-auto/);
  const form = read("dashboard/src/components/TenantForm.tsx");
  assert.match(form, /setServicePage\(Math\.max\(0, Math\.ceil\(nextCount \/ SERVICE_PAGE_SIZE\) - 1\)\)/);
});

// ---- Classification eval (mocked model outputs; the real-model run is scripts/eval-smart-import.ts) ----
import { scoreDocs, findItem, type EvalDoc } from "../dashboard/src/lib/smartImport/evalScore.ts";
import { moveRow, isUnsure } from "../dashboard/src/lib/smartImport/diffImport.ts";

const EVAL = JSON.parse(read("tests/fixtures/smartImport/eval.json")) as { docs: EvalDoc[] };

test("classification eval: every fixture fact routes to its destination (mocked model)", () => {
  const results = EVAL.docs.map((doc) => ({ doc, items: parseSmartImportJson(JSON.stringify({ items: doc.mock })) }));
  // Schema check: every mocked item survives sanitizing (none dropped as malformed).
  for (const { doc, items } of results) assert.equal(items.length, doc.mock!.length, `${doc.id}: schema dropped an item`);
  const score = scoreDocs(results);
  assert.deepEqual(score.misses, []);
  for (const t of ["products", "services", "faqs", "locations", "coverage", "hours", "payments", "policies", "profile"]) {
    assert.ok(score.perTarget[t]?.total, `fixtures cover ${t}`);
  }
});

test("classification eval: ambiguous items go to Not sure where this goes, profile always needs review", () => {
  for (const doc of EVAL.docs) {
    const items = parseSmartImportJson(JSON.stringify({ items: doc.mock }));
    const rows = diffImport(items, saved());
    for (const fact of doc.unsure || []) {
      const item = findItem(items, fact)!;
      assert.ok(isUnsure(item), `${doc.id}: ${fact} is unsure`);
      const row = rows.find((r) => r.item === item || r.item.evidence === item.evidence)!;
      assert.equal(row.unsure, true);
      assert.equal(row.decision, "skip");
    }
    const groups = groupByTarget(rows);
    if (doc.unsure?.length) assert.equal(groups[0].target, "unsure");
    for (const r of rows.filter((x) => x.target === "profile")) {
      assert.equal(r.needsReview, true);
      assert.equal(r.decision, "skip", "profile is never ticked by default");
    }
    // Unsure rows never reach a save step even if ticked.
    const ticked = rows.map((r) => ({ ...r, decision: r.status === "new" ? ("add" as const) : ("update" as const) }));
    const steps = buildApplyPlan(ticked, saved(), ctx);
    for (const fact of doc.unsure || []) {
      assert.ok(!steps.some((s) => Object.values(s.fields).join(" ").includes(fact)), `${fact} not saved while unsure`);
    }
  }
});

test("owner picks a destination for an unsure row: it re-diffs there and waits for a tick", () => {
  const items = parseSmartImportJson(JSON.stringify({ items: EVAL.docs.find((d) => d.id === "delivery_areas")!.mock }));
  const rows = diffImport(items, saved());
  const box = rows.find((r) => r.item.name === "Delivery box")!;
  const moved = moveRow(box, "products", saved());
  assert.equal(moved.unsure, false);
  assert.equal(moved.target, "products");
  assert.equal(moved.key, box.key);
  assert.equal(moved.decision, "skip");
});

test("profile changes are proposals: only business name can be applied, and only through the importer rename", () => {
  const s = { ...saved(), profile: { business_name: "Old Name", website: "old.co.ke" } };
  const rows = diffImport(
    [
      smartItem("profile", { profile_field: "business_name", text: "New Name", confidence: "high" }),
      smartItem("profile", { profile_field: "website", text: "new.co.ke", confidence: "high" }),
    ],
    s
  );
  assert.equal(rows[0].status, "update");
  assert.equal(rows[1].applicable, false);
  assert.deepEqual(buildApplyPlan(rows, s, ctx), [], "nothing is written by default");
  const ticked = rows.map((r) => ({ ...r, decision: "update" as const }));
  const steps = buildApplyPlan(ticked, s, ctx);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].fields.rename_business, "1");
  assert.equal(JSON.parse(steps[0].fields.draft_json).businessNameSuggestion, "New Name");
  assert.ok(!JSON.stringify(steps).includes("new.co.ke"), "website is never written by import");
});
