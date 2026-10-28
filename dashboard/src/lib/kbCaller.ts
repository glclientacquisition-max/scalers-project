/**
 * What a caller-facing preview reads when the business is on the KB (pure; no server imports, no env).
 * The decision is the shared isKbLive (dashboard/src/lib/kbLive.server.ts -> src/knowledge/kb/kbLive.js); this file
 * never recomputes it. When live, the preview is built ONLY from the published snapshot for kb_live_version, through
 * Voice's own reader (kb/live.attach + kb/source.js via requireVoice, kbCaller.server.ts). Never from kb_items, and
 * never a mix of the two. Not live, or the snapshot could not be read: the legacy reads, unchanged.
 */

/**
 * Saves compile automatically, so the owner never publishes. When kb_items changed after the live snapshot was
 * compiled, the preview still shows what callers hear now and says the latest changes are on their way.
 * Cheap compare: newest kb_items.updated_at against kb_snapshots.compiled_at.
 */
export function kbChangesPending(latestItemAt: string | null | undefined, compiledAt: string | null | undefined): boolean {
  if (!latestItemAt || !compiledAt) return false;
  const a = Date.parse(latestItemAt);
  const b = Date.parse(compiledAt);
  return Number.isFinite(a) && Number.isFinite(b) && a > b;
}

/** Owner copy for that state. Calm, plain, no dashes, no "publish". */
export const KB_PENDING_LINE = "Your latest changes reach calls in a moment. This is what callers hear now.";

/** The published snapshot callers hear now (kb_snapshots row for kb_live_version). */
export type KbLiveSnapshot = { version: number; brainTarget: string; doc: unknown; bytes: number | null; compiledAt: string | null };

/**
 * Arguments for Voice's kb/live.attach(profile, info, opts) so the Desk profile carries the snapshot exactly as a
 * call does. Forced: the decision was already taken by the shared isKbLive, attach must not take it again.
 */
export function kbSnapshotAttachArgs(snapshot: KbLiveSnapshot) {
  return [
    { version: snapshot.version, readyVersion: snapshot.version, brainTarget: snapshot.brainTarget, doc: snapshot.doc, bytes: snapshot.bytes, loadMs: null },
    { force: true },
  ] as const;
}

/** Desk fact profile when live: the speech fact sheet (provenance.ts) then leaves notes empty, like Voice. */
export function kbFactProfile<P extends Record<string, unknown>>(profile: P, live: boolean): P & { kbMode?: true } {
  return live ? { ...profile, kbMode: true as const, servicesOffered: null } : profile;
}
