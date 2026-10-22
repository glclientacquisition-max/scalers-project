import type { EmailKind, EmailProps } from "./catalog.ts";

/** Sample data for previews and tests. Fictional business and numbers. */
type Fixture<K extends EmailKind> = { name: string; kind: K; props: EmailProps<K> };
const f = <K extends EmailKind>(name: string, kind: K, props: EmailProps<K>): Fixture<K> => ({ name, kind, props });

const biz = { businessName: "Kamau Plumbing", firstName: "Wanjiru", mode: "beta" as const };

export const fixtures = [
  f("welcome", "welcome", { ...biz, lineReady: false }),
  f("line-live", "line_live", { ...biz, lineNumber: "0709 000 123", dialNumber: "0709000123" }),
  f("package-assigned", "package_changed", { ...biz, change: "assigned", packageName: "Starter", minutes: 300, texts: 200, seats: 2 }),
  f("package-upgraded", "package_changed", { ...biz, change: "upgraded", packageName: "Growth", previousPackageName: "Starter", minutes: 800, texts: 500, seats: 4, date: "1 November" }),
  f("package-downgrade", "package_changed", { ...biz, change: "downgrade_scheduled", packageName: "Starter", previousPackageName: "Growth", minutes: 300, texts: 200, seats: 2, date: "1 November" }),
  f("usage-80", "usage_80", { ...biz, resource: "texts", used: 163, included: 200, resetDate: "1 November", extraUsage: false }),
  f("usage-100", "usage_100", { ...biz, resource: "minutes", used: 300, included: 300, resetDate: "1 November", extraUsage: false }),
  f("usage-100-live", "usage_100", { ...biz, mode: "live", resource: "minutes", used: 300, included: 300, resetDate: "1 November", extraUsage: false }),
  f("usage-100-reminder", "usage_100_reminder", { ...biz, mode: "live", resource: "minutes", used: 300, included: 300, resetDate: "1 November", extraUsage: false, daysLeft: 9, missedSince: 6 }),
  f("extra-usage-on", "extra_usage", { ...biz, on: true, changedBy: "Wanjiru Kamau", changedAt: "18 October at 10:12" }),
  f("monthly-summary", "monthly_summary", { ...biz, month: "October", callsAnswered: 142, requests: 61, appointments: 23, minutesUsed: 248, minutesIncluded: 300, textsUsed: 200, textsIncluded: 200, packageName: "Starter", busiestDay: "Monday 13 October", nextResetDate: "1 December" }),
  f("line-paused", "line_paused", { ...biz, pausedOn: "18 October" }),
  f("line-still-paused", "line_still_paused", { ...biz, pausedOn: "18 October", step: 1, daysPaused: 3 }),
  f("line-restored", "line_restored", { ...biz, lineNumber: "0709 000 123", restoredAt: "2:40 pm today" }),
  f("setup-nudge", "setup_nudge", { ...biz, step: 1, stepsDone: 3, stepsTotal: 5, nextStep: "your opening hours" }),
  f("invite-reminder", "invite_reminder", { step: 1, businessName: "Kamau Plumbing", inviterName: "Wanjiru Kamau", role: "Admin", inviteUrl: "https://app.scalers.co.ke/invite/sample-token", daysLeft: 5 }),
  f("ops-incident", "ops_incident", { state: "open", title: "Speech down", fact: "Speech has failed on 4 calls in 10 minutes. Callers hear the fallback message.", action: "Check the speech status page, then Platform in Admin.", startedAt: "18 Oct, 09:14 EAT", affected: "All clients" }),
  f("ops-incident-client", "ops_incident", { state: "open", title: "Alerts failing", fact: "Owner alerts failed on every channel for 3 calls in the last hour.", action: "Check the owner's phone and email in Admin.", startedAt: "18 Oct, 09:40 EAT", tenant: { id: "00000000-0000-4000-8000-000000000001", name: "Kamau Plumbing" } }),
  f("ops-incident-recovered", "ops_incident", { state: "recovered", title: "Speech down", fact: "Speech calls are succeeding again.", startedAt: "18 Oct, 09:14 EAT", lasted: "42 min", affected: "All clients" }),
  f("ops-incident-reminder", "ops_incident_reminder", { title: "Phone line balance at zero", fact: "The phone line supplier balance is KES 0. New calls can't connect.", action: "Pay the phone line supplier, then check Platform.", startedAt: "18 Oct, 05:02 EAT", openFor: "4h", affected: "All clients" }),
  f("ops-wallet-prod-low", "ops_wallet", { env: "production", state: "low", workspace: "Production (e0e57aa5)", balance: "KES 28.27", threshold: "KES 100", checkedAt: "21 Oct 2026, 18:49 EAT", risk: "2 numbers renew on 1 Nov: KES 200 due." }),
  f("ops-wallet-prod-empty", "ops_wallet", { env: "production", state: "empty", workspace: "Production (e0e57aa5)", balance: "KES -273.14", threshold: "KES 0", checkedAt: "1 Oct 2026, 05:10 EAT", risk: "Numbers renew on 1 Nov." }),
  f("ops-wallet-prod-topped", "ops_wallet", { env: "production", state: "topped_up", workspace: "Production (e0e57aa5)", balance: "KES 600", threshold: "KES 550", checkedAt: "21 Oct 2026, 19:20 EAT", nextAlert: "KES 500" }),
  f("ops-wallet-staging-low", "ops_wallet", { env: "staging", state: "low", workspace: "Staging (1f85601c)", balance: "KES 45.08", threshold: "KES 300", checkedAt: "21 Oct 2026, 18:49 EAT" }),
  f("ops-digest", "ops_digest", {
    date: "Sun 18 Oct",
    yesterday: { calls: 37, texts: 52, signups: 1 },
    stillOpen: [
      { text: "Phone number pool empty", meta: "open 9 days", tone: "attention" },
      { text: "Phone line balance low, KES 6", meta: "open 9 days", tone: "attention" },
    ],
    money: [{ text: "Texts balance 1,240 credits", meta: "about 11 days at this rate" }],
    clients: [
      { text: "Kamau Plumbing reached 80% of texts (163 of 200)", meta: "beta", tenantId: "00000000-0000-4000-8000-000000000001" },
      { text: "Kamau Plumbing turned extra usage on", meta: "by Wanjiru, 10:12" },
      { text: "4 businesses waiting for a number", tone: "attention" },
    ],
    checks: [{ text: "Text counters match the send log", tone: "ok" }],
  }),
] as const;
