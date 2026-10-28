import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase";
import { brainMode, deskKbGate, isKbLive } from "@/lib/kbLive.server";
import { takeMessagesState, type TakeMessagesState } from "@/lib/takeMessages";

export type BrainSettings = {
  /** null = not available here: the KB gate is off (the switch would do nothing) or SQL .4 is not applied. */
  takeMessages: TakeMessagesState | null;
  /** tenants.kb_catalogue_complete_at. undefined = column missing (hide the mark); null = not marked. */
  catalogueCompleteAt: string | null | undefined;
};

const COLS = "brain_mode, brain_mode_source, brain_mode_set_at, kb_catalogue_complete_at";

/**
 * Read the two owner marks for one business. Service role: call only after the member check
 * (getCurrentTenant / memberCan) in the page or action. A read error hides both controls.
 */
export async function loadBrainSettings(tenantId: string): Promise<BrainSettings> {
  const r = await getSupabaseAdmin().from("tenants").select(COLS).eq("id", tenantId).maybeSingle();
  if (r.error || !r.data) return { takeMessages: null, catalogueCompleteAt: undefined };
  const row = r.data as { brain_mode?: string | null; brain_mode_source?: string | null; brain_mode_set_at?: string | null; kb_catalogue_complete_at?: string | null };
  const gateOff = isKbLive(null, { gate: deskKbGate() }).reason === "gate_off";
  return {
    takeMessages: gateOff ? null : takeMessagesState(brainMode(row), row.brain_mode_set_at ?? null),
    catalogueCompleteAt: row.kb_catalogue_complete_at ?? null,
  };
}
