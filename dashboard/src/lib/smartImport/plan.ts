/**
 * Turn the owner's decisions into calls on the EXISTING save paths. Nothing here writes or
 * compiles: each step is the form a manual Settings save (or the existing importers) would
 * post, so the prompt compile and the spoken catalogue run exactly as they do today.
 *
 * Steps, in order:
 * - catalog (saveAndCompileSettings, scope catalog): price changes on saved rows, posted with
 *   the load baseline exactly like editing the price text by hand.
 * - faqs (saveAndCompileSettings, scope faqs): new answers for saved questions.
 * - ingest (applyIngestAction): new services, new FAQs, payments and policies.
 * - catalogImport (applyCatalogImportAction): new products (withImportedPricing, recompile, provenance).
 * - hours (saveAndCompileSettings, scope hours): weekly hours.
 * - locations (saveAndCompileSettings, scope locations): places plus areas you serve with fees.
 *
 * Pure and browser-safe.
 */
import type { ServiceItem } from "../servicesCatalog";
import type { ProductItem } from "../productCatalog";
import type { FaqEntry } from "../supabase";
import type { BusinessLocation } from "../businessLocations";
import type { BusinessPolicies } from "../businessPolicies";
import type { HoursSchedule } from "../hoursSchedule";
import type { ServiceArea, ServiceAreas } from "../serviceAreas";
import { catalogBaseline } from "../catalogPricing";
import { placeLocationLine } from "../businessLocations";
import { DAY_KEYS } from "./schema";
import type { DiffRow, SavedSettings } from "./diffImport";

export type PlanStepKind = "catalog" | "faqs" | "ingest" | "catalogImport" | "hours" | "locations";
export type PlanAction = "settings" | "ingest" | "catalogImport";

export type PlanStep = {
  kind: PlanStepKind;
  action: PlanAction;
  fields: Record<string, string>;
  /** Owner-facing summary, e.g. "3 price changes". */
  summary: string;
};

export type PlanContext = {
  tenantId: string;
  /** Free-text notes the catalog form posts back (extractServicesNotes of services_offered). */
  servicesNotes: string;
  /** The hours location line as stored (Locations owns it). */
  locationNotes: string;
  sourceLabel: string;
  vertical?: string | null;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function picked(rows: DiffRow[], target: DiffRow["target"], decision: "add" | "update"): DiffRow[] {
  // Unsure rows wait until the owner gives them a tab.
  return rows.filter((r) => r.target === target && r.decision === decision && r.applicable && !r.unsure);
}

function importedService(r: DiffRow): ServiceItem {
  return {
    name: r.item.name,
    price_range: r.item.price,
    notes: r.item.notes,
    out_of_scope: "",
    in_stock: "",
    category: r.item.category,
    source: "import",
  };
}

function importedProduct(r: DiffRow): ProductItem {
  return {
    name: r.item.name,
    sku: "",
    category: r.item.category,
    price: r.item.price,
    unit: r.item.unit,
    in_stock: "",
    notes: r.item.notes,
    aliases: r.item.aliases,
  };
}

function areaFromRow(r: DiffRow, prev: ServiceArea | null, vertical?: string | null): ServiceArea {
  const fee = r.item.fee_ksh;
  const mode = vertical === "home_services" ? "visit" : "delivery";
  return {
    id: r.areaId || "",
    modes: prev?.modes?.length ? prev.modes : [mode],
    fee_mode: fee == null ? "ask" : fee === 0 ? "free" : "fixed",
    fee_ksh: fee != null && fee > 0 ? fee : null,
    eta: r.item.eta || prev?.eta || null,
    min_order_ksh: prev?.min_order_ksh ?? null,
    // Imported areas stay suggestions until the owner confirms them on Locations.
    source: "import",
    confirmed: false,
  };
}

/** Saved catalogue with the owner's ticked price changes applied (what hand-editing produces). */
export function catalogWithUpdates(rows: DiffRow[], saved: SavedSettings): { services: ServiceItem[]; products: ProductItem[] } {
  const services = saved.services.map((s) => ({ ...s }));
  const products = saved.products.map((p) => ({ ...p }));
  for (const r of picked(rows, "services", "update")) {
    if (services[r.matchIndex]) services[r.matchIndex] = { ...services[r.matchIndex], price_range: r.item.price };
  }
  for (const r of picked(rows, "products", "update")) {
    if (products[r.matchIndex]) products[r.matchIndex] = { ...products[r.matchIndex], price: r.item.price };
  }
  return { services, products };
}

export function hoursWithImport(rows: DiffRow[], saved: SavedSettings): HoursSchedule | null {
  const r = rows.find((x) => x.target === "hours" && x.decision !== "skip" && !x.unsure);
  if (!r) return null;
  const base: HoursSchedule = saved.hours
    ? { ...saved.hours, days: { ...saved.hours.days } }
    : {
        timezone: "Africa/Nairobi",
        location: "",
        days: { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null },
      };
  for (const d of DAY_KEYS) {
    const v = r.item.days[d];
    if (!v) continue;
    if (v === "closed") base.days[d] = null;
    else {
      const [open, close] = v.split("-");
      base.days[d] = { open, close };
    }
  }
  return base;
}

export function locationsWithImport(
  rows: DiffRow[],
  saved: SavedSettings,
  vertical?: string | null
): { locations: BusinessLocation[]; areas: ServiceAreas; changed: { places: number; areas: number } } {
  const locations = saved.locations.map((l) => ({ ...l }));
  let places = 0;
  for (const r of picked(rows, "locations", "update")) {
    if (locations[r.matchIndex]) {
      locations[r.matchIndex] = { ...locations[r.matchIndex], landmark: r.item.landmark };
      places += 1;
    }
  }
  for (const r of picked(rows, "locations", "add")) {
    if (locations.length >= 8) break;
    locations.push({
      label: r.item.name || (locations.length ? `Branch ${locations.length + 1}` : "Main"),
      address: r.item.address,
      landmark: r.item.landmark,
      directions: "",
      coverage_notes: "",
    });
    places += 1;
  }
  const areaList = saved.serviceAreas.areas.map((a) => ({ ...a }));
  let areas = 0;
  for (const r of rows.filter((x) => x.target === "coverage" && x.decision !== "skip" && x.applicable && !x.unsure && x.areaId)) {
    const idx = areaList.findIndex((a) => a.id === r.areaId);
    if (idx >= 0) areaList[idx] = areaFromRow(r, areaList[idx], vertical);
    else if (areaList.length < 40) areaList.push(areaFromRow(r, null, vertical));
    areas += 1;
  }
  return { locations, areas: { ...saved.serviceAreas, areas: areaList }, changed: { places, areas } };
}

/** Policies text the ingest step fills (payments and policies rows the owner kept). */
export function policiesFromRows(rows: DiffRow[]): Partial<BusinessPolicies> {
  const out: Record<string, string> = {};
  for (const r of rows) {
    if (r.decision === "skip" || r.unsure) continue;
    if (r.target === "payments") out.payment = r.item.text;
    if (r.target === "policies" && r.item.policy_kind) out[r.item.policy_kind] = r.item.text;
  }
  return out as Partial<BusinessPolicies>;
}

export function buildApplyPlan(rows: DiffRow[], saved: SavedSettings, ctx: PlanContext): PlanStep[] {
  const steps: PlanStep[] = [];

  const svcUpdates = picked(rows, "services", "update");
  const prdUpdates = picked(rows, "products", "update");
  if (svcUpdates.length || prdUpdates.length) {
    const { services, products } = catalogWithUpdates(rows, saved);
    steps.push({
      kind: "catalog",
      action: "settings",
      summary: plural(svcUpdates.length + prdUpdates.length, "price change"),
      fields: {
        id: ctx.tenantId,
        settings_scope: "catalog",
        services_catalog: JSON.stringify(services.filter((s) => s.name.trim())),
        product_catalog: JSON.stringify(products.filter((p) => p.name.trim())),
        catalog_baseline: JSON.stringify({
          ...catalogBaseline(saved.services as unknown as Record<string, unknown>[], "service"),
          ...catalogBaseline(saved.products as unknown as Record<string, unknown>[], "product"),
        }),
        services_notes: ctx.servicesNotes,
      },
    });
  }

  const faqUpdates = picked(rows, "faqs", "update");
  if (faqUpdates.length) {
    const faqs: FaqEntry[] = saved.faqs.map((f) => ({ ...f }));
    for (const r of faqUpdates) if (faqs[r.matchIndex]) faqs[r.matchIndex] = { ...faqs[r.matchIndex], answer: r.item.answer };
    steps.push({
      kind: "faqs",
      action: "settings",
      summary: plural(faqUpdates.length, "updated answer"),
      fields: { id: ctx.tenantId, settings_scope: "faqs", faqs: JSON.stringify(faqs) },
    });
  }

  const newServices = picked(rows, "services", "add").map(importedService);
  const newFaqs = picked(rows, "faqs", "add").map((r) => ({ question: r.item.question, answer: r.item.answer }));
  const policies = policiesFromRows(rows);
  const hasPolicies = Object.keys(policies).length > 0;
  // Business name: only when the owner ticked it; uses the importer's existing rename path.
  const rename = rows.find(
    (r) => r.target === "profile" && r.item.profile_field === "business_name" && r.decision !== "skip" && !r.unsure && r.status !== "same"
  );
  if (newServices.length || newFaqs.length || hasPolicies || rename) {
    const draft = {
      services: newServices,
      faqs: newFaqs,
      team: [],
      unknownAnswerFallback: "",
      sourceLabel: ctx.sourceLabel || "import",
      policies: hasPolicies ? policies : undefined,
      businessNameSuggestion: rename ? rename.item.text : undefined,
    };
    const bits = [];
    if (newServices.length) bits.push(plural(newServices.length, "new service"));
    if (newFaqs.length) bits.push(plural(newFaqs.length, "new FAQ"));
    if (hasPolicies) bits.push("payments and policies");
    if (rename) bits.push("business name");
    steps.push({
      kind: "ingest",
      action: "ingest",
      summary: bits.join(", "),
      fields: {
        tenant_id: ctx.tenantId,
        draft_json: JSON.stringify(draft),
        merge_mode: "merge",
        selected_services: newServices.map((_, i) => i).join(","),
        selected_faqs: newFaqs.map((_, i) => i).join(","),
        selected_team: "",
        include_policies: hasPolicies ? "1" : "0",
        include_locations: "0",
        include_hours: "0",
        rename_business: rename ? "1" : "0",
      },
    });
  }

  const newProducts = picked(rows, "products", "add").map(importedProduct);
  if (newProducts.length) {
    steps.push({
      kind: "catalogImport",
      action: "catalogImport",
      summary: plural(newProducts.length, "new product"),
      fields: {
        tenant_id: ctx.tenantId,
        products_json: JSON.stringify(newProducts),
        merge_mode: "merge",
        include_social: "0",
        // The owner reviewed each row in the import sheet: same as "Confirm selected" today.
        confirm: "1",
      },
    });
  }

  const hours = hoursWithImport(rows, saved);
  if (hours) {
    steps.push({
      kind: "hours",
      action: "settings",
      summary: "weekly hours",
      fields: { id: ctx.tenantId, settings_scope: "hours", hours_schedule: JSON.stringify(hours), business_hours: "" },
    });
  }

  const loc = locationsWithImport(rows, saved, ctx.vertical);
  if (loc.changed.places || loc.changed.areas) {
    const bits = [];
    if (loc.changed.places) bits.push(plural(loc.changed.places, "place"));
    if (loc.changed.areas) bits.push(plural(loc.changed.areas, "area"));
    const firstLine = loc.locations[0] ? placeLocationLine(loc.locations[0]) : "";
    steps.push({
      kind: "locations",
      action: "settings",
      summary: bits.join(", "),
      fields: {
        id: ctx.tenantId,
        settings_scope: "locations",
        business_locations: JSON.stringify(loc.locations),
        service_areas: JSON.stringify(loc.areas),
        // Same rule as the Locations form: the first place line, else the stored line.
        location_notes: firstLine || ctx.locationNotes,
      },
    });
  }
  return steps;
}
