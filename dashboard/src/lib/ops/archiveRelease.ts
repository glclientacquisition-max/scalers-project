/**
 * Numbers pane: which release actions to offer (s22, Alvin 23 Oct).
 * Live business → "Archive & release" (primary) + greyed "Just release" with a reason.
 * Already inactive/archived → "Just release" only. Never a lone greyed Release.
 * s28: optional win-back hold after a successful release when platform hold is On.
 */

import type { HoldReleaseMode } from "@/lib/ops/numberHold";

export type ReleaseActions = { archiveRelease: boolean; justRelease: boolean; justReleaseWhy: string | null };

export function releaseActions(state: string | null, blockRelease: string | null, businessId: string | null): ReleaseActions {
  if (state !== "assigned") return { archiveRelease: false, justRelease: false, justReleaseWhy: null };
  if (blockRelease) return { archiveRelease: Boolean(businessId), justRelease: false, justReleaseWhy: blockRelease };
  return { archiveRelease: false, justRelease: true, justReleaseWhy: null };
}

type Post = (url: string, body: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;

export const postJson: Post = async (url, body) => {
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    return res.ok ? { ok: true } : { ok: false, error: json.error };
  } catch {
    return { ok: false };
  }
};

/** Ordered: archive first (existing /api/admin/businesses action), then release (existing /api/did-pool). Says which step failed. */
export async function archiveThenRelease(businessId: string, e164: string, reason: string, post: Post = postJson): Promise<{ ok: true } | { ok: false; step: "archive" | "release"; error: string }> {
  const a = await post("/api/admin/businesses", { action: "archive", business_id: businessId, reason });
  if (!a.ok) return { ok: false, step: "archive", error: `Could not archive the business, nothing changed. ${a.error ?? ""}`.trim() };
  const r = await post("/api/did-pool", { action: "release", e164, reason });
  if (!r.ok) return { ok: false, step: "release", error: `Business archived, but the number was not released. Try Just release. ${r.error ?? ""}`.trim() };
  return { ok: true };
}

/**
 * After a number is in quarantine, optionally mark win-back hold (#885).
 * mode "free" skips the hold call. Failures say which step broke.
 */
export async function releaseThenMaybeHold(
  e164: string,
  reason: string,
  mode: HoldReleaseMode,
  days: number | null,
  post: Post = postJson,
): Promise<{ ok: true } | { ok: false; step: "release" | "hold"; error: string }> {
  const r = await post("/api/did-pool", { action: "release", e164, reason });
  if (!r.ok) return { ok: false, step: "release", error: `Could not release the number. ${r.error ?? ""}`.trim() };
  if (mode !== "hold") return { ok: true };
  const h = await post("/api/admin/number-hold", { action: "hold", e164, days, reason });
  if (!h.ok) {
    return {
      ok: false,
      step: "hold",
      error: `Number released, but win-back hold did not start. Put it on hold from the On hold view. ${h.error ?? ""}`.trim(),
    };
  }
  return { ok: true };
}

export async function archiveThenReleaseMaybeHold(
  businessId: string,
  e164: string,
  reason: string,
  mode: HoldReleaseMode,
  days: number | null,
  post: Post = postJson,
): Promise<{ ok: true } | { ok: false; step: "archive" | "release" | "hold"; error: string }> {
  const a = await archiveThenRelease(businessId, e164, reason, post);
  if (!a.ok) return a;
  if (mode !== "hold") return { ok: true };
  const h = await post("/api/admin/number-hold", { action: "hold", e164, days, reason });
  if (!h.ok) {
    return {
      ok: false,
      step: "hold",
      error: `Business archived and number released, but win-back hold did not start. Put it on hold from the On hold view. ${h.error ?? ""}`.trim(),
    };
  }
  return { ok: true };
}
