/**
 * Release, suspend, archive and purge rules for Super Admin. Pure module so node tests can load it.
 *
 * - A number that is live on an active business can't be released. Archive the
 *   business first.
 * - Suspend pauses the line (line_status = 'suspended'): callers hear "line
 *   unavailable", nothing else changes. Restore brings it back.
 * - Archive is the "delete" a person sees: line closed, hidden from default lists,
 *   billing stopped, owner sign-in blocked. Unarchive within ARCHIVE_RESTORE_DAYS.
 * - After that window the nightly purge (docs/supabase/purge_archived_tenants.sql)
 *   deletes calls, recordings, contacts and playbook facts. No instant hard delete.
 */

/** Days an archived business can be unarchived before the purge deletes its data. The one place this lives. */
export const ARCHIVE_RESTORE_DAYS = 30;
/** Every suspend, restore, archive and unarchive needs a typed reason at least this long. */
export const MIN_REASON_LENGTH = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ReleaseSubject = {
  /** Business the number is on, if any. */
  businessName?: string | null;
  /** tenants.is_active for that business. null or undefined counts as active. */
  isActive?: boolean | null;
  /** True when the number is linked to a business row that still exists. */
  linked: boolean;
};

/** Why release is blocked, or null when it is allowed. */
export function releaseBlockReason(subject: ReleaseSubject): string | null {
  if (!subject.linked) return null;
  if (subject.isActive === false) return null;
  const name = String(subject.businessName || "").trim() || "a business";
  return `Live on ${name}. Archive the business before you release its number.`;
}

export type LifecycleInput = {
  isActive: boolean | null | undefined;
  archivedAt: string | null | undefined;
  lineStatus?: string | null;
  suspendedAt?: string | null;
};

export type Lifecycle =
  | { state: "archived"; purgesAt: string | null }
  /** byAdmin false: suspended for non-payment, which billing lifts, not Admin. */
  | { state: "suspended"; byAdmin: boolean }
  | { state: "live" };

/** Same order as the voice gate: archived, then suspended, then live. */
export function businessLifecycle(row: LifecycleInput): Lifecycle {
  if (row.isActive === false || Boolean(row.archivedAt)) {
    return { state: "archived", purgesAt: purgeDate(row.archivedAt) };
  }
  if (String(row.lineStatus || "").trim().toLowerCase() === "suspended") {
    return { state: "suspended", byAdmin: Boolean(row.suspendedAt) };
  }
  return { state: "live" };
}

/** When the purge may delete this archived business's data, or null with no archive date. */
export function purgeDate(archivedAt: string | null | undefined): string | null {
  if (!archivedAt) return null;
  const at = new Date(archivedAt);
  if (Number.isNaN(at.getTime())) return null;
  return new Date(at.getTime() + ARCHIVE_RESTORE_DAYS * DAY_MS).toISOString();
}

/** Trimmed reason, or throws AdminActionBlocked when it is too short. */
export function requireReason(raw: unknown): string {
  const reason = String(raw ?? "").trim();
  if (reason.length < MIN_REASON_LENGTH) {
    throw new AdminActionBlocked(`Add a reason (${MIN_REASON_LENGTH} characters or more).`);
  }
  return reason.slice(0, 500);
}

export function reasonOk(raw: string): boolean {
  return raw.trim().length >= MIN_REASON_LENGTH;
}

/** Thrown by server helpers when a rule blocks an admin action. Routes answer 409 with the message. */
export class AdminActionBlocked extends Error {
  readonly blocked = true;
  constructor(message: string) {
    super(message);
    this.name = "AdminActionBlocked";
  }
}

export function isAdminActionBlocked(err: unknown): err is AdminActionBlocked {
  return Boolean(err && typeof err === "object" && (err as { blocked?: unknown }).blocked === true);
}
