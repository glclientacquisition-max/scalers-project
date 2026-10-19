"use server";

import { revalidatePath } from "next/cache";
import { memberCan } from "@/lib/requireMember";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { updateWithColumnPeel } from "@/lib/peelMissingColumns";
import {
  DEFAULT_BY_KIND,
  FALLBACK_KINDS,
  parseUnknownAnswerByKind,
  UNKNOWN_ANSWER_BY_KIND_COLUMN,
  type UnknownAnswerByKind,
} from "@/lib/unknownAnswerByKindConstants";

function trimLine(raw: FormDataEntryValue | null): string {
  return String(raw || "").trim().slice(0, 220);
}

function buildByKindPayload(formData: FormData): UnknownAnswerByKind | null {
  const out: UnknownAnswerByKind = {};
  for (const kind of FALLBACK_KINDS) {
    const en = trimLine(formData.get(`fallback_${kind}_en`));
    const sw = trimLine(formData.get(`fallback_${kind}_sw`));
    const defaults = DEFAULT_BY_KIND[kind];
    if (en === defaults.en && sw === defaults.sw) continue;
    if (en || sw) {
      out[kind] = {
        en: en || defaults.en,
        sw: sw || defaults.sw,
      };
    }
  }
  return Object.keys(out).length ? out : null;
}

export async function saveUnknownAnswerByKindAction(formData: FormData) {
  if (!(await memberCan("settings.edit"))) {
    return { ok: false as const, error: "No permission to edit settings." };
  }
  const tenant = await getCurrentTenant();
  if (!tenant) return { ok: false as const, error: "No workspace." };
  const workspace = await createWorkspaceDataClient();
  if (!workspace) return { ok: false as const, error: "Not signed in." };

  const payload = buildByKindPayload(formData);
  const patch: Record<string, unknown> = {
    [UNKNOWN_ANSWER_BY_KIND_COLUMN]: payload,
  };

  const { error } = await updateWithColumnPeel(patch, (p) =>
    workspace.client.from("tenants").update(p).eq("id", tenant.id)
  );
  if (error) {
    return { ok: false as const, error };
  }
  revalidatePath("/settings");
  revalidatePath("/home");
  return { ok: true as const, byKind: parseUnknownAnswerByKind(payload) };
}
