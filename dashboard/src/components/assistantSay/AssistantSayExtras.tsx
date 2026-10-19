import { AssistantSayFallbackEditor } from "@/components/assistantSay/AssistantSayFallbackEditor";
import { AssistantSayLookupPreview } from "@/components/assistantSay/AssistantSayLookupPreview";
import { deskLookupPreview, voiceFallbackByKind } from "@/lib/deskFeatureFlags";
import { parseUnknownAnswerByKind } from "@/lib/unknownAnswerByKindConstants";
import type { TenantRow } from "@/lib/supabase";

export function assistantSayBelowList(tenant: TenantRow) {
  const fallback = voiceFallbackByKind()
    ? (
      <AssistantSayFallbackEditor
        initial={parseUnknownAnswerByKind(tenant.unknown_answer_by_kind)}
        legacyGeneral={tenant.unknown_answer_fallback}
      />
    )
    : null;
  const preview = deskLookupPreview() ? <AssistantSayLookupPreview /> : null;
  if (!fallback && !preview) return null;
  return (
    <div className="space-y-6">
      {fallback}
      {preview}
    </div>
  );
}
