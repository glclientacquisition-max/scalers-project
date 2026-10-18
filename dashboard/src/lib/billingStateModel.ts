/**
 * Owner Usage view from Ops-Billing's tenant_billing_state row (#650, SMS from
 * the notify_sms_billable ledger since #647). Pure: no I/O, relative imports
 * only, so node tests load it directly.
 *
 * Owner review 18 Oct 2026: Esga (Starter, enforcement off) saw "Free beta"
 * with no package price, an unexplained on-demand tick, "SMS 7" with no
 * warning, and an "Included" header over Left/Used. The Desk now reads the
 * view and words each billing mode the way Ops-Billing defined it.
 */

export type BillingMode = "beta" | "metered" | "capped" | "none";

/** Columns the Desk reads from public.tenant_billing_state. */
export type TenantBillingStateRow = {
  package_state?: string | null;
  package_name?: string | null;
  billing_term?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  included_minutes?: number | string | null;
  used_minutes?: number | string | null;
  remaining_minutes?: number | string | null;
  sms_included?: number | string | null;
  sms_used?: number | string | null;
  sms_used_source?: string | null;
  on_demand_enabled?: boolean | null;
  enforcement_mode?: string | null;
  mode_label?: string | null;
  overage_owed_kes?: number | string | null;
};

export type OwnerBillingInput = {
  state: TenantBillingStateRow | null;
  /** billing_packages.monthly_price_kes for the active package. Never hardcoded. */
  monthlyPriceKes: number | null;
  /** SMS messages behind the sms_used credits (one long message can be several credits). */
  smsMessages: number | null;
  /** tenants.seat_included and tenant_seats_used() (members + unexpired invites). */
  seatsIncluded: number;
  seatsUsed: number;
  /** Free beta: no invoices, and a missing package is not a charge. */
  isBeta?: boolean;
  /** Team alert allowances still kept on tenants (not in the view yet). */
  alerts?: {
    email?: { included: number; used: number };
    whatsapp?: { included: number; used: number };
  };
};

export type UsageRow = {
  key: "minutes" | "sms" | "seats" | "email" | "whatsapp";
  label: string;
  included: number;
  used: number;
  left: number;
  /** Extra line under the row, e.g. "102 messages". */
  note: string | null;
};

export type OwnerBillingView = {
  mode: BillingMode;
  packageName: string | null;
  /** Header line under "Usage". */
  headline: string;
  /** Short line for Home ("Starter · Free during beta"). */
  shortLabel: string;
  /** Rates table title. */
  ratesTitle: string;
  rows: UsageRow[];
  minutesIncluded: number;
  minutesLeft: number;
  /** Low-balance banner for minutes or SMS. Null when nothing is low. */
  lowNotice: string | null;
  /** What the on-demand switch means right now, in owner words. */
  onDemandHint: string;
  periodEndLabel: string | null;
};

/** Below this share of the included amount we warn the owner. */
export const LOW_SHARE = 0.1;

function num(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function kes(n: number): string {
  return `KSh ${Math.round(n).toLocaleString("en-KE")}`;
}

function count(n: number): string {
  return Math.round(n).toLocaleString("en-KE");
}

/** "31 Oct" in Nairobi time from the exclusive period end. */
export function periodEndLabel(periodEnd: string | null | undefined): string | null {
  if (!periodEnd) return null;
  const end = Date.parse(periodEnd);
  if (!Number.isFinite(end)) return null;
  // period_end is exclusive (midnight EAT that starts the next month): show the last day.
  const last = new Date(end - 1000);
  return last.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Nairobi" });
}

export function billingModeOf(state: TenantBillingStateRow | null): BillingMode {
  if (!state || state.package_state !== "active") return "none";
  const label = String(state.mode_label || "").toLowerCase();
  if (label === "metered" || label === "capped") return label;
  return "beta";
}

function isLow(included: number, left: number): boolean {
  if (included <= 0) return false;
  return left <= Math.max(1, Math.floor(included * LOW_SHARE));
}

export function ownerBillingView(input: OwnerBillingInput): OwnerBillingView {
  const state = input.state;
  const mode = billingModeOf(state);
  const packageName = mode === "none" ? null : String(state?.package_name || "").trim() || "Your package";
  const price = input.monthlyPriceKes != null && input.monthlyPriceKes > 0 ? kes(input.monthlyPriceKes) : null;
  const priced = price ? `${price} a month` : "Monthly package";
  const endLabel = periodEndLabel(state?.period_end);
  const onDemand = Boolean(state?.on_demand_enabled);

  let headline: string;
  let shortLabel: string;
  if (mode === "beta") {
    headline = `${packageName} · Free during beta. We count your usage so you can see it. Nothing is charged until we tell you.`;
    shortLabel = `${packageName} · Free during beta`;
  } else if (mode === "metered") {
    headline = `${packageName} · ${priced}. Usage past what's included is billed at the rates below.`;
    shortLabel = `${packageName} · ${priced}`;
  } else if (mode === "capped") {
    headline = `${packageName} · ${priced}. When your included minutes run out, calls stop until ${endLabel || "the end of the month"} unless you turn on extra usage.`;
    shortLabel = `${packageName} · ${priced}`;
  } else if (input.isBeta) {
    headline = "Free during beta. Nothing is charged.";
    shortLabel = "Free during beta";
  } else {
    headline = "No package.";
    shortLabel = "No package";
  }

  const minutesIncluded = Math.max(0, Math.floor(num(state?.included_minutes)));
  const minutesUsed = Math.max(0, Math.ceil(num(state?.used_minutes)));
  const minutesLeft = Math.max(0, minutesIncluded - minutesUsed);
  const smsIncluded = Math.max(0, Math.floor(num(state?.sms_included)));
  const smsUsed = Math.max(0, Math.floor(num(state?.sms_used)));
  const smsLeft = Math.max(0, smsIncluded - smsUsed);
  const seatsIncluded = Math.max(0, Math.floor(input.seatsIncluded));
  const seatsUsed = Math.max(0, Math.floor(input.seatsUsed));

  const smsNote =
    input.smsMessages != null && input.smsMessages !== smsUsed
      ? `${count(smsUsed)} credits used (${count(input.smsMessages)} message${input.smsMessages === 1 ? "" : "s"})`
      : null;

  const rows: UsageRow[] = [
    { key: "minutes", label: "Call minutes", included: minutesIncluded, used: minutesUsed, left: minutesLeft, note: null },
    { key: "sms", label: "SMS credits", included: smsIncluded, used: smsUsed, left: smsLeft, note: smsNote },
    { key: "seats", label: "Team seats", included: seatsIncluded, used: seatsUsed, left: Math.max(0, seatsIncluded - seatsUsed), note: null },
  ];
  for (const [key, label] of [["email", "Team email alerts"], ["whatsapp", "Team WhatsApp alerts"]] as const) {
    const bucket = input.alerts?.[key];
    if (!bucket || bucket.included <= 0) continue;
    const included = Math.max(0, Math.floor(bucket.included));
    const used = Math.max(0, Math.floor(bucket.used));
    rows.push({ key, label, included, used, left: Math.max(0, included - used), note: null });
  }

  const lowMinutes = isLow(minutesIncluded, minutesLeft);
  const lowSms = isLow(smsIncluded, smsLeft);
  let lowNotice: string | null = null;
  if (mode !== "none" && (lowMinutes || lowSms)) {
    const what =
      lowMinutes && lowSms
        ? `${count(minutesLeft)} minutes and ${count(smsLeft)} SMS credits left`
        : lowMinutes
          ? `${count(minutesLeft)} of ${count(minutesIncluded)} minutes left`
          : `${count(smsLeft)} of ${count(smsIncluded)} SMS credits left`;
    const until = endLabel ? ` until ${endLabel}` : "";
    if (mode === "beta") {
      lowNotice = `${what}${until}. During beta nothing is charged and calls keep working.`;
    } else if (onDemand) {
      lowNotice = `${what}${until}. Extra usage is on, so anything past this is billed at the rates below.`;
    } else {
      lowNotice = lowMinutes
        ? `${what}${until}. When they run out, calls stop unless you turn on extra usage.`
        : `${what}${until}. When they run out, SMS to callers stop unless you turn on extra usage.`;
    }
  }

  let onDemandHint: string;
  if (mode === "beta") {
    onDemandHint = onDemand
      ? "On. During beta nothing is charged. After beta, usage past what's included is billed at the rates below."
      : "Off. During beta nothing is charged. After beta, calls stop when included minutes run out.";
  } else if (mode === "none") {
    onDemandHint = input.isBeta ? "Nothing is charged during beta." : "No package.";
  } else {
    onDemandHint = onDemand
      ? "On. Usage past what's included is billed at the rates below."
      : `Off. When included minutes run out, calls stop until ${endLabel || "the end of the month"}.`;
  }

  return {
    mode,
    packageName,
    headline,
    shortLabel,
    ratesTitle: mode === "beta" || (mode === "none" && input.isBeta) ? "Rates after beta" : "Rates past what's included",
    rows,
    minutesIncluded,
    minutesLeft,
    lowNotice,
    onDemandHint,
    periodEndLabel: endLabel,
  };
}

/** Loader builds the view before the page knows beta. Same words as `isBeta` on the input. */
export function presentFreeBeta(view: OwnerBillingView, isBeta: boolean): OwnerBillingView {
  if (!isBeta || view.mode !== "none") return view;
  return {
    ...view,
    headline: "Free during beta. Nothing is charged.",
    shortLabel: "Free during beta",
    ratesTitle: "Rates after beta",
    onDemandHint: "Nothing is charged during beta.",
  };
}
