import type { SupabaseClient } from "@supabase/supabase-js";
import { parseSummary } from "@/lib/supabase";
import {
  displayContactLastReason,
  pickCallOwnerCard,
  pickCallOwnerReason,
  pickCallOwnerWant,
} from "@/lib/callSummarySentence";

export type ContactRow = {
  id: string;
  created_at: string;
  updated_at: string;
  tenant_id: string;
  phone: string | null;
  name: string | null;
  notes: string | null;
  last_reason: string | null;
  metadata: Record<string, unknown> | null;
};

export type ContactListRow = ContactRow & {
  lastContactAt: string | null;
  lastReasonDisplay: string | null;
};

export type ContactTimelineEntry = {
  id: string;
  kind: "call" | "request" | "appointment";
  createdAt: string;
  headline: string;
  detail: string | null;
  callId: string | null;
  status: string | null;
  ownerReason?: string | null;
  ownerWant?: string | null;
  ownerCard?: {
    want: string | null;
    done: string | null;
    mood: string | null;
    next: string | null;
  } | null;
};

const CONTACT_SELECT =
  "id, created_at, updated_at, tenant_id, phone, name, notes, last_reason, metadata";

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

export type ContactSavedFilter = "all" | "saved" | "unsaved";

export function resolveContactSavedFilter(
  raw?: string | null
): ContactSavedFilter {
  const value = String(raw || "all").toLowerCase();
  if (value === "saved" || value === "unsaved") return value;
  return "all";
}

export function contactsHref(opts: {
  saved?: ContactSavedFilter;
  page?: number;
}): string {
  const q = new URLSearchParams();
  if (opts.saved && opts.saved !== "all") q.set("saved", opts.saved);
  if (opts.page && opts.page > 1) q.set("page", String(opts.page));
  const qs = q.toString();
  return qs ? `/contacts?${qs}` : "/contacts";
}

export async function loadContactsPage(
  client: SupabaseClient,
  tenantId: string,
  page: number,
  pageSize: number,
  saved: ContactSavedFilter = "all"
): Promise<{ rows: ContactListRow[]; total: number; error: string | null }> {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let listedQuery = client
    .from("contacts")
    .select(CONTACT_SELECT, { count: "exact" })
    .eq("tenant_id", tenantId)
    .order("updated_at", { ascending: false })
    .range(from, to);

  if (saved === "saved") {
    listedQuery = listedQuery.not("name", "is", null).neq("name", "");
  } else if (saved === "unsaved") {
    listedQuery = listedQuery.or("name.is.null,name.eq.");
  }

  const listed = await listedQuery;

  if (listed.error) {
    return { rows: [], total: 0, error: listed.error.message };
  }

  const contacts = (listed.data || []) as ContactRow[];
  const total = listed.count ?? contacts.length;
  if (contacts.length === 0) {
    return { rows: [], total, error: null };
  }

  const extras = await loadLastContactMap(
    client,
    tenantId,
    contacts
  );
  const rows = contacts.map((row) => {
    const latestCallReason = row.phone
      ? extras.reasonByPhone.get(row.phone) ?? null
      : null;
    return {
      ...row,
      lastContactAt:
        extras.byId.get(row.id) ||
        (row.phone ? extras.byPhone.get(row.phone) : null) ||
        row.updated_at,
      lastReasonDisplay: displayContactLastReason({
        name: row.name,
        phone: row.phone,
        lastReason: row.last_reason,
        latestCallReason,
      }),
    };
  });

  return { rows, total, error: null };
}

async function loadLastContactMap(
  client: SupabaseClient,
  tenantId: string,
  contacts: ContactRow[]
): Promise<{
  byId: Map<string, string | null>;
  byPhone: Map<string, string | null>;
  reasonByPhone: Map<string, string | null>;
}> {
  const ids = contacts.map((c) => c.id);
  const phones = contacts.map((c) => c.phone).filter((p): p is string => Boolean(p));

  const [callsRes, reqRes, reqPhoneRes, apptRes, apptPhoneRes] = await Promise.all([
    phones.length
      ? client
          .from("calls")
          .select("caller_number, created_at, summary")
          .eq("tenant_id", tenantId)
          .in("caller_number", phones)
          .order("created_at", { ascending: false })
          .limit(Math.max(phones.length * 8, 80))
      : Promise.resolve({ data: [], error: null }),
    ids.length
      ? client
          .from("service_requests")
          .select("contact_id, caller_phone, created_at")
          .eq("tenant_id", tenantId)
          .in("contact_id", ids)
      : Promise.resolve({ data: [], error: null }),
    phones.length
      ? client
          .from("service_requests")
          .select("contact_id, caller_phone, created_at")
          .eq("tenant_id", tenantId)
          .in("caller_phone", phones)
      : Promise.resolve({ data: [], error: null }),
    ids.length
      ? client
          .from("appointments")
          .select("contact_id, caller_phone, created_at")
          .eq("tenant_id", tenantId)
          .in("contact_id", ids)
      : Promise.resolve({ data: [], error: null }),
    phones.length
      ? client
          .from("appointments")
          .select("contact_id, caller_phone, created_at")
          .eq("tenant_id", tenantId)
          .in("caller_phone", phones)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const byPhone = new Map<string, string | null>();
  const byId = new Map<string, string | null>();
  const reasonByPhone = new Map<string, string | null>();

  for (const row of callsRes.data || []) {
    const phone = String(row.caller_number || "");
    if (!phone) continue;
    byPhone.set(phone, maxIso(byPhone.get(phone) || null, row.created_at));
    if (!reasonByPhone.has(phone)) {
      reasonByPhone.set(
        phone,
        pickCallOwnerWant(parseSummary(row.summary as string | null))
      );
    }
  }
  for (const row of [
    ...(reqRes.data || []),
    ...(reqPhoneRes.data || []),
    ...(apptRes.data || []),
    ...(apptPhoneRes.data || []),
  ]) {
    const at = row.created_at as string;
    if (row.contact_id) {
      byId.set(row.contact_id, maxIso(byId.get(row.contact_id) || null, at));
    }
    if (row.caller_phone) {
      byPhone.set(row.caller_phone, maxIso(byPhone.get(row.caller_phone) || null, at));
    }
  }

  return { byId, byPhone, reasonByPhone };
}

export async function loadContactById(
  client: SupabaseClient,
  tenantId: string,
  id: string
): Promise<{ contact: ContactRow | null; error: string | null }> {
  const { data, error } = await client
    .from("contacts")
    .select(CONTACT_SELECT)
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) return { contact: null, error: error.message };
  return { contact: (data as ContactRow) || null, error: null };
}

export async function loadContactTimeline(
  client: SupabaseClient,
  tenantId: string,
  contact: ContactRow
): Promise<ContactTimelineEntry[]> {
  const phone = contact.phone;
  const [callsRes, reqById, reqByPhone, apptById, apptByPhone] = await Promise.all([
    phone
      ? client
          .from("calls")
          .select(
            "id, created_at, caller_number, status, summary, primary_intent, resolution"
          )
          .eq("tenant_id", tenantId)
          .eq("caller_number", phone)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    client
      .from("service_requests")
      .select(
        "id, created_at, request_type, status, item, notes, call_id, contact_id, caller_phone"
      )
      .eq("tenant_id", tenantId)
      .eq("contact_id", contact.id)
      .order("created_at", { ascending: false }),
    phone
      ? client
          .from("service_requests")
          .select(
            "id, created_at, request_type, status, item, notes, call_id, contact_id, caller_phone"
          )
          .eq("tenant_id", tenantId)
          .eq("caller_phone", phone)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    client
      .from("appointments")
      .select(
        "id, created_at, service_name, status, when_text, notes, call_id, contact_id, caller_phone"
      )
      .eq("tenant_id", tenantId)
      .eq("contact_id", contact.id)
      .order("created_at", { ascending: false }),
    phone
      ? client
          .from("appointments")
          .select(
            "id, created_at, service_name, status, when_text, notes, call_id, contact_id, caller_phone"
          )
          .eq("tenant_id", tenantId)
          .eq("caller_phone", phone)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);

  const entries: ContactTimelineEntry[] = [];
  const seenReq = new Set<string>();
  const seenAppt = new Set<string>();

  for (const row of callsRes.data || []) {
    const meta = parseSummary(
      typeof row.summary === "string" ? row.summary : null
    );
    const ownerWant = pickCallOwnerWant(meta);
    const ownerReason = pickCallOwnerReason(meta);
    entries.push({
      id: `call:${row.id}`,
      kind: "call",
      createdAt: row.created_at,
      headline:
        displayContactLastReason({
          name: contact.name,
          phone: contact.phone,
          lastReason: null,
          latestCallReason: ownerWant || ownerReason,
        }) ||
        ownerWant ||
        ownerReason ||
        row.primary_intent ||
        "Call",
      detail: row.status || null,
      callId: row.id,
      status: row.status || null,
      ownerReason,
      ownerWant,
      ownerCard: pickCallOwnerCard(meta),
    });
  }

  for (const row of [...(reqById.data || []), ...(reqByPhone.data || [])]) {
    if (seenReq.has(row.id)) continue;
    seenReq.add(row.id);
    entries.push({
      id: `request:${row.id}`,
      kind: "request",
      createdAt: row.created_at,
      headline: row.item || row.request_type || "Request",
      detail: row.status || null,
      callId: row.call_id || null,
      status: row.status || null,
    });
  }

  for (const row of [...(apptById.data || []), ...(apptByPhone.data || [])]) {
    if (seenAppt.has(row.id)) continue;
    seenAppt.add(row.id);
    entries.push({
      id: `appointment:${row.id}`,
      kind: "appointment",
      createdAt: row.created_at,
      headline: row.service_name || "Visit",
      detail: row.when_text || row.status || null,
      callId: row.call_id || null,
      status: row.status || null,
    });
  }

  entries.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return entries;
}
