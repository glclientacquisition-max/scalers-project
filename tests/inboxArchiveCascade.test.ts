// Inbox archive cascade (Desk side of #862): Archive archives the call and its
// open holds and visits in ONE transaction (inbox_archive_calls), Undo restores
// them with the undo record (inbox_undo_archive). Real Done and Dusted ids.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  inboxArchivedLabel,
  inboxCascadeErrorText,
  inboxCascadeUndoText,
  isInboxCascadeMissing,
  parseInboxArchiveRpc,
  parseInboxUndoRpc,
  planInboxArchive,
  sendInboxArchive,
  sendInboxCascadeUndo,
  settleInboxArchiveStamps,
  stampedCallIdsToCheck,
  type InboxArchiveResult,
} from "../dashboard/src/lib/inboxArchiveCascade.ts";
import { inboxBulkOutcomeText, inboxBulkPlan } from "../dashboard/src/lib/inboxBulk.ts";
import { runInboxArchiveCalls, runInboxUndoArchive } from "../dashboard/src/lib/inboxArchiveRun.ts";
import { assembleInboxItems, itemIsArchived, itemMatchesPurpose, countInboxPurposes } from "../dashboard/src/lib/inboxPurpose.ts";
import { parseInboxArchiveUndo, writeInboxArchiveUndo } from "../dashboard/src/lib/inboxArchiveUndo.ts";

const src = (p: string) => readFileSync(new URL(`../dashboard/src/${p}`, import.meta.url), "utf8");

const TENANT = "df4ad9d8-28ff-4810-b1e6-94f5495472b0";
const CALL = "2af42c11-4344-46d0-ad48-92d0a38e0dfb";
const HOLD_ON_ROW = "8c713352-8f9f-4cef-b80d-3f0fe848c489"; // first open hold: shown on the call row
const HOLD_EXTRA = "93ab7756-fad0-4997-8e18-f12eb677f3ac"; // second open hold: its own row, lead null

const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;

function hold(id: string, callId: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    created_at: "2026-10-14T04:33:00.000Z",
    request_type: "enquiry",
    status: "open",
    item: null,
    quantity: null,
    when_text: null,
    notes: null,
    caller_name: "Caller",
    caller_phone: "+254700000001",
    call_id: callId,
    ...extra,
  } as any;
}

function lead(id: string, leadStatus = "new") {
  return {
    call: { id, created_at: "2026-10-14T04:30:00.000Z", status: "completed", caller_number: "+254700000001" },
    leadStatus,
    reason: "Enquiry",
    name: null,
    primaryIntent: "enquiry",
    resolution: "unknown",
    urgent: false,
  } as any;
}

/** The browser repro: 29 call rows (call 2af42c11 carries hold 8c713352) + hold 93ab7756 alone. */
function repro() {
  const others = Array.from({ length: 28 }, (_, i) => uuid(i + 1));
  const items: any[] = others.map((id) => ({ id, callId: id, lead: { leadStatus: "new" }, hold: hold(`h-${id}`, id), job: null }));
  items.push({ id: CALL, callId: CALL, lead: { leadStatus: "new" }, hold: hold(HOLD_ON_ROW, CALL), job: null });
  items.push({ id: HOLD_EXTRA, callId: CALL, lead: null, hold: hold(HOLD_EXTRA, CALL), job: null });
  return { items, others };
}

function cascadeSend(over: Partial<InboxArchiveResult> = {}) {
  const calls: string[][] = [];
  const send = async (ids: string[]) => {
    calls.push(ids);
    return {
      ok: true,
      mode: "cascade" as const,
      updatedIds: ids,
      holds: [...ids.filter((id) => id !== CALL).map((id) => `h-${id}`), HOLD_ON_ROW, HOLD_EXTRA],
      visits: [],
      skipped: [],
      undoId: "11111111-1111-4111-8111-111111111111",
      ...over,
    };
  };
  return { calls, send };
}

test("plan: hold 93ab7756 rides with call 2af42c11 when that call is selected (no skip)", () => {
  const { items } = repro();
  const plan = planInboxArchive(items);
  assert.equal(plan.targets.length, 29);
  assert.equal(plan.ids.length, 29);
  assert.ok(plan.ids.includes(CALL));
  assert.deepEqual(plan.riders, [{ itemId: HOLD_EXTRA, rowId: HOLD_EXTRA, callId: CALL }]);
  assert.deepEqual(plan.skipped, []);
});

test("archive 30 selected: ONE request, toast counts every hold the RPC stamped, no leftover note", async () => {
  const { items } = repro();
  const { calls, send } = cascadeSend();
  const run = await sendInboxArchive(items, send);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 29);
  assert.equal(run.mode, "cascade");
  assert.equal(run.applied.length, 29);
  assert.deepEqual(run.cascaded.map((t) => t.itemId), [HOLD_EXTRA]);
  assert.deepEqual(run.missed, []);
  assert.deepEqual(run.skipped, []);
  // Counts come from the RPC result: every open hold it stamped on the 29
  // calls (8c713352 on the call row and 93ab7756 on its own row included).
  assert.equal(run.holdIds.length, 30);
  assert.ok(run.holdIds.includes(HOLD_ON_ROW) && run.holdIds.includes(HOLD_EXTRA));
  assert.deepEqual(run.visitIds, []);
  assert.equal(run.undoId, "11111111-1111-4111-8111-111111111111");
  assert.equal(inboxBulkOutcomeText("archive", run), null);
  assert.equal(inboxArchivedLabel(run.applied.length, run.holdIds.length, run.visitIds.length), "29 archived, plus 30 open requests on those calls");
});

test("archive: a standalone hold whose call is NOT selected keeps the skip", async () => {
  const items: any[] = [
    { id: uuid(1), callId: uuid(1), lead: { leadStatus: "new" }, hold: null, job: null },
    { id: HOLD_EXTRA, callId: CALL, lead: null, hold: hold(HOLD_EXTRA, CALL), job: null },
  ];
  const { calls, send } = cascadeSend({ holds: [] });
  const run = await sendInboxArchive(items, send);
  assert.deepEqual(calls[0], [uuid(1)]);
  assert.deepEqual(run.skipped, [{ itemId: HOLD_EXTRA, reason: "open_request" }]);
  assert.equal(
    inboxBulkOutcomeText("archive", run),
    "1 of 2 archived. 1 is an open request on a call, so use Done or Confirm on it."
  );
});

test("archive: ids the server skipped (already archived / not found) read as already handled", async () => {
  const { items } = repro();
  const { send } = cascadeSend({
    updatedIds: [CALL],
    holds: [HOLD_ON_ROW, HOLD_EXTRA],
    skipped: Array.from({ length: 28 }, (_, i) => ({ id: uuid(i + 1), reason: "already_archived" })),
  });
  const run = await sendInboxArchive(items, send);
  assert.equal(run.applied.length, 1);
  assert.equal(run.cascaded.length, 1);
  assert.equal(run.missed.length, 28);
  assert.equal(inboxBulkOutcomeText("archive", run), "2 of 30 archived. 28 were already handled.");
});

test("archive fallback (no #862 on this database): calls archived, request rows skipped as before", async () => {
  const { items } = repro();
  const send = async (ids: string[]) => ({ ok: true, mode: "legacy" as const, updatedIds: ids, holds: [], visits: [], skipped: [], undoId: null });
  const run = await sendInboxArchive(items, send);
  assert.equal(run.mode, "legacy");
  assert.equal(run.applied.length, 29);
  assert.equal(run.undoId, null);
  assert.deepEqual(run.skipped, [{ itemId: HOLD_EXTRA, reason: "open_request" }]);
  assert.equal(inboxBulkOutcomeText("archive", run), "29 of 30 archived. 1 is an open request on a call, so use Done or Confirm on it.");
});

test("undo: ONE request with the undo id; texts for restored, changed since and already undone", async () => {
  const { items } = repro();
  const rows = items.filter((i) => i.lead).map((i) => ({ id: i.id, callId: i.callId }));
  const requests = [{ id: HOLD_EXTRA, callId: CALL }];
  const sent: string[] = [];
  const res = await sendInboxCascadeUndo(
    { undoId: "u-1", rows, requests },
    async (undoId) => {
      sent.push(undoId);
      return { ok: true, restored: { calls: rows.map((r) => r.callId), holds: [HOLD_ON_ROW, HOLD_EXTRA], visits: [] }, changedSince: [], alreadyUndone: false };
    }
  );
  assert.deepEqual(sent, ["u-1"]);
  assert.equal(res.restoredCalls, 29);
  assert.equal(res.restoredHolds, 2);
  assert.equal(res.restoredVisits, 0);
  assert.ok(res.restored.some((r) => r.id === HOLD_EXTRA));
  assert.equal(inboxCascadeUndoText(res), "29 restored, plus 2 open requests.");

  const partial = await sendInboxCascadeUndo({ undoId: "u-1", rows, requests }, async () => ({
    ok: true,
    restored: { calls: rows.slice(1).map((r) => r.callId), holds: [HOLD_ON_ROW, HOLD_EXTRA], visits: [] },
    changedSince: [rows[0].callId],
    alreadyUndone: false,
  }));
  assert.equal(partial.missed.length, 1);
  assert.equal(inboxCascadeUndoText(partial), "28 restored, plus 2 open requests. 1 changed since.");
  assert.equal(inboxCascadeUndoText({ restoredCalls: 0, restoredHolds: 0, restoredVisits: 0, changedSince: 0, alreadyUndone: true }), "Already restored.");
});

test("rpc jsonb parsing matches the #862 shapes", () => {
  const a = parseInboxArchiveRpc({
    undo_id: "u-2",
    calls: [{ id: CALL, prev: "new" }],
    holds: [HOLD_ON_ROW, HOLD_EXTRA],
    visits: [],
    skipped: [uuid(9)],
    skipped_detail: [{ id: uuid(9), reason: "already_archived" }],
  });
  assert.deepEqual(a, {
    ok: true,
    mode: "cascade",
    updatedIds: [CALL],
    holds: [HOLD_ON_ROW, HOLD_EXTRA],
    visits: [],
    skipped: [{ id: uuid(9), reason: "already_archived" }],
    undoId: "u-2",
  });
  const u = parseInboxUndoRpc({ restored: { calls: [CALL], holds: [HOLD_EXTRA], visits: [] }, changed_since: [HOLD_ON_ROW], already_undone: false });
  assert.deepEqual(u, { ok: true, restored: { calls: [CALL], holds: [HOLD_EXTRA], visits: [] }, changedSince: [HOLD_ON_ROW], alreadyUndone: false });
});

function fakeClient(rpcAnswer: (name: string, args: any) => { data: any; error: any }) {
  const log: any[] = [];
  const builder: any = {
    update(patch: any) { log.push(["update", patch]); return builder; },
    in(col: string, ids: string[]) { log.push(["in", col, ids]); return builder; },
    eq(col: string, v: string) { log.push(["eq", col, v]); return builder; },
    select() { const ids = log.find((l) => l[0] === "in")?.[2] || []; return Promise.resolve({ data: ids.map((id: string) => ({ id })), error: null }); },
  };
  return {
    log,
    client: {
      rpc: async (name: string, args: any) => { log.push(["rpc", name, args]); return rpcAnswer(name, args); },
      from: (t: string) => { log.push(["from", t]); return builder; },
    } as any,
  };
}

test("server: archive is ONE rpc as the member (tenant + call ids), no table writes", async () => {
  const { log, client } = fakeClient(() => ({ data: { undo_id: "u-3", calls: [{ id: CALL, prev: "new" }], holds: [HOLD_ON_ROW, HOLD_EXTRA], visits: [], skipped: [], skipped_detail: [] }, error: null }));
  const { result, error } = await runInboxArchiveCalls({ client, tenantId: TENANT, callIds: [CALL] });
  assert.equal(error, null);
  assert.deepEqual(log, [["rpc", "inbox_archive_calls", { p_tenant_id: TENANT, p_call_ids: [CALL] }]]);
  assert.equal(result?.mode, "cascade");
  assert.deepEqual(result?.holds, [HOLD_ON_ROW, HOLD_EXTRA]);
});

test("server: missing RPC falls back to the #860 single calls update (mode legacy)", async () => {
  const { log, client } = fakeClient(() => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.inbox_archive_calls(p_call_ids, p_tenant_id) in the schema cache" } }));
  const { result } = await runInboxArchiveCalls({ client, tenantId: TENANT, callIds: [CALL] });
  assert.equal(result?.mode, "legacy");
  assert.deepEqual(result?.updatedIds, [CALL]);
  assert.equal(log.filter((l) => l[0] === "rpc").length, 1);
  assert.equal(log.filter((l) => l[0] === "update").length, 1);
  assert.deepEqual(log.find((l) => l[0] === "update")[1], { lead_status: "archived" });
});

test("server: a refusal (viewer 42501, >200 22023) is reported, never retried as the old update", async () => {
  for (const code of ["42501", "22023"]) {
    const { log, client } = fakeClient(() => ({ data: null, error: { code, message: "not allowed" } }));
    const res = await runInboxArchiveCalls({ client, tenantId: TENANT, callIds: [CALL] });
    assert.equal(res.result, null);
    assert.equal(res.error?.code, code);
    assert.equal(log.filter((l) => l[0] === "update").length, 0);
  }
  assert.equal(inboxCascadeErrorText({ code: "42501" }, "archive"), "Your role cannot archive in this business.");
  assert.equal(inboxCascadeErrorText({ code: "P0002" }, "undo"), "Nothing to undo. It may have expired.");
  assert.equal(isInboxCascadeMissing({ code: "42703", message: "column service_requests.inbox_archived_at does not exist" }), true);
  assert.equal(isInboxCascadeMissing({ code: "42501", message: "not allowed" }), false);
});

test("server: undo is ONE rpc with tenant + undo id", async () => {
  const { log, client } = fakeClient(() => ({ data: { restored: { calls: [CALL], holds: [HOLD_ON_ROW, HOLD_EXTRA], visits: [] }, changed_since: [], already_undone: false }, error: null }));
  const { result } = await runInboxUndoArchive({ client, tenantId: TENANT, undoId: "u-3" });
  assert.deepEqual(log, [["rpc", "inbox_undo_archive", { p_tenant_id: TENANT, p_undo_id: "u-3" }]]);
  assert.deepEqual(result?.restored?.holds, [HOLD_ON_ROW, HOLD_EXTRA]);
});

test("inbox: both holds archived with call 2af42c11 leave Needs you and All, and show in Archived", () => {
  const stamp = "2026-10-22T00:50:00.000Z";
  const holds = [hold(HOLD_ON_ROW, CALL, { inbox_archived_at: stamp }), hold(HOLD_EXTRA, CALL, { inbox_archived_at: stamp })];
  const items = assembleInboxItems({ leads: [lead(CALL, "archived")], holds, jobs: [] });
  assert.equal(items.length, 2);
  const extra = items.find((i) => i.id === HOLD_EXTRA)!;
  assert.equal(extra.lead, null);
  assert.equal(itemIsArchived(extra), true);
  assert.equal(itemMatchesPurpose(extra, "needs"), false);
  assert.equal(itemMatchesPurpose(extra, "all"), false);
  assert.deepEqual(items.filter((i) => itemMatchesPurpose(i, "archived")).map((i) => i.id).sort(), [CALL, HOLD_EXTRA].sort());
  const counts = countInboxPurposes(items);
  assert.equal(counts.needs, 0);
  assert.equal(counts.archived, 2);
});

test("inbox: before #862 (no stamp) hold 93ab7756 stays in Needs you, as on prod today", () => {
  const items = assembleInboxItems({ leads: [lead(CALL, "archived")], holds: [hold(HOLD_ON_ROW, CALL), hold(HOLD_EXTRA, CALL)], jobs: [] });
  const extra = items.find((i) => i.id === HOLD_EXTRA)!;
  assert.equal(itemMatchesPurpose(extra, "needs"), true);
});

test("inbox: a stamp only hides while its call is archived (Unarchive brings the requests back)", () => {
  const stamp = "2026-10-22T00:50:00.000Z";
  const rows = [hold(HOLD_ON_ROW, CALL, { inbox_archived_at: stamp }), hold(HOLD_EXTRA, CALL, { inbox_archived_at: stamp }), hold("h-old", uuid(7), { inbox_archived_at: stamp })];
  assert.deepEqual(stampedCallIdsToCheck(rows, new Set([CALL])), [uuid(7)]);
  const live = settleInboxArchiveStamps(rows, new Map([[CALL, "new"]]));
  assert.equal(live[0].inbox_archived_at, null);
  assert.equal(live[1].inbox_archived_at, null);
  assert.equal(live[2].inbox_archived_at, stamp, "unknown call keeps its stamp");
  const still = settleInboxArchiveStamps(rows, new Map([[CALL, "archived"]]));
  assert.equal(still[1].inbox_archived_at, stamp);
  const items = assembleInboxItems({ leads: [lead(CALL, "new")], holds: live.slice(0, 2), jobs: [] });
  assert.equal(items.filter((i) => itemMatchesPurpose(i, "needs")).length, 2);
});

test("unarchive from Archived: a request row archived with its call unarchives that call", () => {
  const stamp = "2026-10-22T00:50:00.000Z";
  const items: any[] = [{ id: HOLD_EXTRA, callId: CALL, lead: null, hold: hold(HOLD_EXTRA, CALL, { inbox_archived_at: stamp }), job: null }];
  const plan = inboxBulkPlan("unarchive", items);
  assert.deepEqual(plan.ids, [CALL]);
  assert.deepEqual(plan.skipped, []);
});

test("undo record survives the session store round trip", () => {
  const mem = new Map<string, string>();
  const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
  const now = 1_000;
  writeInboxArchiveUndo([{ id: CALL, callId: CALL }], now, store, { undoId: "u-4", requests: [{ id: HOLD_EXTRA, callId: CALL }], holdIds: [HOLD_ON_ROW, HOLD_EXTRA], visitIds: ["v-1"] });
  const back = parseInboxArchiveUndo(mem.get("scalers-inbox-archive-undo")!, now + 1);
  assert.equal(back?.undoId, "u-4");
  assert.deepEqual(back?.requests, [{ id: HOLD_EXTRA, callId: CALL }]);
  assert.deepEqual(back?.holdIds, [HOLD_ON_ROW, HOLD_EXTRA]);
  assert.deepEqual(back?.visitIds, ["v-1"]);
  writeInboxArchiveUndo([{ id: CALL, callId: CALL }], now, store);
  assert.equal(parseInboxArchiveUndo(mem.get("scalers-inbox-archive-undo")!, now + 1)?.undoId, undefined);
});

test("wiring: bulk bar, row menu and ticket archive through inbox_archive_calls; loader guards the column", () => {
  const actions = src("app/(desk)/calls/archiveActions.ts");
  assert.match(actions, /createWorkspaceDataClient\(\)/);
  assert.match(actions, /memberDenied\("inbox\.act"\)/);
  const run = src("lib/inboxArchiveRun.ts");
  assert.match(run, /rpc\("inbox_archive_calls"/);
  assert.match(run, /rpc\("inbox_undo_archive"/);
  assert.match(src("components/InboxRowSelect.tsx"), /inboxArchiveItems\(chosen\)/);
  assert.match(src("lib/inboxLeadActions.ts"), /export async function inboxArchive\(item: InboxItem\)[\s\S]*?inboxArchiveCall\(/);
  assert.match(src("components/InboxTicketView.tsx"), /inboxArchiveCall\(callId\)/);
  assert.match(src("components/InboxArchiveToast.tsx"), /inboxUndoArchiveCascade\(/);
  const load = src("lib/inboxLoad.ts");
  assert.match(load, /INBOX_ARCHIVED_COLUMN = "inbox_archived_at"/);
  assert.match(load, /stampMissing\(res\.error\) \? openHoldsQuery\(HOLD_SELECT\)/);
  assert.match(load, /stampMissing\(res\.error\) \? openJobsQuery\(JOB_SELECT\)/);
});

test("staging retest (25 rows: 24 calls + hold 93ab7756): RPC stamped 9 holds and 4 visits, toasts say so", async () => {
  const calls24 = [CALL, ...Array.from({ length: 23 }, (_, i) => uuid(i + 101))];
  const items: any[] = calls24.map((id) => ({ id, callId: id, lead: { leadStatus: "new" }, hold: id === CALL ? hold(HOLD_ON_ROW, CALL) : null, job: null }));
  items.push({ id: HOLD_EXTRA, callId: CALL, lead: null, hold: hold(HOLD_EXTRA, CALL), job: null });
  const holds9 = [HOLD_ON_ROW, HOLD_EXTRA, ...Array.from({ length: 7 }, (_, i) => `h-${i}`)];
  const visits4 = ["v-1", "v-2", "v-3", "v-4"];
  const run = await sendInboxArchive(items, async (ids) => ({ ok: true, mode: "cascade", updatedIds: ids, holds: holds9, visits: visits4, skipped: [], undoId: "u-25" }));
  assert.equal(run.applied.length, 24);
  assert.equal(run.cascaded.length, 1);
  assert.equal(inboxBulkOutcomeText("archive", run), null);
  assert.equal(inboxArchivedLabel(run.applied.length, run.holdIds.length, run.visitIds.length), "24 archived, plus 9 open requests and 4 visits on those calls");
  const rows = items.filter((i) => i.lead).map((i) => ({ id: i.id, callId: i.callId }));
  const undo = await sendInboxCascadeUndo({ undoId: "u-25", rows, requests: [{ id: HOLD_EXTRA, callId: CALL }] }, async () => ({
    ok: true, restored: { calls: calls24, holds: holds9, visits: visits4 }, changedSince: [], alreadyUndone: false,
  }));
  assert.equal(inboxCascadeUndoText(undo), "24 restored, plus 9 open requests and 4 visits.");
});

test("copy: every plural / zero combination, that call vs those calls", () => {
  const cases: Array<[number, number, number, string]> = [
    [1, 0, 0, "Archived"],
    [24, 0, 0, "24 archived"],
    [1, 1, 0, "Archived, plus 1 open request on that call"],
    [1, 2, 0, "Archived, plus 2 open requests on that call"],
    [1, 0, 1, "Archived, plus 1 visit on that call"],
    [1, 0, 3, "Archived, plus 3 visits on that call"],
    [1, 1, 1, "Archived, plus 1 open request and 1 visit on that call"],
    [24, 1, 4, "24 archived, plus 1 open request and 4 visits on those calls"],
    [24, 2, 1, "24 archived, plus 2 open requests and 1 visit on those calls"],
    [2, 1, 0, "2 archived, plus 1 open request on those calls"],
    [2, 0, 2, "2 archived, plus 2 visits on those calls"],
  ];
  for (const [c, h, v, want] of cases) assert.equal(inboxArchivedLabel(c, h, v), want, `${c}/${h}/${v}`);
  const undo: Array<[number, number, number, number, string]> = [
    [24, 1, 4, 0, "24 restored, plus 1 open request and 4 visits."],
    [24, 0, 0, 0, "24 restored."],
    [1, 1, 0, 0, "1 restored, plus 1 open request."],
    [1, 0, 1, 0, "1 restored, plus 1 visit."],
    [3, 2, 2, 0, "3 restored, plus 2 open requests and 2 visits."],
    [23, 9, 4, 1, "23 restored, plus 9 open requests and 4 visits. 1 changed since."],
    [0, 0, 0, 3, "0 restored. 3 changed since."],
  ];
  for (const [c, h, v, ch, want] of undo) {
    assert.equal(inboxCascadeUndoText({ restoredCalls: c, restoredHolds: h, restoredVisits: v, changedSince: ch }), want, want);
  }
  for (const [c, h, v] of cases) assert.doesNotMatch(inboxArchivedLabel(c, h, v), /[\u2013\u2014]/);
});

test("fallback (no RPC): toast has no plus part", async () => {
  const { items } = repro();
  const run = await sendInboxArchive(items, async (ids) => ({ ok: true, mode: "legacy", updatedIds: ids, holds: [], visits: [], skipped: [], undoId: null }));
  assert.deepEqual([run.holdIds, run.visitIds], [[], []]);
  assert.equal(inboxArchivedLabel(run.applied.length, run.holdIds.length, run.visitIds.length), "29 archived");
});

test("calendar: a visit or hold archived with its call stays on the run sheets (stamp only filters the inbox)", async () => {
  const { visitBoardItems } = await import("../dashboard/src/lib/runSheet.ts");
  const { isHoldBoardItem } = await import("../dashboard/src/lib/holdSheet.ts");
  const stamp = "2026-10-22T00:50:00.000Z";
  const job = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
    id, created_at: "2026-10-14T04:33:00.000Z", service_name: "Deep clean", status, when_text: null,
    address_landmark: null, notes: null, caller_name: null, caller_phone: "+254700000001", call_id: CALL, ...extra,
  }) as any;
  const visitRow: any = { id: "v-2", callId: CALL, lead: null, hold: null, job: job("v-2", "confirmed", { inbox_archived_at: stamp }) };
  const holdRow: any = { id: HOLD_EXTRA, callId: CALL, lead: null, hold: hold(HOLD_EXTRA, CALL, { inbox_archived_at: stamp }), job: null };
  assert.equal(itemIsArchived(visitRow), true, "out of the inbox");
  assert.deepEqual(visitBoardItems([visitRow]).map((i) => i.id), ["v-2"], "still on the visit calendar");
  assert.equal(isHoldBoardItem(holdRow), true, "still on the holds sheet");
  for (const f of ["lib/runSheet.ts", "lib/holdSheet.ts", "lib/contactsLoad.ts", "app/(desk)/calls/[id]/page.tsx"]) {
    assert.doesNotMatch(src(f), /inbox_archived_at|itemIsArchived\(/, f);
  }
});

// ------------------------------------------------- unarchive (#866) ----

test("unarchive: ONE inbox_unarchive_calls request; toast names the holds and visits it cleared", async () => {
  const { parseInboxUnarchiveRpc, sendInboxUnarchive, inboxUnarchiveText } = await import("../dashboard/src/lib/inboxArchiveCascade.ts");
  const stamp = "2026-10-22T00:50:00.000Z";
  const calls24 = [CALL, ...Array.from({ length: 23 }, (_, i) => uuid(i + 201))];
  const items: any[] = calls24.map((id) => ({ id, callId: id, lead: { leadStatus: "archived" }, hold: null, job: null }));
  items.push({ id: HOLD_EXTRA, callId: CALL, lead: null, hold: hold(HOLD_EXTRA, CALL, { inbox_archived_at: stamp }), job: null });
  const sent: string[][] = [];
  const run = await sendInboxUnarchive(items, async (ids) => {
    sent.push(ids);
    return parseInboxUnarchiveRpc({ unarchived: 24, holds: 9, visits: 4, skipped: 0, call_ids: ids, skipped_detail: [] });
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].length, 24, "hold 93ab7756 maps to its call, sent once");
  assert.equal(run.mode, "cascade");
  assert.equal(run.applied.length, 25);
  assert.equal(inboxBulkOutcomeText("unarchive", run), null);
  assert.equal(inboxUnarchiveText(run), "24 unarchived, plus 9 open requests and 4 visits on those calls");
});

test("unarchive copy: plural / zero combos, that call vs those calls, skipped reads already handled", async () => {
  const { inboxUnarchiveText, sendInboxUnarchive, parseInboxUnarchiveRpc } = await import("../dashboard/src/lib/inboxArchiveCascade.ts");
  const cases: Array<[number, number, number, string | null]> = [
    [0, 0, 0, null],
    [1, 0, 0, "Unarchived"],
    [1, 2, 0, "Unarchived, plus 2 open requests on that call"],
    [1, 1, 1, "Unarchived, plus 1 open request and 1 visit on that call"],
    [3, 0, 1, "3 unarchived, plus 1 visit on those calls"],
    [24, 1, 4, "24 unarchived, plus 1 open request and 4 visits on those calls"],
  ];
  for (const [calls, holds, visits, want] of cases) assert.equal(inboxUnarchiveText({ calls, holds, visits }), want);
  const items: any[] = [CALL, uuid(301)].map((id) => ({ id, callId: id, lead: { leadStatus: "archived" }, hold: null, job: null }));
  const run = await sendInboxUnarchive(items, async () =>
    parseInboxUnarchiveRpc({ unarchived: 1, holds: 2, visits: 0, skipped: 1, call_ids: [CALL], skipped_detail: [{ id: uuid(301), reason: "not_archived" }] })
  );
  assert.equal(inboxBulkOutcomeText("unarchive", run), "1 of 2 moved back to the Inbox. 1 was already handled.");
  assert.equal(inboxUnarchiveText(run), "Unarchived, plus 2 open requests on that call");
});

test("unarchive server: ONE rpc; missing RPC falls back to the calls-only update; refusals reported", async () => {
  const { runInboxUnarchiveCalls } = await import("../dashboard/src/lib/inboxArchiveRun.ts");
  const ok = fakeClient(() => ({ data: { unarchived: 1, holds: 2, visits: 0, skipped: 0, call_ids: [CALL], skipped_detail: [] }, error: null }));
  const a = await runInboxUnarchiveCalls({ client: ok.client, tenantId: TENANT, callIds: [CALL] });
  assert.deepEqual(ok.log, [["rpc", "inbox_unarchive_calls", { p_tenant_id: TENANT, p_call_ids: [CALL] }]]);
  assert.equal(a.result?.mode, "cascade");
  assert.equal(a.result?.holds, 2);

  const missing = fakeClient(() => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.inbox_unarchive_calls(p_call_ids, p_tenant_id) in the schema cache" } }));
  const b = await runInboxUnarchiveCalls({ client: missing.client, tenantId: TENANT, callIds: [CALL] });
  assert.equal(b.result?.mode, "legacy");
  assert.deepEqual(missing.log.find((l) => l[0] === "update")[1], { lead_status: "new" });
  assert.deepEqual(b.result?.updatedIds, [CALL]);

  for (const code of ["42501", "22023"]) {
    const refused = fakeClient(() => ({ data: null, error: { code, message: "no" } }));
    const c = await runInboxUnarchiveCalls({ client: refused.client, tenantId: TENANT, callIds: [CALL] });
    assert.equal(c.error?.code, code);
    assert.equal(refused.log.filter((l) => l[0] === "update").length, 0);
  }
  assert.equal(inboxCascadeErrorText({ code: "42501" }, "unarchive"), "Your role cannot unarchive in this business.");
  assert.equal(inboxCascadeErrorText({ code: "22023" }, "unarchive"), "Pick 200 or fewer to unarchive at once.");
  assert.equal(inboxCascadeErrorText({ code: "22023" }, "archive"), "Pick 200 or fewer to archive at once.");
});

test("unarchive wiring: bulk bar, row menu and ticket use inbox_unarchive_calls and announce the result", () => {
  assert.match(src("lib/inboxArchiveRun.ts"), /rpc\("inbox_unarchive_calls"/);
  assert.match(src("app/(desk)/calls/archiveActions.ts"), /export async function inboxUnarchiveCallsAction/);
  assert.match(src("components/InboxRowSelect.tsx"), /inboxUnarchiveItems\(chosen\)/);
  assert.match(src("components/InboxRowSelect.tsx"), /announceInboxResult\(inboxUnarchiveText\(unarchive\)\)/);
  assert.match(src("components/InboxRowOverflow.tsx"), /announceInboxResult\(unarchivedText\)/);
  assert.match(src("components/InboxTicketView.tsx"), /await inboxUnarchiveCall\(callId\)/);
  assert.match(src("components/InboxArchiveToast.tsx"), /INBOX_RESULT_EVENT/);
});
