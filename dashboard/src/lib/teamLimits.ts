/** Team scale + abuse limits. Pure so they can be unit-tested; counts come from tenant_member_audit. */
export const MEMBERS_PAGE = 50;
export const INVITES_PAGE = 50;
export const PAGE_MAX = 200;
export const RATE_WINDOW_MS = 3_600_000;
export const LIMITS = {
  /** New invites + resends per workspace per hour. */
  workspacePerHour: 30,
  /** New invites + resends by one person per hour. */
  actorPerHour: 15,
  /** Resends of one invite per hour. */
  resendPerInvitePerHour: 3,
} as const;

export function pageLimit(raw: unknown, base: number): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < base) return base;
  return Math.min(PAGE_MAX, Math.ceil(n / base) * base);
}

export type RateCounts = { workspace: number; actor: number; invite?: number };

/** Returns user-facing copy when a limit is hit, else null. */
export function rateLimitMessage(counts: RateCounts, kind: "invite" | "resend"): string | null {
  if (kind === "resend" && (counts.invite ?? 0) >= LIMITS.resendPerInvitePerHour) {
    return `This invite was resent ${LIMITS.resendPerInvitePerHour} times in the last hour. Try again later.`;
  }
  if (counts.actor >= LIMITS.actorPerHour) return "You've sent a lot of invites in the last hour. Try again later.";
  if (counts.workspace >= LIMITS.workspacePerHour) return "This business has sent a lot of invites in the last hour. Try again later.";
  return null;
}

/** A double-click on Invite hits the pending-invite unique index; treat a very fresh duplicate as success. */
export const DUPLICATE_GRACE_MS = 60_000;
export function isFreshDuplicate(createdAt: string | null | undefined, invitedBy: string | null | undefined, actor: string, now = Date.now()): boolean {
  if (!createdAt || invitedBy !== actor) return false;
  const t = Date.parse(createdAt);
  return Number.isFinite(t) && now - t >= 0 && now - t < DUPLICATE_GRACE_MS;
}
