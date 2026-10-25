import { withEnv } from "../env.ts";
import { adminRoutes, type Urls } from "../config.ts";
import type { Block, EmailSpec } from "../spec.ts";
import type { Tone } from "../tokens.ts";

export type Ctx = { urls: Urls };
const admin = (ctx: Ctx, path: string) => `${ctx.urls.admin}${path}`;
const REASON = "Scalers platform alert. Sent to platform ops only.";

export type OpsTenant = { id: string; name: string };

/* 14. Incident alert (open / recovered) -------------------------------- */
export type OpsIncidentProps = {
  state: "open" | "recovered";
  /** Short title, e.g. "Speech down" or "Texts balance low". */
  title: string;
  /** One line of fact. */
  fact: string;
  /** One line of action. Omit on recovery. */
  action?: string;
  startedAt: string;
  /** Display duration for recovered incidents, e.g. "42 min". */
  lasted?: string;
  affected?: string;
  tenant?: OpsTenant;
};
export function opsIncident(p: OpsIncidentProps, ctx: Ctx): EmailSpec {
  const open = p.state === "open";
  // Status is in the pill; the table holds only facts the pill can't.
  const rows: { label: string; value: string; tone?: Tone }[] = [{ label: "Started", value: p.startedAt }];
  if (!open && p.lasted) rows.push({ label: "Lasted", value: p.lasted });
  if (p.tenant) rows.push({ label: "Client", value: p.tenant.name });
  if (p.affected) rows.push({ label: "Affected", value: p.affected });
  const blocks: Block[] = [{ t: "p", text: p.fact }, { t: "table", rows }];
  if (open && p.action) blocks.push({ t: "p", text: [{ strong: "Do: " }, p.action] });
  return {
    audience: "ops",
    essential: true,
    subject: `[Scalers ops] ${open ? "" : "Recovered: "}${p.title}${p.tenant ? ` (${p.tenant.name})` : ""}`,
    preheader: open ? p.action ?? p.fact : `${p.title} recovered${p.lasted ? ` after ${p.lasted}` : ""}.`,
    pill: open ? { tone: "attention", text: "Open" } : { tone: "ok", text: "Recovered" },
    heading: open ? p.title : `Recovered: ${p.title}`,
    blocks,
    cta: p.tenant ? { label: "Open client", href: admin(ctx, adminRoutes.client(p.tenant.id)) } : { label: "Open Platform", href: admin(ctx, adminRoutes.platform) },
    reason: REASON,
  };
}

/* 15. Follow-up: incident still open after 4h -------------------------- */
export type OpsIncidentReminderProps = Omit<OpsIncidentProps, "state" | "lasted"> & { openFor: string };
export function opsIncidentReminder(p: OpsIncidentReminderProps, ctx: Ctx): EmailSpec {
  const rows: { label: string; value: string; tone?: Tone }[] = [
    { label: "Open for", value: p.openFor, tone: "attention" },
    { label: "Started", value: p.startedAt },
  ];
  if (p.tenant) rows.push({ label: "Client", value: p.tenant.name });
  if (p.affected) rows.push({ label: "Affected", value: p.affected });
  return {
    audience: "ops",
    essential: true,
    subject: `[Scalers ops] Still open after ${p.openFor}: ${p.title}${p.tenant ? ` (${p.tenant.name})` : ""}`,
    preheader: p.action ?? p.fact,
    pill: { tone: "attention", text: `Open ${p.openFor}` },
    heading: `Still open: ${p.title}`,
    blocks: [
      { t: "p", text: p.fact },
      { t: "table", rows },
      ...(p.action ? [{ t: "p", text: [{ strong: "Do: " }, p.action] } as Block] : []),
      { t: "p", muted: true, text: "No more emails for this one. It stays in the 07:30 digest daily until it closes." },
    ],
    cta: p.tenant ? { label: "Open client", href: admin(ctx, adminRoutes.client(p.tenant.id)) } : { label: "Open Platform", href: admin(ctx, adminRoutes.platform) },
    reason: REASON,
  };
}

/* 16. Daily digest, 07:30 EAT ------------------------------------------ */
export type DigestItem = { text: string; meta?: string; tone?: Tone; /** Adds an "Open client" link to the Admin client page. */ tenantId?: string };
export type OpsDigestProps = {
  /** Display date, e.g. "Sun 18 Oct". */
  date: string;
  stillOpen: DigestItem[];
  money: DigestItem[];
  clients: DigestItem[];
  checks: DigestItem[];
  /** Totals for yesterday, shown as stat blocks. */
  yesterday?: { calls: number; texts: number; signups: number };
};
export function opsDigest(p: OpsDigestProps, ctx: Ctx): EmailSpec {
  const total = p.stillOpen.length + p.money.length + p.clients.length + p.checks.length;
  const blocks: Block[] = [];
  if (p.yesterday) {
    blocks.push({ t: "stats", items: [{ value: String(p.yesterday.calls), label: "calls yesterday" }, { value: String(p.yesterday.texts), label: "texts" }, { value: String(p.yesterday.signups), label: "signups" }] });
  }
  const section = (text: string, items: DigestItem[]) => {
    if (!items.length) return;
    blocks.push({ t: "h2", text, count: items.length }, {
        t: "list",
        items: items.map((i) => ({
          text: i.text,
          meta: i.meta,
          tone: i.tone,
          link: i.tenantId ? { label: "Open client", href: admin(ctx, adminRoutes.client(i.tenantId)) } : undefined,
        })),
      });
  };
  section("Still open", p.stillOpen);
  section("Money", p.money);
  section("Clients", p.clients);
  section("Checks", p.checks);
  return {
    audience: "ops",
    essential: true,
    subject: `[Scalers ops] Daily ${p.date}: ${total} ${total === 1 ? "item" : "items"}${p.stillOpen.length ? `, ${p.stillOpen.length} still open` : ""}`,
    preheader: [p.stillOpen[0]?.text, p.money[0]?.text, p.clients[0]?.text].filter(Boolean).join(". "),
    heading: `Daily digest, ${p.date}`,
    blocks,
    cta: { label: "Open Platform", href: admin(ctx, adminRoutes.platform) },
    reason: `${REASON} Sent at 07:30 EAT, skipped when there's nothing to report.`,
  };
}

/* 17. Phone wallet (SautiKit) low, empty, topped up --------------------- */
/** Where the SautiKit dashboard tops up the wallet (docs: Wallet, then Top Up). */
export const SAUTIKIT_TOPUP_URL = "https://app.sautikit.com/wallet";

export type OpsWalletProps = {
  /** Which SautiKit wallet this is about. Not where Desk runs: prod Desk also sends the staging alert. */
  env: "production" | "staging";
  state: "low" | "empty" | "topped_up";
  /** e.g. "Production (e0e57aa5)". */
  workspace: string;
  /** Display amounts, e.g. "KES 28.27". */
  balance: string;
  /** Low: the threshold crossed. Empty: "KES 0". Topped up: the re-arm line passed. */
  threshold: string;
  /** Display time in EAT, e.g. "21 Oct 2026, 18:49 EAT". */
  checkedAt: string;
  /** Low or empty: one line on what is at risk, e.g. "2 numbers renew on 1 Nov: KES 200 due." */
  risk?: string;
  /** Topped up: the next alert line, e.g. "KES 500". */
  nextAlert?: string;
};

export function opsWallet(p: OpsWalletProps, ctx: Ctx): EmailSpec {
  const note = p.env === "production" ? "live calls" : "test workspace only";
  return withEnv(opsWalletBody(p, ctx), p.env, note);
}

/** The untagged wallet mail; opsWallet adds the shared env tag (env.ts). */
function opsWalletBody(p: OpsWalletProps, ctx: Ctx): EmailSpec {
  const prod = p.env === "production";
  const name = prod ? "SautiKit wallet" : "SautiKit staging wallet";
  const rows: { label: string; value: string; tone?: Tone }[] = [
    { label: "Workspace", value: p.workspace },
    { label: "Balance", value: p.balance, tone: p.state === "topped_up" ? "ok" : "attention" },
    { label: p.state === "topped_up" ? "Re-armed above" : "Alert at", value: p.threshold },
    { label: "Checked", value: p.checkedAt },
  ];
  if (p.state === "topped_up") {
    return {
      audience: "ops",
      essential: true,
      subject: `${name} topped up: ${p.balance}`,
      preheader: `${name} is back at ${p.balance}. Alerts are armed again${p.nextAlert ? ` below ${p.nextAlert}` : ""}.`,
      pill: { tone: "ok", text: "Topped up" },
      heading: `${prod ? "Wallet" : "Staging wallet"} back at ${p.balance}`,
      blocks: [
        { t: "p", text: `Alerts are armed again${p.nextAlert ? `. Next one below ${p.nextAlert}` : ""}.` },
        { t: "table", rows },
      ],
      cta: { label: "Open Platform", href: admin(ctx, adminRoutes.platform) },
      reason: REASON,
    };
  }
  const empty = p.state === "empty";
  const stake = prod
    ? "At KES 0 incoming calls are rejected for every client."
    : "Staging calls stop at KES 0. Production is not affected.";
  const blocks: Block[] = [];
  if (p.risk) blocks.push({ t: "p", text: [{ strong: p.risk }] });
  blocks.push({ t: "p", text: empty ? (prod ? "Incoming calls are being rejected now." : "Staging calls are stopped now.") : stake });
  blocks.push({ t: "table", rows });
  return {
    audience: "ops",
    essential: true,
    subject: empty ? `${name} is empty: ${p.balance}` : `${name} ${p.balance}, below ${p.threshold}`,
    preheader: p.risk ? `${p.risk} ${empty ? "Calls are being rejected." : stake}` : stake,
    pill: { tone: "attention", text: empty ? "Empty" : "Low" },
    heading: `${prod ? "Wallet" : "Staging wallet"} at ${p.balance}`,
    blocks,
    cta: { label: "Top up in SautiKit", href: SAUTIKIT_TOPUP_URL },
    reason: REASON,
  };
}
