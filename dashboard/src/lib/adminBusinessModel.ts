/**
 * Release and archive rules for Super Admin. Pure module so node tests can load it.
 *
 * - A number that is live on an active business can't be released. Archive the
 *   business first.
 * - Remove is Archive. Permanent delete opens 30 days after the archive date.
 */

export const ARCHIVE_GRACE_DAYS = 30;
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

export type ArchiveState = {
  archived: boolean;
  canDelete: boolean;
  /** ISO time permanent delete opens, when known. */
  deleteOpensAt: string | null;
  /** Why permanent delete is off, or null when it is allowed. */
  deleteBlockedReason: string | null;
};

export function archiveState(
  row: { isActive: boolean | null | undefined; archivedAt: string | null | undefined },
  now: Date = new Date(),
): ArchiveState {
  if (row.isActive !== false) {
    return {
      archived: false,
      canDelete: false,
      deleteOpensAt: null,
      deleteBlockedReason: "Archive the business first.",
    };
  }
  const at = row.archivedAt ? new Date(row.archivedAt) : null;
  if (!at || Number.isNaN(at.getTime())) {
    return {
      archived: true,
      canDelete: false,
      deleteOpensAt: null,
      deleteBlockedReason: "No archive date on file, so permanent delete stays off.",
    };
  }
  const opens = new Date(at.getTime() + ARCHIVE_GRACE_DAYS * DAY_MS);
  if (now.getTime() < opens.getTime()) {
    return {
      archived: true,
      canDelete: false,
      deleteOpensAt: opens.toISOString(),
      deleteBlockedReason: `Permanent delete opens ${ARCHIVE_GRACE_DAYS} days after archive.`,
    };
  }
  return { archived: true, canDelete: true, deleteOpensAt: opens.toISOString(), deleteBlockedReason: null };
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
