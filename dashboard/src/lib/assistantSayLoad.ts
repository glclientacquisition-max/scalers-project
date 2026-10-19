import { createRequire } from "node:module";
import path from "node:path";
import type { TenantRow } from "@/lib/supabase";
import { loadCompileProvenance } from "@/lib/tenantFieldProvenance";

const requireVoice = createRequire(path.join(process.cwd(), "..", "package.json"));

export type AssistantSayRow = {
  id: string;
  title: string;
  willSay: boolean;
  reason: string;
  fixHref: string;
};

export type AssistantSayState = {
  intro: string;
  rows: AssistantSayRow[];
  readyCount: number;
  total: number;
};

export type ReadyChecklistItem = {
  id: string;
  label: string;
  href: string;
  complete: boolean;
};

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

function voiceProfileFromTenant(
  tenant: TenantRow,
  extras: { fieldMeta?: unknown; holdGate?: unknown } = {}
) {
  const { tenantProfileFromRow } = requireVoice("./src/tenantProfile.js") as {
    tenantProfileFromRow: (row: unknown, extras: unknown) => unknown;
  };
  return tenantProfileFromRow(tenant, extras);
}

/** Dev fixtures and checklist: provenance optional. */
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
