// Per-call text thread (call_messages, Platform #868): outbound only. Reads via
// call_messages_list; every Desk caller SMS is put on the thread with
// call_messages_record_out after it settles; Retry via call_messages_retry.
// Missing RPCs: no Texts tab, the call view and the SMS send are as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CALL_MESSAGE_SOURCES,
  isCallMessagesRpcMissing,
  loadCallMessages,
  normalizeCallMessage,
  recordCallMessageOut,
  type CallMessage,
} from "../dashboard/src/lib/callMessages.ts";
import {
  callViewTab,
  smsMeterLine,
  textBubble,
  composerPlaceholder,
  textBubbleTime,
  textFailureReason,
  textThreadBubbles,
  textThreadCount,
  textThreadEmpty,
} from "../dashboard/src/lib/callTextThread.ts";
import { deskSmsSendError } from "../dashboard/src/lib/deskSmsError.ts";
import { smsSegments } from "../dashboard/src/lib/smsSegments.ts";

const TENANT = "df4ad9d8-28ff-4810-b1e6-94f5495472b0";
const CALL = "2af42c11-4344-46d0-ad48-92d0a38e0dfb";
const src = (p: string) => readFileSync(new URL(`../dashboard/src/${p}`, import.meta.url), "utf8");
const MISSING = {
  code: "PGRST202",
  message: "Could not find the function public.call_messages_list(p_call_id, p_limit, p_tenant_id) in the schema cache",
};

function msg(over: Partial<CallMessage> = {}): CallMessage {
  return {
    id: "m1",
    createdAt: "2026-10-22T07:02:00.000Z",
    direction: "out",
    body: "Hi Chris, 10 AM works.",
    status: "sent",
    failureReason: null,
    retryOf: null,
    authorKind: "owner",
    source: "caller_inbox_reply",
    sentAt: "2026-10-22T07:02:01.000Z",
    ...over,
  };
}

function rpcClient(reply: (name: string, args: any) => any) {
  const log: any[] = [];
  return {
    log,
    client: {
      rpc: async (name: string, args: any) => {
        log.push([name, args]);
        return reply(name, args);
      },
    } as any,
  };
}

test("tab: Call by default, Texts only from ?tab=texts and only with a thread", () => {
  assert.equal(callViewTab(undefined, true), "call");
  assert.equal(callViewTab("texts", true), "texts");
  assert.equal(callViewTab("TEXTS", true), "texts");
  assert.equal(callViewTab("texts", false), "call");
  assert.equal(callViewTab("other", true), "call");
});

test("status display: Sending, one tick, two ticks, Not delivered with reason and Retry", () => {
  const pending = textBubble(msg({ status: "pending" }));
  assert.equal(pending.statusLabel, "Sending");
  assert.equal(pending.ticks, 0);
  const sent = textBubble(msg());
  assert.deepEqual([sent.statusLabel, sent.ticks, sent.failed], ["Sent", 1, false]);
  const delivered = textBubble(msg({ status: "delivered" }));
  assert.deepEqual([delivered.statusLabel, delivered.ticks], ["Delivered", 2]);
  for (const status of ["failed", "refused"] as const) {
    const b = textBubble(msg({ status, failureReason: "textsms_500" }));
    assert.equal(b.statusLabel, "Not delivered");
    assert.equal(b.failed, true);
    assert.equal(b.canRetry, true);
    assert.equal(b.reason, "Text service error.");
    assert.equal(b.ticks, 0);
  }
});

test("bubbles: owner right in accent, Business Assistant right and labelled, caller left", () => {
  const owner = textBubble(msg());
  assert.deepEqual([owner.side, owner.tone, owner.label], ["right", "owner", null]);
  for (const authorKind of ["assistant", "system"] as const) {
    const a = textBubble(msg({ authorKind, source: "missed_textback" }));
    assert.deepEqual([a.side, a.tone, a.label], ["right", "assistant", "Business Assistant"]);
  }
  const caller = textBubble(msg({ direction: "in", status: "received", authorKind: null, source: "inbound" }));
  assert.deepEqual([caller.side, caller.tone, caller.statusLabel, caller.canRetry], ["left", "caller", null, false]);
});

test("a retried failed text shows only as its retry; the tab counts what shows", () => {
  const list = [
    msg({ id: "a", status: "failed", failureReason: "no_caller_phone" }),
    msg({ id: "b", status: "pending", retryOf: "a" }),
    msg({ id: "c" }),
  ];
  assert.deepEqual(textThreadBubbles(list).map((b) => b.id), ["b", "c"]);
  assert.equal(textThreadCount(list), 2);
  assert.equal(textThreadCount([]), 0);
});

test("failure reasons in owner words", () => {
  assert.equal(textFailureReason(null), null);
  assert.equal(textFailureReason("no_caller_phone"), "No valid number.");
  assert.equal(textFailureReason("sms_allowance_exhausted"), "Included SMS used.");
  assert.equal(textFailureReason("sms_not_configured"), "Texting is not set up for this business yet.");
  assert.equal(textFailureReason("weird"), "Send failed.");
});

test("empty state copy, no dashes, business words", () => {
  assert.equal(
    textThreadEmpty("Chris"),
    "No texts with Chris yet. Texts you send here show up in this thread."
  );
  assert.equal(
    textThreadEmpty(null),
    "No texts with this caller yet. Texts you send here show up in this thread."
  );
});

test("composer meter: parts and included left; nothing without included SMS", () => {
  assert.equal(smsMeterLine({ segments: 1, included: 300, used: 38 }), "1 SMS · 262 of 300 included left");
  assert.equal(smsMeterLine({ segments: 0, included: 300, used: 400 }), "1 SMS · 0 of 300 included left");
  assert.equal(smsMeterLine({ segments: 2, included: 0, used: 0 }), null);
  assert.equal(smsMeterLine({ segments: 1, included: null, used: null }), null);
  assert.equal(smsSegments("x".repeat(160)), 1);
  assert.equal(smsSegments("x".repeat(161)), 2);
});

test("bubble time in Nairobi", () => {
  assert.equal(textBubbleTime("2026-10-22T07:02:00.000Z"), "10:02 AM");
  assert.equal(textBubbleTime("nope"), "");
});

test("list: first page only (no cursors), normalized rows", async () => {
  const { log, client } = rpcClient(() => ({
    data: {
      messages: [
        { id: "m1", created_at: "2026-10-22T07:02:00Z", direction: "out", body: "Hi", status: "sent", author_kind: "owner", source: "caller_note", status_from: "ledger" },
        { id: "", body: "dropped" },
        { id: "m2", created_at: "2026-10-22T07:03:00Z", direction: "out", body: "Yo", status: "bogus", author_kind: "x", source: "caller_note" },
      ],
      unread_in: 0,
      has_more: false,
    },
    error: null,
  }));
  const res = await loadCallMessages(client, TENANT, CALL);
  assert.deepEqual(log, [["call_messages_list", { p_tenant_id: TENANT, p_call_id: CALL, p_limit: 100 }]]);
  assert.equal(res.available, true);
  assert.deepEqual(res.messages.map((m) => [m.id, m.status, m.authorKind]), [
    ["m1", "sent", "owner"],
    ["m2", "pending", null],
  ]);
});

test("list fallback: missing RPC or any error means no thread (view as before)", async () => {
  for (const error of [MISSING, { code: "42501", message: "not allowed" }, { code: "P0002", message: "call not found" }]) {
    const { client } = rpcClient(() => ({ data: null, error }));
    const res = await loadCallMessages(client, TENANT, CALL);
    assert.deepEqual(res, { available: false, messages: [], unreadIn: 0, hasMore: false });
  }
  const throwing = { rpc: async () => { throw new Error("network"); } } as any;
  assert.equal((await loadCallMessages(throwing, TENANT, CALL)).available, false);
});

test("missing detection only for an absent function or table", () => {
  assert.equal(isCallMessagesRpcMissing(MISSING), true);
  assert.equal(isCallMessagesRpcMissing({ code: "42883", message: "function does not exist" }), true);
  assert.equal(isCallMessagesRpcMissing({ code: "22023", message: "limit must be 1..100" }), false);
  assert.equal(isCallMessagesRpcMissing(null), false);
});

test("record_out: same key and source, notify send id, visit link", async () => {
  const { log, client } = rpcClient(() => ({ data: { id: "m9", status: "sent", created_at: "x" }, error: null }));
  const res = await recordCallMessageOut(client, {
    tenantId: TENANT,
    callId: CALL,
    key: `reply:${TENANT}:r1`,
    source: "caller_appointment_confirmed",
    body: " Confirmed ",
    notifySendId: "n1",
    appointmentId: "a1",
  });
  assert.deepEqual(res, { mode: "recorded", id: "m9", status: "sent" });
  assert.deepEqual(log, [[
    "call_messages_record_out",
    {
      p_tenant_id: TENANT,
      p_call_id: CALL,
      p_key: `reply:${TENANT}:r1`,
      p_source: "caller_appointment_confirmed",
      p_body: "Confirmed",
      p_notify_send_id: "n1",
      p_appointment_id: "a1",
      p_request_id: null,
    },
  ]]);
});

test("record_out never throws and skips what it cannot record", async () => {
  const none = rpcClient(() => ({ data: null, error: null }));
  assert.deepEqual(await recordCallMessageOut(none.client, { tenantId: TENANT, callId: null, key: "k", source: "caller_note", body: "x" }), { mode: "skipped", reason: "no_call" });
  assert.deepEqual(await recordCallMessageOut(none.client, { tenantId: TENANT, callId: CALL, key: "k", source: "lead", body: "x" }), { mode: "skipped", reason: "source" });
  assert.equal(none.log.length, 0);
  const missing = rpcClient(() => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.call_messages_record_out" } }));
  assert.deepEqual(await recordCallMessageOut(missing.client, { tenantId: TENANT, callId: CALL, key: "k", source: "caller_note", body: "x" }), { mode: "missing" });
  const dup = rpcClient(() => ({ data: null, error: { code: "23505", message: "already recorded" } }));
  assert.deepEqual(await recordCallMessageOut(dup.client, { tenantId: TENANT, callId: CALL, key: "k", source: "caller_note", body: "x" }), { mode: "skipped", reason: "already_recorded" });
  const boom = { rpc: async () => { throw new Error("socket"); } } as any;
  const res = await recordCallMessageOut(boom, { tenantId: TENANT, callId: CALL, key: "k", source: "caller_note", body: "x" });
  assert.equal(res.mode, "error");
});

test("every Desk caller kind is a source record_out accepts", () => {
  const ledger = src("lib/sendLedger.ts");
  const kinds = [...ledger.matchAll(/\| "(caller_[a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(kinds.length >= 9);
  for (const k of kinds) assert.ok(CALL_MESSAGE_SOURCES.has(k), k);
  assert.equal(CALL_MESSAGE_SOURCES.has("inbound"), false);
});

test("send flow: thread record after settle, never alters the SMS result", () => {
  const ledger = src("lib/sendLedger.ts");
  const fn = ledger.slice(ledger.indexOf("export async function sendRecordedDeskCallerSms"));
  const settle = fn.indexOf("await settleNotifySend(");
  const record = fn.indexOf("await recordDeskThread(opts, key, reservation.id)");
  assert.ok(settle > 0 && record > settle, "record after settle");
  assert.ok(record < fn.indexOf("if (!sent.ok) return sent;"), "failed sends are recorded too (Retry)");
  assert.match(fn, /if \(legacy\.ok\) await recordDeskThread\(opts, key, null\)/);
  assert.match(fn, /String\(opts\.key \|\| ""\)\.trim\(\) \|\| deskSendKey\(opts\)/);
  assert.match(ledger, /opts\.recordThread === false \|\| !opts\.callId\) return;/);
  assert.match(ledger, /catch \(err\) \{\n\s+console\.warn\("\[call messages\] record"/);
});

test("visit and hold sends link the thread row", () => {
  assert.equal((src("app/(desk)/appointments/actions.ts").match(/appointmentId: id \|\| null/g) || []).length, 2);
  assert.equal((src("app/(desk)/requests/actions.ts").match(/requestId: id \|\| null/g) || []).length, 2);
  assert.match(src("app/(desk)/calls/bulkActions.ts"), /appointmentId: text\.appointmentId/);
});

test("allowance copy points to Usage, shared by send and Retry", () => {
  assert.equal(deskSmsSendError({ reason: "sms_allowance_exhausted" }), "Included SMS used. Enable on-demand on Usage.");
  assert.equal(deskSmsSendError({ reason: "instance_already_sent" }), "Already sent.");
  assert.equal(deskSmsSendError({ reason: "x", message: "Line paused." }), "Line paused.");
  const notes = src("app/(desk)/calls/noteActions.ts");
  assert.doesNotMatch(notes, /on Wallet/);
  assert.match(notes, /return \{ error: deskSmsSendError\(sent\) \}/);
});

test("Retry: call_messages_retry key, sent without a second thread row", () => {
  const a = src("app/(desk)/calls/textThreadActions.ts");
  assert.match(a, /^"use server";/);
  assert.match(a, /memberDenied\("inbox\.act"\)/);
  assert.match(a, /rpc\("call_messages_retry"/);
  assert.match(a, /recordThread: false/);
  assert.match(a, /error\.code === "23505"\) return \{ error: "Already retried\." \}/);
});

test("call view: Call | Texts toggle only with a thread, ?tab=texts, composer switches to Texts", () => {
  const view = src("components/InboxTicketView.tsx");
  const page = src("app/(desk)/calls/[id]/page.tsx");
  assert.match(page, /loadCallMessages\(workspace\.client, tenant\.id, id\)/);
  assert.match(page, /texts=\{thread\.available \? \{ messages: thread\.messages \} : null\}/);
  assert.match(page, /callViewTab\(sp\.tab, thread\.available\)/);
  assert.match(view, /const tab: CallViewTab = texts \? tabPick : "call";/);
  assert.equal((view.match(/\{texts \? \(\n/g) || []).length, 2, "phone and desktop tab bars, both gated on texts");
  assert.match(view, /label="Call or texts"/);
  assert.match(view, /url\.searchParams\.set\("tab", "texts"\)/);
  assert.match(view, /onSent=\{texts \? \(\) => selectTab\("texts"\) : undefined\}/);
  assert.match(view, /tab === "texts" \? "max-lg:hidden" : ""/);
  assert.match(view, /<CallTranscript turns=\{turns\} mode="thread"/);
});

test("new UI: tokens only, no dashes in copy, no new libraries", () => {
  for (const f of ["components/CallTextThread.tsx", "lib/callTextThread.ts", "components/InboxSmsDock.tsx", "lib/deskSmsError.ts"]) {
    const s = src(f);
    assert.doesNotMatch(s, /#[0-9a-fA-F]{3,8}\b/, `${f} hex`);
    assert.doesNotMatch(s, /[\u2013\u2014]/, `${f} dash`);
    assert.doesNotMatch(s, /\btenant\b|\bshop\b/i, `${f} wording`);
    assert.doesNotMatch(s, /framer-motion|from "motion|gsap|lottie/i, `${f} motion lib`);
  }
  const thread = src("components/CallTextThread.tsx");
  assert.match(thread, /bg-accent text-accent-on/);
  assert.match(thread, /bg-surface-2 text-ink/);
  assert.match(thread, /border-attention/);
});

test("normalize keeps inbound shape for later", () => {
  const m = normalizeCallMessage({ id: "i1", body: "Yes", direction: "in", status: "received", source: "inbound" });
  assert.equal(m?.direction, "in");
  assert.equal(m?.status, "received");
  assert.equal(normalizeCallMessage(null), null);
});

test("not set up: plain copy in the composer error and the bubble, and no Retry", () => {
  const copy = "Texting is not set up for this business yet.";
  assert.equal(deskSmsSendError({ reason: "sms_not_configured" }), copy);
  const b = textBubble(msg({ status: "failed", failureReason: "sms_not_configured" }));
  assert.equal(b.reason, copy);
  assert.equal(b.canRetry, false);
  assert.equal(textBubble(msg({ status: "failed", failureReason: "textsms_502" })).canRetry, true);
  assert.equal(textBubble(msg({ status: "refused", failureReason: "sms_allowance_exhausted" })).canRetry, true);
  assert.doesNotMatch(copy, /[\u2013\u2014]/);
});

test("composer placeholder: first name, else caller", () => {
  assert.equal(composerPlaceholder("Chris Otieno"), "Text Chris");
  assert.equal(composerPlaceholder("  "), "Text caller");
  assert.equal(composerPlaceholder(null), "Text caller");
  const dock = src("components/InboxSmsDock.tsx");
  assert.match(dock, /placeholder=\{composerPlaceholder\(callerName\)\}/);
  assert.doesNotMatch(dock, /placeholder="SMS"/);
});

test("after Send, sent or failed: refresh the thread and switch to Texts", () => {
  const notes = src("app/(desk)/calls/noteActions.ts");
  const fail = notes.slice(notes.indexOf("if (!sent.ok) {"));
  assert.ok(fail.indexOf("revalidatePath(`/calls/${callId}`)") < fail.indexOf("return {"), "failed send refreshes the call");
  assert.match(notes, /return \{ \.\.\.ownerSmsFailure\(sent\), attempted: true, token: Date\.now\(\) \}/);
  assert.match(notes, /return \{ ok: true, attempted: true, token: Date\.now\(\) \}/);
  const dock = src("components/InboxSmsDock.tsx");
  assert.match(dock, /if \(sendState\.attempted\) onSentRef\.current\?\.\(\);\n\s+\}, \[sendState\]\);/);
});
