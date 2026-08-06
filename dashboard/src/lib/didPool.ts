import { getSupabaseAdmin } from "@/lib/supabase";

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
