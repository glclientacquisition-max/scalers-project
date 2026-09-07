import {
  leadStatusLabel,
  parseCallResolution,
  parseLeadStatus,
  parseSummary,
  type CallResolution,
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
  resolution: CallResolution;
  primaryIntent: string | null;
};

export const STATUS_FILTERS = [
  { id: "all", label: "All" },
  { id: "new", label: "New" },
  { id: "contacted", label: "Followed Up" },
  { id: "resolved", label: "Done" },
  { id: "archived", label: "Archived" },
] as const;

export type StatusFilterId = (typeof STATUS_FILTERS)[number]["id"];

export { leadStatusLabel };

export function toLead(call: CallRow): Lead {
  const meta = parseSummary(call.summary);
  return {
    call,
    name: typeof meta.name === "string" ? meta.name : null,
    reason: typeof meta.reason === "string" ? meta.reason : null,
    notified: Boolean(meta.whatsapp_sent),
    urgent: String(call.sentiment || "").toLowerCase() === "urgent",
    leadStatus: parseLeadStatus(call.lead_status),
    resolution: parseCallResolution(call.resolution),
    primaryIntent: call.primary_intent?.trim() || null,
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

function nairobiDayKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function nairobiTime(iso: string): string {
  return new Intl.DateTimeFormat("en-KE", {
    timeZone: "Africa/Nairobi",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** Inbox When column: Today / Yesterday / weekday, not a full timestamp. */
export function formatCallWhenRelative(iso: string, now = new Date()): string {
  try {
    const time = nairobiTime(iso);
    const thenDay = nairobiDayKey(new Date(iso));
    const today = nairobiDayKey(now);
    if (thenDay === today) return `Today ${time}`;

    const [ty, tm, td] = today.split("-").map(Number);
    const [yy, ym, yd] = thenDay.split("-").map(Number);
    const diffDays = Math.round(
      (Date.UTC(ty, tm - 1, td) - Date.UTC(yy, ym - 1, yd)) / 86400000
    );
    if (diffDays === 1) return `Yesterday ${time}`;
    if (diffDays > 1 && diffDays < 7) {
      const weekday = new Intl.DateTimeFormat("en-KE", {
        timeZone: "Africa/Nairobi",
        weekday: "short",
      }).format(new Date(iso));
      return `${weekday} ${time}`;
    }
    return new Intl.DateTimeFormat("en-KE", {
      timeZone: "Africa/Nairobi",
      day: "numeric",
      month: "short",
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

/** Nairobi calendar day for Home. Real date, not decorative copy. */
export function nairobiDateLabel(now = new Date()): { iso: string; label: string } {
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  try {
    return {
      iso,
      label: new Intl.DateTimeFormat("en-KE", {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: "Africa/Nairobi",
      }).format(now),
    };
  } catch {
    return { iso, label: iso };
  }
}

/** Explicit status wins; bare /calls defaults to New when work is waiting. */
export function resolveStatusFilter(
  raw: string | undefined,
  newCount: number
): StatusFilterId {
  if (raw === "all") return "all";
  if (
    raw === "new" ||
    raw === "contacted" ||
    raw === "resolved" ||
    raw === "archived"
  ) {
    return raw;
  }
  return newCount > 0 ? "new" : "all";
}

export function callsHref(opts: {
  purpose?: string;
  status?: StatusFilterId;
  page?: number;
  q?: string;
} = {}): string {
  const q = new URLSearchParams();
  if (opts.purpose) q.set("purpose", opts.purpose);
  else if (opts.status) q.set("status", opts.status);
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
  return `Hi ${who}, this is ${biz}. Thanks for calling. How can we help you?`;
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
