import "server-only";
import { createWorkspaceDataClient } from "@/lib/tenant";
import { parseCallSetup, type CallSetup } from "@/lib/callSetupStore";
import type { CallSetupActivity } from "@/lib/callSetupStatus";

export type CallSetupState = {
  /** False until tenants.call_setup exists (prod before its migration): the UI falls back to browser storage. */
  supported: boolean;
  setup: CallSetup | null;
  activity: CallSetupActivity | null;
};

const UNSUPPORTED: CallSetupState = { supported: false, setup: null, activity: null };

export function isMissingCallSetup(message: string | null | undefined): boolean {
  return /call_setup|save_call_setup|schema cache|does not exist/i.test(String(message || ""));
}

/**
 * Stored picks plus the two call times auto-detect and the nudge need.
 * Two small reads on calls (tenant_id, created_at index), only once the step was opened.
 */
export async function loadCallSetupState(tenantId: string): Promise<CallSetupState> {
  const ws = await createWorkspaceDataClient();
  if (!ws || !tenantId) return UNSUPPORTED;
  const { data, error } = await ws.client.from("tenants").select("call_setup").eq("id", tenantId).maybeSingle();
  if (error) return UNSUPPORTED;
  const raw = (data as { call_setup?: unknown } | null)?.call_setup;
  if (raw == null) return { supported: true, setup: null, activity: null };
  const setup = parseCallSetup(raw);
  if (!setup.opened_at && !setup.tested_at) return { supported: true, setup, activity: null };

  const calls = () => ws.client.from("calls").select("created_at").eq("tenant_id", tenantId);
  const [first, last] = await Promise.all([
    setup.opened_at && !setup.tested_at
      ? calls().gt("created_at", setup.opened_at).order("created_at", { ascending: true }).limit(1)
      : Promise.resolve({ data: [] as Array<{ created_at: string }>, error: null }),
    calls().order("created_at", { ascending: false }).limit(1),
  ]);
  const at = (res: { data: unknown; error: unknown }) =>
    !res.error && Array.isArray(res.data) && res.data[0] ? String((res.data[0] as { created_at: string }).created_at) : null;
  return { supported: true, setup, activity: { firstCallAfterOpenAt: at(first), lastCallAt: at(last) } };
}
