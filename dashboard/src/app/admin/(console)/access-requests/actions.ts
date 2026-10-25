"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { getAdminSession, isLegacyAuthenticated } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isAdminV2Enabled } from "@/lib/adminV2";

export type AccessRequestActionState = {
  error?: string;
  ok?: boolean;
};

async function assertAdmin(): Promise<{ operator: string } | { error: string }> {
  if (!isAdminV2Enabled()) {
    return { error: "Access requests admin is not enabled." };
  }
  if (!(await isLegacyAuthenticated())) {
    return { error: "Not signed in." };
  }
  const session = await getAdminSession();
  const operator = session?.user?.name || session?.user?.email || "ops";
  return { operator };
}

export async function approveAccessRequestAction(
  requestId: string
): Promise<AccessRequestActionState> {
  const gate = await assertAdmin();
  if ("error" in gate) return { error: gate.error };

  const id = String(requestId || "").trim();
  if (!id) return { error: "Missing request." };

  const admin = getSupabaseAdmin();
  const { data: row, error: fetchErr } = await admin
    .from("access_requests")
    .select("id, status, email, name, business, phone")
    .eq("id", id)
    .maybeSingle();

  if (fetchErr || !row) return { error: "Request not found." };
  if (row.status !== "pending") return { error: "Request is already decided." };

  const email = String(row.email || "").trim().toLowerCase();
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (await headers()).get("origin") ||
    "https://scalers.co.ke";

  const { data: inviteData, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${siteUrl.replace(/\/$/, "")}/onboarding`,
    data: {
      business_name: row.business,
      whatsapp_notification_number: row.phone,
      access_request_name: row.name,
    },
  });

  if (inviteErr) {
    console.error("[access-requests] invite failed:", inviteErr.message);
    return { error: "Could not send invite. Check Auth settings." };
  }

  const invitedUserId = inviteData.user?.id ?? null;

  const { error: updateErr } = await admin
    .from("access_requests")
    .update({
      status: "approved",
      decided_at: new Date().toISOString(),
      decided_by: gate.operator,
      invited_user_id: invitedUserId,
    })
    .eq("id", id)
    .eq("status", "pending");

  if (updateErr) {
    console.error("[access-requests] approve update failed:", updateErr.message);
    return { error: "Invite sent but request status failed to update." };
  }

  revalidatePath("/admin/access-requests");
  return { ok: true };
}

export async function declineAccessRequestAction(
  requestId: string
): Promise<AccessRequestActionState> {
  const gate = await assertAdmin();
  if ("error" in gate) return { error: gate.error };

  const id = String(requestId || "").trim();
  if (!id) return { error: "Missing request." };

  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from("access_requests")
    .update({
      status: "declined",
      decided_at: new Date().toISOString(),
      decided_by: gate.operator,
    })
    .eq("id", id)
    .eq("status", "pending");

  if (error) {
    console.error("[access-requests] decline failed:", error.message);
    return { error: "Could not decline request." };
  }

  revalidatePath("/admin/access-requests");
  return { ok: true };
}
