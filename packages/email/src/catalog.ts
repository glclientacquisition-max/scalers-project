import * as owner from "./templates/owner.ts";
import * as ops from "./templates/ops.ts";
import type { EmailSpec } from "./spec.ts";
import type { Urls } from "./config.ts";

type Ctx = { urls: Urls };

/** Follow-up rule. The scheduler (not built yet) enforces these; they live here so code and plan agree. */
export type FollowUp = {
  /** Event whose send starts the clock. */
  after: string;
  /** Delay(s) from the first send. Length = cap (never more than 2). */
  delays: string[];
  /** Stop as soon as any of these is true. */
  stopWhen: string;
};

export const catalog = {
  welcome: { render: owner.welcome, audience: "owner" },
  line_live: { render: owner.lineLive, audience: "owner" },
  package_changed: { render: owner.packageChanged, audience: "owner" },
  usage_80: { render: owner.usage80, audience: "owner" },
  usage_100: { render: owner.usage100, audience: "owner" },
  usage_100_reminder: { render: owner.usage100Reminder, audience: "owner" },
  extra_usage: { render: owner.extraUsage, audience: "owner" },
  monthly_summary: { render: owner.monthlySummary, audience: "owner" },
  line_paused: { render: owner.linePaused, audience: "owner" },
  line_still_paused: { render: owner.lineStillPaused, audience: "owner" },
  line_restored: { render: owner.lineRestored, audience: "owner" },
  setup_nudge: { render: owner.setupNudge, audience: "owner" },
  invite_reminder: { render: owner.inviteReminder, audience: "owner" },
  ops_incident: { render: ops.opsIncident, audience: "ops" },
  ops_incident_reminder: { render: ops.opsIncidentReminder, audience: "ops" },
  ops_digest: { render: ops.opsDigest, audience: "ops" },
  ops_wallet: { render: ops.opsWallet, audience: "ops" },
} as const satisfies Record<string, { render: (p: never, ctx: Ctx) => EmailSpec; audience: "owner" | "ops" }>;

export type EmailKind = keyof typeof catalog;
export type EmailProps<K extends EmailKind> = Parameters<(typeof catalog)[K]["render"]>[0];

export const followUps: Partial<Record<EmailKind, FollowUp>> = {
  usage_100_reminder: {
    after: "usage_100",
    delays: ["48h"],
    stopWhen: "period rolls over, plan upgraded, extra usage turned on, or grant lifts usage below 100%",
  },
  setup_nudge: {
    after: "signup confirmed (setup not finished)",
    delays: ["48h", "120h"],
    stopWhen: "setup_completed_at is set, tenant archived, or owner unsubscribes",
  },
  invite_reminder: {
    after: "team_invite (existing Desk invite email)",
    delays: ["48h", "120h"],
    stopWhen: "invite accepted, revoked or expired, or a newer invite to the same email exists",
  },
  line_still_paused: {
    after: "line_paused",
    delays: ["72h", "168h"],
    stopWhen: "suspended_at cleared (line restored) or tenant archived",
  },
  ops_incident_reminder: {
    after: "ops_incident",
    delays: ["4h"],
    stopWhen: "incident recovered or acknowledged in Admin; after the one re-alert it moves to the daily digest",
  },
};
