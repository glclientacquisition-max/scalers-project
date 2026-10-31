"use server";

import { revalidatePath } from "next/cache";
import { memberDenied } from "@/lib/requireMember";
import { getCurrentTenant, requireSupabaseUser } from "@/lib/tenant";
import { getAuthUser } from "@/lib/auth";
import { FACT_RESTORE_ORDER, factKeysFor, importSource, type FactKey } from "@/lib/importUndo";
import { beginImportFacts, endImportFacts, factBeforeUndo, openFactsRun } from "@/lib/kbImportRuns.server";
import { normalizeAreaPicks } from "@/lib/areaPicks";
import { saveAreaPicks } from "@/lib/areaPicks.server";
import { saveAndCompileSettings } from "@/app/(desk)/settings/actions";

/**
 * Add many: found facts join the import's undo. The sheet calls begin, saves each ticked card in its own request
 * (each reads the tenant fresh), then end. Undo restores each fact through its own settings save, in its own request.
 */
type FactsLogResult = { ok: true; importId: string | null } | { ok: false; error: string };

const RUN_ID = /^[0-9a-f-]{36}$/i;
const KINDS = new Set(["hours", "policy", "payment", "address", "branch", "faq", "areas"]);
const kindsOf = (raw: unknown): string[] => (Array.isArray(raw) ? raw.filter((k): k is string => typeof k === "string" && KINDS.has(k)) : []);

async function owner(): Promise<{ id: string } | { error: string }> {
  const denied = await memberDenied("settings.edit");
  if (denied) return { error: denied.error };
  const t = await getCurrentTenant();
  return t ? { id: t.id } : { error: "Not signed in." };
}

/** Before saving found facts: log what they replace. Opens a log row when the import had no items. Never blocks the save. */
export async function beginImportFactsAction(kinds: string[], importId: string | null, source?: string): Promise<FactsLogResult> {
  const t = await owner();
  if ("error" in t) return { ok: false, error: t.error };
  const keys = factKeysFor(kindsOf(kinds));
  if (!keys.length) return { ok: true, importId: null };
  let runId = importId && RUN_ID.test(importId) ? importId : null;
  if (!runId) {
    const user = await requireSupabaseUser().catch(() => null);
    runId = await openFactsRun(t.id, user?.id ?? null, importSource(source));
  }
  if (!runId) return { ok: true, importId: null };
  return { ok: true, importId: (await beginImportFacts(t.id, runId, keys)) ? runId : null };
}

/** After saving found facts: log what they hold now, so undo can tell if anyone changed them since. */
export async function endImportFactsAction(importId: string, kinds: string[], saved: number): Promise<{ ok: boolean }> {
  const t = await owner();
  if ("error" in t || !RUN_ID.test(String(importId || ""))) return { ok: false };
  const keys = factKeysFor(kindsOf(kinds));
  return { ok: await endImportFacts(t.id, importId, keys, Math.max(0, Math.min(500, Number(saved) || 0))) };
}

/** Second half of an undo: one fact back to its value from before the import (read from the log, not the browser). */
export async function restoreImportFactAction(importId: string, key: FactKey): Promise<{ ok: true } | { ok: false; error: string }> {
  const t = await owner();
  if ("error" in t) return { ok: false, error: t.error };
  if (!RUN_ID.test(String(importId || "")) || !FACT_RESTORE_ORDER.includes(key)) return { ok: false, error: "Couldn't put that back." };
  const before = await factBeforeUndo(t.id, importId, key);
  if (!before.ok) return { ok: false, error: "Couldn't put that back." };
  if (key === "areas") {
    const user = await getAuthUser();
    const res = await saveAreaPicks(t.id, normalizeAreaPicks(before.value ?? null), { confirm: false, userId: user?.id ?? null });
    if (!res.ok) return { ok: false, error: "Couldn't put your areas back." };
    revalidatePath("/settings/areas");
    return { ok: true };
  }
  const form = new FormData();
  form.set("id", t.id);
  form.set("owner_field_paths", "[]");
  if (key === "hours") {
    form.set("settings_scope", "hours");
    form.set("hours_schedule", JSON.stringify(before.value ?? null));
  } else if (key === "policies") {
    form.set("settings_scope", "policies-rules");
    form.set("business_policies", JSON.stringify(before.value ?? {}));
  } else if (key === "locations") {
    form.set("settings_scope", "locations-address");
    form.set("business_locations", JSON.stringify(before.value ?? []));
  } else {
    form.set("settings_scope", "faqs");
    form.set("faqs", JSON.stringify(before.value ?? []));
  }
  const res = await saveAndCompileSettings({}, form);
  if (res.error) return { ok: false, error: res.error };
  revalidatePath("/settings");
  revalidatePath("/home");
  return { ok: true };
}
