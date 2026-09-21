import type { SupabaseClient } from "@supabase/supabase-js";
import { formatCallWhenRelative, sanitizeSearchQuery, toLead } from "@/lib/callsTriage";
import { parseCallResolution, parseLeadStatus, parseSummary } from "@/lib/supabase";
import { storedPhoneCandidates } from "@/lib/handoffMode";
import {
  displayContactLastReason,
  pickCallOwnerCard,
  pickCallOwnerReason,
  pickCallOwnerWant,
} from "@/lib/callSummarySentence";
import {
  contactHistoryEntries,
  type ContactCallMeta,
  type ContactTimelineEntry,
} from "@/lib/contactPersonFile";
import type { InboxHold, InboxJob } from "@/lib/inboxPurpose";

export type { ContactTimelineEntry } from "@/lib/contactPersonFile";

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

const CONTACT_SELECT =
  "id, created_at, updated_at, tenant_id, phone, name, notes, last_reason, metadata";

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

/** Newest call or work row. Do not let an older visit created_at beat a later call. */
export function pickLastContactAt(
  byPhone: string | null | undefined,
  byContactId: string | null | undefined,
  updatedAt: string | null | undefined
): string | null {
  return maxIso(byPhone || null, byContactId || null) || updatedAt || null;
}

export type ContactSavedFilter = "all" | "saved" | "unsaved" | "recent";
export type ContactSort = "recent" | "name";

export function resolveContactSavedFilter(
  raw?: string | null
): ContactSavedFilter {
  const value = String(raw || "all").toLowerCase();
  if (value === "saved" || value === "unsaved" || value === "recent") return value;
  return "all";
}

export function resolveContactSort(raw?: string | null): ContactSort {
  return String(raw || "").toLowerCase() === "name" ? "name" : "recent";
}

export function contactsHref(opts: {
  saved?: ContactSavedFilter;
  sort?: ContactSort;
  q?: string;
  page?: number;
}): string {
  const q = new URLSearchParams();
  if (opts.saved && opts.saved !== "all") q.set("saved", opts.saved);
  if (opts.sort && opts.sort !== "recent") q.set("sort", opts.sort);
  const query = sanitizeSearchQuery(opts.q);
  if (query) q.set("q", query);
  if (opts.page && opts.page > 1) q.set("page", String(opts.page));
  const qs = q.toString();
  return qs ? `/contacts?${qs}` : "/contacts";
}

export type ContactsListReturn = {
  saved?: ContactSavedFilter;
  sort?: ContactSort;
  q?: string;
  page?: number;
};

/** Open a contact file while keeping the list pile for Back. */
export function contactProfileHref(
  id: string,
  opts: ContactsListReturn = {}
): string {
  const q = new URLSearchParams();
  q.set("from", "contacts");
  if (opts.saved && opts.saved !== "all") q.set("saved", opts.saved);
  if (opts.sort && opts.sort !== "recent") q.set("sort", opts.sort);
  const query = sanitizeSearchQuery(opts.q);
  if (query) q.set("q", query);
  if (opts.page && opts.page > 1) q.set("page", String(opts.page));
  return `/contacts/${id}?${q.toString()}`;
}

/** Restore `/contacts` from a profile opened on the list. Inbox/call `from` values stay off this path. */
export function contactsReturnHref(sp: {
  from?: string;
  saved?: string;
  sort?: string;
  q?: string;
  page?: string;
}): string {
  const from = String(sp.from || "contacts");
  if (from !== "contacts") return "/contacts";
  return contactsHref({
    saved: resolveContactSavedFilter(sp.saved),
    sort: resolveContactSort(sp.sort),
    q: sp.q,
    page: Math.max(1, Number.parseInt(String(sp.page || "1"), 10) || 1),
  });
}

export function isUnsavedContactName(name?: string | null): boolean {
  return !String(name || "").trim();
}

/** List subline: Unsaved, phone, or last call. Never hangup copy or presence. */
export function contactListSubline(row: {
  name?: string | null;
  phone?: string | null;
  lastContactAt?: string | null;
}): string {
  if (isUnsavedContactName(row.name)) return "Unsaved";
  const phone = String(row.phone || "").trim();
  if (phone) return phone;
  if (row.lastContactAt) return formatCallWhenRelative(row.lastContactAt);
  return "No phone";
}

export function contactMatchesQuery(
  row: {
    name?: string | null;
    phone?: string | null;
    last_reason?: string | null;
    lastReasonDisplay?: string | null;
  },
  q: string
): boolean {
  const text = sanitizeSearchQuery(q);
  if (!text) return true;
  const hay = [row.name, row.phone, row.lastReasonDisplay, row.last_reason]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(text.toLowerCase());
}

/** Profile stamp for the newest call. Not presence. */
export function contactLastCallFact(at?: string | null): string | null {
  const iso = String(at || "").trim();
  if (!iso) return null;
  return `Last call ${formatCallWhenRelative(iso)}`;
}

export function compareContactRows(
  a: Pick<ContactListRow, "name" | "lastContactAt" | "updated_at">,
  b: Pick<ContactListRow, "name" | "lastContactAt" | "updated_at">,
  sort: ContactSort
): number {
  if (sort === "name") {
    const an = String(a.name || "").trim().toLowerCase();
    const bn = String(b.name || "").trim().toLowerCase();
    if (!an && bn) return 1;
    if (an && !bn) return -1;
    const byName = an.localeCompare(bn, "en");
    if (byName) return byName;
  }
  const at = a.lastContactAt || a.updated_at || "";
  const bt = b.lastContactAt || b.updated_at || "";
  if (at === bt) return 0;
  return at < bt ? 1 : -1;
}

export function uniqueRecentCallerPhones(
  rows: Array<{ caller_number?: string | null }>
): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const row of rows) {
    const phone = String(row.caller_number || "").trim();
    if (!phone) continue;
    const keys = storedPhoneCandidates(phone);
    if (keys.some((key) => seen.has(key))) continue;
    for (const key of keys) seen.add(key);
    ordered.push(phone);
  }
  return ordered;
}

export function rankContactByRecentPhones(
  phone: string | null | undefined,
  recentPhones: string[]
): number {
  if (!phone) return Number.MAX_SAFE_INTEGER;
  const keys = new Set(storedPhoneCandidates(phone));
  for (let i = 0; i < recentPhones.length; i += 1) {
    if (storedPhoneCandidates(recentPhones[i]).some((key) => keys.has(key))) {
      return i;
    }
  }
  return Number.MAX_SAFE_INTEGER;
}

export function paginateContactRows<T>(
  rows: T[],
  page: number,
  pageSize: number
): { rows: T[]; total: number } {
  const total = rows.length;
  const from = Math.max(0, (page - 1) * pageSize);
  return { rows: rows.slice(from, from + pageSize), total };
}

function contactSearchOr(q: string): string | null {
  const text = sanitizeSearchQuery(q);
  if (!text) return null;
  const needle = text.replace(/,/g, " ").trim();
  if (!needle) return null;
  return `name.ilike.%${needle}%,phone.ilike.%${needle}%,last_reason.ilike.%${needle}%`;
}

function decorateContactRows(
  contacts: ContactRow[],
  extras: {
    byId: Map<string, string | null>;
    byPhone: Map<string, string | null>;
    reasonByPhone: Map<string, string | null>;
  }
): ContactListRow[] {
  return contacts.map((row) => {
    const phoneKeys = row.phone ? storedPhoneCandidates(row.phone) : [];
    const latestCallReason =
      phoneKeys
        .map((key) => extras.reasonByPhone.get(key))
        .find((value) => value != null) ?? null;
    const lastByPhone =
      phoneKeys
        .map((key) => extras.byPhone.get(key) || null)
        .reduce<string | null>((best, value) => maxIso(best, value || null), null);
    return {
      ...row,
      lastContactAt: pickLastContactAt(
        lastByPhone,
        extras.byId.get(row.id),
        row.updated_at
      ),
      lastReasonDisplay: displayContactLastReason({
        name: row.name,
        phone: row.phone,
        lastReason: row.last_reason,
        latestCallReason,
      }),
    };
  });
}

export async function loadContactsPage(
  client: SupabaseClient,
  tenantId: string,
  page: number,
  pageSize: number,
  saved: ContactSavedFilter = "all",
  opts: { q?: string; sort?: ContactSort } = {}
): Promise<{ rows: ContactListRow[]; total: number; error: string | null }> {
  const q = sanitizeSearchQuery(opts.q);
  const sort = resolveContactSort(opts.sort);
  const searchOr = contactSearchOr(q);

  if (saved === "recent") {
    const recent = await client
      .from("calls")
      .select("caller_number, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (recent.error) {
      return { rows: [], total: 0, error: recent.error.message };
    }
    const recentPhones = uniqueRecentCallerPhones(recent.data || []);
    const phoneKeys = [
      ...new Set(recentPhones.flatMap((phone) => storedPhoneCandidates(phone))),
    ];
    if (!phoneKeys.length) {
      return { rows: [], total: 0, error: null };
    }

    let listedQuery = client
      .from("contacts")
      .select(CONTACT_SELECT)
      .eq("tenant_id", tenantId)
      .in("phone", phoneKeys);
    if (searchOr) listedQuery = listedQuery.or(searchOr);

    const listed = await listedQuery;
    if (listed.error) {
      return { rows: [], total: 0, error: listed.error.message };
    }

    const contacts = (listed.data || []) as ContactRow[];
    if (!contacts.length) {
      return { rows: [], total: 0, error: null };
    }

    const extras = await loadLastContactMap(client, tenantId, contacts);
    const decorated = decorateContactRows(contacts, extras).filter((row) =>
      contactMatchesQuery(row, q)
    );
    decorated.sort((a, b) => {
      if (sort === "name") return compareContactRows(a, b, "name");
      const ar = rankContactByRecentPhones(a.phone, recentPhones);
      const br = rankContactByRecentPhones(b.phone, recentPhones);
      if (ar !== br) return ar - br;
      return compareContactRows(a, b, "recent");
    });
    return { ...paginateContactRows(decorated, page, pageSize), error: null };
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let listedQuery = client
    .from("contacts")
    .select(CONTACT_SELECT, { count: "exact" })
    .eq("tenant_id", tenantId);

  if (saved === "saved") {
    listedQuery = listedQuery.not("name", "is", null).neq("name", "");
  } else if (saved === "unsaved") {
    listedQuery = listedQuery.or("name.is.null,name.eq.");
  }
  if (searchOr) listedQuery = listedQuery.or(searchOr);
  listedQuery =
    sort === "name"
      ? listedQuery
          .order("name", { ascending: true, nullsFirst: false })
          .order("updated_at", { ascending: false })
      : listedQuery.order("updated_at", { ascending: false });
  listedQuery = listedQuery.range(from, to);

  const listed = await listedQuery;

  if (listed.error) {
    return { rows: [], total: 0, error: listed.error.message };
  }

  const contacts = (listed.data || []) as ContactRow[];
  const total = listed.count ?? contacts.length;
  if (contacts.length === 0) {
    return { rows: [], total, error: null };
  }

  const extras = await loadLastContactMap(client, tenantId, contacts);
  const rows = decorateContactRows(contacts, extras);
  if (sort === "recent") {
    rows.sort((a, b) => compareContactRows(a, b, "recent"));
  }
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
  const phones = [
    ...new Set(
      contacts.flatMap((c) => (c.phone ? storedPhoneCandidates(c.phone) : []))
    ),
  ];

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
    const at = maxIso(byPhone.get(phone) || null, row.created_at);
    const reason = reasonByPhone.has(phone)
      ? null
      : pickCallOwnerReason(parseSummary(row.summary as string | null));
    for (const key of storedPhoneCandidates(phone)) {
      byPhone.set(key, maxIso(byPhone.get(key) || null, at));
      if (reason != null && !reasonByPhone.has(key)) {
        reasonByPhone.set(key, reason);
      }
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
      for (const key of storedPhoneCandidates(row.caller_phone)) {
        byPhone.set(key, maxIso(byPhone.get(key) || null, at));
      }
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

function uniqueById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (!row?.id || seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

function asHold(row: {
  id: string;
  created_at: string;
  request_type: string;
  status: string;
  item?: string | null;
  quantity?: string | null;
  when_text?: string | null;
  window_start?: string | null;
  window_end?: string | null;
  notes?: string | null;
  caller_name?: string | null;
  caller_phone?: string | null;
  call_id?: string | null;
}): InboxHold {
  return {
    id: row.id,
    created_at: row.created_at,
    request_type: row.request_type,
    status: row.status,
    item: row.item || null,
    quantity: row.quantity || null,
    when_text: row.when_text || null,
    window_start: row.window_start || null,
    window_end: row.window_end || null,
    notes: row.notes || null,
    caller_name: row.caller_name || null,
    caller_phone: row.caller_phone || null,
    call_id: row.call_id || null,
  };
}

function asJob(row: {
  id: string;
  created_at: string;
  service_name: string;
  status: string;
  when_text?: string | null;
  window_start?: string | null;
  window_end?: string | null;
  address_landmark?: string | null;
  notes?: string | null;
  caller_name?: string | null;
  caller_phone?: string | null;
  call_id?: string | null;
}): InboxJob {
  return {
    id: row.id,
    created_at: row.created_at,
    service_name: row.service_name,
    status: row.status,
    when_text: row.when_text || null,
    window_start: row.window_start || null,
    window_end: row.window_end || null,
    address_landmark: row.address_landmark || null,
    notes: row.notes || null,
    caller_name: row.caller_name || null,
    caller_phone: row.caller_phone || null,
    call_id: row.call_id || null,
  };
}

export async function loadContactTimeline(
  client: SupabaseClient,
  tenantId: string,
  contact: ContactRow,
  vertical?: string | null
): Promise<ContactTimelineEntry[]> {
  const phone = contact.phone;
  const phoneKeys = phone ? storedPhoneCandidates(phone) : [];
  const [callsRes, reqById, reqByPhone, apptById, apptByPhone] = await Promise.all([
    phoneKeys.length
      ? client
          .from("calls")
          .select(
            "id, created_at, caller_number, status, summary, primary_intent, resolution, lead_status"
          )
          .eq("tenant_id", tenantId)
          .in("caller_number", phoneKeys)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    client
      .from("service_requests")
      .select(
        "id, created_at, request_type, status, item, quantity, when_text, window_start, window_end, notes, caller_name, caller_phone, call_id, contact_id"
      )
      .eq("tenant_id", tenantId)
      .eq("contact_id", contact.id)
      .order("created_at", { ascending: false }),
    phoneKeys.length
      ? client
          .from("service_requests")
          .select(
            "id, created_at, request_type, status, item, quantity, when_text, window_start, window_end, notes, caller_name, caller_phone, call_id, contact_id"
          )
          .eq("tenant_id", tenantId)
          .in("caller_phone", phoneKeys)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    client
      .from("appointments")
      .select(
        "id, created_at, service_name, status, when_text, window_start, window_end, address_landmark, notes, caller_name, caller_phone, call_id, contact_id"
      )
      .eq("tenant_id", tenantId)
      .eq("contact_id", contact.id)
      .order("created_at", { ascending: false }),
    phoneKeys.length
      ? client
          .from("appointments")
          .select(
            "id, created_at, service_name, status, when_text, window_start, window_end, address_landmark, notes, caller_name, caller_phone, call_id, contact_id"
          )
          .eq("tenant_id", tenantId)
          .in("caller_phone", phoneKeys)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);

  const leads = (callsRes.data || []).map((row) =>
    toLead({
      id: row.id,
      created_at: row.created_at,
      tenant_id: tenantId,
      caller_number: row.caller_number,
      sautikit_call_sid: null,
      status: row.status,
      duration_seconds: null,
      recording_url: null,
      summary: row.summary,
      sentiment: null,
      lead_status: parseLeadStatus(row.lead_status),
      resolution: parseCallResolution(row.resolution),
      primary_intent: row.primary_intent,
    })
  );
  const callMetaById: Record<string, ContactCallMeta> = {};
  for (const row of callsRes.data || []) {
    const meta = parseSummary(typeof row.summary === "string" ? row.summary : null);
    callMetaById[row.id] = {
      ownerWant: pickCallOwnerWant(meta),
      ownerReason: pickCallOwnerReason(meta),
      ownerCard: pickCallOwnerCard(meta),
    };
  }

  return contactHistoryEntries({
    leads,
    holds: uniqueById(
      [...(reqById.data || []), ...(reqByPhone.data || [])].map(asHold)
    ),
    jobs: uniqueById(
      [...(apptById.data || []), ...(apptByPhone.data || [])].map(asJob)
    ),
    callMetaById,
    vertical,
  });
}
