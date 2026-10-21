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
