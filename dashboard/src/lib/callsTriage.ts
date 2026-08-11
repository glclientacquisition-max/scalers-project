import {
  parseLeadStatus,
  parseSummary,
  type CallRow,
  type LeadStatus,
} from "@/lib/supabase";

export type Lead = {
  call: CallRow;
  name: string | null;
  reason: string | null;
  notified: boolean;
  urgent: boolean;
  leadStatus: LeadStatus;
};

export const STATUS_FILTERS = [
  { id: "all", label: "All" },
  { id: "new", label: "New" },
  { id: "contacted", label: "Contacted" },
  { id: "resolved", label: "Resolved" },
] as const;

export type StatusFilterId = (typeof STATUS_FILTERS)[number]["id"];

export function toLead(call: CallRow): Lead {
  const meta = parseSummary(call.summary);
  return {
    call,
    name: typeof meta.name === "string" ? meta.name : null,
    reason: typeof meta.reason === "string" ? meta.reason : null,
    notified: Boolean(meta.whatsapp_sent),
    urgent: String(call.sentiment || "").toLowerCase() === "urgent",
    leadStatus: parseLeadStatus(call.lead_status),
  };
}

export function formatCallWhen(iso: string, style: "short" | "full" = "short") {
  try {
    return new Intl.DateTimeFormat("en-KE", {
      dateStyle: style === "full" ? "full" : "medium",
      timeStyle: style === "full" ? "medium" : "short",
      timeZone: "Africa/Nairobi",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function nairobiDayStartIso(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const day = fmt.format(new Date());
  return new Date(`${day}T00:00:00+03:00`).toISOString();
}

export function nairobiGreeting(): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-KE", {
      timeZone: "Africa/Nairobi",
      hour: "numeric",
      hour12: false,
    }).format(new Date())
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** Explicit status wins; bare /calls defaults to New when work is waiting. */
export function resolveStatusFilter(
  raw: string | undefined,
  newCount: number
): StatusFilterId {
  if (raw === "all") return "all";
  if (raw === "new" || raw === "contacted" || raw === "resolved") return raw;
  return newCount > 0 ? "new" : "all";
}

export function callsHref(opts: {
  status?: StatusFilterId;
  page?: number;
  q?: string;
} = {}): string {
  const q = new URLSearchParams();
  if (opts.status) q.set("status", opts.status);
  if (opts.q?.trim()) q.set("q", opts.q.trim());
  if (opts.page && opts.page > 1) q.set("page", String(opts.page));
  const qs = q.toString();
  return qs ? `/calls?${qs}` : "/calls";
}

export function sanitizeSearchQuery(raw: string | undefined): string {
  return String(raw || "")
    .trim()
    .slice(0, 64)
    .replace(/[%_,.()]/g, " ");
}

/** Prefilled WhatsApp opener for Kenyan SME follow-up. */
export function followUpWhatsAppMessage(opts: {
  businessName: string;
  name: string | null;
  reason: string | null;
}): string {
  const who = opts.name?.trim() || "there";
  const biz = opts.businessName.trim() || "us";
  if (opts.reason?.trim()) {
    return `Hi ${who}, this is ${biz}. Thanks for calling about ${opts.reason.trim().replace(/\.$/, "")}. How can we help you next?`;
  }
  return `Hi ${who}, this is ${biz}. Thanks for calling — how can we help you?`;
}

export function walletKes(tenant: {
  wallet_balance_kes?: number | null;
  telecom_wallet_balance_kes?: number | null;
  ai_wallet_balance_usd?: number | null;
}): number {
  return Number(
    tenant.wallet_balance_kes ??
      (Number(tenant.telecom_wallet_balance_kes ?? 0) +
        Math.round(Number(tenant.ai_wallet_balance_usd ?? 0) * 130))
  );
}
