/** Staff platform notices. Not owner or caller alerts. */

export const OPS_NOTICE_KINDS = [
  "speech",
  "reasoning",
  "phone_line",
  "sautikit_low",
  "pool_empty",
  "beta_expired",
] as const;

export type OpsNoticeKind = (typeof OPS_NOTICE_KINDS)[number];

export type OpsNoticeStatus = "open" | "acked" | "resolved";

export type OpsHealthTone = "ok" | "attention" | "neutral";

export type OpsKindFlags = Record<OpsNoticeKind, boolean>;

export type OpsSettings = {
  emails: string[];
  kinds: OpsKindFlags;
  sautikitWarnMinor: number;
};

export type OpsSignal = {
  kind: OpsNoticeKind;
  active: boolean;
  critical: boolean;
  title: string;
  detail: string;
};

export type OpsNotice = {
  id: string;
  kind: OpsNoticeKind;
  status: OpsNoticeStatus;
  detail: string | null;
  notified_at: string | null;
};

export const DEFAULT_SAUTIKIT_WARN_MINOR = 50_000;
export const OPS_MAIL_COOLDOWN_MS = 30 * 60 * 1000;
export const OPS_RESEND_DOMAIN = "ops.scalers.co.ke";

export type OpsDnsRecord = {
  name: string;
  type: string;
  value: string;
  priority: number | null;
  status: string;
};

export function normalizeResendRecords(raw: unknown): OpsDnsRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const rec = row as Record<string, unknown>;
    const type = String(rec.type || "").toUpperCase();
    const value = String(rec.value || rec.content || "").trim();
    if (!type || !value) return [];
    const priorityRaw = rec.priority;
    const priority =
      typeof priorityRaw === "number" && Number.isFinite(priorityRaw) ? priorityRaw : null;
    return [
      {
        name: String(rec.name || "").trim() || OPS_RESEND_DOMAIN,
        type,
        value,
        priority,
        status: String(rec.status || "").trim() || "pending",
      },
    ];
  });
}

export function defaultKindFlags(): OpsKindFlags {
  return {
    speech: true,
    reasoning: true,
    phone_line: true,
    sautikit_low: true,
    pool_empty: true,
    beta_expired: true,
  };
}

export function defaultOpsSettings(): OpsSettings {
  return {
    emails: [],
    kinds: defaultKindFlags(),
    sautikitWarnMinor: DEFAULT_SAUTIKIT_WARN_MINOR,
  };
}

export function normalizeOpsEmail(raw: string): string {
  const email = String(raw || "").trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "";
  return email;
}

export function parseOpsEmails(raw: string): string[] {
  const seen = new Set<string>();
  const emails: string[] = [];
  for (const part of String(raw || "").split(/[\s,;]+/)) {
    const email = normalizeOpsEmail(part);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    emails.push(email);
  }
  return emails;
}

export function parseKindFlags(raw: unknown): OpsKindFlags {
  const flags = defaultKindFlags();
  if (!raw || typeof raw !== "object") return flags;
  const input = raw as Record<string, unknown>;
  for (const kind of OPS_NOTICE_KINDS) {
    if (typeof input[kind] === "boolean") flags[kind] = input[kind];
  }
  return flags;
}

export function kindLabel(kind: OpsNoticeKind): string {
  if (kind === "speech") return "Speech";
  if (kind === "reasoning") return "Reasoning";
  if (kind === "phone_line") return "Phone line";
  if (kind === "sautikit_low") return "Phone wallet low";
  if (kind === "pool_empty") return "Number pool empty";
  return "Beta expired";
}

export function kindHint(kind: OpsNoticeKind): string {
  if (kind === "speech") return "Voice audio";
  if (kind === "reasoning") return "Conversation model";
  if (kind === "phone_line") return "Provider line";
  if (kind === "sautikit_low") return "SautiKit balance";
  if (kind === "pool_empty") return "No number to assign";
  return "Stay Beta. Notice only.";
}

export type HealthSlice = { tone: OpsHealthTone; detail: string | null };

export function deriveOpsSignals(input: {
  speech: HealthSlice;
  reasoning: HealthSlice;
  phoneLine: HealthSlice;
  walletMinor: number | null;
  sautikitWarnMinor: number;
  availableDids: number;
  waitingBusinesses: number;
  expiredBetaCount: number;
}): OpsSignal[] {
  const warn = Number.isFinite(input.sautikitWarnMinor)
    ? input.sautikitWarnMinor
    : DEFAULT_SAUTIKIT_WARN_MINOR;
  const walletLow =
    input.walletMinor != null && Number.isFinite(input.walletMinor) && input.walletMinor <= warn;
  const walletEmpty = input.walletMinor != null && input.walletMinor <= 0;
  const poolEmpty = input.availableDids <= 0 && input.waitingBusinesses > 0;

  return [
    {
      kind: "speech",
      active: input.speech.tone === "attention",
      critical: input.speech.tone === "attention",
      title: "Speech",
      detail: input.speech.detail || "Speech is degraded",
    },
    {
      kind: "reasoning",
      active: input.reasoning.tone === "attention",
      critical: input.reasoning.tone === "attention",
      title: "Reasoning",
      detail: input.reasoning.detail || "Reasoning is degraded",
    },
    {
      kind: "phone_line",
      active: input.phoneLine.tone === "attention",
      critical: input.phoneLine.tone === "attention",
      title: "Phone line",
      detail: input.phoneLine.detail || "Phone line is degraded",
    },
    {
      kind: "sautikit_low",
      active: walletLow,
      critical: walletEmpty,
      title: "Phone wallet low",
      detail: walletEmpty
        ? "Phone wallet is empty"
        : `Phone wallet is at or under the warn level`,
    },
    {
      kind: "pool_empty",
      active: poolEmpty,
      critical: poolEmpty,
      title: "Number pool empty",
      detail:
        input.waitingBusinesses > 0
          ? `${input.waitingBusinesses} business waiting. No numbers available.`
          : "No numbers available",
    },
    {
      kind: "beta_expired",
      active: input.expiredBetaCount > 0,
      critical: false,
      title: "Beta expired",
      detail:
        input.expiredBetaCount === 1
          ? "1 business beta has ended"
          : `${input.expiredBetaCount} business betas have ended`,
    },
  ];
}

export function deriveStatusStrip(signals: OpsSignal[]): {
  tone: "ok" | "attention" | "down";
  label: string;
  openCount: number;
  criticalCount: number;
} {
  const active = signals.filter((signal) => signal.active);
  const criticalCount = active.filter((signal) => signal.critical).length;
  if (criticalCount > 0) {
    return {
      tone: "down",
      label: criticalCount === 1 ? "1 critical notice" : `${criticalCount} critical notices`,
      openCount: active.length,
      criticalCount,
    };
  }
  if (active.length > 0) {
    return {
      tone: "attention",
      label: active.length === 1 ? "1 notice" : `${active.length} notices`,
      openCount: active.length,
      criticalCount: 0,
    };
  }
  return { tone: "ok", label: "Platform OK", openCount: 0, criticalCount: 0 };
}

export function reconcileNotices(
  existing: OpsNotice[],
  signals: OpsSignal[],
  kinds: OpsKindFlags,
  nowMs = Date.now(),
): {
  open: OpsNoticeKind[];
  resolve: OpsNoticeKind[];
  notify: OpsNoticeKind[];
} {
  const openKinds = new Set(
    existing.filter((row) => row.status === "open" || row.status === "acked").map((row) => row.kind),
  );
  const byKind = new Map(existing.map((row) => [row.kind, row]));
  const open: OpsNoticeKind[] = [];
  const resolve: OpsNoticeKind[] = [];
  const notify: OpsNoticeKind[] = [];

  for (const signal of signals) {
    const enabled = kinds[signal.kind] !== false;
    const isOpen = openKinds.has(signal.kind);
    if (signal.active && enabled) {
      if (!isOpen) {
        open.push(signal.kind);
        notify.push(signal.kind);
      } else {
        const row = byKind.get(signal.kind);
        const last = row?.notified_at ? Date.parse(row.notified_at) : 0;
        if (row?.status === "open" && (!last || nowMs - last >= OPS_MAIL_COOLDOWN_MS)) {
          notify.push(signal.kind);
        }
      }
    } else if (isOpen && (!signal.active || !enabled)) {
      resolve.push(signal.kind);
    }
  }

  return { open, resolve, notify };
}

export function opsMailSubject(kind: OpsNoticeKind, recovered = false): string {
  const name = kindLabel(kind);
  return recovered ? `Scalers ops: ${name} recovered` : `Scalers ops: ${name}`;
}

export function mergeQueueRows(input: {
  notices: Array<{ kind: OpsNoticeKind; detail: string | null; status: OpsNoticeStatus }>;
  businesses: Array<{ id: string; name: string; status: string }>;
}): Array<{ key: string; title: string; detail: string; href: string; stamp: string }> {
  const rows: Array<{ key: string; title: string; detail: string; href: string; stamp: string }> = [];
  for (const notice of input.notices) {
    if (notice.status !== "open") continue;
    rows.push({
      key: `ops-${notice.kind}`,
      title: kindLabel(notice.kind),
      detail: notice.detail || kindHint(notice.kind),
      href: "/admin/platform#ops-mail",
      stamp: "Open",
    });
  }
  for (const business of input.businesses) {
    const waiting = business.status === "waiting";
    rows.push({
      key: `biz-${business.id}`,
      title: business.name,
      detail: waiting ? "Waiting for a number" : "Archived",
      href: `/admin/businesses#biz-${business.id}`,
      stamp: waiting ? "Waiting" : "Archived",
    });
  }
  return rows;
}

export function infraFromEnv(env: {
  voiceReachable: boolean | null;
  supabaseUrl: string;
  vercelEnv: string;
}): Array<{ id: string; title: string; tone: OpsHealthTone; label: string; detail: string }> {
  const supabaseHost = String(env.supabaseUrl || "");
  const supabaseSet = /supabase\.co/.test(supabaseHost);
  return [
    {
      id: "railway",
      title: "Railway",
      tone: env.voiceReachable === true ? "ok" : env.voiceReachable === false ? "attention" : "neutral",
      label: env.voiceReachable === true ? "OK" : env.voiceReachable === false ? "Unreachable" : "Unknown",
      detail:
        env.voiceReachable === true
          ? "Voice health responded"
          : env.voiceReachable === false
            ? "Voice health did not respond"
            : "No voice health yet",
    },
    {
      id: "vercel",
      title: "Vercel",
      tone: "neutral",
      label: env.vercelEnv ? "Host set" : "Unknown",
      detail: env.vercelEnv
        ? `Desk env ${env.vercelEnv}. No deploy status API configured.`
        : "No deploy status API configured",
    },
    {
      id: "supabase",
      title: "Supabase",
      tone: supabaseSet ? "neutral" : "neutral",
      label: supabaseSet ? "URL set" : "Unknown",
      detail: supabaseSet
        ? "Project URL is set. No management status API configured."
        : "No project URL",
    },
  ];
}
