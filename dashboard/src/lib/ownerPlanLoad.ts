import { isMissingTableError } from "@/lib/adminErrors";
import { createWorkspaceDataClient } from "@/lib/tenant";
import { isFreeBeta, ownerBillingSurface, type OwnerBillingSurface } from "@/lib/betaBilling";
import { nairobiDay, pickBillingBanner, type BillingBanner } from "@/lib/billingBanner";
import {
  annualPriceFromVersion,
  emptySeatOffer,
  nairobiMonthName,
  nairobiPeriodDays,
  seatUnitKes,
  spendLimitDisplayKes,
  type SeatOffer,
} from "@/lib/planPricing";
import { creditBurnsFrom, type CreditBurns } from "@/lib/messageCredits";
import { trialRemaining } from "@/lib/trialRemaining";
import { planRowText } from "@/lib/planEntry";
import { getSupabaseAdmin } from "@/lib/supabase";
import { minutesUsedFromSeconds } from "@/lib/minutes";

const SELL = ["starter", "growth", "scale"] as const;

export type PlanSku = (typeof SELL)[number];
export type PlanCycle = "month" | "year";

export type PublishedPlan = {
  sku: PlanSku;
  name: string;
  monthlyKes: number;
  annualKes: number;
  savingKes: number;
  minutes: number;
  seats: number;
  dids: number;
  messageCredits: number | null;
  inboundPerMinuteKes: number;
  outboundPerMinuteKes: number;
};

export type OwnerInvoiceRow = {
  id: string;
  number: string;
  status: string;
  totalKes: number;
  dueAt: string | null;
  periodStart: string | null;
  periodEnd: string | null;
};

export type OwnerNoticeRow = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  unread: boolean;
};

export type OwnerPlanModel = {
  freeBeta: boolean;
  billingStatus: string;
  surface: OwnerBillingSurface;
  currentSku: PlanSku | null;
  currentMonthlyKes: number | null;
  cycle: PlanCycle;
  plans: PublishedPlan[];
  seatsUsed: number;
  seatsIncluded: number;
  /** Plan minutes this period and minutes used, from the subscription read. */
  minutesIncluded: number;
  minutesUsed: number;
  trialText: string | null;
  onDemandLocked: boolean;
  invoices: OwnerInvoiceRow[];
  notices: OwnerNoticeRow[];
  periodEndLabel: string | null;
  dayOfPeriod: number | null;
  daysInPeriod: number | null;
  daysLeft: number | null;
  extraSeatMonthlyKes: number | null;
  extraSeats: number;
  seatUnitKes: number | null;
  periodEndMonth: string | null;
  nextPeriodStartLabel: string | null;
  banner: BillingBanner | null;
};

export type UsageBillingExtras = {
  billingStatus: string;
  freeBeta: boolean;
  monthlyPriceKes: number | null;
  messageCredits: number | null;
  /** Credits per text, WhatsApp, and email. Used to count credits; never shown. */
  creditBurns: CreditBurns | null;
  inboundPerMinuteKes: number | null;
  outboundPerMinuteKes: number | null;
  /** Default when the owner has not saved a limit. Not a per-credit price. */
  spendLimitKes: number | null;
  onDemandLocked: boolean;
};

const VERSION_CORE = [
  "id",
  "package_id",
  "version",
  "monthly_price_kes",
  "seats",
  "minutes",
  "dids",
  "inbound_kes_per_second",
  "outbound_kes_per_second",
  "annual_discount_percent",
];
const VERSION_OPTIONAL = [
  "message_credits",
  "extra_seat_monthly_kes",
  "trial_days",
  "annual_price_kes",
  "spend_limit_share_percent",
  "sms_credit_burn",
  "whatsapp_credit_burn",
  "email_credit_burn",
];
const SUB_CORE = ["billing_status", "period", "package_version_id", "current_period_start", "current_period_end"];
const SUB_OPTIONAL = ["term_start", "term_end", "extra_seats"];
const INVOICE_FIELDS =
  "id, invoice_number, status, total_kes, due_at, issued_at, period_start, period_end";

function num(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function betaModel(): OwnerPlanModel {
  return {
    freeBeta: true,
    billingStatus: "beta",
    surface: ownerBillingSurface("beta"),
    currentSku: null,
    currentMonthlyKes: null,
    cycle: "month",
    plans: [],
    seatsUsed: 0,
    seatsIncluded: 0,
    minutesIncluded: 0,
    minutesUsed: 0,
    trialText: null,
    onDemandLocked: false,
    invoices: [],
    notices: [],
    periodEndLabel: null,
    dayOfPeriod: null,
    daysInPeriod: null,
    daysLeft: null,
    extraSeatMonthlyKes: null,
    extraSeats: 0,
    seatUnitKes: null,
    periodEndMonth: null,
    nextPeriodStartLabel: null,
    banner: null,
  };
}

function emptyExtras(): UsageBillingExtras {
  return {
    billingStatus: "beta",
    freeBeta: true,
    monthlyPriceKes: null,
    messageCredits: null,
    creditBurns: null,
    inboundPerMinuteKes: null,
    outboundPerMinuteKes: null,
    spendLimitKes: null,
    onDemandLocked: false,
  };
}

function isSku(raw: unknown): raw is PlanSku {
  return SELL.includes(raw as PlanSku);
}

type VersionRow = Record<string, unknown>;

function mapPlans(packages: Record<string, unknown>[], versions: VersionRow[]): PublishedPlan[] {
  const latest = new Map<string, VersionRow>();
  for (const row of versions) {
    const id = String(row.package_id || "");
    const prev = latest.get(id);
    if (!prev || num(row.version) > num(prev.version)) latest.set(id, row);
  }
  const plans: PublishedPlan[] = [];
  for (const pack of packages) {
    if (!isSku(pack.sku) || pack.is_active === false) continue;
    const version = latest.get(String(pack.id || ""));
    if (!version) continue;
    const monthly = num(version.monthly_price_kes);
    const discount = num(version.annual_discount_percent);
    const storedAnnual = version.annual_price_kes;
    const annual = annualPriceFromVersion(
      monthly,
      discount,
      storedAnnual == null || storedAnnual === "" ? null : num(storedAnnual),
    );
    const creditsRaw = version.message_credits;
    const messageCredits =
      creditsRaw == null || creditsRaw === "" ? null : Math.round(num(creditsRaw));
    plans.push({
      sku: pack.sku,
      name: String(pack.name || pack.sku),
      monthlyKes: monthly,
      annualKes: annual,
      savingKes: Math.round(monthly * 12 - annual),
      minutes: Math.round(num(version.minutes)),
      seats: Math.round(num(version.seats)),
      dids: Math.round(num(version.dids)),
      messageCredits,
      inboundPerMinuteKes: num(version.inbound_kes_per_second) * 60,
      outboundPerMinuteKes: num(version.outbound_kes_per_second) * 60,
    });
  }
  plans.sort((a, b) => SELL.indexOf(a.sku) - SELL.indexOf(b.sku));
  return plans;
}

type DataClient = NonNullable<Awaited<ReturnType<typeof createWorkspaceDataClient>>>["client"];

type LooseRows = { data: VersionRow[] | null; error: { message?: string; code?: string } | null };
type LooseOne = { data: VersionRow | null; error: { message?: string; code?: string } | null };

async function selectRows(query: PromiseLike<unknown>): Promise<LooseRows> {
  return (await query) as LooseRows;
}

async function selectOne(query: PromiseLike<unknown>): Promise<LooseOne> {
  return (await query) as LooseOne;
}

function dropOptional(fields: string[], optional: string[], message: string): string[] | null {
  const lower = message.toLowerCase();
  const hit = fields.filter((name) => optional.includes(name) && lower.includes(name));
  if (!hit.length) return null;
  return fields.filter((name) => !hit.includes(name));
}

async function publishedVersions(
  client: DataClient,
): Promise<{ rows: VersionRow[]; missing: boolean; failed: boolean }> {
  let fields = [...VERSION_CORE, ...VERSION_OPTIONAL];
  let res = await selectRows(
    client.from("billing_package_versions").select(fields.join(", ")).eq("status", "published"),
  );
  for (let attempt = 0; attempt < VERSION_OPTIONAL.length && res.error; attempt += 1) {
    if (isMissingTableError(res.error)) return { rows: [], missing: true, failed: false };
    const next = dropOptional(fields, VERSION_OPTIONAL, String(res.error.message || ""));
    if (!next) break;
    fields = next;
    res = await selectRows(
      client.from("billing_package_versions").select(fields.join(", ")).eq("status", "published"),
    );
  }
  if (isMissingTableError(res.error)) return { rows: [], missing: true, failed: false };
  if (res.error) return { rows: [], missing: false, failed: true };
  return { rows: (res.data || []) as VersionRow[], missing: false, failed: false };
}

function nullableKes(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

/** Pinned version seat price and the days left in this period. Missing columns hide the seat control. */
export async function loadPinnedSeatOffer(client: DataClient, tenantId: string): Promise<SeatOffer> {
  const empty = emptySeatOffer();
  if (!tenantId) return empty;
  try {
    let fields = [...SUB_CORE, ...SUB_OPTIONAL];
    let sub = await selectOne(
      client.from("tenant_subscriptions").select(fields.join(", ")).eq("tenant_id", tenantId).maybeSingle(),
    );
    for (let attempt = 0; attempt < SUB_OPTIONAL.length && sub.error && !isMissingTableError(sub.error); attempt += 1) {
      const next = dropOptional(fields, SUB_OPTIONAL, String(sub.error.message || ""));
      if (!next) break;
      fields = next;
      sub = await selectOne(
        client.from("tenant_subscriptions").select(fields.join(", ")).eq("tenant_id", tenantId).maybeSingle(),
      );
    }
    if (sub.error || !sub.data) return empty;
    const row = sub.data;
    const status = String(row.billing_status || "");
    if (status !== "active") return empty;
    const cycle = row.period === "year" ? "year" : "month";
    const extraSeats = Math.max(0, Math.round(num(row.extra_seats)));
    const versionId = row.package_version_id ? String(row.package_version_id) : "";
    if (!versionId) return { ...empty, extraSeats, cycle };
    let versionFields = [...VERSION_CORE, ...VERSION_OPTIONAL];
    let version = await selectOne(
      client.from("billing_package_versions").select(versionFields.join(", ")).eq("id", versionId).maybeSingle(),
    );
    for (let attempt = 0; attempt < VERSION_OPTIONAL.length && version.error && !isMissingTableError(version.error); attempt += 1) {
      const next = dropOptional(versionFields, VERSION_OPTIONAL, String(version.error.message || ""));
      if (!next) break;
      versionFields = next;
      version = await selectOne(
        client.from("billing_package_versions").select(versionFields.join(", ")).eq("id", versionId).maybeSingle(),
      );
    }
    if (version.error || !version.data) return { ...empty, extraSeats, cycle };
    const price = nullableKes(version.data.extra_seat_monthly_kes);
    const periodEnd = row.term_end
      ? String(row.term_end)
      : row.current_period_end
        ? String(row.current_period_end)
        : null;
    const clock = nairobiPeriodDays(
      row.term_start ? String(row.term_start) : row.current_period_start ? String(row.current_period_start) : null,
      periodEnd,
      new Date(),
    );
    return {
      extraSeatMonthlyKes: price,
      extraSeats,
      cycle,
      daysLeft: clock?.daysLeft ?? null,
      daysInPeriod: clock?.daysInPeriod ?? null,
      seatUnitKes: price == null ? null : seatUnitKes(price, cycle, num(version.data.annual_discount_percent)),
      periodEndMonth: nairobiMonthName(periodEnd),
      nextPeriodStartLabel: nairobiDay(periodEnd),
    };
  } catch {
    return empty;
  }
}

function pauseOn(row: Record<string, unknown>): string | null {
  if (row.billing_suspended_at) return String(row.billing_suspended_at);
  if (!row.past_due_at) return null;
  const t = Date.parse(String(row.past_due_at));
  if (!Number.isFinite(t)) return null;
  return new Date(t + 8 * 86_400_000).toISOString();
}

function bannerFrom(row: Record<string, unknown>, open: { totalKes: number } | null, now: Date): BillingBanner | null {
  const status = String(row.billing_status || "");
  const trial =
    status === "trialing"
      ? trialRemaining({
          now,
          trialEndsAt: row.trial_ends_at ? String(row.trial_ends_at) : null,
          secondsUsed: num(row.seconds_used),
          minutesIncluded: num(row.minutes_included),
        })
      : null;
  return pickBillingBanner(
    {
      billingStatus: status,
      voicemailUntil: row.voicemail_until ? String(row.voicemail_until) : null,
      pauseOn: pauseOn(row),
      trialEnded: Boolean(trial?.ended),
      openInvoiceKes: open?.totalKes ?? null,
    },
    now,
  );
}

async function loadInvoices(
  client: DataClient,
  tenantId: string,
): Promise<{ rows: OwnerInvoiceRow[]; missing: boolean; failed: boolean }> {
  const res = await selectRows(
    client
      .from("invoices")
      .select(INVOICE_FIELDS)
      .eq("tenant_id", tenantId)
      .neq("status", "draft")
      .order("issued_at", { ascending: false }),
  );
  if (isMissingTableError(res.error)) return { rows: [], missing: true, failed: false };
  if (res.error) return { rows: [], missing: false, failed: true };
  const rows = ((res.data || []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    number: String(row.invoice_number || "Invoice"),
    status: String(row.status || ""),
    totalKes: num(row.total_kes),
    dueAt: row.due_at ? String(row.due_at) : null,
    periodStart: row.period_start ? String(row.period_start) : null,
    periodEnd: row.period_end ? String(row.period_end) : null,
  }));
  return { rows, missing: false, failed: false };
}

export async function loadOwnerPlan(tenantId: string): Promise<{ ok: true; model: OwnerPlanModel } | { ok: false }> {
  if (!tenantId) return { ok: false };
  try {
    const ws = await createWorkspaceDataClient();
    if (!ws) return { ok: false };
    const sub = await ws.client
      .from("billing_subscription_read")
      .select(
        "billing_status, package_sku, version_monthly_price_kes, version_seats, trial_ends_at, voicemail_until, past_due_at, billing_suspended_at, billing_cancelled_at, paid_through, minutes_included, seconds_used, package_version_id",
      )
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (isMissingTableError(sub.error) || (!sub.error && !sub.data)) return { ok: true, model: betaModel() };
    if (sub.error || !sub.data) return { ok: false };
    const row = sub.data as Record<string, unknown>;
    const status = String(row.billing_status || "beta");
    if (isFreeBeta(status)) return { ok: true, model: betaModel() };

    const [packs, versions, invoices, notices, seats] = await Promise.all([
      ws.client.from("billing_packages").select("id, sku, name, is_active"),
      publishedVersions(ws.client),
      loadInvoices(ws.client, tenantId),
      ws.client
        .from("billing_notices")
        .select("id, title, body, created_at, read_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(40),
      ws.client.rpc("tenant_seats_used", { p_tenant: tenantId }),
    ]);
    if (versions.missing || isMissingTableError(packs.error)) return { ok: true, model: betaModel() };
    if (packs.error || versions.failed || invoices.failed) return { ok: false };
    if (notices.error && !isMissingTableError(notices.error)) return { ok: false };

    const plans = mapPlans((packs.data || []) as Record<string, unknown>[], versions.rows);
    const seatOffer = await loadPinnedSeatOffer(ws.client, tenantId);
    const open = invoices.rows.find((item) => item.status === "open") || null;
    const now = new Date();
    const trial =
      status === "trialing"
        ? trialRemaining({
            now,
            trialEndsAt: row.trial_ends_at ? String(row.trial_ends_at) : null,
            secondsUsed: num(row.seconds_used),
            minutesIncluded: num(row.minutes_included),
          })
        : null;
    const noticeRows = ((notices.data || []) as Record<string, unknown>[])
      .map((item) => ({
        id: String(item.id),
        title: String(item.title || ""),
        body: String(item.body || ""),
        createdAt: String(item.created_at || ""),
        unread: !item.read_at,
      }))
      .sort((a, b) => Number(a.unread === b.unread ? 0 : a.unread ? -1 : 1) || Date.parse(b.createdAt) - Date.parse(a.createdAt));

    return {
      ok: true,
      model: {
        freeBeta: false,
        billingStatus: status,
        surface: ownerBillingSurface(status),
        currentSku: isSku(row.package_sku) ? row.package_sku : null,
        currentMonthlyKes: row.version_monthly_price_kes == null ? null : num(row.version_monthly_price_kes),
        cycle: seatOffer.cycle,
        plans,
        seatsUsed: Math.max(0, Math.round(num(seats.data))),
        seatsIncluded: Math.max(0, Math.round(num(row.version_seats))),
        minutesIncluded: Math.max(0, Math.round(num(row.minutes_included))),
        minutesUsed: minutesUsedFromSeconds(row.seconds_used),
        trialText: trial?.text ?? null,
        onDemandLocked: status === "trialing",
        invoices: invoices.rows,
        notices: noticeRows,
        periodEndLabel: nairobiDay(row.paid_through ? String(row.paid_through) : null),
        dayOfPeriod:
          seatOffer.daysLeft != null && seatOffer.daysInPeriod != null
            ? seatOffer.daysInPeriod - seatOffer.daysLeft
            : null,
        daysInPeriod: seatOffer.daysInPeriod,
        daysLeft: seatOffer.daysLeft,
        extraSeatMonthlyKes: seatOffer.extraSeatMonthlyKes,
        extraSeats: seatOffer.extraSeats,
        seatUnitKes: seatOffer.seatUnitKes,
        periodEndMonth: seatOffer.periodEndMonth,
        nextPeriodStartLabel: seatOffer.nextPeriodStartLabel,
        banner: bannerFrom(row, open ? { totalKes: open.totalKes } : null, now),
      },
    };
  } catch {
    return { ok: false };
  }
}

export async function loadDeskBillingBanner(tenantId: string): Promise<BillingBanner | null> {
  if (!tenantId) return null;
  try {
    const ws = await createWorkspaceDataClient();
    if (!ws) return null;
    const sub = await ws.client
      .from("billing_subscription_read")
      .select(
        "billing_status, trial_ends_at, voicemail_until, past_due_at, billing_suspended_at, minutes_included, seconds_used",
      )
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (sub.error || !sub.data) return null;
    const row = sub.data as Record<string, unknown>;
    if (isFreeBeta(String(row.billing_status || ""))) return null;
    const invoices = await loadInvoices(ws.client, tenantId);
    const open = invoices.rows.find((item) => item.status === "open") || null;
    return bannerFrom(row, open ? { totalKes: open.totalKes } : null, new Date());
  } catch {
    return null;
  }
}

export async function loadUsageBillingExtras(tenantId: string): Promise<UsageBillingExtras> {
  if (!tenantId) return emptyExtras();
  try {
    const ws = await createWorkspaceDataClient();
    if (!ws) return emptyExtras();
    const sub = await ws.client
      .from("billing_subscription_read")
      .select("billing_status, version_monthly_price_kes, package_version_id")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (sub.error || !sub.data) return emptyExtras();
    const row = sub.data as Record<string, unknown>;
    const status = String(row.billing_status || "beta");
    const beta = isFreeBeta(status);
    let messageCredits: number | null = null;
    let creditBurns: CreditBurns | null = null;
    let inbound: number | null = null;
    let outbound: number | null = null;
    let share: number | null = null;
    if (row.package_version_id) {
      const versions = await publishedVersions(ws.client);
      const match = versions.rows.find((item) => String(item.id) === String(row.package_version_id));
      if (match) {
        if (match.message_credits != null && match.message_credits !== "") {
          messageCredits = Math.round(num(match.message_credits));
        }
        creditBurns = creditBurnsFrom(match);
        inbound = num(match.inbound_kes_per_second) * 60;
        outbound = num(match.outbound_kes_per_second) * 60;
        const shareRaw = match.spend_limit_share_percent;
        if (shareRaw != null && shareRaw !== "") share = num(shareRaw);
      }
    }
    if (beta) return { ...emptyExtras(), billingStatus: "beta", freeBeta: true, messageCredits, creditBurns };
    const monthlyPriceKes = row.version_monthly_price_kes == null ? null : num(row.version_monthly_price_kes);
    return {
      billingStatus: status,
      freeBeta: false,
      monthlyPriceKes,
      messageCredits,
      creditBurns,
      inboundPerMinuteKes: inbound,
      outboundPerMinuteKes: outbound,
      spendLimitKes: spendLimitDisplayKes(null, monthlyPriceKes, share),
      onDemandLocked: status === "trialing",
    };
  } catch {
    return emptyExtras();
  }
}

export type PlanRowStatus = { billingStatus: string; row: { text: string; title: string } | null };

/** Settings Plan row: the plan name, "Choose a plan" on trial. Beta reads the package from tenant_billing_state. */
export async function loadPlanRowStatus(tenantId: string): Promise<PlanRowStatus> {
  const none: PlanRowStatus = { billingStatus: "beta", row: null };
  if (!tenantId) return none;
  try {
    const ws = await createWorkspaceDataClient();
    if (!ws) return none;
    const sub = await ws.client
      .from("billing_subscription_read")
      .select("billing_status, package_sku")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    const row = (sub.error ? null : sub.data) as Record<string, unknown> | null;
    const status = row ? String(row.billing_status || "beta") : "beta";
    let name: string | null = null;
    if (row && isSku(row.package_sku)) {
      const pack = await ws.client.from("billing_packages").select("name").eq("sku", row.package_sku).maybeSingle();
      if (!pack.error && pack.data) name = String((pack.data as { name?: unknown }).name || "") || null;
    }
    if (!name && isFreeBeta(status)) {
      const state = await getSupabaseAdmin()
        .from("tenant_billing_state")
        .select("package_state, package_name")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      const data = (state.error ? null : state.data) as { package_state?: string; package_name?: string } | null;
      if (data?.package_state === "active" && data.package_name) name = String(data.package_name);
    }
    const text = planRowText(status, name);
    return { billingStatus: status, row: text ? { text, title: text } : null };
  } catch {
    return none;
  }
}
