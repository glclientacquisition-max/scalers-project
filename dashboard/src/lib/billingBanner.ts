import { isFreeBeta } from "./betaBilling";
import { formatKsh } from "./planPricing";

export type BillingBannerKind =
  | "line_closed"
  | "voicemail"
  | "trial_ended"
  | "grace"
  | "invoice_due"
  | "cancelled";

export type BillingBannerAction = { label: string; href: string };

export type BillingBanner = {
  kind: BillingBannerKind;
  text: string;
  action: BillingBannerAction | null;
};

export type BannerSub = {
  billingStatus: string | null;
  voicemailUntil?: string | null;
  pauseOn?: string | null;
  trialEnded?: boolean;
  openInvoiceKes?: number | null;
  payToken?: string | null;
};

export function nairobiDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Africa/Nairobi",
  });
}

function payAction(sub: BannerSub): BillingBannerAction | null {
  const amount = sub.openInvoiceKes;
  if (amount == null || !(amount > 0)) return { label: "Billing", href: "/settings/billing" };
  if (sub.payToken) return { label: `Pay ${formatKsh(amount)}`, href: `/pay/${sub.payToken}` };
  return { label: "Billing", href: "/settings/billing" };
}

/** At most one desk banner. Beta and a clear active plan return null. */
export function pickBillingBanner(sub: BannerSub | null | undefined, _now: Date): BillingBanner | null {
  if (!sub || isFreeBeta(sub.billingStatus)) return null;
  const open = sub.openInvoiceKes != null && sub.openInvoiceKes > 0;
  if (sub.billingStatus === "active" && !open) return null;

  const action = payAction(sub);
  const status = sub.billingStatus;

  if (status === "suspended") {
    const until = sub.voicemailUntil ? Date.parse(sub.voicemailUntil) : NaN;
    const now = _now.getTime();
    if (Number.isFinite(until) && now < until) {
      const day = nairobiDay(sub.voicemailUntil);
      return {
        kind: "voicemail",
        text: day
          ? `Callers can leave a voicemail until ${day}. Updates go to your Inbox only.`
          : "Callers can leave a voicemail. Updates go to your Inbox only.",
        action,
      };
    }
    return {
      kind: "line_closed",
      text: "Your line is not available. Callers hear that the line is closed.",
      action,
    };
  }

  if (status === "cancelled") {
    return { kind: "cancelled", text: "Your plan was cancelled.", action };
  }

  if (sub.trialEnded) {
    return { kind: "trial_ended", text: "Trial ended.", action };
  }

  if (status === "past_due" || status === "grace") {
    const day = nairobiDay(sub.pauseOn);
    return {
      kind: "grace",
      text: day
        ? `Payment due. Your Business Assistant pauses on ${day}.`
        : "Payment due. Your Business Assistant pauses soon.",
      action,
    };
  }

  if (open) {
    return { kind: "invoice_due", text: "Invoice due.", action };
  }

  return null;
}
