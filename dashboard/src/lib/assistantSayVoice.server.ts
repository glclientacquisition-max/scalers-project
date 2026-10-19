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
  const provenance = await loadCompileProvenance(tenant.id);
  const profile = voiceProfileFromTenant(tenant, {
    fieldMeta: provenance.fieldMeta,
    holdGate: provenance.holdGate,
  });
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

export async function loadReadyChecklist(tenant: TenantRow) {
  const { getReadyChecklist } = requireVoice("./src/knowledge/assistantSayReadiness.js") as {
    getReadyChecklist: (profile: unknown) => { items: ReadyChecklistItem[]; allDone: boolean };
  };
  return getReadyChecklist(voiceProfileFromTenant(tenant));
}
