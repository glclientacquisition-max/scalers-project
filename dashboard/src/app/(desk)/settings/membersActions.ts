"use server";

import { memberDenied } from "@/lib/requireMember";
import { revalidatePath } from "next/cache";
import { getAuthUser } from "@/lib/auth";
import { getCurrentTenant } from "@/lib/tenant";
import { getSupabaseAdmin } from "@/lib/supabase";
import { teamInvitesEnabled } from "@/lib/teamInvitesFlag";
import { canManageMember, assignableRoles, normalizeRole, type Role } from "@/lib/permissions";
import {
  generateInviteToken,
  hashInviteToken,
  inviteEmail,
  inviteErrorCopy,
  normalizeInviteEmail,
} from "@/lib/invites";
import { sendOpsMail } from "@/lib/opsMail";
import { configuredAppHost } from "@/lib/adminHost";
import { RATE_WINDOW_MS, isFreshDuplicate, rateLimitMessage, type RateCounts } from "@/lib/teamLimits";

export type MembersActionResult = { ok?: boolean; error?: string; message?: string };

async function context(): Promise<
  { ok: true; userId: string; tenantId: string; businessName: string } | { ok: false; error: string }
> {
  const user = await getAuthUser();
  if (!user) return { ok: false, error: "Sign in first." };
  const tenant = await getCurrentTenant();
  if (!tenant) return { ok: false, error: "No workspace linked to this account." };
  if (!teamInvitesEnabled(tenant.id)) return { ok: false, error: "Team access isn't switched on for this business yet." };
  return { ok: true, userId: user.id, tenantId: tenant.id, businessName: tenant.business_name || "your business" };
}

async function roleOf(tenantId: string, userId: string): Promise<Role | null> {
  const { data } = await getSupabaseAdmin()
    .from("tenant_members")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();
  return data ? normalizeRole((data as { role: string }).role) : null;
}

/** Invite + resend counts in the last hour, from the audit log (shared across server instances). */
async function recentInviteCounts(tenantId: string, actor: string, targetEmail?: string): Promise<RateCounts> {
  const admin = getSupabaseAdmin();
  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const base = () =>
    admin
      .from("tenant_member_audit")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .in("action", ["invite", "resend"])
      .gte("created_at", since);
  const [w, a, i] = await Promise.all([
    base(),
    base().eq("actor", actor),
    targetEmail ? base().eq("action", "resend").eq("target_email", targetEmail) : Promise.resolve({ count: 0 }),
  ]);
  return { workspace: w.count ?? 0, actor: a.count ?? 0, invite: i.count ?? 0 };
}

async function audit(row: Record<string, unknown>) {
  await getSupabaseAdmin().from("tenant_member_audit").insert(row);
}

async function sendInvite(opts: { email: string; role: Role; token: string; businessName: string }) {
  const link = `https://${configuredAppHost()}/invite/${encodeURIComponent(opts.token)}`;
  const mail = inviteEmail({ businessName: opts.businessName, role: opts.role, link });
  return sendOpsMail({ to: [opts.email], subject: mail.subject, text: mail.text, html: mail.html });
}

function mailNote(result: { sent: number; skipped: string }): string {
  return result.sent ? "Invite sent." : "Invite saved, but email sending is off on this server, so no email went out.";
}

export async function inviteMemberAction(email: string, role: string): Promise<MembersActionResult> {
  const denied = await memberDenied("members.invite");
  if (denied) return denied;
  const ctx = await context();
  if (!ctx.ok) return { error: ctx.error };
  const actorRole = await roleOf(ctx.tenantId, ctx.userId);
  const target = normalizeRole(role);
  const cleanEmail = normalizeInviteEmail(email);
  if (!cleanEmail) return { error: "Enter a valid email address." };
  if (!actorRole || !assignableRoles(actorRole).includes(target)) return { error: "You can't invite someone with that role." };
  const limited = rateLimitMessage(await recentInviteCounts(ctx.tenantId, ctx.userId), "invite");
  if (limited) return { error: limited };

  const token = generateInviteToken();
  const { error } = await getSupabaseAdmin().rpc("create_tenant_invite", {
    p_tenant: ctx.tenantId,
    p_email: cleanEmail,
    p_role: target,
    p_token_hash: hashInviteToken(token),
    p_actor: ctx.userId,
  });
  if (error) {
    if (/\balready_member\b/.test(error.message)) return { error: `${cleanEmail} is already on this team.` };
    if (/\balready_invited\b/.test(error.message)) {
      // Double-click / retry: the first request already created it. Report success, don't send twice.
      const { data: dup } = await getSupabaseAdmin()
        .from("tenant_invites")
        .select("created_at, invited_by")
        .eq("tenant_id", ctx.tenantId)
        .eq("email", cleanEmail)
        .eq("status", "pending")
        .maybeSingle();
      const d = dup as { created_at?: string; invited_by?: string } | null;
      if (isFreshDuplicate(d?.created_at, d?.invited_by, ctx.userId)) return { ok: true, message: "Invite sent." };
      return { error: `${cleanEmail} already has a pending invite. Use Resend in the invites list instead.` };
    }
    return { error: inviteErrorCopy(error.message) };
  }
  try {
    const sent = await sendInvite({ email: cleanEmail, role: target, token, businessName: ctx.businessName });
    revalidatePath("/settings");
    return { ok: true, message: mailNote(sent) };
  } catch {
    revalidatePath("/settings");
    return { ok: true, message: "Invite saved, but the email failed to send. Try Resend." };
  }
}

export async function resendInviteAction(inviteId: string): Promise<MembersActionResult> {
  const denied = await memberDenied("members.invite");
  if (denied) return denied;
  const ctx = await context();
  if (!ctx.ok) return { error: ctx.error };
  const now = Date.now();
  const admin = getSupabaseAdmin();
  const { data: inv } = await admin
    .from("tenant_invites")
    .select("id, email, role, status")
    .eq("id", inviteId)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  const row = inv as { id: string; email: string; role: string; status: string } | null;
  if (!row || row.status !== "pending") return { error: "That invite is no longer pending." };
  const actorRole = await roleOf(ctx.tenantId, ctx.userId);
  if (!actorRole || !canManageMember(actorRole, normalizeRole(row.role))) return { error: "You don't have access to do that." };
  const limited = rateLimitMessage(await recentInviteCounts(ctx.tenantId, ctx.userId, row.email), "resend");
  if (limited) return { error: limited };
  const token = generateInviteToken();
  const expires = new Date(now + 7 * 86_400_000).toISOString();
  const { error } = await admin
    .from("tenant_invites")
    .update({ token_hash: hashInviteToken(token), expires_at: expires })
    .eq("id", row.id);
  if (error) return { error: "Couldn't resend. Try again." };
  await audit({ tenant_id: ctx.tenantId, actor: ctx.userId, action: "resend", target_email: row.email, to_role: row.role });
  try {
    const sent = await sendInvite({ email: row.email, role: normalizeRole(row.role), token, businessName: ctx.businessName });
    return { ok: true, message: sent.sent ? "Invite resent. The old link no longer works." : mailNote(sent) };
  } catch {
    return { error: "The email failed to send. Try again." };
  }
}

export async function revokeInviteAction(inviteId: string): Promise<MembersActionResult> {
  const denied = await memberDenied("members.invite");
  if (denied) return denied;
  const ctx = await context();
  if (!ctx.ok) return { error: ctx.error };
  const admin = getSupabaseAdmin();
  // Admins may only cancel invites for roles they could have sent (not an owner-sent Admin invite).
  const { data: pendingRow } = await admin
    .from("tenant_invites")
    .select("role, status")
    .eq("id", inviteId)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (!pendingRow) return { error: "That invite no longer exists." };
  const pendingState = (pendingRow as { status: string }).status;
  if (pendingState === "revoked") return { ok: true, message: "Invite cancelled." };
  if (pendingState !== "pending") return { error: "That invite is no longer pending." };
  const actorRole = await roleOf(ctx.tenantId, ctx.userId);
  if (!actorRole || !canManageMember(actorRole, normalizeRole((pendingRow as { role: string }).role))) {
    return { error: "Only the owner can cancel an Admin invite." };
  }
  const { data } = await admin
    .from("tenant_invites")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", inviteId)
    .eq("tenant_id", ctx.tenantId)
    .eq("status", "pending")
    .select("email, role")
    .maybeSingle();
  if (!data) return { ok: true, message: "Invite cancelled." };
  const row = data as { email: string; role: string };
  await audit({ tenant_id: ctx.tenantId, actor: ctx.userId, action: "revoke", target_email: row.email, from_role: row.role });
  revalidatePath("/settings");
  return { ok: true, message: "Invite cancelled. The seat is free again." };
}

export async function changeMemberRoleAction(userId: string, role: string): Promise<MembersActionResult> {
  const denied = await memberDenied("members.manage");
  if (denied) return denied;
  const ctx = await context();
  if (!ctx.ok) return { error: ctx.error };
  if (userId === ctx.userId) return { error: "You can't change your own role." };
  const actorRole = await roleOf(ctx.tenantId, ctx.userId);
  const current = await roleOf(ctx.tenantId, userId);
  const next = normalizeRole(role);
  if (!actorRole || !current) return { error: "Member not found." };
  if (current === next) return { ok: true, message: "Role updated." };
  if (!canManageMember(actorRole, current) || !assignableRoles(actorRole).includes(next)) {
    return { error: "You don't have access to do that." };
  }
  const { error } = await getSupabaseAdmin()
    .from("tenant_members")
    .update({ role: next, updated_at: new Date().toISOString() })
    .eq("tenant_id", ctx.tenantId)
    .eq("user_id", userId);
  if (error) return { error: "Couldn't change the role. Try again." };
  await audit({ tenant_id: ctx.tenantId, actor: ctx.userId, action: "role_change", target_user: userId, from_role: current, to_role: next });
  revalidatePath("/settings");
  return { ok: true, message: "Role updated." };
}

export async function removeMemberAction(userId: string): Promise<MembersActionResult> {
  const denied = await memberDenied("members.manage");
  if (denied) return denied;
  const ctx = await context();
  if (!ctx.ok) return { error: ctx.error };
  if (userId === ctx.userId) return { error: "You can't remove yourself." };
  const actorRole = await roleOf(ctx.tenantId, ctx.userId);
  const current = await roleOf(ctx.tenantId, userId);
  if (!actorRole) return { error: "Member not found." };
  if (!current) return { ok: true, message: "Removed." }; // already gone (double-click)
  if (current === "owner") return { error: "The owner can't be removed. Transfer ownership first." };
  if (!canManageMember(actorRole, current)) return { error: "You don't have access to do that." };
  const { error } = await getSupabaseAdmin()
    .from("tenant_members")
    .delete()
    .eq("tenant_id", ctx.tenantId)
    .eq("user_id", userId)
    .neq("role", "owner");
  if (error) return { error: "Couldn't remove. Try again." };
  await audit({ tenant_id: ctx.tenantId, actor: ctx.userId, action: "remove", target_user: userId, from_role: current });
  revalidatePath("/settings");
  return { ok: true, message: "Removed. The seat is free again." };
}

export async function transferOwnershipAction(newOwnerUserId: string): Promise<MembersActionResult> {
  const denied = await memberDenied("ownership.transfer");
  if (denied) return denied;
  const ctx = await context();
  if (!ctx.ok) return { error: ctx.error };
  const target = String(newOwnerUserId || "").trim();
  if (!target) return { error: "Pick who should become the owner." };
  if (target === ctx.userId) return { error: "You're already the owner." };
  const { error } = await getSupabaseAdmin().rpc("transfer_tenant_ownership", {
    p_tenant: ctx.tenantId,
    p_actor: ctx.userId,
    p_new_owner: target,
  });
  if (error) return { error: inviteErrorCopy(error.message) };
  revalidatePath("/settings");
  return { ok: true, message: "Ownership transferred. You're now an Admin." };
}
