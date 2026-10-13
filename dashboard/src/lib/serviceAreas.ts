/**
 * Areas you serve (Settings › Locations). Each area is a directory id (county:<id> or
 * place:<id>) with how you serve it, the fee, how long it takes and a minimum order.
 *
 * Stored in tenants.service_areas. business_policies.coverage_areas is kept in step from
 * here for one release so the voice server's coverage check keeps working unchanged.
 *
 * Pure and browser-safe. Relative imports only so node tests can load it.
 */
import { coverageAreaLabel, parseCoverageAreas, searchAreaOptions, COVERAGE_AREA_MAX, type AreaOption } from "./coverageAreas";

export type AreaMode = "delivery" | "visit" | "pickup";
export type FeeMode = "free" | "fixed" | "ask";
export type DeliveredBy = "self" | "rider" | "courier";
export type RiderPaid = "in_fee" | "on_arrival";
/** How customers reach the business. Defaults from the business type. */
export type Reach = "deliver" | "visit" | "walk_in" | "both";

export type ServiceArea = {
  id: string;
  modes: AreaMode[];
  fee_mode: FeeMode;
  fee_ksh: number | null;
  eta: string | null;
  min_order_ksh: number | null;
  source: "owner" | "import";
  confirmed: boolean;
};

export type ServiceAreas = {
  version: 1;
  areas: ServiceArea[];
  delivered_by: DeliveredBy[];
  rider_paid: RiderPaid | null;
  reach: Reach;
  /** Home services with no premises: "We come to you"; places are a base for reference only. */
  no_premises: boolean;
  /** "Do you go outside these areas?" Yes = anywhere in Kenya, on one fee (null: the team quotes it). */
  anywhere_kenya: boolean;
  outside_fee_ksh: number | null;
};

export const REACH_OPTIONS: ReadonlyArray<{ id: Reach; label: string; detail: string }> = [
  { id: "deliver", label: "We deliver", detail: "Shops and suppliers" },
  { id: "visit", label: "We visit customers", detail: "Cleaners, fundis, salons at home" },
  { id: "both", label: "We deliver and visit", detail: "Pick per area" },
  { id: "walk_in", label: "Customers come to us", detail: "No delivery or visits" },
];

export function defaultReach(vertical: string | null | undefined): Reach {
  if (vertical === "home_services") return "visit";
  if (vertical === "hospitality") return "walk_in";
  return "deliver";
}

/** Labels for the Locations page, by how customers reach you. */
export function reachCopy(r: Reach): { title: string; fee: string; empty: string; areas: boolean; riders: boolean; perArea: boolean } {
  switch (r) {
    case "visit":
      return { title: "Where do you visit customers?", fee: "Call-out fee", empty: "Add the areas you visit and one call-out fee.", areas: true, riders: false, perArea: false };
    case "both":
      return { title: "Where do you deliver or visit?", fee: "Fee", empty: "Add your areas, then mark each one delivery or visit.", areas: true, riders: true, perArea: true };
    case "walk_in":
      return { title: "Customers come to us", fee: "", empty: "", areas: false, riders: false, perArea: false };
    default:
      return { title: "Where do you deliver?", fee: "Delivery fee", empty: "Add your areas and one delivery fee.", areas: true, riders: true, perArea: false };
  }
}

const REACH_IDS = new Set<Reach>(["deliver", "visit", "walk_in", "both"]);

export const AREA_MODES: ReadonlyArray<{ id: AreaMode; label: string; verb: string }> = [
  { id: "delivery", label: "Delivery", verb: "deliver to" },
  { id: "visit", label: "Home visit", verb: "visit" },
  { id: "pickup", label: "Pickup only", verb: "serve customers from" },
];
export const FEE_MODES: ReadonlyArray<{ id: FeeMode; label: string }> = [
  { id: "free", label: "Free" },
  { id: "fixed", label: "Set fee" },
  { id: "ask", label: "We confirm it" },
];
export const DELIVERED_BY: ReadonlyArray<{ id: DeliveredBy; label: string; detail: string }> = [
  { id: "self", label: "We deliver ourselves", detail: "Your own staff or vehicle" },
  { id: "rider", label: "Rider", detail: "Bolt, Uber, Glovo or a boda rider" },
  { id: "courier", label: "Courier", detail: "G4S, Wells Fargo, Fargo or matatu parcel" },
];
export const RIDER_PAID: ReadonlyArray<{ id: RiderPaid; label: string }> = [
  { id: "in_fee", label: "Included in the delivery fee" },
  { id: "on_arrival", label: "Customer pays the rider on arrival" },
];

export const ETA_MAX = 40;
export const MAX_KSH = 1_000_000;

const MODE_IDS = new Set(AREA_MODES.map((m) => m.id));
const FEE_IDS = new Set(FEE_MODES.map((m) => m.id));
const BY_IDS = new Set(DELIVERED_BY.map((m) => m.id));

export function defaultMode(vertical: string | null | undefined): AreaMode {
  return vertical === "home_services" ? "visit" : "delivery";
}

function ksh(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[,\s]/g, "").replace(/^ksh/i, ""));
  return Number.isFinite(n) && n >= 0 && n <= MAX_KSH ? Math.round(n) : null;
}

export function emptyServiceAreas(vertical?: string | null): ServiceAreas {
  return { version: 1, areas: [], delivered_by: [], rider_paid: null, reach: defaultReach(vertical), no_premises: false, anywhere_kenya: false, outside_fee_ksh: null };
}

export function newServiceArea(id: string, vertical?: string | null): ServiceArea {
  return { id, modes: [defaultMode(vertical)], fee_mode: "ask", fee_ksh: null, eta: null, min_order_ksh: null, source: "owner", confirmed: true };
}

/** Accepts only well-formed areas with ids in the place directory. Null when nothing was ever saved. */
export function normalizeServiceAreas(raw: unknown, vertical?: string | null): ServiceAreas {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(obj.areas) ? obj.areas : [];
  const valid = new Set(parseCoverageAreas(list.map((a) => (a && typeof a === "object" ? (a as Record<string, unknown>).id : null))));
  const seen = new Set<string>();
  const areas: ServiceArea[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const id = String(r.id || "").trim().toLowerCase();
    if (!valid.has(id) || seen.has(id)) continue;
    seen.add(id);
    const modes = (Array.isArray(r.modes) ? r.modes : []).map(String).filter((m): m is AreaMode => MODE_IDS.has(m as AreaMode));
    const fee = ksh(r.fee_ksh);
    let feeMode = FEE_IDS.has(r.fee_mode as FeeMode) ? (r.fee_mode as FeeMode) : "ask";
    if (feeMode === "fixed" && fee == null) feeMode = "ask";
    const eta = String(r.eta ?? "").trim().slice(0, ETA_MAX);
    areas.push({
      id,
      modes: modes.length ? [...new Set(modes)] : [defaultMode(vertical)],
      fee_mode: feeMode,
      fee_ksh: feeMode === "fixed" ? fee : null,
      eta: eta || null,
      min_order_ksh: ksh(r.min_order_ksh),
      source: r.source === "import" ? "import" : "owner",
      confirmed: r.confirmed === true,
    });
    if (areas.length >= COVERAGE_AREA_MAX) break;
  }
  const deliveredBy = (Array.isArray(obj.delivered_by) ? obj.delivered_by : []).map(String).filter((b): b is DeliveredBy => BY_IDS.has(b as DeliveredBy));
  const riderPaid = obj.rider_paid === "in_fee" || obj.rider_paid === "on_arrival" ? (obj.rider_paid as RiderPaid) : null;
  const reach = REACH_IDS.has(obj.reach as Reach) ? (obj.reach as Reach) : defaultReach(vertical);
  const anywhere = obj.anywhere_kenya === true;
  return withReach(
    {
      version: 1,
      areas,
      delivered_by: [...new Set(deliveredBy)],
      rider_paid: riderPaid,
      reach,
      no_premises: obj.no_premises === true,
      anywhere_kenya: anywhere,
      outside_fee_ksh: anywhere ? ksh(obj.outside_fee_ksh) : null,
    },
    reach
  );
}

/**
 * Switch how customers get the service. Outside mixed mode every area follows it, so the
 * list, "Callers hear" and the prompt never say "visit" for a business that delivers.
 */
export function withReach(v: ServiceAreas, reach: Reach): ServiceAreas {
  const next = { ...v, reach, no_premises: reach === "visit" ? v.no_premises : false };
  if (reach === "walk_in") {
    next.anywhere_kenya = false;
    next.outside_fee_ksh = null;
  }
  if (reach !== "deliver" && reach !== "visit") return next;
  const from: AreaMode = reach === "deliver" ? "visit" : "delivery";
  const to: AreaMode = reach === "deliver" ? "delivery" : "visit";
  next.areas = v.areas.map((a) => {
    const modes = [...new Set(a.modes.map((m) => (m === from ? to : m)))];
    return { ...a, modes: modes.length ? modes : [to] };
  });
  return next;
}

/** Old Policies coverage list -> areas with "we confirm the fee", unconfirmed (owner checks them once). */
export function serviceAreasFromCoverage(ids: unknown, vertical?: string | null): ServiceAreas | null {
  if (!Array.isArray(ids)) return null;
  const areas = parseCoverageAreas(ids).map((id) => ({ ...newServiceArea(id, vertical), source: "import" as const, confirmed: false }));
  return { ...emptyServiceAreas(vertical), areas };
}

/** Stored value, or a value read from the old coverage list when Locations was never saved. */
export function serviceAreasForForm(stored: unknown, coverage: unknown, vertical?: string | null): ServiceAreas {
  if (stored && typeof stored === "object") return normalizeServiceAreas(stored, vertical);
  return serviceAreasFromCoverage(coverage, vertical) ?? emptyServiceAreas(vertical);
}

/** business_policies.coverage_areas for the voice server: area ids, or null when none are listed. */
export function coverageIdsFrom(value: ServiceAreas | null | undefined): string[] | null {
  if (!value || !value.areas.length) return null;
  return value.areas.map((a) => a.id);
}

const shortName = (id: string) => coverageAreaLabel(id).split(",")[0].trim();
const money = (n: number) => `KSh ${n.toLocaleString("en-US")}`;

function feeText(a: ServiceArea, forPrompt: boolean): string {
  const trusted = !forPrompt || (a.source === "owner" && a.confirmed);
  if (!trusted) return "fee confirmed on callback";
  const visit = a.modes[0] === "visit";
  if (a.fee_mode === "free") return visit ? "no call-out fee" : "free";
  if (a.fee_mode === "fixed" && a.fee_ksh != null) return visit ? `call-out fee ${money(a.fee_ksh)}` : money(a.fee_ksh);
  return "fee confirmed on callback";
}

/** One line under the area in the list: "Delivery · KSh 200 · Same day". */
export function areaSummary(a: ServiceArea): string {
  const modes = a.modes.map((m) => AREA_MODES.find((o) => o.id === m)?.label).filter(Boolean).join(", ");
  const fee = a.fee_mode === "free" ? "Free" : a.fee_mode === "fixed" && a.fee_ksh != null ? money(a.fee_ksh) : "";
  return [modes, fee, a.eta, a.min_order_ksh ? `From ${money(a.min_order_ksh)} orders` : ""].filter(Boolean).join(" · ");
}

function joinNames(names: string[]): string {
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** What callers hear, shown under the editor. Areas with the same terms are grouped. */
export function serviceAreasSentence(v: ServiceAreas | null | undefined): string {
  if (v?.reach === "walk_in") return "We don't deliver or visit. Customers come to us.";
  if (!v || !v.areas.length) return v ? outsideSentence(v) : "";
  const groups = new Map<string, { verb: string; tail: string; names: string[] }>();
  for (const a of v.areas) {
    const verb = AREA_MODES.find((o) => o.id === a.modes[0])?.verb || "deliver to";
    const visit = a.modes[0] === "visit";
    const fee =
      a.fee_mode === "free"
        ? visit ? " with no call-out fee" : " for free"
        : a.fee_mode === "fixed" && a.fee_ksh != null
          ? visit ? ` for a call-out fee of ${money(a.fee_ksh)}` : ` for ${money(a.fee_ksh)}`
          : "";
    const eta = a.eta ? `, ${a.eta.charAt(0).toLowerCase()}${a.eta.slice(1)}` : "";
    const key = `${verb}|${fee}|${eta}`;
    const g = groups.get(key) ?? { verb, tail: `${fee}${eta}`, names: [] };
    g.names.push(shortName(a.id));
    groups.set(key, g);
  }
  return [...[...groups.values()].map((g) => `We ${g.verb} ${joinNames(g.names)}${g.tail}.`), outsideSentence(v)].filter(Boolean).join(" ");
}

/** The fee to prefill when changing several areas. When they differ: no amount, and say so. */
export function commonFee(areas: readonly ServiceArea[]): BulkFee & { differ: boolean } {
  const a = areas[0];
  if (!a) return { fee_mode: "free", fee_ksh: null, eta: null, differ: false };
  const same = areas.every((b) => b.fee_mode === a.fee_mode && b.fee_ksh === a.fee_ksh);
  const eta = areas.every((b) => b.eta === a.eta) ? a.eta : null;
  if (!same) return { fee_mode: "fixed", fee_ksh: null, eta, differ: true };
  return { fee_mode: a.fee_mode, fee_ksh: a.fee_ksh, eta, differ: false };
}

/** Prompt block. Fees are quoted only when the owner set and confirmed them. */
export function formatServiceAreasForCompiler(v: ServiceAreas | null | undefined): string {
  if (v?.reach === "walk_in") {
    return "Customers come to us. We do not deliver or visit: point callers to the nearest branch below.";
  }
  if (!v || !v.areas.length) return "";
  const lines = v.areas.map((a) => {
    const bits = [a.modes.map((m) => (m === "visit" ? "home visit" : m === "pickup" ? "pickup only" : "delivery")).join(" or "), feeText(a, true)];
    if (a.eta) bits.push(a.eta);
    if (a.min_order_ksh) bits.push(`orders from ${money(a.min_order_ksh)}`);
    return `- ${shortName(a.id)}: ${bits.join(", ")}`;
  });
  const head = v.reach === "visit" ? "Areas we visit:" : v.reach === "both" ? "Areas you serve:" : "Delivery areas:";
  const out = [head, ...lines];
  const riders = reachCopy(v.reach).riders && v.areas.some((a) => a.modes.includes("delivery"));
  if (riders && v.delivered_by.length) {
    out.push(`Delivered by: ${v.delivered_by.map((b) => DELIVERED_BY.find((o) => o.id === b)?.label.toLowerCase()).join(", ")}.`);
  }
  if (riders && v.rider_paid === "on_arrival") out.push("The customer pays the rider on arrival.");
  if (riders && v.rider_paid === "in_fee") out.push("The rider is paid from the delivery fee.");
  if (v.anywhere_kenya) {
    if (outsideIsVisit(v)) {
      out.push("Anywhere else in Kenya: covered, and the team calls back with the travel price. Take the job and the place for a callback; never book a time for a place not listed.");
    } else {
      out.push(`Anywhere else in Kenya: delivery, ${v.outside_fee_ksh != null ? money(v.outside_fee_ksh) : "the team calls back with the fee"}.`);
    }
    out.push("Listed places keep their own terms. A place you cannot place in Kenya: ask which county it is in. Outside Kenya is not covered: say so and offer to note it. Never guess a fee that is not listed.");
  } else {
    out.push("A place not on this list is not covered: say so and offer a callback. Never guess a fee that is not listed.");
  }
  return out.join("\n");
}

/** business_policies.coverage_outside for the voice server, or null when the answer is No. */
export function coverageOutsideFrom(value: ServiceAreas | null | undefined): { anywhere_kenya: true; fee_ksh: number | null } | null {
  if (!value || !value.anywhere_kenya || value.reach === "walk_in") return null;
  return { anywhere_kenya: true, fee_ksh: value.outside_fee_ksh };
}

/** Visit-only businesses always quote travel on a callback; "both" quotes it too. */
function outsideIsVisit(v: ServiceAreas): boolean {
  return v.reach === "visit" || v.reach === "both";
}

function outsideSentence(v: ServiceAreas): string {
  if (!v.anywhere_kenya || v.reach === "walk_in") return "";
  if (outsideIsVisit(v)) return "Anywhere else in Kenya, the team calls back with the travel price.";
  if (v.outside_fee_ksh != null) return `Anywhere else in Kenya, delivery is ${money(v.outside_fee_ksh)}.`;
  return "Anywhere else in Kenya, the team calls back with the fee.";
}

export function validateServiceArea(a: ServiceArea): Record<string, string> {
  const e: Record<string, string> = {};
  if (!a.modes.length) e.modes = "Pick how you serve this area.";
  if (a.fee_mode === "fixed" && (a.fee_ksh == null || a.fee_ksh <= 0)) e.fee_ksh = "Add the fee in KSh, or pick Free.";
  if (a.min_order_ksh != null && (!Number.isInteger(a.min_order_ksh) || a.min_order_ksh < 0)) e.min_order_ksh = "Use a whole amount in KSh.";
  if (a.eta && a.eta.length > ETA_MAX) e.eta = `Keep it under ${ETA_MAX} characters.`;
  return e;
}

export function parseServiceAreasField(raw: unknown, vertical?: string | null): ServiceAreas | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  try {
    return normalizeServiceAreas(JSON.parse(text), vertical);
  } catch {
    return null;
  }
}

export type BulkFee = { fee_mode: FeeMode; fee_ksh: number | null; eta: string | null; mode?: AreaMode };

/** Set one fee (and time) on many areas at once; areas not yet listed are added. */
export function applyFeeToAreas(v: ServiceAreas, ids: readonly string[], fee: BulkFee, vertical?: string | null): ServiceAreas {
  const want = new Set(ids);
  const set = (a: ServiceArea): ServiceArea => ({
    ...a,
    fee_mode: fee.fee_mode,
    fee_ksh: fee.fee_mode === "fixed" ? fee.fee_ksh : null,
    modes: fee.mode ? [fee.mode] : a.modes,
    eta: fee.eta && fee.eta.trim() ? fee.eta.trim().slice(0, ETA_MAX) : null,
    source: "owner",
    confirmed: true,
  });
  const have = new Set(v.areas.map((a) => a.id));
  const areas = v.areas.map((a) => (want.has(a.id) ? set(a) : a));
  for (const id of ids) {
    if (!have.has(id) && areas.length < COVERAGE_AREA_MAX) {
      const fresh = newServiceArea(id, vertical);
      if (v.reach === "visit") fresh.modes = ["visit"];
      if (v.reach === "deliver") fresh.modes = ["delivery"];
      areas.push(set(fresh));
    }
  }
  return { ...v, areas };
}

/** The county or town in the shop address, to pre-select on first setup. */
export function suggestHomeAreas(address: string): string[] {
  const parts = String(address || "").split(/[,\n]/).map((p) => p.trim().toLowerCase()).filter(Boolean).reverse();
  const out: string[] = [];
  for (const p of parts) {
    for (const kind of ["county", "place"]) {
      const id = `${kind}:${p}`;
      if (parseCoverageAreas([id]).length && !out.includes(id)) out.push(id);
    }
  }
  return out.slice(0, 2);
}

/**
 * Rows for the Add areas drawer. Ticked (not yet saved) areas stay in the list, ticked;
 * only areas already saved on the page show as "Added".
 */
export function areaPickerRows(
  query: string,
  ticked: readonly string[],
  listed: readonly string[]
): { options: Array<{ id: string; label: string; detail?: string }>; alreadyAdded: AreaOption[] } {
  const results = query.trim() ? searchAreaOptions(query, listed, 8) : [];
  return {
    options: [
      ...ticked.map((id) => ({ id, label: coverageAreaLabel(id) })),
      ...results.filter((o) => !o.added && !ticked.includes(o.id)).map((o) => ({ id: o.id, label: o.label, detail: o.hint })),
    ],
    alreadyAdded: results.filter((o) => o.added && !ticked.includes(o.id)),
  };
}

/**
 * Policies as part of the Settings form key. coverage_areas is left out: it follows
 * service_areas on every Locations save, and a key change remounts the form (closing an
 * open drawer and dropping the Saved toast).
 */
export function policiesFormKey(policies: unknown): string {
  if (!policies || typeof policies !== "object") return "{}";
  const { coverage_areas: _skip, coverage_outside: _skipOutside, ...rest } = policies as Record<string, unknown>;
  void _skip;
  void _skipOutside;
  return JSON.stringify(rest);
}
