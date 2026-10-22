// Owner text-back stamp on the call: calls_record_caller_reply (#866) in ONE
// database UPDATE, with the old read-modify-write only when the RPC is missing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isCallerReplyRpcMissing, recordCallerReply } from "../dashboard/src/lib/callerReplyRecord.ts";

const TENANT = "df4ad9d8-28ff-4810-b1e6-94f5495472b0";
const CALL = "2af42c11-4344-46d0-ad48-92d0a38e0dfb";
const src = (p: string) => readFileSync(new URL(`../dashboard/src/${p}`, import.meta.url), "utf8");

function fake(rpc: () => { data: unknown; error: unknown }, summary: unknown = '{"headline":"Quote"}') {
  const log: any[] = [];
  const q: any = {
    select(cols: string) { log.push(["select", cols]); return q; },
    eq(c: string, v: string) { log.push(["eq", c, v]); return q; },
    maybeSingle() { return Promise.resolve({ data: { summary }, error: null }); },
    update(patch: any) { log.push(["update", patch]); return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }; },
  };
  return {
    log,
    client: {
      rpc: async (name: string, args: any) => { log.push(["rpc", name, args]); return rpc(); },
      from: (t: string) => { log.push(["from", t]); return q; },
    } as any,
  };
}

test("one RPC call with tenant, call and body; no table read or write", async () => {
  const { log, client } = fake(() => ({ data: { at: "2026-10-21T22:37:45.322037+00:00" }, error: null }));
  const res = await recordCallerReply({ client, tenantId: TENANT, callId: CALL, body: "On our way" });
  assert.deepEqual(log, [["rpc", "calls_record_caller_reply", { p_tenant_id: TENANT, p_call_id: CALL, p_body: "On our way" }]]);
  assert.deepEqual(res, { at: "2026-10-21T22:37:45.322037+00:00", mode: "rpc", error: null });
});

test("missing RPC (prod before #866): falls back to the old summary merge", async () => {
  const { log, client } = fake(() => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.calls_record_caller_reply(p_body, p_call_id, p_tenant_id) in the schema cache" } }));
  const now = new Date("2026-10-22T01:40:00.000+03:00");
  const res = await recordCallerReply({ client, tenantId: TENANT, callId: CALL, body: "On our way", now });
  assert.equal(res.mode, "legacy");
  assert.equal(res.error, null);
  const update = log.find((l) => l[0] === "update")[1];
  assert.deepEqual(JSON.parse(update.summary), { headline: "Quote", caller_reply_body: "On our way", caller_reply_at: "2026-10-21T22:40:00.000Z" });
  // A plain-text summary keeps its text, as before.
  const plain = fake(() => ({ data: null, error: { code: "42883", message: "function does not exist" } }), "Caller asked for a quote");
  await recordCallerReply({ client: plain.client, tenantId: TENANT, callId: CALL, body: "Hi", now });
  assert.equal(JSON.parse(plain.log.find((l) => l[0] === "update")[1].summary).text, "Caller asked for a quote");
});

test("refusals (22023 blank/too long, P0002 not found, 42501 not allowed) are returned, never retried as the old write", async () => {
  for (const code of ["22023", "P0002", "42501"]) {
    const { log, client } = fake(() => ({ data: null, error: { code, message: "refused" } }));
    const res = await recordCallerReply({ client, tenantId: TENANT, callId: CALL, body: "x" });
    assert.equal(res.error?.code, code);
    assert.equal(log.filter((l) => l[0] === "update").length, 0);
  }
  assert.equal(isCallerReplyRpcMissing({ code: "42501", message: "not allowed" }), false);
  assert.equal(isCallerReplyRpcMissing({ code: "PGRST202", message: "x" }), true);
});

test("caller_reply_at from the RPC (+00:00, microseconds) parses to the same instant as the old Z form", () => {
  const rpc = Date.parse("2026-10-21T22:37:45.322037+00:00");
  const old = Date.parse("2026-10-21T22:37:45.322Z");
  assert.ok(Number.isFinite(rpc));
  assert.equal(rpc, old);
  assert.equal(
    new Date(rpc).toLocaleString("en-KE", { timeZone: "Africa/Nairobi", hour: "2-digit", minute: "2-digit", hour12: false }),
    "01:37"
  );
});

test("wiring: noteActions stamps through recordCallerReply after the SMS and only warns on error", () => {
  const notes = src("app/(desk)/calls/noteActions.ts");
  assert.match(notes, /const stamp = await recordCallerReply\(\{\s*client: workspace\.client,\s*tenantId: tenant\.id,\s*callId,\s*body,\s*\}\);/);
  assert.match(notes, /if \(stamp\.error\) \{\s*console\.warn\("\[caller note summary\]", stamp\.error\.message\);/);
  assert.doesNotMatch(notes, /caller_reply_at: new Date\(\)/);
  assert.ok(notes.indexOf("sendRecordedDeskCallerSms({") < notes.indexOf("recordCallerReply({"), "stamp after the send");
});
