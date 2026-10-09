/**
 * Platform ops alert run: the scheduled check that opens and resolves notices and mails the
 * Admin recipients list. Pure: storage, signals, and mail come in as arguments, so tests drive
 * it with an in-memory store. No `@/` imports.
 *
 * Rules:
 * - A notice is mailed at most once. The run claims it first (notified_at null -> now, one row
 *   wins); only the run that wins the claim sends. A failed send releases the claim so the next
 *   run can try again; nothing is ever sent twice for the same notice.
 * - A recovery mail goes out once, from the run whose update flipped the notice to resolved,
 *   and only when the opening alert was actually sent.
 * - Dry run changes notice state but sends nothing and claims nothing, so the first live run
 *   still sends each open notice once.
 * - Recipients come only from the Admin list (platform_ops_settings). No env fallback.
 */

export type AlertKind = string;

export type AlertSignal = { kind: AlertKind; active: boolean; detail: string };

export type AlertNotice = {
  id: string;
  kind: AlertKind;
  status: "open" | "acked" | "resolved";
  notified_at: string | null;
};

export type AlertStore = {
  readOpenNotices(): Promise<AlertNotice[]>;
  /** Insert an open notice with notified_at null. Returns false when another run already opened this kind. */
  insertOpen(kind: AlertKind, detail: string, nowIso: string): Promise<boolean>;
  updateDetail(id: string, detail: string): Promise<void>;
  /** Flip one open/acked notice to resolved. Returns the row only when this call did the flip. */
  resolve(id: string, nowIso: string): Promise<AlertNotice | null>;
  /** notified_at null -> now for one row. True only for the call that set it. */
  claimNotified(id: string, nowIso: string): Promise<boolean>;
  releaseClaim(id: string, claimedIso: string): Promise<void>;
};

export type AlertMail = { to: string[]; subject: string; text: string };

export type AlertRunResult = {
  dryRun: boolean;
  recipients: number;
  opened: AlertKind[];
  resolved: AlertKind[];
  sent: Array<{ kind: AlertKind; recovered: boolean }>;
  wouldSend: Array<{ kind: AlertKind; recovered: boolean }>;
  failed: AlertKind[];
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanEmail(raw: unknown): string {
  const email = String(raw || "").trim().toLowerCase();
  return EMAIL.test(email) ? email : "";
}

/**
 * Admin recipients from the platform_ops_settings row, same rule as Voice: people[].email first,
 * else the emails array. Null row (missing table or no row) means nobody. Never reads the environment.
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
    ? collect(row.people.map((p) => (p && typeof p === "object" ? (p as Record<string, unknown>).email : "")))
    : [];
  if (people.length) return people;
  return Array.isArray(row.emails) ? collect(row.emails) : [];
}

/** Dry run unless the flag is explicitly off. Unset means dry run, so a fresh environment never mails. */
export function opsAlertsDryRun(raw: string | undefined | null): boolean {
  const value = String(raw ?? "").trim().toLowerCase();
  return !(value === "false" || value === "0" || value === "off" || value === "no");
}

/** Vercel cron sends `Authorization: Bearer <CRON_SECRET>`. No secret configured means every call is refused. */
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
  /** Kind switches from the Admin settings. A kind set to false never opens or mails. */
  kinds: Record<string, boolean>;
  recipients: string[];
  dryRun: boolean;
  now: Date;
  compose: (kind: AlertKind, recovered: boolean, detail: string) => { subject: string; text: string };
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
    failed: [],
  };
  const canMail = recipients.length > 0;
  const enabled = (kind: AlertKind) => kinds[kind] !== false;
  const bySignal = new Map(signals.map((s) => [s.kind, s]));

  let open = (await store.readOpenNotices()).filter((n) => n.status === "open" || n.status === "acked");
  const openKinds = new Set(open.map((n) => n.kind));

  for (const signal of signals) {
    if (!signal.active || !enabled(signal.kind) || openKinds.has(signal.kind)) continue;
    if (await store.insertOpen(signal.kind, signal.detail, nowIso)) result.opened.push(signal.kind);
  }

  for (const notice of open) {
    const signal = bySignal.get(notice.kind);
    if (signal?.active && enabled(notice.kind)) {
      await store.updateDetail(notice.id, signal.detail);
      continue;
    }
    const flipped = await store.resolve(notice.id, nowIso);
    if (!flipped) continue;
    result.resolved.push(notice.kind);
    // Recovery only for an alert someone actually received.
    if (!flipped.notified_at || !canMail) continue;
    const mail = compose(notice.kind, true, signal?.detail || "");
    if (dryRun) {
      result.wouldSend.push({ kind: notice.kind, recovered: true });
      continue;
    }
    try {
      await send({ to: recipients, ...mail });
      result.sent.push({ kind: notice.kind, recovered: true });
    } catch {
      // The notice is already resolved; a lost recovery mail is not retried.
      result.failed.push(notice.kind);
    }
  }

  // Re-read so notices opened above (or by a parallel run) are mailed in this pass.
  open = (await store.readOpenNotices()).filter((n) => n.status === "open" || n.status === "acked");
  for (const notice of open) {
    const signal = bySignal.get(notice.kind);
    // Acked means someone on Platform already has it.
    if (notice.status !== "open" || notice.notified_at || !signal?.active || !enabled(notice.kind) || !canMail) continue;
    const mail = compose(notice.kind, false, signal.detail);
    if (dryRun) {
      result.wouldSend.push({ kind: notice.kind, recovered: false });
      continue;
    }
    if (!(await store.claimNotified(notice.id, nowIso))) continue;
    try {
      await send({ to: recipients, ...mail });
      result.sent.push({ kind: notice.kind, recovered: false });
    } catch {
      await store.releaseClaim(notice.id, nowIso);
      result.failed.push(notice.kind);
    }
  }

  return result;
}
