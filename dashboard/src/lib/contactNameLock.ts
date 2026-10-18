/**
 * Owner contact-identity lock (DESK_CONTACT_NAME_LOCK). Metadata only, no migration:
 *   single_person: true                 the owner says only one person uses this number
 *   name_locked: { at, by: "owner" }    the owner set or confirmed the name
 *   alternate_names_dismissed: [{ name, at }]  removed by the owner; nothing adds these back
 * Brain reads the same keys (treats the line as never shared, binds the locked name).
 * Pure: safe for client and server.
 */
import { namesLikelySame } from "./nameFold";

export type ContactAlternate = { name: string; seen_at: string | null; call_id: string | null };
export type DismissedName = { name: string; at: string };
export type NameLock = { at: string; by: "owner" };

export type ContactIdentityView = {
  singlePerson: boolean;
  nameLocked: NameLock | null;
  alternates: ContactAlternate[];
  dismissed: DismissedName[];
};

/** Most dismissed names kept, newest last. */
export const DISMISSED_CAP = 20;

type Meta = Record<string, unknown>;

function meta(raw: unknown): Meta {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as Meta) } : {};
}

function text(raw: unknown): string | null {
  const v = typeof raw === "string" ? raw.trim() : "";
  return v || null;
}

function key(name: unknown): string {
  return String(name ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

export function readAlternates(raw: unknown): ContactAlternate[] {
  const list = meta(raw).alternate_names;
  const out: ContactAlternate[] = [];
  for (const row of Array.isArray(list) ? list : []) {
    const r = row as { name?: unknown; seen_at?: unknown; call_id?: unknown };
    const name = text(r?.name);
    if (!name) continue;
    out.push({ name, seen_at: text(r.seen_at), call_id: text(r.call_id) });
  }
  return out;
}

export function readDismissed(raw: unknown): DismissedName[] {
  const list = meta(raw).alternate_names_dismissed;
  const out: DismissedName[] = [];
  for (const row of Array.isArray(list) ? list : []) {
    const r = row as { name?: unknown; at?: unknown };
    const name = text(r?.name);
    if (name) out.push({ name, at: text(r.at) ?? "" });
  }
  return out;
}

export function readContactIdentity(raw: unknown): ContactIdentityView {
  const m = meta(raw);
  const lock = m.name_locked as { at?: unknown; by?: unknown } | undefined;
  return {
    singlePerson: m.single_person === true,
    nameLocked: lock && lock.by === "owner" && text(lock.at) ? { at: String(lock.at), by: "owner" } : null,
    alternates: readAlternates(m),
    dismissed: readDismissed(m),
  };
}

/** "This number is one person": on sets single_person and name_locked; off clears both. */
export function setSinglePerson(raw: unknown, on: boolean, nowIso: string): Meta {
  const m = meta(raw);
  if (on) {
    m.single_person = true;
    m.name_locked = { at: nowIso, by: "owner" };
  } else {
    delete m.single_person;
    delete m.name_locked;
  }
  return m;
}

/**
 * Remove an "Also heard as" name: out of alternate_names (same spelling, any case or
 * accent), appended to alternate_names_dismissed once.
 */
export function dismissAlternate(raw: unknown, name: string, nowIso: string): Meta {
  const m = meta(raw);
  const k = key(name);
  if (!k) return m;
  m.alternate_names = readAlternates(m).filter((row) => key(row.name) !== k);
  const dismissed = readDismissed(m).filter((row) => key(row.name) !== k);
  dismissed.push({ name: name.trim(), at: nowIso });
  m.alternate_names_dismissed = dismissed.slice(-DISMISSED_CAP);
  return m;
}

/** Was this name removed by the owner? (The call path must not add it back.) */
export function isDismissedName(raw: unknown, name: unknown): boolean {
  const k = key(name);
  return Boolean(k) && readDismissed(raw).some((row) => key(row.name) === k);
}

/**
 * Owner rename with the lock on: the new name, locked by the owner. The old name is NOT
 * added as an alternate, and alternates that are near-spellings of the new name go.
 */
export function ownerRename(
  existing: { name?: string | null; metadata?: unknown },
  incoming: string,
  nowIso: string,
  opts: { lock: boolean } = { lock: true }
): { name: string; metadata: Meta } {
  const name = incoming.trim();
  const m = meta(existing.metadata);
  m.alternate_names = readAlternates(m).filter(
    (row) => key(row.name) !== key(name) && !namesLikelySame(row.name, name)
  );
  if (opts.lock) m.name_locked = { at: nowIso, by: "owner" };
  return { name, metadata: m };
}

/** "1 other name" / "2 other names": how many people the system thinks use the line. */
export function otherNamesLine(count: number): string {
  if (count <= 0) return "No other names heard on this number.";
  return count === 1 ? "1 other name heard on this number." : `${count} other names heard on this number.`;
}

/** Alternates still shown: dismissed names never come back on screen, even if re-added. */
export function visibleAlternates(raw: unknown): ContactAlternate[] {
  return readAlternates(raw).filter((row) => !isDismissedName(raw, row.name));
}

/** "17 Oct" in the owner's time zone, or "" when unknown. */
export function heardDay(iso: string | null | undefined): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return "";
  return new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", timeZone: "Africa/Nairobi" }).format(t);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Link to the call the name was heard on, when the id is a call row id. */
export function alternateCallHref(callId: string | null | undefined): string | null {
  return callId && UUID.test(callId) ? `/calls/${callId}` : null;
}
