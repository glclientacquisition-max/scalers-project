import { isMissingTableError } from "@/lib/adminErrors";
import { createWorkspaceDataClient } from "@/lib/tenant";
import { isFreeBeta, ownerBillingSurface, type OwnerBillingSurface } from "@/lib/betaBilling";
import { nairobiDay, pickBillingBanner, type BillingBanner } from "@/lib/billingBanner";
import { annualPriceKes, annualSavingKes } from "@/lib/planPricing";
import { trialRemaining } from "@/lib/trialRemaining";

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
  payToken: string | null;
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
  trialText: string | null;
  onDemandLocked: boolean;
  invoices: OwnerInvoiceRow[];
  notices: OwnerNoticeRow[];
  periodEndLabel: string | null;
  dayOfPeriod: number | null;
  daysInPeriod: number | null;
  banner: BillingBanner | null;
};

export type UsageBillingExtras = {
  billingStatus: string;
  freeBeta: boolean;
  monthlyPriceKes: number | null;
  messageCredits: number | null;
  inboundPerMinuteKes: number | null;
  outboundPerMinuteKes: number | null;
  onDemandLocked: boolean;
};

const VERSION_WITH_CREDITS =
  "id, package_id, version, monthly_price_kes, seats, minutes, dids, inbound_kes_per_second, outbound_kes_per_second, annual_discount_percent, message_credits";
const VERSION_BASE = VERSION_WITH_CREDITS.replace(", message_credits", "");
const INVOICE_WITH_TOKEN =
  "id, invoice_number, status, total_kes, due_at, issued_at, period_start, period_end, pay_token";
const INVOICE_BASE = INVOICE_WITH_TOKEN.replace(", pay_token", "");

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
    trialText: null,
    onDemandLocked: false,
    invoices: [],
    notices: [],
    periodEndLabel: null,
    dayOfPeriod: null,
    daysInPeriod: null,
    banner: null,
  };
}

function emptyExtras(): UsageBillingExtras {
  return {
    billingStatus: "beta",
    freeBeta: true,
    monthlyPriceKes: null,
    messageCredits: null,
    inboundPerMinuteKes: null,
    outboundPerMinuteKes: null,
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
    const creditsRaw = version.message_credits;
    const messageCredits =
      creditsRaw == null || creditsRaw === "" ? null : Math.round(num(creditsRaw));
    plans.push({
      sku: pack.sku,
      name: String(pack.name || pack.sku),
      monthlyKes: monthly,
      annualKes: annualPriceKes(monthly, discount),
      savingKes: annualSavingKes(monthly, discount),
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

async function selectRows(query: PromiseLike<unknown>): Promise<LooseRows> {
  return (await query) as LooseRows;
}

async function publishedVersions(
  client: DataClient,
): Promise<{ rows: VersionRow[]; missing: boolean; failed: boolean }> {
  let res = await selectRows(
    client.from("billing_package_versions").select(VERSION_WITH_CREDITS).eq("status", "published"),
  );
  if (res.error && /message_credits/i.test(String(res.error.message || ""))) {
    res = await selectRows(
      client.from("billing_package_versions").select(VERSION_BASE).eq("status", "published"),
    );
  }
  if (isMissingTableError(res.error)) return { rows: [], missing: true, failed: false };
  if (res.error) return { rows: [], missing: false, failed: true };
  return { rows: (res.data || []) as VersionRow[], missing: false, failed: false };
}

function pauseOn(row: Record<string, unknown>): string | null {
  if (row.billing_suspended_at) return String(row.billing_suspended_at);
  if (!row.past_due_at) return null;
  const t = Date.parse(String(row.past_due_at));
  if (!Number.isFinite(t)) return null;
  return new Date(t + 8 * 86_400_000).toISOString();
}

function bannerFrom(row: Record<string, unknown>, open: { totalKes: number; payToken: string | null } | null, now: Date): BillingBanner | null {
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
      payToken: open?.payToken ?? null,
    },
    now,
  );
}

async function loadInvoices(
  client: DataClient,
  tenantId: string,
): Promise<{ rows: OwnerInvoiceRow[]; missing: boolean; failed: boolean }> {
  let res = await selectRows(
    client
      .from("invoices")
      .select(INVOICE_WITH_TOKEN)
      .eq("tenant_id", tenantId)
      .neq("status", "draft")
      .order("issued_at", { ascending: false }),
  );
  if (res.error && /pay_token/i.test(String(res.error.message || ""))) {
    res = await selectRows(
      client
        .from("invoices")
        .select(INVOICE_BASE)
        .eq("tenant_id", tenantId)
        .neq("status", "draft")
        .order("issued_at", { ascending: false }),
    );
  }
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
    payToken: row.pay_token ? String(row.pay_token) : null,
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
        cycle: "month",
        plans,
        seatsUsed: Math.max(0, Math.round(num(seats.data))),
        seatsIncluded: Math.max(0, Math.round(num(row.version_seats))),
        trialText: trial?.text ?? null,
        onDemandLocked: status === "trialing",
        invoices: invoices.rows,
        notices: noticeRows,
        periodEndLabel: nairobiDay(row.paid_through ? String(row.paid_through) : null),
        dayOfPeriod: null,
        daysInPeriod: null,
        banner: bannerFrom(row, open ? { totalKes: open.totalKes, payToken: open.payToken } : null, now),
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
    return bannerFrom(row, open ? { totalKes: open.totalKes, payToken: open.payToken } : null, new Date());
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
    if (isFreeBeta(status)) return { ...emptyExtras(), billingStatus: "beta", freeBeta: true };
    let messageCredits: number | null = null;
    let inbound: number | null = null;
    let outbound: number | null = null;
    if (row.package_version_id) {
      const versions = await publishedVersions(ws.client);
      const match = versions.rows.find((item) => String(item.id) === String(row.package_version_id));
      if (match) {
        if (match.message_credits != null && match.message_credits !== "") {
          messageCredits = Math.round(num(match.message_credits));
        }
        inbound = num(match.inbound_kes_per_second) * 60;
        outbound = num(match.outbound_kes_per_second) * 60;
      }
    }
    return {
      billingStatus: status,
      freeBeta: false,
      monthlyPriceKes: row.version_monthly_price_kes == null ? null : num(row.version_monthly_price_kes),
      messageCredits,
      inboundPerMinuteKes: inbound,
      outboundPerMinuteKes: outbound,
      onDemandLocked: status === "trialing",
    };
  } catch {
    return emptyExtras();
  }
}
