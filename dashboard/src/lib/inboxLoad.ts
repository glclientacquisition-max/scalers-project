import { type CallRow } from "@/lib/supabase";
import { toLead } from "@/lib/callsTriage";
import {
  assembleInboxItems,
  attachContactIds,
  type InboxHold,
  type InboxItem,
  type InboxJob,
} from "@/lib/inboxPurpose";
import type { SupabaseClient } from "@supabase/supabase-js";

const CALL_SELECT =
  "id, created_at, tenant_id, caller_number, sautikit_call_sid, status, duration_seconds, recording_url, summary, sentiment, lead_status, resolution, primary_intent, resolution_note";
const CALL_SELECT_LEGACY =
  "id, created_at, tenant_id, caller_number, sautikit_call_sid, status, duration_seconds, recording_url, summary, sentiment";
const CALL_SELECT_LEAD =
  "id, created_at, tenant_id, caller_number, sautikit_call_sid, status, duration_seconds, recording_url, summary, sentiment, lead_status";

const HOLD_SELECT =
  "id, created_at, request_type, status, item, quantity, when_text, notes, caller_name, caller_phone, call_id";
const JOB_SELECT =
  "id, created_at, service_name, status, when_text, address_landmark, notes, caller_name, caller_phone, call_id";

export const INBOX_WINDOW = 150;

export async function loadInboxItems(
  client: SupabaseClient,
  tenantId: string,
  vertical?: string | null
): Promise<{ items: InboxItem[]; error: string | null }> {
  const first = await client
    .from("calls")
    .select(CALL_SELECT)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(INBOX_WINDOW);

  let data = first.data as CallRow[] | null;
  let error = first.error;

  if (error && /resolution|primary_intent|resolution_note|column/i.test(error.message)) {
    const retry = await client
      .from("calls")
      .select(CALL_SELECT_LEAD)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(INBOX_WINDOW);
    data = retry.data as CallRow[] | null;
    error = retry.error;
  }

  if (error && /lead_status|column/i.test(error.message)) {
    const retry = await client
      .from("calls")
      .select(CALL_SELECT_LEGACY)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(INBOX_WINDOW);
    data = retry.data as CallRow[] | null;
    error = retry.error;
  }

  if (error) {
    return { items: [], error: error.message };
  }

  const [holdsRes, jobsRes] = await Promise.all([
    client
      .from("service_requests")
      .select(HOLD_SELECT)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(INBOX_WINDOW),
    client
      .from("appointments")
      .select(JOB_SELECT)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(INBOX_WINDOW),
  ]);

  const holds = (holdsRes.error ? [] : holdsRes.data || []) as InboxHold[];
  const jobs = (jobsRes.error ? [] : jobsRes.data || []) as InboxJob[];
  const leads = (data || []).map(toLead);
  const items = assembleInboxItems({ leads, holds, jobs, vertical });

  const phones = [
    ...new Set(
      items
        .map((item) => item.callerPhone)
        .filter((phone): phone is string => Boolean(phone && phone !== "unknown"))
    ),
  ];
  let withPeople = items;
  if (phones.length) {
    const people = await client
      .from("contacts")
      .select("id, phone, name")
      .eq("tenant_id", tenantId)
      .in("phone", phones);
    if (!people.error) {
      withPeople = attachContactIds(items, people.data || []);
    }
  }

  return {
    items: withPeople,
    error: null,
  };
}
