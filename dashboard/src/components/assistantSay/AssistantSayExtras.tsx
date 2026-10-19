import { AssistantSayFallbackEditor } from "@/components/assistantSay/AssistantSayFallbackEditor";
import { voiceFallbackByKind } from "@/lib/deskFeatureFlags";
import { parseUnknownAnswerByKind } from "@/lib/unknownAnswerByKindConstants";
import type { TenantRow } from "@/lib/supabase";

export function assistantSayBelowList(tenant: TenantRow) {
  if (!voiceFallbackByKind()) return null;
  const initial = parseUnknownAnswerByKind(tenant.unknown_answer_by_kind);
  return <AssistantSayFallbackEditor initial={initial} />;
}
