import "server-only";
import { createWorkspaceDataClient } from "@/lib/tenant";
import { parseCallSetup, type CallSetup } from "@/lib/callSetupStore";
import { TEST_WINDOW_MINUTES, matchTestCall, suggestTestPhone, type CallSetupActivity } from "@/lib/callSetupStatus";

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
 * Stored picks plus the call times the status needs (tenant_id, created_at index):
 * the first call after opening, the latest call, and calls in the 30-minute test
 * window (matched to test_from in code, so 07/254/+254 forms all match).
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

  type Row = { created_at: string; caller_number?: string | null };
  const none = Promise.resolve({ data: [] as Row[], error: null });
  const calls = (cols = "created_at") => ws.client.from("calls").select(cols).eq("tenant_id", tenantId);
  const start = setup.test_started_at ? Date.parse(setup.test_started_at) : NaN;
  const [first, last, window] = await Promise.all([
    setup.opened_at && !setup.tested_at
      ? calls().gt("created_at", setup.opened_at).order("created_at", { ascending: true }).limit(1)
      : none,
    calls().order("created_at", { ascending: false }).limit(1),
    setup.test_from && !Number.isNaN(start) && !setup.tested_at
      ? calls("created_at, caller_number")
          .gte("created_at", new Date(start).toISOString())
          .lte("created_at", new Date(start + TEST_WINDOW_MINUTES * 60_000).toISOString())
          .order("created_at", { ascending: true })
          .limit(50)
      : none,
  ]);
  const rows = (res: { data: unknown; error: unknown }): Row[] =>
    !res.error && Array.isArray(res.data) ? (res.data as Row[]) : [];
  const at = (res: { data: unknown; error: unknown }) => rows(res)[0]?.created_at ?? null;
  const testMatchAt = matchTestCall(
    setup,
    rows(window).map((r) => ({ caller_number: r.caller_number ?? null, created_at: String(r.created_at) }))
  );
  return {
    supported: true,
    setup,
    activity: { testMatchAt, firstCallAfterOpenAt: at(first), lastCallAt: at(last) },
  };
}

/** A teammate's number for "Which phone will you test from?" (team list only), or null. */
export async function loadTestPhoneSuggestion(
  tenantId: string,
  exclude: ReadonlyArray<string | null | undefined>
): Promise<string | null> {
  const ws = await createWorkspaceDataClient();
  if (!ws || !tenantId) return null;
  const { data, error } = await ws.client.from("tenants").select("team_directory").eq("id", tenantId).maybeSingle();
  if (error) return null;
  const team = (data as { team_directory?: unknown } | null)?.team_directory;
  return suggestTestPhone(Array.isArray(team) ? (team as Array<{ phone?: string | null }>) : [], exclude);
}
