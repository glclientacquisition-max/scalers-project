export type InboxReturn = {
  purpose?: string;
  status?: string;
  from?: string;
  view?: string;
  week?: string;
  day?: string;
  q?: string;
  page?: number | string;
};

const PILES = new Set([
  "needs",
  "hold",
  "job",
  "human",
  "answered",
  "all",
  "new",
  "contacted",
  "resolved",
  "archived",
]);

const LEGACY_STATUS = new Set(["new", "contacted", "resolved", "archived"]);

function pile(ret: InboxReturn): string | undefined {
  const raw = String(ret.purpose || ret.from || ret.status || "").trim();
  return PILES.has(raw) ? raw : undefined;
}

function cleanQuery(raw?: string): string {
  return String(raw || "")
    .trim()
    .slice(0, 64)
    .replace(/[%_,.()]/g, " ")
    .trim();
}

function pageNum(raw?: number | string): number | undefined {
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw || ""), 10);
  if (!Number.isFinite(n) || n < 2) return undefined;
  return Math.floor(n);
}

function applyViewQuery(q: URLSearchParams, ret: InboxReturn, id?: string) {
  if (id !== "job" && id !== "hold") return;
  if (ret.view === "today" || (id === "job" && ret.view === "week")) q.set("view", ret.view);
  if (id === "job" && ret.view === "week" && ret.week) q.set("week", String(ret.week));
  if (ret.view === "today" && ret.day) q.set("day", String(ret.day));
}

function applyInboxQuery(q: URLSearchParams, ret: InboxReturn, list: boolean) {
  const id = pile(ret);
  if (id) {
    if (!list) q.set("from", id);
    else if (LEGACY_STATUS.has(id)) q.set("status", id);
    else q.set("purpose", id);
  }
  const text = cleanQuery(ret.q);
  if (text) q.set("q", text);
  const page = pageNum(ret.page);
  if (page) q.set("page", String(page));
  applyViewQuery(q, ret, id);
}

export function inboxRecordHref(callId: string, ret: InboxReturn = {}): string {
  const q = new URLSearchParams();
  applyInboxQuery(q, ret, false);
  const qs = q.toString();
  return qs ? `/calls/${callId}?${qs}` : `/calls/${callId}`;
}

export function inboxReturnHref(ret: InboxReturn = {}): string {
  const q = new URLSearchParams();
  applyInboxQuery(q, ret, true);
  const qs = q.toString();
  return qs ? `/calls?${qs}` : "/calls";
}

export function inboxReturnFromSearch(sp: {
  from?: string;
  view?: string;
  week?: string;
  day?: string;
  q?: string;
  page?: string;
}): InboxReturn {
  return {
    purpose: pile({ from: sp.from }),
    view: sp.view,
    week: sp.week,
    day: sp.day,
    q: sp.q,
    page: sp.page,
  };
}

export function contactFromCallHref(
  contactId: string,
  callId: string,
  ret: InboxReturn = {}
): string {
  const q = new URLSearchParams();
  q.set("from", "call");
  q.set("call", callId);
  const id = pile(ret);
  if (id) q.set("purpose", id);
  const text = cleanQuery(ret.q);
  if (text) q.set("q", text);
  const page = pageNum(ret.page);
  if (page) q.set("page", String(page));
  applyViewQuery(q, ret, id);
  return `/contacts/${contactId}?${q.toString()}`;
}

export function callFromContactHref(sp: {
  from?: string;
  call?: string;
  purpose?: string;
  view?: string;
  week?: string;
  day?: string;
  q?: string;
  page?: string;
}): string | null {
  const callId = String(sp.call || "").trim();
  if (sp.from !== "call" || !callId) return null;
  return inboxRecordHref(callId, {
    purpose: sp.purpose,
    view: sp.view,
    week: sp.week,
    day: sp.day,
    q: sp.q,
    page: sp.page,
  });
}
