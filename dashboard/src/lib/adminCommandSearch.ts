import "server-only";

import {
  businessHit,
  callHit,
  callIdRange,
  commandQueryReady,
  escapeIlike,
  invoiceHit,
  isArchived,
  normalizeCommandQuery,
  numberFragment,
  numberHit,
  PER_GROUP,
  type CommandHit,
} from "@/lib/ops/searchView";
import { logAdminError } from "@/lib/adminErrors";
import { getSupabaseAdmin } from "@/lib/supabase";

type Tenant = { id: string; business_name: string | null; sautikit_virtual_number: string | null; is_active: boolean | null; archived_at: string | null };
const TENANT_COLS = "id, business_name, sautikit_virtual_number, is_active, archived_at";

type QRes<T> = { data: T[] | null; error: unknown | null };

/** Use rows when the read worked; log and return [] when one source fails so others still show. */
function rowsOrEmpty<T>(scope: string, r: QRes<T>): T[] {
  if (r.error) {
    logAdminError(`search:${scope}`, r.error);
    return [];
  }
  return r.data || [];
}

/**
 * ⌘K search (ADMIN_V2). Read-only. Businesses by name or number, pool numbers, invoices by number, calls by id.
 * Archived businesses are included and labelled. Caller must gate with isLegacyAuthenticated.
 * One broken source (e.g. a missing column) must not turn a name search into a blanket "failed".
 */
export async function adminCommandSearch(raw: string): Promise<CommandHit[]> {
  const q = normalizeCommandQuery(raw);
  if (!commandQueryReady(q)) return [];
  const admin = getSupabaseAdmin();
  const like = `%${escapeIlike(q)}%`;
  const frag = numberFragment(q);
  const cap = PER_GROUP + 2;
  const callRange = callIdRange(q);

  const [byName, byLine, pool, invoices, calls] = await Promise.all([
    admin.from("tenants").select(TENANT_COLS).ilike("business_name", like).order("business_name").limit(cap),
    frag
      ? admin.from("tenants").select(TENANT_COLS).ilike("sautikit_virtual_number", `%${frag}%`).limit(cap)
      : Promise.resolve({ data: [] as Tenant[], error: null }),
    frag
      ? admin.from("sautikit_did_pool").select("id, e164, status, tenant_id").ilike("e164", `%${frag}%`).limit(cap)
      : Promise.resolve({ data: [] as { id: string; e164: string; status: string | null; tenant_id: string | null }[], error: null }),
    admin.from("invoices").select("id, invoice_number, status, tenant_id").ilike("invoice_number", like).order("created_at", { ascending: false }).limit(cap),
    callRange
      ? admin.from("calls").select("id, tenant_id").gte("id", callRange.lo).lte("id", callRange.hi).order("created_at", { ascending: false }).limit(cap)
      : Promise.resolve({ data: [] as { id: string; tenant_id: string }[], error: null }),
  ]);

  // Only hard-fail when every source that actually ran failed — otherwise return what we have.
  const ran: { scope: string; error: unknown | null }[] = [
    { scope: "tenants.name", error: byName.error },
    ...(frag ? [{ scope: "tenants.line", error: byLine.error }] : []),
    ...(frag ? [{ scope: "pool", error: pool.error }] : []),
    { scope: "invoices", error: invoices.error },
    ...(callRange ? [{ scope: "calls", error: calls.error }] : []),
  ];
  if (ran.length > 0 && ran.every((r) => r.error)) {
    throw ran[0]!.error;
  }

  const nameRows = rowsOrEmpty<Tenant>("tenants.name", byName);
  const lineRows = rowsOrEmpty<Tenant>("tenants.line", byLine);
  const poolRows = rowsOrEmpty<{ id: string; e164: string; status: string | null; tenant_id: string | null }>("pool", pool);
  const invRows = rowsOrEmpty<{ id: string; invoice_number: string | null; status: string | null; tenant_id: string }>("invoices", invoices);
  const callRows = rowsOrEmpty<{ id: string; tenant_id: string }>("calls", calls);

  const tenants = new Map<string, Tenant>();
  for (const t of [...nameRows, ...lineRows]) tenants.set(String(t.id), t);

  const missing = [...new Set([...poolRows.map((r) => r.tenant_id), ...invRows.map((r) => r.tenant_id), ...callRows.map((r) => r.tenant_id)])]
    .filter((id): id is string => Boolean(id) && !tenants.has(String(id)));
  if (missing.length) {
    const extra = await admin.from("tenants").select(TENANT_COLS).in("id", missing);
    for (const t of rowsOrEmpty<Tenant>("tenants.owners", extra)) tenants.set(String(t.id), t);
  }
  const owner = (id: string | null) => (id ? tenants.get(String(id)) : undefined);

  return [
    ...[...nameRows, ...lineRows].map((t) =>
      businessHit({ id: String(t.id), business_name: String(t.business_name || ""), number: t.sautikit_virtual_number, archived: isArchived(t) }),
    ),
    ...poolRows.map((r) => numberHit({ ...r, id: String(r.id), business_name: owner(r.tenant_id)?.business_name, archived: isArchived(owner(r.tenant_id)) })),
    ...invRows.map((r) => invoiceHit({ ...r, id: String(r.id), business_name: owner(r.tenant_id)?.business_name, archived: isArchived(owner(r.tenant_id)) })),
    ...callRows.map((r) => callHit({ id: String(r.id), business_name: owner(r.tenant_id)?.business_name, archived: isArchived(owner(r.tenant_id)) })),
  ];
}
