/**
 * Super Admin global search: pure query shaping and hit rows. No I/O.
 */

export type AdminSearchHit = {
  key: string;
  kind: "business" | "call";
  title: string;
  preview: string;
  href: string;
};

export function normalizeSearchQuery(raw: string): string {
  return String(raw || "")
    .trim()
    .slice(0, 80);
}

export function searchQueryReady(query: string): boolean {
  return query.length >= 2;
}

/** Escape `%`, `_`, and `\` for PostgREST ilike filters. */
export function escapeIlikeFragment(raw: string): string {
  return raw.replace(/[%_\\]/g, "\\$&");
}

export function businessSearchHit(row: {
  id: string;
  business_name: string;
  sautikit_virtual_number: string;
}): AdminSearchHit {
  const line = String(row.sautikit_virtual_number || "").trim();
  const preview = line && !line.startsWith("pending:") ? line : "No number yet";
  return {
    key: `biz-${row.id}`,
    kind: "business",
    title: row.business_name,
    preview,
    href: `/admin/businesses/${row.id}`,
  };
}

export function callSearchHit(row: { id: string; business_name?: string | null }): AdminSearchHit {
  const name = String(row.business_name || "").trim();
  return {
    key: `call-${row.id}`,
    kind: "call",
    title: row.id,
    preview: name || "Call",
    href: `/admin/quality/call/${encodeURIComponent(row.id)}`,
  };
}

export function mergeSearchHits(businesses: AdminSearchHit[], calls: AdminSearchHit[], limit: number): AdminSearchHit[] {
  const seen = new Set<string>();
  const out: AdminSearchHit[] = [];
  for (const hit of [...businesses, ...calls]) {
    if (seen.has(hit.key)) continue;
    seen.add(hit.key);
    out.push(hit);
    if (out.length >= limit) break;
  }
  return out;
}
