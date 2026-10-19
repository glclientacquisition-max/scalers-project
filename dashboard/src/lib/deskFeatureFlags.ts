/** Desk + voice assistant-facts rollout flags. On only when env is exactly `on`. */

export function envFlagOn(value: string | undefined | null): boolean {
  return String(value || "").trim() === "on";
}

export function deskAttestServiceAreas(): boolean {
  return envFlagOn(process.env.DESK_ATTEST_SERVICE_AREAS);
}

export function factPaymentsV2Hash(): boolean {
  return envFlagOn(process.env.FACT_PAYMENTS_V2_HASH);
}

export function factSaveIsConfirm(): boolean {
  return envFlagOn(process.env.FACT_SAVE_IS_CONFIRM);
}

export function deskAssistantSayPage(): boolean {
  return envFlagOn(process.env.DESK_ASSISTANT_SAY_PAGE);
}

export function voiceFallbackByKind(): boolean {
  return envFlagOn(process.env.VOICE_FALLBACK_BY_KIND);
}

export function deskLookupPreview(): boolean {
  return envFlagOn(process.env.DESK_LOOKUP_PREVIEW);
}
