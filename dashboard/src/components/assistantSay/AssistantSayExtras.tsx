import { AssistantSayFallbackEditor } from "@/components/assistantSay/AssistantSayFallbackEditor";
import { AssistantSayLookupPreview } from "@/components/assistantSay/AssistantSayLookupPreview";
import { deskLookupPreview, voiceFallbackByKind } from "@/lib/deskFeatureFlags";
import { parseUnknownAnswerByKind } from "@/lib/unknownAnswerByKindConstants";
import type { TenantRow } from "@/lib/supabase";

export function assistantSayBelowList(tenant: TenantRow) {
<<<<<<< HEAD
  if (!voiceFallbackByKind()) return null;
  const initial = parseUnknownAnswerByKind(tenant.unknown_answer_by_kind);
  return (
    <AssistantSayFallbackEditor
      initial={initial}
      legacyGeneral={tenant.unknown_answer_fallback}
    />
=======
  const fallback = voiceFallbackByKind()
    ? <AssistantSayFallbackEditor initial={parseUnknownAnswerByKind(tenant.unknown_answer_by_kind)} />
    : null;
  const preview = deskLookupPreview() ? <AssistantSayLookupPreview /> : null;
  if (!fallback && !preview) return null;
  return (
    <div className="space-y-6">
      {fallback}
      {preview}
    </div>
>>>>>>> 50037198 (feat(desk): lookup preview on readiness page (PR4))
  );
}
