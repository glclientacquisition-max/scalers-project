import { AssistantSayFallbackEditor } from "@/components/assistantSay/AssistantSayFallbackEditor";
import { AssistantSayLookupPreview } from "@/components/assistantSay/AssistantSayLookupPreview";
import { lookupPreviewSamples, type LookupPreviewSamples } from "@/lib/assistantSayVoice.server";
import { deskLookupPreview, voiceFallbackByKind } from "@/lib/deskFeatureFlags";
import { parseUnknownAnswerByKind } from "@/lib/unknownAnswerByKindConstants";
import type { TenantRow } from "@/lib/supabase";

/** samples: pass them from loadAssistantSayView so the preview asks about what callers hear now. */
export function assistantSayBelowList(tenant: TenantRow, samples?: LookupPreviewSamples) {
  const fallback = voiceFallbackByKind()
    ? (
      <AssistantSayFallbackEditor
        initial={parseUnknownAnswerByKind(tenant.unknown_answer_by_kind)}
        legacyGeneral={tenant.unknown_answer_fallback}
      />
    )
    : null;
  const preview = deskLookupPreview() ? <AssistantSayLookupPreview samples={samples ?? lookupPreviewSamples(tenant)} /> : null;
  if (!fallback && !preview) return null;
  return (
    <div className="space-y-6">
      {fallback}
      {preview}
    </div>
  );
}
