"use server";

import { requireMember } from "@/lib/requireMember";
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
  await requireMember("members.invite");
  const ctx = await context();
  if (!ctx.ok) return { error: ctx.error };
  const actorRole = await roleOf(ctx.tenantId, ctx.userId);
  const target = normalizeRole(role);
  const cleanEmail = normalizeInviteEmail(email);
  if (!cleanEmail) return { error: "Enter a valid email address." };
  if (!actorRole || !assignableRoles(actorRole).includes(target)) return { error: "You can't invite someone with that role." };

  const token = generateInviteToken();
  const { error } = await getSupabaseAdmin().rpc("create_tenant_invite", {
    p_tenant: ctx.tenantId,
    p_email: cleanEmail,
    p_role: target,
    p_token_hash: hashInviteToken(token),
    p_actor: ctx.userId,
  });
  if (error) return { error: inviteErrorCopy(error.message) };
  try {
    const sent = await sendInvite({ email: cleanEmail, role: target, token, businessName: ctx.businessName });
    revalidatePath("/settings");
    return { ok: true, message: mailNote(sent) };
  } catch {
    revalidatePath("/settings");
    return { ok: true, message: "Invite saved, but the email failed to send. Try Resend." };
  }
}

const resendHits = new Map<string, number[]>();

export async function resendInviteAction(inviteId: string): Promise<MembersActionResult> {
  await requireMember("members.invite");
  const ctx = await context();
  if (!ctx.ok) return { error: ctx.error };
  const now = Date.now();
  const hits = (resendHits.get(inviteId) || []).filter((t) => now - t < 3_600_000);
  if (hits.length >= 3) return { error: "You've resent this invite 3 times in the last hour. Try later." };
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
  const token = generateInviteToken();
  const expires = new Date(now + 7 * 86_400_000).toISOString();
  const { error } = await admin
    .from("tenant_invites")
    .update({ token_hash: hashInviteToken(token), expires_at: expires })
    .eq("id", row.id);
  if (error) return { error: "Couldn't resend. Try again." };
  hits.push(now);
  resendHits.set(inviteId, hits);
  await audit({ tenant_id: ctx.tenantId, actor: ctx.userId, action: "resend", target_email: row.email, to_role: row.role });
  try {
    const sent = await sendInvite({ email: row.email, role: normalizeRole(row.role), token, businessName: ctx.businessName });
    return { ok: true, message: sent.sent ? "Invite resent. The old link no longer works." : mailNote(sent) };
  } catch {
    return { error: "The email failed to send. Try again." };
  }
}

export async function revokeInviteAction(inviteId: string): Promise<MembersActionResult> {
  await requireMember("members.invite");
  const ctx = await context();
  if (!ctx.ok) return { error: ctx.error };
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("tenant_invites")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", inviteId)
    .eq("tenant_id", ctx.tenantId)
    .eq("status", "pending")
    .select("email, role")
    .maybeSingle();
  if (!data) return { error: "That invite is no longer pending." };
  const row = data as { email: string; role: string };
  await audit({ tenant_id: ctx.tenantId, actor: ctx.userId, action: "revoke", target_email: row.email, from_role: row.role });
  revalidatePath("/settings");
  return { ok: true, message: "Invite cancelled. The seat is free again." };
}

export async function changeMemberRoleAction(userId: string, role: string): Promise<MembersActionResult> {
  await requireMember("members.manage");
  const ctx = await context();
  if (!ctx.ok) return { error: ctx.error };
  if (userId === ctx.userId) return { error: "You can't change your own role." };
  const actorRole = await roleOf(ctx.tenantId, ctx.userId);
  const current = await roleOf(ctx.tenantId, userId);
  const next = normalizeRole(role);
  if (!actorRole || !current) return { error: "Member not found." };
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
  await requireMember("members.manage");
  const ctx = await context();
  if (!ctx.ok) return { error: ctx.error };
  if (userId === ctx.userId) return { error: "You can't remove yourself." };
  const actorRole = await roleOf(ctx.tenantId, ctx.userId);
  const current = await roleOf(ctx.tenantId, userId);
  if (!actorRole || !current) return { error: "Member not found." };
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
  await requireMember("ownership.transfer");
  const ctx = await context();
  if (!ctx.ok) return { error: ctx.error };
  const { error } = await getSupabaseAdmin().rpc("transfer_tenant_ownership", {
    p_tenant: ctx.tenantId,
    p_actor: ctx.userId,
    p_new_owner: newOwnerUserId,
  });
  if (error) return { error: inviteErrorCopy(error.message) };
  revalidatePath("/settings");
  return { ok: true, message: "Ownership transferred. You're now an Admin." };
}
