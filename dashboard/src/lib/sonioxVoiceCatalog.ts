import { getSupabaseAdmin } from "@/lib/supabase";
import fallbackCatalog from "@/data/soniox-voices.json";

export type CuratedSonioxVoice = {
  id: string;
  /** Admin-written hint shown to owners. */
  description?: string;
  default?: boolean;
  sortOrder?: number;
  active?: boolean;
};

export type PlatformSonioxVoiceRow = {
  id: string;
  description: string;
  is_default: boolean;
  is_active: boolean;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
};

function normalizeRows(
  rows: Array<{
    id?: string;
    description?: string;
    default?: boolean;
    is_default?: boolean;
    sortOrder?: number;
    sort_order?: number;
    active?: boolean;
    is_active?: boolean;
  }>
): CuratedSonioxVoice[] {
  return rows
    .map((v) => ({
      id: String(v?.id || "").trim(),
      description: String(v?.description || "").trim(),
      default: Boolean(v?.default ?? v?.is_default),
      sortOrder: Number(v?.sortOrder ?? v?.sort_order ?? 100),
      active: v?.active !== false && v?.is_active !== false,
    }))
    .filter((v) => v.id && v.active)
    .sort(
      (a, b) =>
        (a.sortOrder || 100) - (b.sortOrder || 100) || a.id.localeCompare(b.id)
    );
}

function fallbackVoices(): CuratedSonioxVoice[] {
  return normalizeRows(
    Array.isArray(fallbackCatalog?.voices) ? fallbackCatalog.voices : []
  );
}

/** Active curated voices for owner pickers (DB first, JSON fallback). */
export async function listCuratedSonioxVoices(): Promise<CuratedSonioxVoice[]> {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("platform_soniox_voices")
      .select("id, description, is_default, is_active, sort_order")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    if (error) return fallbackVoices();
    const rows = normalizeRows(data || []);
    return rows.length ? rows : fallbackVoices();
  } catch {
    return fallbackVoices();
  }
}

/** Sync helper for client components seeded from server props / JSON fallback. */
export function listCuratedSonioxVoicesSync(): CuratedSonioxVoice[] {
  return fallbackVoices();
}

export async function getDefaultSonioxVoiceId(): Promise<string | null> {
  const voices = await listCuratedSonioxVoices();
  const marked = voices.find((v) => v.default);
  return marked?.id || voices[0]?.id || null;
}

export function getDefaultSonioxVoiceIdSync(): string | null {
  const voices = listCuratedSonioxVoicesSync();
  const marked = voices.find((v) => v.default);
  return marked?.id || voices[0]?.id || null;
}

export async function isAllowedSonioxVoiceId(
  voiceId: string | null | undefined
): Promise<boolean> {
  const id = String(voiceId || "").trim();
  if (!id) return false;
  const voices = await listCuratedSonioxVoices();
  return voices.some((v) => v.id === id);
}

/** Normalize tenant save / form value to an allowed id or null (platform default). */
export async function parseSonioxVoiceId(
  raw: FormDataEntryValue | string | null | undefined
): Promise<string | null> {
  const id = String(raw || "").trim();
  if (!id) return null;
  return (await isAllowedSonioxVoiceId(id)) ? id : null;
}

export function parseSonioxVoiceLabel(
  raw: FormDataEntryValue | string | null | undefined
): string | null {
  const label = String(raw || "").trim();
  if (!label) return null;
  return label.slice(0, 40);
}

export function displaySonioxVoiceLabel(
  ownerLabel: string | null | undefined,
  voiceId: string | null | undefined,
  catalog?: CuratedSonioxVoice[]
): string {
  const custom = String(ownerLabel || "").trim();
  if (custom) return custom;
  const id = String(voiceId || "").trim();
  const voices = catalog || listCuratedSonioxVoicesSync();
  const match = voices.find((v) => v.id === id);
  if (match?.description) return match.description;
  return "Default phone voice";
}

/** Super Admin: list all platform voices including inactive. */
export async function listPlatformSonioxVoicesAdmin(): Promise<
  PlatformSonioxVoiceRow[]
> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("platform_soniox_voices")
    .select("id, description, is_default, is_active, sort_order, created_at, updated_at")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data as PlatformSonioxVoiceRow[]) || [];
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isSonioxVoiceUuid(value: string): boolean {
  return UUID_RE.test(String(value || "").trim());
}

export async function upsertPlatformSonioxVoice(input: {
  id: string;
  description?: string;
  is_default?: boolean;
  is_active?: boolean;
  sort_order?: number;
}): Promise<PlatformSonioxVoiceRow> {
  const id = String(input.id || "").trim();
  if (!isSonioxVoiceUuid(id)) {
    throw new Error("Voice id must be a Soniox UUID.");
  }
  const description = String(input.description || "").trim().slice(0, 160);
  const sort_order =
    input.sort_order != null && Number.isFinite(Number(input.sort_order))
      ? Math.max(0, Math.min(9999, Number(input.sort_order)))
      : 100;

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("platform_soniox_voices")
    .upsert(
      {
        id,
        description,
        is_default: Boolean(input.is_default),
        is_active: input.is_active !== false,
        sort_order,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    )
    .select("id, description, is_default, is_active, sort_order, created_at, updated_at")
    .single();

  if (error) throw error;
  return data as PlatformSonioxVoiceRow;
}

export async function setPlatformSonioxVoiceActive(
  id: string,
  is_active: boolean
): Promise<void> {
  const voiceId = String(id || "").trim();
  if (!isSonioxVoiceUuid(voiceId)) throw new Error("Invalid voice id.");
  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from("platform_soniox_voices")
    .update({ is_active, updated_at: new Date().toISOString() })
    .eq("id", voiceId);
  if (error) throw error;
}

export async function setPlatformSonioxVoiceDefault(id: string): Promise<void> {
  const voiceId = String(id || "").trim();
  if (!isSonioxVoiceUuid(voiceId)) throw new Error("Invalid voice id.");
  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from("platform_soniox_voices")
    .update({
      is_default: true,
      is_active: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", voiceId);
  if (error) throw error;
}

export async function deletePlatformSonioxVoice(id: string): Promise<void> {
  const voiceId = String(id || "").trim();
  if (!isSonioxVoiceUuid(voiceId)) throw new Error("Invalid voice id.");
  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from("platform_soniox_voices")
    .delete()
    .eq("id", voiceId);
  if (error) throw error;
}
