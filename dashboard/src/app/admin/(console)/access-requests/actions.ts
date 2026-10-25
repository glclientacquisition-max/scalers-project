"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { getAdminSession, isLegacyAuthenticated } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isAdminV2Enabled } from "@/lib/adminV2";
import { sendAccessRequestDeclineEmail } from "@/lib/accessRequestDeclineEmail";
import {
  isAccessRequestsSchemaV2Error,
  normalizeAccessRequestEmail,
} from "@/lib/accessRequestLogic";
import { sendOwnerEmail, isOwnerEmailConfigured } from "@/lib/ownerEmail";

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

async function siteRedirectUrl(): Promise<string> {
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (await headers()).get("origin") ||
    "https://scalers.co.ke";
  return `${siteUrl.replace(/\/$/, "")}/onboarding`;
}

async function sendInviteEmail(
  admin: ReturnType<typeof getSupabaseAdmin>,
  email: string,
  row: { business: string; phone: string; name: string },
  redirectTo: string
): Promise<{ ok: true; userId: string | null } | { error: string }> {
  const { data: inviteData, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: {
      business_name: row.business,
      whatsapp_notification_number: row.phone,
      access_request_name: row.name,
    },
  });

  if (!inviteErr) {
    return { ok: true, userId: inviteData.user?.id ?? null };
  }

  const msg = inviteErr.message || "";
  if (!/already|exists|registered/i.test(msg)) {
    console.error("[access-requests] invite failed:", msg);
    return { error: "Could not send invite. Check Auth settings." };
  }

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "invite",
    email,
    options: { redirectTo },
  });

  if (linkErr || !linkData?.properties?.action_link) {
    console.error("[access-requests] generateLink failed:", linkErr?.message || "no link");
    return { error: "Could not send another invite to this address." };
  }

  if (isOwnerEmailConfigured()) {
    await sendOwnerEmail({
      to: email,
      subject: "Your Scalers Desk invite",
      text: [
        `Hi ${row.name || "there"},`,
        "",
        "Here is a fresh link to set up your Scalers Desk account:",
        linkData.properties.action_link,
        "",
        "Scalers",
      ].join("\n"),
    });
  }

  const userId = linkData.user?.id ?? null;
  return { ok: true, userId };
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
  const redirectTo = await siteRedirectUrl();
  const invite = await sendInviteEmail(admin, email, row, redirectTo);
  if ("error" in invite) return { error: invite.error };

  const { error: updateErr } = await admin
    .from("access_requests")
    .update({
      status: "approved",
      decided_at: new Date().toISOString(),
      decided_by: gate.operator,
      invited_user_id: invite.userId,
    })
    .eq("id", id)
    .eq("status", "pending");

  if (updateErr) {
    console.error("[access-requests] approve update failed:", updateErr.message);
    return { error: "Invite sent but request status failed to update." };
  }

  revalidatePath("/admin/access-requests");
  revalidatePath("/admin", "layout");
  return { ok: true };
}

export type DeclineAccessRequestInput = {
  reason?: string;
  sendEmail?: boolean;
};

export async function declineAccessRequestAction(
  requestId: string,
  input?: DeclineAccessRequestInput
): Promise<AccessRequestActionState> {
  const gate = await assertAdmin();
  if ("error" in gate) return { error: gate.error };

  const id = String(requestId || "").trim();
  if (!id) return { error: "Missing request." };

  const reason = String(input?.reason || "").trim().slice(0, 500);
  const sendEmail = Boolean(input?.sendEmail);

  const admin = getSupabaseAdmin();
  const { data: row, error: fetchErr } = await admin
    .from("access_requests")
    .select("id, status, email, name, business")
    .eq("id", id)
    .maybeSingle();

  if (fetchErr || !row) return { error: "Request not found." };
  if (row.status !== "pending") return { error: "Request is already decided." };

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status: "declined",
    decided_at: now,
    decided_by: gate.operator,
  };
  if (reason) patch.decline_reason = reason;

  let { error } = await admin.from("access_requests").update(patch).eq("id", id).eq("status", "pending");

  if (error && isAccessRequestsSchemaV2Error(error.message)) {
    const minimal = {
      status: "declined",
      decided_at: now,
      decided_by: gate.operator,
    };
    ({ error } = await admin.from("access_requests").update(minimal).eq("id", id).eq("status", "pending"));
  }

  if (error) {
    console.error("[access-requests] decline failed:", error.message);
    return { error: "Could not decline request." };
  }

  if (sendEmail) {
    const sent = await sendAccessRequestDeclineEmail(
      row.email,
      row.name,
      row.business,
      reason || null
    );
    if (sent) {
      const emailed = { decline_emailed_at: now };
      const { error: emailMarkErr } = await admin.from("access_requests").update(emailed).eq("id", id);
      if (emailMarkErr && !isAccessRequestsSchemaV2Error(emailMarkErr.message)) {
        console.error("[access-requests] decline_emailed_at failed:", emailMarkErr.message);
      }
    }
  }

  revalidatePath("/admin/access-requests");
  revalidatePath("/admin", "layout");
  return { ok: true };
}

export async function saveAccessRequestNoteAction(
  requestId: string,
  note: string
): Promise<AccessRequestActionState> {
  const gate = await assertAdmin();
  if ("error" in gate) return { error: gate.error };

  const id = String(requestId || "").trim();
  if (!id) return { error: "Missing request." };

  const trimmed = String(note || "").trim();
  const admin = getSupabaseAdmin();
  const now = new Date().toISOString();

  const { error } = await admin
    .from("access_requests")
    .update({
      note: trimmed || null,
      note_updated_at: now,
      note_updated_by: gate.operator,
    })
    .eq("id", id);

  if (error) {
    if (isAccessRequestsSchemaV2Error(error.message)) {
      return { error: "Notes need the access_requests_v2 SQL migration." };
    }
    console.error("[access-requests] note save failed:", error.message);
    return { error: "Could not save note." };
  }

  revalidatePath("/admin/access-requests");
  return { ok: true };
}

export async function resendAccessRequestInviteAction(
  requestId: string
): Promise<AccessRequestActionState> {
  const gate = await assertAdmin();
  if ("error" in gate) return { error: gate.error };

  const id = String(requestId || "").trim();
  if (!id) return { error: "Missing request." };

  const admin = getSupabaseAdmin();
  const { data: row, error: fetchErr } = await admin
    .from("access_requests")
    .select("id, status, email, name, business, phone, invited_user_id")
    .eq("id", id)
    .maybeSingle();

  if (fetchErr || !row) return { error: "Request not found." };
  if (row.status !== "approved") return { error: "Only approved requests can be resent." };

  const email = String(row.email || "").trim().toLowerCase();
  const redirectTo = await siteRedirectUrl();
  const invite = await sendInviteEmail(admin, email, row, redirectTo);
  if ("error" in invite) return { error: invite.error };

  const patch: Record<string, unknown> = { invite_resent_at: new Date().toISOString() };
  if (invite.userId && !row.invited_user_id) {
    patch.invited_user_id = invite.userId;
  }

  const { error: updateErr } = await admin.from("access_requests").update(patch).eq("id", id);
  if (updateErr && !isAccessRequestsSchemaV2Error(updateErr.message)) {
    console.error("[access-requests] invite_resent_at failed:", updateErr.message);
  }

  revalidatePath("/admin/access-requests");
  return { ok: true };
}

export async function reopenAccessRequestAction(
  requestId: string
): Promise<AccessRequestActionState> {
  const gate = await assertAdmin();
  if ("error" in gate) return { error: gate.error };

  const id = String(requestId || "").trim();
  if (!id) return { error: "Missing request." };

  const admin = getSupabaseAdmin();
  const { data: row, error: fetchErr } = await admin
    .from("access_requests")
    .select("id, status, email")
    .eq("id", id)
    .maybeSingle();

  if (fetchErr || !row) return { error: "Request not found." };
  if (row.status !== "declined") return { error: "Only declined requests can reopen." };

  const email = normalizeAccessRequestEmail(row.email);
  const { data: pendingRows } = await admin
    .from("access_requests")
    .select("id, email")
    .eq("status", "pending")
    .neq("id", id);

  const pendingDup = (pendingRows || []).find(
    (r) => normalizeAccessRequestEmail(r.email) === email
  );

  if (pendingDup) {
    return {
      error: "Another pending request already uses this email. Decline or approve it first.",
    };
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status: "pending",
    decided_at: null,
    decided_by: null,
    reopened_at: now,
    decline_reason: null,
    decline_emailed_at: null,
  };

  let { error } = await admin.from("access_requests").update(patch).eq("id", id).eq("status", "declined");

  if (error && isAccessRequestsSchemaV2Error(error.message)) {
    ({ error } = await admin
      .from("access_requests")
      .update({ status: "pending", decided_at: null, decided_by: null })
      .eq("id", id)
      .eq("status", "declined"));
  }

  if (error) {
    if (error.code === "23505" || /unique|duplicate/i.test(error.message || "")) {
      return {
        error: "Another pending request already uses this email. Decline or approve it first.",
      };
    }
    console.error("[access-requests] reopen failed:", error.message);
    return { error: "Could not reopen request." };
  }

  revalidatePath("/admin/access-requests");
  revalidatePath("/admin", "layout");
  return { ok: true };
}
