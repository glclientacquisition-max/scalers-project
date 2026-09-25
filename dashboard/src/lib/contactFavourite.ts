const FAVOURITE_AT = "favourite_at";

function asMeta(
  raw: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return { ...raw };
}

/** ISO stamp when the owner starred this contact. Missing or junk is not a favourite. */
export function contactFavouriteAt(
  metadata?: Record<string, unknown> | null
): string | null {
  const iso = String(asMeta(metadata)[FAVOURITE_AT] || "").trim();
  if (!iso || !Number.isFinite(Date.parse(iso))) return null;
  return iso;
}

export function isContactFavourite(
  metadata?: Record<string, unknown> | null
): boolean {
  return Boolean(contactFavouriteAt(metadata));
}

/** Keep other metadata keys. Toggle only favourite_at. */
export function withContactFavourite(
  metadata: Record<string, unknown> | null | undefined,
  favourite: boolean,
  now = new Date()
): Record<string, unknown> {
  const next = asMeta(metadata);
  if (favourite) {
    next[FAVOURITE_AT] = contactFavouriteAt(next) || now.toISOString();
    return next;
  }
  delete next[FAVOURITE_AT];
  return next;
}
