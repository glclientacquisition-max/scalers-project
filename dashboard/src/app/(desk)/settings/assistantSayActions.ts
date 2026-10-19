"use server";

import { revalidatePath } from "next/cache";
import { memberCan } from "@/lib/requireMember";
import { voiceProfileForAssistantSay } from "@/lib/assistantSayVoice.server";
import { requireVoice } from "@/lib/voiceRequire.server";
import { deskLookupPreview } from "@/lib/deskFeatureFlags";
import { devChapterOneTenant } from "@/lib/devChapterOneTenant";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import type { TenantRow } from "@/lib/supabase";
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

async function voiceProfileForPreview(tenant: TenantRow) {
  if (process.env.DASHBOARD_OPEN === "true") {
    const { tenantProfileFromRow } = requireVoice("./src/tenantProfile.js") as {
      tenantProfileFromRow: (row: unknown, extras: unknown) => unknown;
    };
    return tenantProfileFromRow(tenant, {});
  }
  return voiceProfileForAssistantSay(tenant);
}

async function tenantForPreview(): Promise<TenantRow | null> {
  if (process.env.DASHBOARD_OPEN === "true") {
    return devChapterOneTenant;
  }
  return getCurrentTenant();
}

export type DeskLookupPreviewResult = {
  status: string;
  /** Plain owner copy. Never an internal lookup code. */
  reason: string;
  speechEn: string;
  speechSw: string;
  willSay: boolean;
};

export async function previewDeskLookupAction(
  kind: string,
  query: string
): Promise<{ ok: true; result: DeskLookupPreviewResult } | { ok: false; error: string }> {
  if (!deskLookupPreview()) {
    return { ok: false, error: "Preview is not enabled." };
  }
  if (!(await memberCan("settings.view"))) {
    return { ok: false, error: "No permission." };
  }
  const tenant = await tenantForPreview();
  if (!tenant) return { ok: false, error: "No workspace." };

  const profile = await voiceProfileForPreview(tenant);
  const { lookup, speechOf } = requireVoice("./src/knowledge/lookup.js") as {
    lookup: (
      kind: string,
      query: string,
      ctx: object
    ) => { status: string; reason?: string; speech?: { en?: string; sw?: string } };
    speechOf: (result: { speech?: { en?: string; sw?: string } }, language: string) => string;
  };
  const trimmedQuery = String(query || "").trim() || "sample question";
  const lookupKind = kind === "delivery" ? "fee" : kind;
  const result = lookup(lookupKind, trimmedQuery, {
    profile,
    language: "en",
    now: new Date(),
    seed: 0,
  });
  const { ownerLookupReason } = requireVoice("./src/knowledge/lookupOwnerReason.js") as {
    ownerLookupReason: (kind: string, result: { status?: string; reason?: string }) => string;
  };
  const reasonKind =
    lookupKind === "fee" ? "delivery" : lookupKind === "pay" ? "payment" : lookupKind;
  return {
    ok: true,
    result: {
      status: result.status,
      reason: ownerLookupReason(reasonKind, result),
      speechEn: speechOf(result, "en"),
      speechSw: speechOf(result, "sw"),
      willSay: result.status === "found",
    },
  };
}
