import type { TenantRow } from "@/lib/supabase";
import type { AssistantSayState, ReadyChecklistItem } from "@/lib/assistantSayTypes";
import {
  applyTopicTitles,
  assistantSayTopicHref,
  mapChecklistItemToTopicId,
  readyChecklistLabelForItem,
  withCallerLines,
} from "@/lib/assistantSayTopics";
import { resolveTenantBusinessType } from "@/lib/businessType";
import { loadCompileProvenance } from "@/lib/tenantFieldProvenance";
import { requireVoice } from "@/lib/voiceRequire.server";
import { attachKbSnapshot, loadKbPreview } from "@/lib/kbCaller.server";

function voiceProfileFromTenant(
  tenant: TenantRow,
  extras: { fieldMeta?: unknown; holdGate?: unknown } = {}
) {
  const { tenantProfileFromRow } = requireVoice("./src/tenantProfile.js") as {
    tenantProfileFromRow: (row: unknown, extras: unknown) => object;
  };
  return tenantProfileFromRow(tenant, extras);
}

const readiness = () =>
  requireVoice("./src/knowledge/assistantSayReadiness.js") as {
    evaluateAssistantSay: (profile: unknown) => AssistantSayState;
    getReadyChecklist: (profile: unknown) => { items: ReadyChecklistItem[]; allDone: boolean };
    previewSampleQuestions: (profile: unknown) => LookupPreviewSamples;
  };

export async function loadAssistantSayState(tenant: TenantRow): Promise<AssistantSayState> {
  const bt = resolveTenantBusinessType(tenant);
  return withCallerLines(applyTopicTitles(readiness().evaluateAssistantSay(await voiceProfileForAssistantSay(tenant)), bt), tenant);
}

/**
 * The "What it will say" page in one read: rows, the lookup preview samples and the calm "changes on their way"
 * state, all from the same profile (the live snapshot when isKbLive, else the stored row; never a mix).
 */
export async function loadAssistantSayView(tenant: TenantRow): Promise<{ state: AssistantSayState; samples: LookupPreviewSamples; pending: boolean }> {
  const [profile, preview] = await Promise.all([voiceProfileForAssistantSay(tenant), loadKbPreview(tenant.id)]);
  const r = readiness();
  const businessType = resolveTenantBusinessType(tenant);
  const state = withCallerLines(applyTopicTitles(r.evaluateAssistantSay(profile), businessType), tenant);
  return { state, samples: r.previewSampleQuestions(profile), pending: !!preview.snapshot && preview.pending };
}

export function assistantSayStateFromTenant(tenant: TenantRow): AssistantSayState {
  const bt = resolveTenantBusinessType(tenant);
  return withCallerLines(applyTopicTitles(readiness().evaluateAssistantSay(voiceProfileFromTenant(tenant)), bt), tenant);
}

/**
 * isKbLive (shared, kbLive.server): the published snapshot for kb_live_version is attached with Voice's own
 * kb/live.attach, so this page reads exactly what a call reads (offered items only, no old services text, no paused
 * item, no stale notes). Not live, or the snapshot could not be read: the stored row (legacy), unchanged.
 */
export async function voiceProfileForAssistantSay(tenant: TenantRow) {
  const [provenance, preview] = await Promise.all([loadCompileProvenance(tenant.id), loadKbPreview(tenant.id)]);
  const profile = voiceProfileFromTenant(tenant, {
    fieldMeta: provenance.fieldMeta,
    holdGate: provenance.holdGate,
  });
  return attachKbSnapshot(profile, preview.snapshot);
}

export async function loadReadyChecklist(tenant: TenantRow) {
  const businessType = resolveTenantBusinessType(tenant);
  const raw = await readiness().getReadyChecklist(await voiceProfileForAssistantSay(tenant));
  return {
    ...raw,
    items: raw.items.map((item) => ({
      ...item,
      label: readyChecklistLabelForItem(item.id, businessType),
      href: assistantSayTopicHref(mapChecklistItemToTopicId(item.id)),
    })),
  };
}

export type LookupPreviewSamples = { price: string; hours: string; delivery: string; pay: string };

/** Preview sample questions from the stored row (dev pages). The settings page uses loadAssistantSayView. */
export function lookupPreviewSamples(tenant: TenantRow): LookupPreviewSamples {
  return readiness().previewSampleQuestions(voiceProfileFromTenant(tenant));
}
