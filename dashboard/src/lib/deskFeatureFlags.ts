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

/**
 * Catalogue item states Paused and Not offered (the Status control on an item).
 * Off by default: until the KB writers and the Brain KB reader are live, an old
 * services save can force items back to active and calls would not honour the state.
 * Server side only; the knowledge page passes it down as statesEnabled.
 */
export function deskKbItemStates(): boolean {
  return envFlagOn(process.env.DESK_KB_ITEM_STATES);
}

export function voiceFallbackByKind(): boolean {
  return envFlagOn(process.env.VOICE_FALLBACK_BY_KIND);
}

export function deskLookupPreview(): boolean {
  return envFlagOn(process.env.DESK_LOOKUP_PREVIEW);
}

/** Subtle desk haptics and sheet easing. Server flag DESK_FEEL=on. */
export function deskFeelEnabled(): boolean {
  return envFlagOn(process.env.DESK_FEEL);
}

/** "Add many" also reads a photo of a price list or a website. Staging flag DESK_IMPORT_PHOTO=on. */
export function deskImportPhoto(): boolean {
  return envFlagOn(process.env.DESK_IMPORT_PHOTO);
}
