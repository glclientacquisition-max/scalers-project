import "server-only";

import type {
  BusinessQualityDetail,
  BusinessQualityRow,
  QualityBadge,
  QualityRange,
  ReleaseDelta,
  VoiceCallTrace,
} from "./adminQualityModel";

export type {
  BusinessQualityDetail,
  BusinessQualityRow,
  QualityBadge,
  QualityCallSummary,
  QualityRange,
  ReleaseDelta,
  RepeatFailure,
  VoiceCallTrace,
  VoiceCheckCounts,
  VoiceCheckName,
  VoiceTurnTrace,
} from "./adminQualityModel";

/**
 * Super Admin quality reads. Service role only, when Platform wires them.
 *
 * TODO(Platform): replace each function body with a service-role read of
 * `public.voice_turn_traces` (schema v1). Do not use the owner session and
 * do not send the service-role key to the browser. Production tracing stays
 * off. #582 still has to persist score, per-check counts, diagnosis, and
 * release on the call row. Per-turn `checks` are not in schema v1. Fill
 * them from the scorer so failing checks can pin to a turn.
 *
 * When that read exists, build business detail with `couldntAnswerQuestions`
 * and `repeatFailuresFromCalls` from `adminQualityModel.ts`.
 *
 * Until then every read is empty. No fixture data on this path.
 */

export async function listBusinessQuality(range: QualityRange): Promise<BusinessQualityRow[]> {
  void range;
  return [];
}

export async function getBusinessQuality(
  businessId: string,
  range: QualityRange,
): Promise<BusinessQualityDetail | null> {
  void businessId;
  void range;
  return null;
}

export async function getCallTrace(callId: string): Promise<VoiceCallTrace | null> {
  void callId;
  return null;
}

export async function listReleaseDeltas(): Promise<ReleaseDelta[]> {
  return [];
}

/** Score and Dropping marker for Businesses rows and Overview. */
export async function qualityBadges(): Promise<Record<string, QualityBadge>> {
  return {};
}
