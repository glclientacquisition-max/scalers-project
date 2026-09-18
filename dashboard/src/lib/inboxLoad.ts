import { type CallRow } from "@/lib/supabase";
import { toLead } from "@/lib/callsTriage";
import { storedPhoneCandidates } from "@/lib/handoffMode";
import {
  assembleInboxItems,
  attachContactIds,
  type InboxHold,
  type InboxItem,
  type InboxJob,
} from "@/lib/inboxPurpose";
import type { SupabaseClient } from "@supabase/supabase-js";

const CALL_SELECT =
  "id, created_at, tenant_id, caller_number, sautikit_call_sid, status, duration_seconds, recording_url, summary, sentiment, lead_status, resolution, primary_intent, resolution_note, inbox_read_at, inbox_muted, inbox_pinned_at, inbox_assignee, inbox_labels, inbox_snoozed_until";
const CALL_SELECT_LEGACY =
  "id, created_at, tenant_id, caller_number, sautikit_call_sid, status, duration_seconds, recording_url, summary, sentiment";
const CALL_SELECT_LEAD =
  "id, created_at, tenant_id, caller_number, sautikit_call_sid, status, duration_seconds, recording_url, summary, sentiment, lead_status";

const HOLD_SELECT =
  "id, created_at, request_type, status, item, quantity, when_text, notes, caller_name, caller_phone, call_id";
const JOB_SELECT =
  "id, created_at, service_name, status, when_text, window_start, window_end, address_landmark, notes, caller_name, caller_phone, call_id";
const JOB_SELECT_LEGACY =
  "id, created_at, service_name, status, when_text, address_landmark, notes, caller_name, caller_phone, call_id";

/** Closed/history tape for calls plus recent fulfilled/cancelled work. Open queues do not use this cap. */
export const INBOX_WINDOW = 150;

/**
 * Safety stop for unbounded open-work pagination. Indexes already exist:
 * `service_requests_tenant_status_idx`, `appointments_tenant_status_idx`.
 * Hitting this cap means Needs you may be incomplete; we surface partialError.
 */
export const OPEN_WORK_SAFETY_CAP = 10_000;
const OPEN_WORK_PAGE = 1_000;

export const OPEN_HOLD_STATUS = "open";
export const OPEN_JOB_STATUSES = ["requested", "confirmed"] as const;
export const TAPE_HOLD_STATUSES = ["fulfilled", "cancelled"] as const;
export const TAPE_JOB_STATUSES = ["cancelled", "done"] as const;

export function mergeOpenAndTapeRows<T extends { id: string }>(
  open: T[],
  tape: T[]
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of [...open, ...tape]) {
    if (!row?.id || seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

export function inboxContactPhoneQueryValues(phones: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const phone of phones) {
    for (const candidate of storedPhoneCandidates(phone)) {
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      out.push(candidate);
    }
  }
  return out;
}

type PageResult<T> = {
  rows: T[];
  error: string | null;
  truncated: boolean;
};

async function fetchPagedOpenWork<T>(
  page: (from: number, to: number) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>
): Promise<PageResult<T>> {
  const rows: T[] = [];
  let from = 0;
  while (from < OPEN_WORK_SAFETY_CAP) {
    const to = Math.min(from + OPEN_WORK_PAGE - 1, OPEN_WORK_SAFETY_CAP - 1);
    const res = await page(from, to);
    if (res.error) {
      return { rows, error: res.error.message, truncated: false };
    }
    const batch = res.data || [];
    rows.push(...batch);
    if (batch.length < OPEN_WORK_PAGE) {
      return { rows, error: null, truncated: false };
    }
    from += OPEN_WORK_PAGE;
  }
  return { rows, error: null, truncated: rows.length >= OPEN_WORK_SAFETY_CAP };
}

async function fetchCallsTape(
  client: SupabaseClient,
  tenantId: string
): Promise<{ data: CallRow[] | null; error: { message: string } | null }> {
  const first = await client
    .from("calls")
    .select(CALL_SELECT)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(INBOX_WINDOW);

  let data = first.data as CallRow[] | null;
  let error = first.error;

  if (error && /inbox_read_at|inbox_muted|inbox_pinned_at|inbox_assignee|inbox_labels|inbox_snoozed_until|column/i.test(error.message)) {
    const retry = await client
      .from("calls")
      .select(
        "id, created_at, tenant_id, caller_number, sautikit_call_sid, status, duration_seconds, recording_url, summary, sentiment, lead_status, resolution, primary_intent, resolution_note"
      )
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(INBOX_WINDOW);
    data = retry.data as CallRow[] | null;
    error = retry.error;
  }

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

  return { data, error };
}

export async function loadInboxItems(
  client: SupabaseClient,
  tenantId: string,
  vertical?: string | null
): Promise<{
  items: InboxItem[];
  callsTruncated: boolean;
  error: string | null;
  partialError: string | null;
}> {
  const callsRes = await fetchCallsTape(client, tenantId);
  if (callsRes.error) {
    return {
      items: [],
      callsTruncated: false,
      error: callsRes.error.message,
      partialError: null,
    };
  }

  const [openHoldsRes, tapeHoldsRes, openJobsFirst, tapeJobsFirst] = await Promise.all([
    fetchPagedOpenWork<InboxHold>((from, to) =>
      client
        .from("service_requests")
        .select(HOLD_SELECT)
        .eq("tenant_id", tenantId)
        .eq("status", OPEN_HOLD_STATUS)
        .order("created_at", { ascending: false })
        .range(from, to)
    ),
    client
      .from("service_requests")
      .select(HOLD_SELECT)
      .eq("tenant_id", tenantId)
      .in("status", [...TAPE_HOLD_STATUSES])
      .order("created_at", { ascending: false })
      .limit(INBOX_WINDOW),
    fetchPagedOpenWork<InboxJob>((from, to) =>
      client
        .from("appointments")
        .select(JOB_SELECT)
        .eq("tenant_id", tenantId)
        .in("status", [...OPEN_JOB_STATUSES])
        .order("created_at", { ascending: false })
        .range(from, to)
    ),
    client
      .from("appointments")
      .select(JOB_SELECT)
      .eq("tenant_id", tenantId)
      .in("status", [...TAPE_JOB_STATUSES])
      .order("created_at", { ascending: false })
      .limit(INBOX_WINDOW),
  ]);

  let openJobs = openJobsFirst;
  let tapeJobs = tapeJobsFirst;
  if (openJobs.error && /window_start|window_end|column/i.test(openJobs.error)) {
    openJobs = await fetchPagedOpenWork<InboxJob>((from, to) =>
      client
        .from("appointments")
        .select(JOB_SELECT_LEGACY)
        .eq("tenant_id", tenantId)
        .in("status", [...OPEN_JOB_STATUSES])
        .order("created_at", { ascending: false })
        .range(from, to)
    );
    tapeJobs = (await client
      .from("appointments")
      .select(JOB_SELECT_LEGACY)
      .eq("tenant_id", tenantId)
      .in("status", [...TAPE_JOB_STATUSES])
      .order("created_at", { ascending: false })
      .limit(INBOX_WINDOW)) as typeof tapeJobsFirst;
  }

  const holdsFailed = Boolean(openHoldsRes.error);
  const jobsFailed = Boolean(openJobs.error);
  const tapeFailed = Boolean(tapeHoldsRes.error || tapeJobs.error);
  const openWorkTruncated = Boolean(openHoldsRes.truncated || openJobs.truncated);
  const holds = holdsFailed
    ? []
    : mergeOpenAndTapeRows(
        openHoldsRes.rows,
        tapeHoldsRes.error ? [] : ((tapeHoldsRes.data || []) as InboxHold[])
      );
  const jobs = jobsFailed
    ? []
    : mergeOpenAndTapeRows(
        openJobs.rows,
        tapeJobs.error ? [] : ((tapeJobs.data || []) as InboxJob[])
      );
  const leads = (callsRes.data || []).map(toLead);
  const items = assembleInboxItems({ leads, holds, jobs, vertical });

  const phones = inboxContactPhoneQueryValues(
    items
      .map((item) => item.callerPhone)
      .filter((phone): phone is string => Boolean(phone && phone !== "unknown"))
  );
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

  const openWorkIncomplete = holdsFailed || jobsFailed || openWorkTruncated;

  return {
    items: withPeople,
    // Tape only. Open holds/visits are fetched separately and must not vanish.
    callsTruncated: (callsRes.data || []).length >= INBOX_WINDOW,
    error: null,
    partialError:
      openWorkIncomplete || tapeFailed
        ? "Could not load some inbox rows."
        : null,
  };
}
