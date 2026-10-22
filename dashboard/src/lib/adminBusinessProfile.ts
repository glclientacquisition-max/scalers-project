import { recordAdminAction } from "@/lib/adminAudit";
import { adminErrorParts } from "@/lib/adminErrors";
import { normalizeE164 } from "@/lib/didPool";
import { getSupabaseAdmin } from "@/lib/supabase";
import { bustTenantCache } from "@/lib/tenantCache";
import type { Role } from "@/lib/permissions";

function cleanName(raw: unknown): string {
  return String(raw || "").trim().slice(0, 120);
}

function cleanNotify(raw: unknown): string {
  const value = String(raw || "").trim();
  if (!value) return "";
  return normalizeE164(value) || value;
}

async function loadTenantRow(businessId: string) {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("tenants")
    .select("id, business_name, whatsapp_notification_number")
    .eq("id", businessId)
    .maybeSingle();
  if (error) throw error;
  return data as {
    id: string;
    business_name: string;
    whatsapp_notification_number: string;
  } | null;
}

export async function updateBusinessProfile(
  businessId: string,
  actor: string,
  input: { business_name?: unknown; whatsapp_notification_number?: unknown },
) {
  const row = await loadTenantRow(businessId);
  if (!row) throw new Error("Business not found.");

  const business_name = input.business_name !== undefined ? cleanName(input.business_name) : row.business_name;
  const whatsapp_notification_number =
    input.whatsapp_notification_number !== undefined
      ? cleanNotify(input.whatsapp_notification_number)
      : row.whatsapp_notification_number;

  if (!business_name) throw new Error("Business name is required.");

  const before = {
    business_name: row.business_name,
    whatsapp_notification_number: row.whatsapp_notification_number,
  };
  const after = { business_name, whatsapp_notification_number };

  const { error } = await getSupabaseAdmin()
    .from("tenants")
    .update({ business_name, whatsapp_notification_number })
    .eq("id", businessId);
  if (error) throw error;

  bustTenantCache(businessId);
  await recordAdminAction({
    actor,
    action: "update_business_profile",
    businessId,
    before,
    after,
  });
  return after;
}

export async function sendOwnerPasswordReset(businessId: string, actor: string, redirectTo: string) {
  const admin = getSupabaseAdmin();
  const { data: ownerRow, error: ownerErr } = await admin
    .from("tenant_members")
    .select("user_id")
    .eq("tenant_id", businessId)
    .eq("role", "owner")
    .maybeSingle();
  if (ownerErr) throw ownerErr;
  if (!ownerRow?.user_id) throw new Error("This business has no owner yet.");

  const { data: userData, error: userErr } = await admin.auth.admin.getUserById(String(ownerRow.user_id));
  if (userErr) throw userErr;
  const email = userData.user?.email?.trim();
  if (!email) throw new Error("Owner has no email on file.");

  const { error } = await admin.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;

  await recordAdminAction({
    actor,
    action: "send_owner_password_reset",
    businessId,
    before: { email: null },
    after: { email },
  });
  return { email };
}

const TRANSFER_ROLES: Role[] = ["admin"];

export async function adminTransferOwnership(businessId: string, actor: string, newOwnerUserId: string) {
  const target = String(newOwnerUserId || "").trim();
  if (!target) throw new Error("Pick who should become the owner.");

  const admin = getSupabaseAdmin();
  const { data: members, error: listErr } = await admin
    .from("tenant_members")
    .select("user_id, role")
    .eq("tenant_id", businessId);
  if (listErr) throw listErr;

  const rows = (members || []) as Array<{ user_id: string; role: string }>;
  const currentOwner = rows.find((row) => row.role === "owner");
  const targetRow = rows.find((row) => String(row.user_id) === target);
  if (!targetRow) throw new Error("That person is not on this business.");
  if (targetRow.role === "owner") throw new Error("They are already the owner.");
  if (!TRANSFER_ROLES.includes(targetRow.role as Role)) {
    throw new Error("Only an Admin can become the owner.");
  }

  const before = {
    owner_user_id: currentOwner?.user_id || null,
    new_owner: null,
  };

  if (currentOwner) {
    const { error: demoteErr } = await admin
      .from("tenant_members")
      .update({ role: "admin" })
      .eq("tenant_id", businessId)
      .eq("user_id", currentOwner.user_id);
    if (demoteErr) throw demoteErr;
  }

  const { error: promoteErr } = await admin
    .from("tenant_members")
    .update({ role: "owner" })
    .eq("tenant_id", businessId)
    .eq("user_id", target);
  if (promoteErr) throw promoteErr;

  const { error: tenantErr } = await admin.from("tenants").update({ owner_user_id: target }).eq("id", businessId);
  if (tenantErr) throw tenantErr;

  bustTenantCache(businessId);
  await recordAdminAction({
    actor,
    action: "transfer_ownership",
    businessId,
    before,
    after: { owner_user_id: target, previous_owner: currentOwner?.user_id || null },
  });
}

export function isMissingMemberTable(err: unknown): boolean {
  const { message, code } = adminErrorParts(err);
  return code === "42P01" || /tenant_members|tenant_member_directory/i.test(message);
}
