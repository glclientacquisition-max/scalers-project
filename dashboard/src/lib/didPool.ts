import { getSupabaseAdmin } from "@/lib/supabase";
import { claimSautikitNumber, listSautikitNumbers } from "@/lib/sautikit";

export type DidPoolRow = {
  id: string;
  created_at: string;
  e164: string;
  sautikit_number_id: string | null;
  status: string;
  tenant_id: string | null;
  assigned_at: string | null;
  notes: string | null;
  tenants?: { business_name: string } | null;
};

export type PendingTenant = {
  id: string;
  business_name: string;
  sautikit_virtual_number: string;
  created_at: string;
};

export function normalizeE164(raw: string): string | null {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("254") && digits.length >= 12) return `+${digits}`;
  if (digits.startsWith("0") && digits.length >= 10) return `+254${digits.slice(1)}`;
  if (digits.length >= 9) return `+254${digits}`;
  return null;
}

export async function listDidPool(): Promise<DidPoolRow[]> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("sautikit_did_pool")
    .select(
      "id, created_at, e164, sautikit_number_id, status, tenant_id, assigned_at, notes, tenants(business_name)"
    )
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []) as unknown as DidPoolRow[];
}

export async function listPendingTenants(): Promise<PendingTenant[]> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("tenants")
    .select("id, business_name, sautikit_virtual_number, created_at")
    .like("sautikit_virtual_number", "pending:%")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []) as PendingTenant[];
}

export type SyncResult = {
  added: string[];
  linked: string[];
  skipped: string[];
};

/**
 * Pull the numbers this SautiKit account owns into the DID pool.
 * New voice-capable numbers become 'available'; existing rows get their
 * sautikit_number_id backfilled. Never touches assignment state.
 */
export async function syncPoolFromSautikit(): Promise<SyncResult> {
  const admin = getSupabaseAdmin();
  const [numbers, pool] = await Promise.all([listSautikitNumbers(), listDidPool()]);
  const byE164 = new Map(pool.map((row) => [row.e164, row]));

  const result: SyncResult = { added: [], linked: [], skipped: [] };

  for (const num of numbers) {
    if (num.status !== "active" || !num.capabilities?.includes("voice")) {
      result.skipped.push(num.e164);
      continue;
    }

    const existing = byE164.get(num.e164);
    if (existing) {
      if (!existing.sautikit_number_id) {
        const { error } = await admin
          .from("sautikit_did_pool")
          .update({ sautikit_number_id: num.id })
          .eq("id", existing.id);
        if (error) throw error;
        result.linked.push(num.e164);
      } else {
        result.skipped.push(num.e164);
      }
      continue;
    }

    const { error } = await admin.from("sautikit_did_pool").insert({
      e164: num.e164,
      sautikit_number_id: num.id,
      status: "available",
      notes: "Synced from SautiKit",
    });
    if (error) throw error;
    result.added.push(num.e164);
  }

  return result;
}

/**
 * Claim a SautiKit inventory number, point webhooks at Railway, insert into pool.
 */
export async function buyNumberIntoPool(inventoryId: string): Promise<DidPoolRow> {
  if (!inventoryId) throw new Error("inventory_id required");

  const claimed = await claimSautikitNumber(inventoryId);
  const e164 = claimed.e164;
  if (!e164) throw new Error("Claimed number has no E.164");

  const admin = getSupabaseAdmin();
  const { data: existing } = await admin
    .from("sautikit_did_pool")
    .select(
      "id, created_at, e164, sautikit_number_id, status, tenant_id, assigned_at, notes"
    )
    .eq("e164", e164)
    .maybeSingle();

  if (existing) {
    const { data, error } = await admin
      .from("sautikit_did_pool")
      .update({
        sautikit_number_id: claimed.id,
        notes: existing.notes || "Bought from SautiKit",
      })
      .eq("id", existing.id)
      .select(
        "id, created_at, e164, sautikit_number_id, status, tenant_id, assigned_at, notes"
      )
      .single();
    if (error) throw error;
    return data as DidPoolRow;
  }

  const { data, error } = await admin
    .from("sautikit_did_pool")
    .insert({
      e164,
      sautikit_number_id: claimed.id,
      status: "available",
      notes: "Bought from SautiKit",
    })
    .select(
      "id, created_at, e164, sautikit_number_id, status, tenant_id, assigned_at, notes"
    )
    .single();
  if (error) throw error;
  return data as DidPoolRow;
}

export async function addDidToPool(opts: {
  e164: string;
  notes?: string;
}): Promise<DidPoolRow> {
  const e164 = normalizeE164(opts.e164);
  if (!e164) throw new Error("Invalid Kenyan E.164 number");

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("sautikit_did_pool")
    .insert({
      e164,
      status: "available",
      notes: opts.notes?.trim() || null,
    })
    .select(
      "id, created_at, e164, sautikit_number_id, status, tenant_id, assigned_at, notes"
    )
    .single();
  if (error) throw error;
  return data as DidPoolRow;
}
