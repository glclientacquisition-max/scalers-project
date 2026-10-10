import { createHash, randomBytes } from "node:crypto";
import { ROLE_LABELS, type Role } from "./permissions";

export const INVITE_TTL_DAYS = 7;

export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Only the hash is stored; the raw token lives in the email link. */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(String(token || "").trim()).digest("hex");
}

export type InviteRow = {
  id: string;
  email: string;
  role: string;
  status: string;
  expires_at: string;
  created_at?: string;
};

export type InviteState = "pending" | "expired" | "accepted" | "revoked";

export function inviteState(row: Pick<InviteRow, "status" | "expires_at">, now = new Date()): InviteState {
  if (row.status === "accepted" || row.status === "revoked") return row.status;
  if (row.status === "expired") return "expired";
  return new Date(row.expires_at).getTime() <= now.getTime() ? "expired" : "pending";
}

export type SeatSummary = { used: number; included: number; full: boolean; members: number; pending: number };

/** Owner and pending (unexpired) invites count as seats. */
export function seatSummary(input: {
  members: number;
  invites: Array<Pick<InviteRow, "status" | "expires_at">>;
  included: number;
  now?: Date;
}): SeatSummary {
  const pending = input.invites.filter((i) => inviteState(i, input.now) === "pending").length;
  const used = input.members + pending;
  const included = Math.max(0, Number(input.included) || 0);
  return { used, included, full: used >= included, members: input.members, pending };
}

export function daysLeft(expiresAt: string, now = new Date()): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / 86_400_000));
}

const RPC_ERRORS: Record<string, string> = {
  forbidden: "You don't have access to do that.",
  bad_role: "Pick a role.",
  already_member: "That person is already a member of this business.",
  already_invited: "There's already a pending invite for that email. Resend it instead.",
  seats_full: "All your seats are in use. Upgrade your package to invite more people.",
  invalid: "This invite link isn't valid.",
  not_pending: "This invite has already been used or was cancelled.",
  expired: "This invite has expired. Ask for a new one.",
  email_mismatch: "This invite was sent to a different email. Sign in with that email.",
  target_not_admin: "You can only transfer ownership to an existing Admin.",
};

export function inviteErrorCopy(message: string | null | undefined): string {
  const text = String(message || "");
  const key = Object.keys(RPC_ERRORS).find((k) => new RegExp(`\\b${k}\\b`).test(text));
  return key ? RPC_ERRORS[key] : "Something went wrong. Try again.";
}

export function inviteEmail(input: { businessName: string; role: Role; link: string; inviterName?: string }) {
  const role = ROLE_LABELS[input.role];
  const who = input.inviterName?.trim() ? `${input.inviterName.trim()} invited you` : "You've been invited";
  const subject = `${who.replace("You've been invited", "Invitation")} to ${input.businessName} on Scalers`;
  const text = [
    `${who} to join ${input.businessName} on Scalers as ${role}.`,
    "",
    `Accept the invite: ${input.link}`,
    "",
    `This link expires in ${INVITE_TTL_DAYS} days. If you weren't expecting it, you can ignore this email.`,
  ].join("\n");
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const html = `<p>${esc(who)} to join <strong>${esc(input.businessName)}</strong> on Scalers as <strong>${esc(role)}</strong>.</p>
<p><a href="${esc(input.link)}">Accept the invite</a></p>
<p style="color:#666">This link expires in ${INVITE_TTL_DAYS} days. If you weren't expecting it, you can ignore this email.</p>`;
  return { subject, text, html };
}

export function normalizeInviteEmail(raw: unknown): string | null {
  const email = String(raw ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : null;
}
