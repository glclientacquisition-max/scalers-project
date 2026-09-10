import { type CallRow } from "@/lib/supabase";
import { toLead } from "@/lib/callsTriage";
import {
  assembleInboxItems,
  attachContactIds,
  type InboxHold,
  type InboxItem,
  type InboxJob,
} from "@/lib/inboxPurpose";
import { eatWeekRangeIso } from "@/lib/visitCalendar";
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
  "id, created_at, service_name, status, when_text, window_start, window_end, address_landmark, notes, caller_name, caller_phone, call_id";

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

  const [holdsRes, jobsFirst] = await Promise.all([
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

  let jobs: InboxJob[] = [];
  if (jobsFirst.error && /window_start|window_end|column/i.test(jobsFirst.error.message)) {
    const retry = await client
      .from("appointments")
      .select(
        "id, created_at, service_name, status, when_text, address_landmark, notes, caller_name, caller_phone, call_id"
      )
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(INBOX_WINDOW);
    jobs = (retry.error ? [] : retry.data || []) as InboxJob[];
  } else {
    jobs = (jobsFirst.error ? [] : jobsFirst.data || []) as InboxJob[];
  }

  const holds = (holdsRes.error ? [] : holdsRes.data || []) as InboxHold[];
  const leads = (data || []).map(toLead);
  const items = assembleInboxItems({ leads, holds, jobs, vertical });

  return {
    items: await attachInboxPeople(client, tenantId, items),
    error: null,
  };
}

async function attachInboxPeople(
  client: SupabaseClient,
  tenantId: string,
  items: InboxItem[]
): Promise<InboxItem[]> {
  const phones = [
    ...new Set(
      items
        .map((item) => item.callerPhone)
        .filter((phone): phone is string => Boolean(phone && phone !== "unknown"))
    ),
  ];
  if (!phones.length) return items;
  const people = await client
    .from("contacts")
    .select("id, phone, name")
    .eq("tenant_id", tenantId)
    .in("phone", phones);
  if (people.error) return items;
  return attachContactIds(items, people.data || []);
}

/** Appointments whose window_start falls in the visible EAT Monday–Sunday. */
export async function loadWeekJobItems(
  client: SupabaseClient,
  tenantId: string,
  monday: string,
  vertical?: string | null
): Promise<InboxItem[]> {
  const range = eatWeekRangeIso(monday);
  if (!range) return [];

  const ranged = await client
    .from("appointments")
    .select(JOB_SELECT)
    .eq("tenant_id", tenantId)
    .gte("window_start", range.from)
    .lt("window_start", range.to)
    .order("window_start", { ascending: true })
    .limit(200);

  let jobs: InboxJob[] = [];
  if (ranged.error && /window_start|window_end|column/i.test(ranged.error.message)) {
    const retry = await client
      .from("appointments")
      .select(
        "id, created_at, service_name, status, when_text, address_landmark, notes, caller_name, caller_phone, call_id"
      )
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(INBOX_WINDOW);
    jobs = (retry.error ? [] : retry.data || []) as InboxJob[];
  } else {
    jobs = (ranged.error ? [] : ranged.data || []) as InboxJob[];
    const loose = await client
      .from("appointments")
      .select(JOB_SELECT)
      .eq("tenant_id", tenantId)
      .is("window_start", null)
      .order("created_at", { ascending: false })
      .limit(80);
    if (!loose.error && loose.data?.length) {
      const seen = new Set(jobs.map((row) => row.id));
      for (const row of loose.data as InboxJob[]) {
        if (!seen.has(row.id)) {
          jobs.push(row);
          seen.add(row.id);
        }
      }
    }
  }

  const items = assembleInboxItems({ leads: [], holds: [], jobs, vertical });
  return attachInboxPeople(client, tenantId, items);
}
