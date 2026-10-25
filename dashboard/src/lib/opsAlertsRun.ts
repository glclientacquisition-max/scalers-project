/**
 * Platform ops alert run. The scheduled check opens and resolves notices and
 * mails the Admin list once per notice. Pure: storage, signals, and mail are
 * arguments, so tests drive an in-memory store.
 *
 * A mailed notice is claimed first (`notified_at` null to now). Only the run
 * that wins the claim sends. A failed send releases the claim. A silent latch
 * is inserted already claimed, so a second threshold does not send a second mail.
 * Dry run sends nothing and does not claim a mail. A live run still sends a
 * fresh notice once. A notice older than the stale window is claimed without
 * mail, so turning dry run off does not empty the inbox. Recovery mail is
 * once. A failed recovery send is not retried: the notice is already resolved.
 *
 * Recipients come from the Admin list. This module does not read the environment.
 */

export type AlertKind = string;

export type AlertSignal = {
  kind: AlertKind;
  active: boolean;
  detail: string;
  mail?: boolean;
  recoverMail?: boolean;
  hold?: boolean;
};

export type AlertNotice = {
  id: string;
  kind: AlertKind;
  status: "open" | "acked" | "resolved";
  notified_at: string | null;
  opened_at?: string | null;
};

export type AlertStore = {
  readOpenNotices(): Promise<AlertNotice[]>;
  /** Insert an open notice. Silent rows are stored already claimed. False when this kind is already open. */
  insertOpen(kind: AlertKind, detail: string, nowIso: string, opts?: { silent?: boolean }): Promise<boolean>;
  updateDetail(id: string, detail: string): Promise<void>;
  /** Flip one open or acked notice to resolved. Returns the row only when this call did the flip. */
  resolve(id: string, nowIso: string): Promise<AlertNotice | null>;
  /** notified_at null to now. True only for the call that set it. */
  claimNotified(id: string, nowIso: string): Promise<boolean>;
  releaseClaim(id: string, claimedIso: string): Promise<void>;
};

/** html is optional: wallet notices carry the @scalers/email layout, other kinds are plain text. */
export type AlertMail = { to: string[]; subject: string; text: string; html?: string; kind: string; ledgerKey: string };
export type ComposedMail = { subject: string; text: string; html?: string };

export type AlertRunResult = {
  dryRun: boolean;
  recipients: number;
  opened: AlertKind[];
  resolved: AlertKind[];
  sent: Array<{ kind: AlertKind; recovered: boolean }>;
  wouldSend: Array<{ kind: AlertKind; recovered: boolean }>;
  /** Opened longer ago than the stale window. Claimed, not mailed. */
  quieted: AlertKind[];
  failed: AlertKind[];
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanEmail(raw: unknown): string {
  const email = String(raw || "").trim().toLowerCase();
  return EMAIL.test(email) ? email : "";
}

/**
 * Admin recipients from the platform_ops_settings row: people emails first,
 * else the emails array. A missing row means nobody.
 */
export function alertRecipients(row: { emails?: unknown; people?: unknown } | null | undefined): string[] {
  if (!row) return [];
  const collect = (list: unknown[]) => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of list) {
      const email = cleanEmail(raw);
      if (!email || seen.has(email)) continue;
      seen.add(email);
      out.push(email);
    }
    return out;
  };
  const people = Array.isArray(row.people)
    ? collect(row.people.map((person) => (person && typeof person === "object" ? (person as Record<string, unknown>).email : "")))
    : [];
  if (people.length) return people;
  return Array.isArray(row.emails) ? collect(row.emails) : [];
}

/** Dry run unless the flag is explicitly off. Unset means dry run. */
export function opsAlertsDryRun(raw: string | undefined | null): boolean {
  const value = String(raw ?? "").trim().toLowerCase();
  return !(value === "false" || value === "0" || value === "off" || value === "no");
}

/** Parent toggle (`sautikit_low`) also covers `sautikit_low:10000`. */
export function alertKindEnabled(kind: string, flags: Record<string, boolean>): boolean {
  if (flags[kind] === false) return false;
  const base = kind.split(":")[0];
  if (base !== kind && flags[base] === false) return false;
  return true;
}

/**
 * Staging Desk must not send ops mail, even when dry run is explicitly off.
 * The staging Supabase ref, the staging Vercel project, or a scalers-staging host.
 */
const STAGING_SUPABASE_REF = "sgcdncjxauhsbunobmob";
const STAGING_VERCEL_PROJECT_ID = "prj_koYxAaXjOZ9QYA7hVB2SUOEAmyoB";

export function opsAlertsStagingBlocked(env: NodeJS.ProcessEnv | Record<string, string | undefined>): boolean {
  if (String(env.VERCEL_PROJECT_ID || "") === STAGING_VERCEL_PROJECT_ID) return true;
  const haystack = [env.SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_URL, env.VERCEL_URL, env.NEXT_PUBLIC_APP_URL]
    .map((value) => String(value || ""))
    .join(" ");
  if (haystack.includes(STAGING_SUPABASE_REF)) return true;
  return /scalers-staging/i.test(haystack);
}

/** A replayed ledger row that already went out keeps the claim. in_flight does not. */
export function replayedMailSkip(reason: string | null | undefined): "already_sent" | "in_flight" {
  return reason === "already_sent" ? "already_sent" : "in_flight";
}

/** True only when the message went out, or the ledger already has it as sent. */
export function opsMailKeepsClaim(sent: number, skipped: string): boolean {
  return sent > 0 || skipped === "already_sent";
}

/** Older than the window. Missing opened_at is not stale. */
export function noticeIsStale(openedAt: string | null | undefined, now: Date, staleMs: number | undefined): boolean {
  if (!staleMs || staleMs <= 0 || !openedAt) return false;
  const opened = Date.parse(openedAt);
  if (!Number.isFinite(opened)) return false;
  return now.getTime() - opened > staleMs;
}

/** Bearer `Authorization: Bearer <CRON_SECRET>`. No secret, or a short one, refuses every call. */
export function cronAuthorized(header: string | null | undefined, secret: string | undefined | null): boolean {
  const want = String(secret || "");
  if (want.length < 16) return false;
  const got = String(header || "");
  const expected = `Bearer ${want}`;
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function runOpsAlerts(input: {
  store: AlertStore;
  signals: AlertSignal[];
  kinds: Record<string, boolean>;
  recipients: string[];
  dryRun: boolean;
  now: Date;
  /** Unnotified notices older than this are claimed and not mailed. Unset or 0 leaves them. */
  staleMs?: number;
  compose: (kind: AlertKind, recovered: boolean, detail: string) => ComposedMail;
  send: (mail: AlertMail) => Promise<void>;
}): Promise<AlertRunResult> {
  const { store, signals, kinds, recipients, dryRun, compose, send } = input;
  const nowIso = input.now.toISOString();
  const result: AlertRunResult = {
    dryRun,
    recipients: recipients.length,
    opened: [],
    resolved: [],
    sent: [],
    wouldSend: [],
    quieted: [],
    failed: [],
  };
  const canMail = recipients.length > 0;
  const enabled = (kind: AlertKind) => alertKindEnabled(kind, kinds);
  const bySignal = new Map(signals.map((row) => [row.kind, row]));

  let open = (await store.readOpenNotices()).filter((notice) => notice.status === "open" || notice.status === "acked");
  const openKinds = new Set(open.map((notice) => notice.kind));

  for (const signal of signals) {
    if (signal.hold || !signal.active || !enabled(signal.kind) || openKinds.has(signal.kind)) continue;
    const silent = signal.mail === false;
    if (await store.insertOpen(signal.kind, signal.detail, nowIso, { silent })) result.opened.push(signal.kind);
  }

  for (const notice of open) {
    const signal = bySignal.get(notice.kind);
    if (signal?.hold) continue;
    // A kind this run did not compute stays put. A failed balance read must not clear it.
    if (!signal) continue;
    if (signal.active && enabled(notice.kind)) {
      if (signal.detail) await store.updateDetail(notice.id, signal.detail);
      continue;
    }
    const flipped = await store.resolve(notice.id, nowIso);
    if (!flipped) continue;
    result.resolved.push(notice.kind);
    if (!flipped.notified_at || signal.recoverMail === false || !canMail) continue;
    const mail = compose(notice.kind, true, signal.detail || "");
    if (dryRun) {
      result.wouldSend.push({ kind: notice.kind, recovered: true });
      continue;
    }
    try {
      await send({ to: recipients, ...mail, kind: notice.kind, ledgerKey: `ops:cron:${notice.id}:recovered` });
      result.sent.push({ kind: notice.kind, recovered: true });
    } catch {
      result.failed.push(notice.kind);
    }
  }

  open = (await store.readOpenNotices()).filter((notice) => notice.status === "open" || notice.status === "acked");
  for (const notice of open) {
    const signal = bySignal.get(notice.kind);
    if (!signal || signal.hold || notice.status !== "open" || !signal.active || !enabled(notice.kind)) continue;
    if (signal.mail === false) {
      if (!notice.notified_at) await store.claimNotified(notice.id, nowIso);
      continue;
    }
    if (notice.notified_at || !canMail) continue;
    if (!dryRun && noticeIsStale(notice.opened_at, input.now, input.staleMs)) {
      if (await store.claimNotified(notice.id, nowIso)) result.quieted.push(notice.kind);
      continue;
    }
    const mail = compose(notice.kind, false, signal.detail);
    if (dryRun) {
      result.wouldSend.push({ kind: notice.kind, recovered: false });
      continue;
    }
    if (!(await store.claimNotified(notice.id, nowIso))) continue;
    try {
      await send({ to: recipients, ...mail, kind: notice.kind, ledgerKey: `ops:cron:${notice.id}:open` });
      result.sent.push({ kind: notice.kind, recovered: false });
    } catch {
      await store.releaseClaim(notice.id, nowIso);
      result.failed.push(notice.kind);
    }
  }

  return result;
}
