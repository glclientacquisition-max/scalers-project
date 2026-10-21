/** Senders and links. Both sending domains are verified in Resend (18 Oct 2026). */
export const SENDERS = {
  owner: {
    from: "Scalers <hello@alerts.scalers.co.ke>",
    /** TBD: placeholder until the support inbox exists. Until then point it at Alvin's inbox. */
    replyTo: "support@scalers.co.ke",
  },
  ops: {
    from: "Scalers ops <platform@ops.scalers.co.ke>",
    replyTo: undefined as string | undefined,
  },
} as const;

export type Urls = {
  /** Owner Desk origin (DEFAULT_APP_HOST in dashboard/src/lib/adminHost.ts). */
  desk: string;
  /** Super Admin base including the /admin prefix. */
  admin: string;
  /** Where dashboard/public is served, for the logo mark. */
  assets: string;
  /** Support address shown in the footer (TBD placeholder). */
  support: string;
};

export const DEFAULT_URLS: Urls = {
  desk: "https://app.scalers.co.ke",
  admin: "https://admin.scalers.co.ke/admin",
  assets: "https://app.scalers.co.ke",
  support: "support@scalers.co.ke",
};

/** Real Desk routes (dashboard/src/app). Keep in step when routes move. */
export const deskRoutes = {
  home: "/home", // line status + "Test line"
  usage: "/wallet", // Usage page: plan, allowances, extra usage switch
  calls: "/calls",
  setup: "/onboarding",
  lineSetup: "/onboarding/line", // number + call setup choices (Desk brief 2026-10-18)
  alerts: "/settings?tab=alerts",
  team: "/settings?tab=team",
  answers: "/settings?tab=train&panel=identity",
} as const;

export const adminRoutes = {
  client: (tenantId: string) => `/billing/${encodeURIComponent(tenantId)}`,
  platform: "/platform",
} as const;
