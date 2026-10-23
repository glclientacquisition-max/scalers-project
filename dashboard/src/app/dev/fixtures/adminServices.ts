import type { OpsNotice, OpsSettings, OpsSignal } from "@/lib/platformOpsModel";
import { DEFAULT_SAUTIKIT_WARN_MINOR } from "@/lib/platformOpsModel";

/** Synthetic Services snapshot for /dev. No real infra names on screen beyond labels. */
export const ADMIN_SERVICES_SNAPSHOT = {
  settings: {
    emails: ["ops@example.co.ke"],
    people: [
      { id: "p1", name: "Alvin", phone: "+254700000001", email: "alvin@example.co.ke" },
      { id: "p2", name: "Desk on-call", phone: "+254700000002", email: "oncall@example.co.ke" },
    ],
    kinds: {
      speech: true,
      reasoning: true,
      phone_line: true,
      sautikit_low: true,
      sms_credit: false,
      pool_empty: true,
      beta_expired: true,
    },
    sautikitWarnMinor: DEFAULT_SAUTIKIT_WARN_MINOR,
    recordingRetentionDays: 30,
  } satisfies OpsSettings,
  persisted: true,
  signals: [
    { kind: "speech", active: false, critical: false, title: "Speech", detail: "Clear" },
    { kind: "reasoning", active: false, critical: false, title: "Reasoning", detail: "Clear" },
    { kind: "phone_line", active: true, critical: false, title: "Phone line", detail: "Wallet low" },
    { kind: "sautikit_low", active: false, critical: false, title: "SautiKit", detail: "Above warn" },
    { kind: "sms_credit", active: false, critical: false, title: "SMS credit", detail: "Not watched" },
    { kind: "pool_empty", active: false, critical: false, title: "Number pool", detail: "Numbers free" },
    { kind: "beta_expired", active: false, critical: false, title: "Beta", detail: "None expired" },
  ] satisfies OpsSignal[],
  strip: { tone: "attention" as const, label: "Needs you", openCount: 1, criticalCount: 0 },
  notices: [
    {
      id: "n1",
      kind: "phone_line",
      status: "open",
      detail: "Wallet under warn.",
      notified_at: "2026-10-22T06:00:00Z",
    },
  ] satisfies OpsNotice[],
  infra: [
    { id: "voice", title: "Voice", tone: "ok" as const, label: "Reachable", detail: "Responding" },
    { id: "database", title: "Database", tone: "ok" as const, label: "Set", detail: "Connected" },
    { id: "host", title: "Host", tone: "neutral" as const, label: "Preview", detail: "This environment" },
  ],
  mailConfigured: true,
};

export type AdminServicesSnapshot = typeof ADMIN_SERVICES_SNAPSHOT;
