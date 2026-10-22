/**
 * ⌘K command search (ADMIN_V2): pure hit shaping, grouping and query parsing. No I/O.
 * Results: businesses, numbers, invoices, calls. Archived businesses stay findable, labelled.
 */

export type CommandKind = "business" | "number" | "invoice" | "call";

export type CommandHit = {
  key: string;
  kind: CommandKind;
  title: string;
  preview: string;
  href: string;
  /** Business is archived (or the hit belongs to an archived business). */
  archived?: boolean;
};

export const COMMAND_GROUPS: { kind: CommandKind; label: string }[] = [
  { kind: "business", label: "Businesses" },
  { kind: "number", label: "Numbers" },
  { kind: "invoice", label: "Invoices" },
  { kind: "call", label: "Calls" },
];

export const PER_GROUP = 5;

export function normalizeCommandQuery(raw: string): string {
  return String(raw || "").trim().replace(/\s+/g, " ").slice(0, 80);
}

export function commandQueryReady(q: string): boolean {
  return normalizeCommandQuery(q).length >= 2;
}

/** Digits to match against E.164 numbers. "0712 345" → "712345"; "+254 712" → "254712". Null if under 3 digits. */
export function numberFragment(q: string): string | null {
  const digits = String(q || "").replace(/\D/g, "");
  const frag = digits.startsWith("0") ? digits.slice(1) : digits;
  return frag.length >= 3 ? frag : null;
}

const UUID_HEX = 32;
const CALL_ID_MIN_HEX = 4;

function asUuid(hex: string): string {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Call ids are uuid, and Postgres has no ILIKE on uuid. A hex prefix becomes an inclusive
 * uuid range instead ("8f2c" → 8f2c0000-… to 8f2cffff-…). Null if the query is not a hex prefix of 4+.
 */
export function callIdRange(q: string): { lo: string; hi: string } | null {
  const raw = String(q || "").trim().toLowerCase();
  if (!/^[0-9a-f-]+$/.test(raw)) return null;
  const hex = raw.replace(/-/g, "");
  if (hex.length < CALL_ID_MIN_HEX || hex.length > UUID_HEX) return null;
  return { lo: asUuid(hex.padEnd(UUID_HEX, "0")), hi: asUuid(hex.padEnd(UUID_HEX, "f")) };
}

export function escapeIlike(raw: string): string {
  return raw.replace(/[%_\\]/g, "\\$&");
}

export function isArchived(t: { is_active?: boolean | null; archived_at?: string | null } | null | undefined): boolean {
  if (!t) return false;
  return t.is_active === false || Boolean(t.archived_at);
}

export function businessHit(row: { id: string; business_name: string; number?: string | null; archived: boolean }): CommandHit {
  const line = String(row.number || "").trim();
  return {
    key: `business-${row.id}`,
    kind: "business",
    title: row.business_name || "Business",
    preview: line && !line.startsWith("pending:") ? line : "No number yet",
    href: `/admin/businesses/${row.id}`,
    archived: row.archived,
  };
}

const NUMBER_STATUS: Record<string, string> = {
  available: "In the pool",
  assigned: "Assigned",
  reserved: "Reserved",
  released: "Released",
};

export function numberHit(row: {
  id: string;
  e164: string;
  status?: string | null;
  tenant_id?: string | null;
  business_name?: string | null;
  archived?: boolean;
}): CommandHit {
  const raw = String(row.status || "").trim();
  const status = NUMBER_STATUS[raw] || (raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : "Number");
  const owner = String(row.business_name || "").trim();
  return {
    key: `number-${row.id}`,
    kind: "number",
    title: row.e164,
    preview: owner ? `${status} · ${owner}` : status,
    href: row.tenant_id ? `/admin/businesses/${row.tenant_id}` : "/admin/numbers",
    archived: Boolean(row.archived),
  };
}

export function invoiceHit(row: {
  id: string;
  invoice_number?: string | null;
  status?: string | null;
  tenant_id: string;
  business_name?: string | null;
  archived?: boolean;
}): CommandHit {
  const num = String(row.invoice_number || "").trim() || "Draft";
  const status = String(row.status || "").trim();
  const label = status ? status.charAt(0).toUpperCase() + status.slice(1) : "Invoice";
  const owner = String(row.business_name || "").trim();
  return {
    key: `invoice-${row.id}`,
    kind: "invoice",
    title: num,
    preview: owner ? `${label} · ${owner}` : label,
    href: `/admin/billing/invoices?business=${encodeURIComponent(row.tenant_id)}&view=all&pane=${encodeURIComponent(row.id)}`,
    archived: Boolean(row.archived),
  };
}

export function callHit(row: { id: string; business_name?: string | null; archived?: boolean }): CommandHit {
  return {
    key: `call-${row.id}`,
    kind: "call",
    title: row.id,
    preview: String(row.business_name || "").trim() || "Call",
    href: `/admin/quality/call/${encodeURIComponent(row.id)}`,
    archived: Boolean(row.archived),
  };
}

/** Group in fixed order, drop duplicates, cap each group, live before archived. */
export function groupCommandHits(hits: CommandHit[], perGroup = PER_GROUP): { kind: CommandKind; label: string; hits: CommandHit[] }[] {
  const seen = new Set<string>();
  const uniq = hits.filter((h) => (seen.has(h.key) ? false : (seen.add(h.key), true)));
  return COMMAND_GROUPS.map((g) => ({
    ...g,
    hits: uniq
      .filter((h) => h.kind === g.kind)
      .toSorted((a, b) => Number(Boolean(a.archived)) - Number(Boolean(b.archived)))
      .slice(0, perGroup),
  })).filter((g) => g.hits.length > 0);
}

/** Flat order the keyboard walks. */
export function flatCommandHits(groups: { hits: CommandHit[] }[]): CommandHit[] {
  return groups.flatMap((g) => g.hits);
}

/** Loose client-side filter for the dev fixture (titles and previews). The server matches by field. */
export function matchCommandHit(h: CommandHit, raw: string): boolean {
  const q = normalizeCommandQuery(raw).toLowerCase();
  if (!q) return false;
  if (h.title.toLowerCase().includes(q) || h.preview.toLowerCase().includes(q)) return true;
  const frag = numberFragment(q);
  return Boolean(frag && h.title.replace(/\D/g, "").includes(frag));
}

/** ⌘K on Mac, Ctrl+K elsewhere. "/" only when focus is not in a field. */
export function isPaletteShortcut(e: { key: string; metaKey?: boolean; ctrlKey?: boolean; targetIsField?: boolean }): boolean {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") return true;
  return e.key === "/" && !e.targetIsField;
}
