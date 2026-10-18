import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranscriptRow } from "@/lib/supabase";
import { isMissingSeqColumn, sortTranscriptTurns } from "@/lib/transcriptOrder";

const COLS = "id, created_at, call_id, speaker, text_content, latency_ms";

/** Turns for one call in spoken order. Reads seq when Voice has added it; works without it. */
export async function loadTranscriptTurns(
  client: SupabaseClient,
  callId: string
): Promise<{ turns: TranscriptRow[]; error: { message: string } | null }> {
  type Res = { data: unknown[] | null; error: { message: string; code?: string } | null };
  let res: Res = await client
    .from("transcripts")
    .select(`${COLS}, seq`)
    .eq("call_id", callId)
    .order("created_at", { ascending: true });
  if (res.error && isMissingSeqColumn(res.error)) {
    res = await client
      .from("transcripts")
      .select(COLS)
      .eq("call_id", callId)
      .order("created_at", { ascending: true });
  }
  if (res.error) return { turns: [], error: { message: res.error.message } };
  return { turns: sortTranscriptTurns((res.data || []) as TranscriptRow[]), error: null };
}
