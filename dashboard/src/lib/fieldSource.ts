export const FIELD_SOURCES = [
  "owner",
  "seed",
  "import",
  "inferred",
  "call_suggested",
] as const;

export type FieldSource = (typeof FIELD_SOURCES)[number];

export function parseFieldSource(raw: unknown): FieldSource | null {
  const key = String(raw || "")
    .trim()
    .toLowerCase();
  return FIELD_SOURCES.find((source) => source === key) ?? null;
}
