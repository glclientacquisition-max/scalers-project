import type { TenantRow } from "@/lib/supabase";
import type { AssistantSayState, ReadyChecklistItem } from "@/lib/assistantSayTypes";
import { loadCompileProvenance } from "@/lib/tenantFieldProvenance";
import { requireVoice } from "@/lib/voiceRequire.server";

function voiceProfileFromTenant(
  tenant: TenantRow,
  extras: { fieldMeta?: unknown; holdGate?: unknown } = {}
) {
  const { tenantProfileFromRow } = requireVoice("./src/tenantProfile.js") as {
    tenantProfileFromRow: (row: unknown, extras: unknown) => unknown;
  };
  return tenantProfileFromRow(tenant, extras);
}

export async function loadAssistantSayState(tenant: TenantRow): Promise<AssistantSayState> {
  const profile = await voiceProfileForAssistantSay(tenant);
  const { evaluateAssistantSay } = requireVoice("./src/knowledge/assistantSayReadiness.js") as {
    evaluateAssistantSay: (profile: unknown) => AssistantSayState;
  };
  return evaluateAssistantSay(profile);
}

export function assistantSayStateFromTenant(tenant: TenantRow): AssistantSayState {
  const { evaluateAssistantSay } = requireVoice("./src/knowledge/assistantSayReadiness.js") as {
    evaluateAssistantSay: (profile: unknown) => AssistantSayState;
  };
  return evaluateAssistantSay(voiceProfileFromTenant(tenant));
}

export async function voiceProfileForAssistantSay(tenant: TenantRow) {
  const provenance = await loadCompileProvenance(tenant.id);
  return voiceProfileFromTenant(tenant, {
    fieldMeta: provenance.fieldMeta,
    holdGate: provenance.holdGate,
  });
}

export async function loadReadyChecklist(tenant: TenantRow) {
  const { getReadyChecklist } = requireVoice("./src/knowledge/assistantSayReadiness.js") as {
    getReadyChecklist: (profile: unknown) => { items: ReadyChecklistItem[]; allDone: boolean };
  };
  const profile = await voiceProfileForAssistantSay(tenant);
  return getReadyChecklist(profile);
}

export type LookupPreviewSamples = { price: string; hours: string; delivery: string; pay: string };

/** Preview sample questions from this tenant's own catalogue and areas (same as the readiness probes). */
export function lookupPreviewSamples(tenant: TenantRow): LookupPreviewSamples {
  const { previewSampleQuestions } = requireVoice("./src/knowledge/assistantSayReadiness.js") as {
    previewSampleQuestions: (profile: unknown) => LookupPreviewSamples;
  };
  return previewSampleQuestions(voiceProfileFromTenant(tenant));
}
