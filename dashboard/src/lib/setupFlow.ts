/**
 * Onboarding setup flow: steps, draft shape, validation, and the text the receptionist reads.
 * Pure and dependency-free so the server action, the client and node tests share one contract.
 */

export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export const DAYS: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const DAY_SHORT: Record<DayKey, string> = {
  mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun",
};
export const DAY_NAME: Record<DayKey, string> = {
  mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday",
};

export type StepKey = "business" | "catalogue" | "hours" | "voice" | "faqs" | "alerts";

export const SETUP_STEPS: ReadonlyArray<{ key: StepKey; title: string; skippable: boolean }> = [
  { key: "business", title: "Your business", skippable: false },
  { key: "catalogue", title: "What you sell", skippable: true },
  { key: "hours", title: "Opening hours", skippable: true },
  { key: "voice", title: "Your receptionist", skippable: false },
  { key: "faqs", title: "Common questions", skippable: true },
  { key: "alerts", title: "Alerts", skippable: false },
];

export function stepIndex(key: unknown): number {
  return SETUP_STEPS.findIndex((s) => s.key === key);
}

export type Vertical = "retail" | "home_services";
export type PriceMode = "fixed" | "from" | "range" | "ask";
export type Tone = "professional" | "warm";
export type Handoff = "callback" | "live_transfer";

export type BusinessStep = { vertical: Vertical; landmark: string; directions: string };
export type CatalogueRow = {
  name: string;
  category: string;
  pricing_mode: PriceMode | "";
  price: string;
  price_max: string;
  /** Home services only: does the job need a site visit before a quote? */
  site_visit: "yes" | "no" | "";
  notes: string;
};
export type CatalogueStep = { skipped: boolean; rows: CatalogueRow[] };
export type Shift = { open: string; close: string };
export type DayPlan = { closed: boolean; shifts: Shift[] };
export type HoursStep = { skipped: boolean; days: Record<DayKey, DayPlan> };
export type VoiceStep = { agentName: string; tone: Tone; handoff: Handoff };
export type FaqRow = { question: string; answer: string };
export type FaqsStep = { skipped: boolean; items: FaqRow[] };
export type AlertsStep = { phone: string; email: string; whatsapp: boolean; sms: boolean; emailOn: boolean };

export type SetupDraft = {
  business: BusinessStep;
  catalogue: CatalogueStep;
  hours: HoursStep;
  voice: VoiceStep;
  faqs: FaqsStep;
  alerts: AlertsStep;
};

export const LIMITS = {
  rows: 200,
  name: 120,
  category: 60,
  notes: 300,
  landmark: 200,
  directions: 600,
  agentName: 40,
  faqItems: 20,
  question: 200,
  answer: 400,
  shiftsPerDay: 3,
  priceMax: 10_000_000,
} as const;

export const SUGGESTED_QUESTIONS = [
  "Do you accept M-Pesa?",
  "Do you deliver?",
  "Which areas do you cover?",
  "Do you come to my location?",
  "Can you hold an item for me?",
] as const;

// ---------------------------------------------------------------------------
// Defaults and parsing (loose: never throws, clamps sizes; validation is separate)
// ---------------------------------------------------------------------------

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export function defaultWeek(): Record<DayKey, DayPlan> {
  const open = (): DayPlan => ({ closed: false, shifts: [{ open: "08:00", close: "18:00" }] });
  return { mon: open(), tue: open(), wed: open(), thu: open(), fri: open(), sat: open(), sun: { closed: true, shifts: [] } };
}

export function emptyRow(name = ""): CatalogueRow {
  return { name, category: "", pricing_mode: "fixed", price: "", price_max: "", site_visit: "", notes: "" };
}

export function defaultDraft(seed: { phone?: string | null; email?: string | null } = {}): SetupDraft {
  const phone = String(seed.phone || "");
  return {
    business: { vertical: "retail", landmark: "", directions: "" },
    catalogue: { skipped: false, rows: [] },
    hours: { skipped: false, days: defaultWeek() },
    voice: { agentName: "", tone: "warm", handoff: "callback" },
    faqs: { skipped: false, items: [] },
    alerts: {
      phone: phone && !/^pending/i.test(phone) ? phone : "",
      email: String(seed.email || ""),
      whatsapp: true,
      sms: true,
      emailOn: Boolean(seed.email),
    },
  };
}

function parseMode(v: unknown): PriceMode | "" {
  return v === "fixed" || v === "from" || v === "range" || v === "ask" ? v : "";
}

function parseRow(raw: unknown): CatalogueRow {
  const r = obj(raw);
  const visit = r.site_visit === "yes" || r.site_visit === "no" ? r.site_visit : "";
  return {
    name: str(r.name, LIMITS.name),
    category: str(r.category, LIMITS.category),
    pricing_mode: parseMode(r.pricing_mode),
    price: str(r.price, 20),
    price_max: str(r.price_max, 20),
    site_visit: visit,
    notes: str(r.notes, LIMITS.notes),
  };
}

function parseTime(v: unknown): string {
  const s = str(v, 5);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : "";
}

function parseDays(raw: unknown): Record<DayKey, DayPlan> {
  const base = defaultWeek();
  const d = obj(raw);
  for (const key of DAYS) {
    if (!(key in d)) continue;
    const day = obj(d[key]);
    const shifts = Array.isArray(day.shifts)
      ? day.shifts.slice(0, LIMITS.shiftsPerDay).map((s) => ({ open: parseTime(obj(s).open), close: parseTime(obj(s).close) }))
      : [];
    base[key] = { closed: bool(day.closed, false), shifts };
  }
  return base;
}

/** Merge a stored jsonb draft over defaults. Unknown keys are dropped. */
export function parseDraft(raw: unknown, seed: { phone?: string | null; email?: string | null } = {}): SetupDraft {
  const d = obj(raw);
  const out = defaultDraft(seed);
  const b = obj(d.business);
  if (Object.keys(b).length) {
    out.business = {
      vertical: b.vertical === "home_services" ? "home_services" : "retail",
      landmark: str(b.landmark, LIMITS.landmark),
      directions: str(b.directions, LIMITS.directions),
    };
  }
  const c = obj(d.catalogue);
  if (Object.keys(c).length) {
    out.catalogue = {
      skipped: bool(c.skipped, false),
      rows: Array.isArray(c.rows) ? c.rows.slice(0, LIMITS.rows).map(parseRow) : [],
    };
  }
  const h = obj(d.hours);
  if (Object.keys(h).length) out.hours = { skipped: bool(h.skipped, false), days: parseDays(h.days) };
  const v = obj(d.voice);
  if (Object.keys(v).length) {
    out.voice = {
      agentName: str(v.agentName, LIMITS.agentName),
      tone: v.tone === "professional" ? "professional" : "warm",
      handoff: v.handoff === "live_transfer" ? "live_transfer" : "callback",
    };
  }
  const f = obj(d.faqs);
  if (Object.keys(f).length) {
    out.faqs = {
      skipped: bool(f.skipped, false),
      items: Array.isArray(f.items)
        ? f.items.slice(0, LIMITS.faqItems).map((i) => ({ question: str(obj(i).question, LIMITS.question), answer: str(obj(i).answer, LIMITS.answer) }))
        : [],
    };
  }
  const a = obj(d.alerts);
  if (Object.keys(a).length) {
    out.alerts = {
      phone: str(a.phone, 20),
      email: str(a.email, 254),
      whatsapp: bool(a.whatsapp, true),
      sms: bool(a.sms, true),
      emailOn: bool(a.emailOn, false),
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Validation (server is the authority; the client runs the same checks)
// ---------------------------------------------------------------------------

export type FieldErrors = Record<string, string>;
export type StepResult<T> = { ok: true; value: T } | { ok: false; error: string; fields: FieldErrors };

function fail<T>(error: string, fields: FieldErrors = {}): StepResult<T> {
  return { ok: false, error, fields };
}

export function normalizeKenyaPhone(raw: unknown): string | null {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;
  let digits = trimmed.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("0") && digits.length === 10) digits = `254${digits.slice(1)}`;
  else if (/^[17]\d{8}$/.test(digits)) digits = `254${digits}`;
  if (!/^254[17]\d{8}$/.test(digits)) return null;
  return `+${digits}`;
}

export function isEmail(raw: unknown): boolean {
  const s = String(raw || "").trim();
  return s.length <= 254 && /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(s);
}

/** Whole shillings, optional thousands commas. Null when not a positive amount. */
export function parseAmount(raw: unknown): number | null {
  const s = String(raw ?? "").trim().replace(/^(ksh|kes)\s*/i, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0 || n > LIMITS.priceMax) return null;
  return n;
}

function money(n: number): string {
  return `KSh ${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/** Price text the catalogue stores and the receptionist reads ("KSh 1,500", "From KSh 300", "KSh 200-400", "Ask"). */
export function priceText(row: Pick<CatalogueRow, "pricing_mode" | "price" | "price_max">): string {
  if (row.pricing_mode === "ask") return "Ask";
  const lo = parseAmount(row.price);
  if (lo == null) return "";
  if (row.pricing_mode === "from") return `From ${money(lo)}`;
  if (row.pricing_mode === "range") {
    const hi = parseAmount(row.price_max);
    return hi == null ? "" : `KSh ${lo.toLocaleString("en-US")}-${hi.toLocaleString("en-US")}`;
  }
  return money(lo);
}

function rowHasContent(row: CatalogueRow): boolean {
  return Boolean(row.name.trim() || row.price.trim() || row.price_max.trim() || row.notes.trim() || row.category.trim());
}

/** Error for one row, or null. `index` keys field errors as rows.<i>.<field>. */
function rowErrors(row: CatalogueRow, index: number, vertical: Vertical, fields: FieldErrors): void {
  const k = (f: string) => `rows.${index}.${f}`;
  if (!row.name.trim()) fields[k("name")] = "Add a name.";
  if (!row.pricing_mode) fields[k("pricing_mode")] = "Choose how you charge.";
  else if (row.pricing_mode !== "ask") {
    const lo = parseAmount(row.price);
    if (lo == null) fields[k("price")] = "Enter an amount above 0, like 1500.";
    if (row.pricing_mode === "range") {
      const hi = parseAmount(row.price_max);
      if (hi == null) fields[k("price_max")] = "Enter the highest amount.";
      else if (lo != null && hi <= lo) fields[k("price_max")] = "Must be more than the lowest amount.";
    }
  }
  if (vertical === "home_services" && !row.site_visit) fields[k("site_visit")] = "Say whether you visit first.";
}

export function validateCatalogue(input: CatalogueStep, vertical: Vertical): StepResult<CatalogueStep> {
  const rows = input.rows.filter(rowHasContent).map((r) => ({ ...r, name: r.name.trim(), category: r.category.trim(), notes: r.notes.trim() }));
  if (input.skipped) return { ok: true, value: { skipped: true, rows } };
  if (rows.length > LIMITS.rows) return fail(`You can add up to ${LIMITS.rows} items here. Add the rest in Settings.`);
  const fields: FieldErrors = {};
  const seen = new Map<string, number>();
  rows.forEach((row, i) => {
    rowErrors(row, i, vertical, fields);
    const key = row.name.toLowerCase();
    if (key) {
      if (seen.has(key)) fields[`rows.${i}.name`] = "You already added this.";
      else seen.set(key, i);
    }
  });
  const noun = vertical === "home_services" ? "service" : "product";
  if (!rows.length) return fail(`Add at least one ${noun} with a price, or skip this step.`);
  if (Object.keys(fields).length) return fail("Fix the highlighted items.", fields);
  return { ok: true, value: { skipped: false, rows } };
}

function minutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function validateHours(input: HoursStep): StepResult<HoursStep> {
  if (input.skipped) return { ok: true, value: input };
  const fields: FieldErrors = {};
  let openDays = 0;
  for (const key of DAYS) {
    const day = input.days[key];
    if (!day || day.closed) continue;
    if (!day.shifts.length) {
      fields[`days.${key}`] = "Add hours or mark closed.";
      continue;
    }
    let prevEnd = -1;
    day.shifts.forEach((s, i) => {
      if (!s.open || !s.close) {
        fields[`days.${key}.${i}`] = "Pick both times.";
        return;
      }
      const a = minutes(s.open);
      const b = minutes(s.close);
      if (b <= a) fields[`days.${key}.${i}`] = "Closing must be after opening.";
      else if (a < prevEnd) fields[`days.${key}.${i}`] = "Overlaps the earlier hours.";
      prevEnd = Math.max(prevEnd, b);
    });
    openDays += 1;
  }
  if (Object.keys(fields).length) return fail("Fix the highlighted days.", fields);
  if (!openDays) return fail("Open at least one day, or skip this step.");
  return { ok: true, value: input };
}

export function validateBusiness(input: BusinessStep): StepResult<BusinessStep> {
  if (input.vertical !== "retail" && input.vertical !== "home_services") return fail("Choose your business type.");
  return {
    ok: true,
    value: { vertical: input.vertical, landmark: input.landmark.trim(), directions: input.directions.trim() },
  };
}

export function validateVoice(input: VoiceStep): StepResult<VoiceStep> {
  const name = input.agentName.trim();
  if (!name) return fail("Give your receptionist a name.", { agentName: "Give your receptionist a name." });
  if (name.length > LIMITS.agentName) return fail("Use 40 characters or fewer.", { agentName: "Use 40 characters or fewer." });
  if (input.tone !== "warm" && input.tone !== "professional") return fail("Choose a tone.");
  return { ok: true, value: { agentName: name, tone: input.tone, handoff: input.handoff === "live_transfer" ? "live_transfer" : "callback" } };
}

export function validateFaqs(input: FaqsStep): StepResult<FaqsStep> {
  const items = input.items
    .map((i) => ({ question: i.question.trim(), answer: i.answer.trim() }))
    .filter((i) => i.question || i.answer);
  if (input.skipped) return { ok: true, value: { skipped: true, items } };
  const fields: FieldErrors = {};
  const seen = new Set<string>();
  items.forEach((item, i) => {
    if (!item.question) fields[`items.${i}.question`] = "Add the question.";
    else if (seen.has(item.question.toLowerCase())) fields[`items.${i}.question`] = "You already added this question.";
    seen.add(item.question.toLowerCase());
    if (!item.answer) fields[`items.${i}.answer`] = "Add an answer, or remove the question.";
    if (item.answer.length > LIMITS.answer) fields[`items.${i}.answer`] = `Use ${LIMITS.answer} characters or fewer.`;
    if (item.question.length > LIMITS.question) fields[`items.${i}.question`] = `Use ${LIMITS.question} characters or fewer.`;
  });
  if (items.length > LIMITS.faqItems) return fail(`You can add up to ${LIMITS.faqItems} questions here.`);
  if (Object.keys(fields).length) return fail("Fix the highlighted questions.", fields);
  return { ok: true, value: { skipped: false, items } };
}

export function validateAlerts(input: AlertsStep): StepResult<AlertsStep> {
  const fields: FieldErrors = {};
  const phone = normalizeKenyaPhone(input.phone);
  const email = input.email.trim().toLowerCase();
  if ((input.whatsapp || input.sms) && !phone) fields.phone = "Enter a Kenyan mobile number, like 0712 345 678.";
  if (email && !isEmail(email)) fields.email = "Enter a valid email address.";
  if (input.emailOn && !email) fields.email = "Add an email, or turn off email alerts.";
  if (!input.whatsapp && !input.sms && !input.emailOn) return fail("Turn on at least one way to reach you.");
  if (Object.keys(fields).length) return fail("Fix the highlighted fields.", fields);
  return { ok: true, value: { phone: phone || "", email, whatsapp: input.whatsapp, sms: input.sms, emailOn: input.emailOn } };
}

/** Validate one step's value against the rest of the draft. */
export function validateStep(key: StepKey, value: unknown, draft: SetupDraft): StepResult<unknown> {
  const merged = parseDraft({ ...draft, [key]: value });
  switch (key) {
    case "business": return validateBusiness(merged.business);
    case "catalogue": return validateCatalogue(merged.catalogue, merged.business.vertical);
    case "hours": return validateHours(merged.hours);
    case "voice": return validateVoice(merged.voice);
    case "faqs": return validateFaqs(merged.faqs);
    case "alerts": return validateAlerts(merged.alerts);
  }
}

/** First step that does not validate, or -1 when the whole draft is ready to finish. */
export function firstInvalidStep(draft: SetupDraft): number {
  for (let i = 0; i < SETUP_STEPS.length; i++) {
    const key = SETUP_STEPS[i].key;
    if (!validateStep(key, draft[key], draft).ok) return i;
  }
  return -1;
}

/** The step to open: requested if reachable, else the furthest saved step. */
export function resumeStep(requested: unknown, savedStep: number): number {
  const furthest = Math.max(0, Math.min(SETUP_STEPS.length - 1, Math.floor(Number(savedStep) || 0)));
  const want = stepIndex(requested);
  if (want >= 0 && want <= furthest) return want;
  return furthest;
}

// ---------------------------------------------------------------------------
// Output for the tenant row
// ---------------------------------------------------------------------------

function shiftText(day: DayPlan): string {
  return day.shifts.map((s) => `${s.open}-${s.close}`).join(", ");
}

/** "Mon-Fri 08:00-13:00, 14:00-18:00; Sat 09:00-13:00; Sun closed". Consecutive equal days are grouped. */
export function hoursText(days: Record<DayKey, DayPlan>): string {
  const parts: string[] = [];
  let i = 0;
  while (i < DAYS.length) {
    const label = days[DAYS[i]].closed ? "closed" : shiftText(days[DAYS[i]]);
    let j = i;
    while (j + 1 < DAYS.length) {
      const next = days[DAYS[j + 1]];
      if ((next.closed ? "closed" : shiftText(next)) !== label) break;
      j += 1;
    }
    const span = i === j ? DAY_SHORT[DAYS[i]] : `${DAY_SHORT[DAYS[i]]}-${DAY_SHORT[DAYS[j]]}`;
    parts.push(`${span} ${label}`);
    i = j + 1;
  }
  return parts.join("; ");
}

/**
 * tenants.hours_schedule. One open/close per day (what voice reads today) plus `shifts`
 * when the day is split, so a lunch break is not lost.
 */
export function hoursSchedule(days: Record<DayKey, DayPlan>, location: string) {
  const out: Record<string, unknown> = {};
  for (const key of DAYS) {
    const day = days[key];
    if (day.closed || !day.shifts.length) {
      out[key] = null;
      continue;
    }
    const first = day.shifts[0];
    const last = day.shifts[day.shifts.length - 1];
    out[key] = day.shifts.length > 1 ? { open: first.open, close: last.close, shifts: day.shifts } : { open: first.open, close: first.close };
  }
  return { timezone: "Africa/Nairobi" as const, location, days: out };
}

export function catalogueForTenant(step: CatalogueStep, vertical: Vertical) {
  const rows = step.skipped ? [] : step.rows;
  if (vertical === "home_services") {
    return {
      services: rows.map((r) => ({
        name: r.name,
        price_range: priceText(r),
        pricing_mode: r.pricing_mode || "ask",
        site_visit_required: r.site_visit === "yes",
        notes: r.notes,
        category: r.category,
        out_of_scope: "",
        in_stock: "",
        source: "owner",
      })),
      products: [] as Array<Record<string, unknown>>,
    };
  }
  return {
    services: [] as Array<Record<string, unknown>>,
    products: rows.map((r) => ({
      name: r.name,
      category: r.category,
      price: priceText(r),
      price_mode: r.pricing_mode || "ask",
      notes: r.notes,
      source: "owner",
    })),
  };
}

/** Plain list the prompt compiler reads. */
export function catalogueText(step: CatalogueStep): string {
  if (step.skipped) return "";
  return step.rows.map((r) => `${r.name}: ${priceText(r) || "ask"}${r.notes ? ` (${r.notes})` : ""}`).join("\n");
}

export function faqsForTenant(step: FaqsStep) {
  if (step.skipped) return [];
  return step.items
    .filter((i) => i.question && i.answer)
    .map((i) => ({ question: i.question, answer: i.answer, source: "owner", status: "confirmed" }));
}

export function notifyChannelsFor(alerts: AlertsStep) {
  return { whatsapp: alerts.whatsapp, sms: alerts.sms, email: alerts.emailOn, caller_sms: false, missed_textback: false };
}

/** True when the virtual number is still a signup placeholder. */
export function numberPending(raw: unknown): boolean {
  const s = String(raw || "").trim();
  return !s || /^pending/i.test(s);
}

/** "+254 711 082 300" for display. */
export function formatKenyaNumber(raw: unknown): string {
  const s = String(raw || "").trim();
  const m = /^\+?254(\d{3})(\d{3})(\d{3})$/.exec(s.replace(/\s/g, ""));
  return m ? `+254 ${m[1]} ${m[2]} ${m[3]}` : s;
}

/** Turn an imported price string ("from 300", "200-400", "ask", "1,500") into row fields. */
export function rowFromImport(name: string, price: string, notes = "", category = ""): CatalogueRow {
  const row = { ...emptyRow(name.slice(0, LIMITS.name)), notes: notes.slice(0, LIMITS.notes), category: category.slice(0, LIMITS.category) };
  const p = String(price || "").trim().toLowerCase().replace(/ksh|kes/g, "").trim();
  if (!p) return { ...row, pricing_mode: "fixed" };
  if (/^(ask|on request|quoted)$/.test(p)) return { ...row, pricing_mode: "ask" };
  const from = /^from\s+([\d,.]+)$/.exec(p);
  if (from) return { ...row, pricing_mode: "from", price: from[1] };
  const range = /^([\d,.]+)\s*(?:-|to|–)\s*([\d,.]+)$/.exec(p);
  if (range) return { ...row, pricing_mode: "range", price: range[1], price_max: range[2] };
  return { ...row, pricing_mode: "fixed", price: p.slice(0, 20) };
}

const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
const toTime = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;

/** "Add a break": split the last block around its middle with a one-hour gap (08:00-18:00 becomes 08:00-12:30, 13:30-18:00). */
export function splitLast(shifts: Shift[]): Shift[] {
  const last = shifts[shifts.length - 1];
  if (!last?.open || !last.close) return [...shifts, { open: "14:00", close: "18:00" }];
  const a = toMin(last.open);
  const b = toMin(last.close);
  if (b - a >= 180) {
    const mid = Math.round((a + b) / 2 / 30) * 30;
    return [...shifts.slice(0, -1), { open: last.open, close: toTime(mid - 30) }, { open: toTime(mid + 30), close: last.close }];
  }
  const start = Math.min(b + 60, 22 * 60);
  return [...shifts, { open: toTime(start), close: toTime(Math.min(start + 120, 23 * 60 + 45)) }];
}
