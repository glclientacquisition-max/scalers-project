// N+1 fixes (audit 21 Oct): inbox bulk + Undo, Overview prices sheet, owner attest.
// Each test counts server requests / database round trips with injected fakes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  INBOX_BULK_MAX,
  cleanInboxBulkIds,
  inboxBulkTargets,
  inboxBulkOutcomeText,
  inboxBulkPlan,
  inboxUndoOutcomeText,
  sendInboxArchiveUndo,
  sendInboxBulk,
  type InboxBulkKind,
} from "../dashboard/src/lib/inboxBulk.ts";
import { inboxBulkCallerTexts, runInboxBulkUpdate } from "../dashboard/src/lib/inboxBulkRun.ts";
import { applyPriceBatch, priceStampPaths, runPriceBatch, type PriceConfirmInput } from "../dashboard/src/lib/priceBatch.ts";
import { ownerAttestBatch, ownerStampPatch, runOwnerAttest } from "../dashboard/src/lib/ownerAttestBatch.ts";
import { hashFactValue, factValueForPath } from "../dashboard/src/lib/factHash.ts";

const src = (p: string) => readFileSync(new URL(`../dashboard/src/${p}`, import.meta.url), "utf8");

// ---------------------------------------------------------------- inbox ----

function item(i: number, partial: Record<string, unknown> = {}) {
  return {
    id: `call-${i}`,
    callId: `call-${i}`,
    lead: { leadStatus: "new" },
    hold: null,
    job: null,
    ...partial,
  } as any;
}

function countingSend() {
  const calls: Array<{ kind: InboxBulkKind; ids: string[] }> = [];
  // The server answers with every id it updated (all of them here).
  const send = async (kind: InboxBulkKind, ids: string[]) => {
    calls.push({ kind, ids });
    return { ok: true, updatedIds: ids };
  };
  return { calls, send };
}

test("inbox: archiving 30 rows is ONE server request with all 30 call ids (was 30)", async () => {
  const items = Array.from({ length: 30 }, (_, i) => item(i));
  const { calls, send } = countingSend();
  const res = await sendInboxBulk("archive", items, send);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, "archive");
  assert.deepEqual(calls[0].ids, items.map((r) => r.callId));
  assert.equal(res.applied.length, 30);
  assert.equal(res.error, undefined);
  assert.equal(inboxBulkOutcomeText("archive", res), null);
});

test("inbox: Undo of 30 archived rows is ONE request back to New (was 30)", async () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ id: `row-${i}`, callId: `call-${i}` }));
  const { calls, send } = countingSend();
  const res = await sendInboxArchiveUndo(rows, send);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, "unarchive");
  assert.equal(calls[0].ids.length, 30);
  assert.equal(res.restored.length, 30);
  assert.equal(res.missed.length, 0);
});

test("inbox: every bulk kind keeps the old skip rules and sends once", async () => {
  const items = [
    item(1, { job: { id: "job-1", status: "requested" } }),
    item(2, { job: { id: "job-2", status: "confirmed" } }),
    item(3, { hold: { id: "hold-3", status: "open" } }),
    item(4, { hold: { id: "hold-4", status: "fulfilled" } }),
    item(5),
    item(6, { lead: { leadStatus: "archived" } }),
  ];
  const expect: Record<InboxBulkKind, string[]> = {
    confirm: ["job-1"],
    done: ["hold-3"],
    mark_done: ["call-5"],
    // Rows 1 to 4 have a lead plus their request: they are call rows, so they archive.
    archive: ["call-1", "call-2", "call-3", "call-4", "call-5"],
    unarchive: ["call-6"],
  };
  for (const kind of Object.keys(expect) as InboxBulkKind[]) {
    const { calls, send } = countingSend();
    await sendInboxBulk(kind, items, send);
    assert.equal(calls.length, 1, kind);
    assert.deepEqual(calls[0].ids, expect[kind], kind);
  }
});

test("inbox: nothing eligible sends nothing; a server error hides nothing", async () => {
  const { calls, send } = countingSend();
  const none = await sendInboxBulk("confirm", [item(1)], send);
  assert.equal(calls.length, 0);
  assert.deepEqual(none.applied, []);
  assert.deepEqual(none.skipped, [{ itemId: "call-1", reason: "not_eligible" }]);
  const failed = await sendInboxBulk("archive", [item(1), item(2)], async () => ({ error: "Could not archive." }));
  assert.equal(failed.error, "Could not archive.");
  assert.deepEqual(failed.applied, []);
});

test("inbox: dev harness skips the server for calls-only kinds, as before", async () => {
  const { calls, send } = countingSend();
  const res = await sendInboxBulk("archive", [item(1)], send, { harness: true });
  assert.equal(calls.length, 0);
  assert.equal(res.applied.length, 1);
});

test("inbox: ids are cleaned, de-duplicated and capped", () => {
  assert.deepEqual(cleanInboxBulkIds([" a ", "a", "b", 3, ""]), ["a", "b"]);
  assert.equal(cleanInboxBulkIds([]), null);
  assert.equal(cleanInboxBulkIds("a"), null);
  assert.equal(cleanInboxBulkIds(Array.from({ length: INBOX_BULK_MAX + 1 }, (_, i) => `id-${i}`)), null);
  // Two rows on one id: both are targets, the server gets the id once.
  const twice = inboxBulkPlan("archive", [item(1), item(1)]);
  assert.equal(twice.targets.length, 2);
  assert.deepEqual(twice.ids, ["call-1"]);
});

// Staging repro, Done and Dusted, 21 Oct: the first 30 rows of Needs you (81).
// Row 19 is hold 93ab7756 with no call row of its own: it is a second open
// request on call 2af42c11, whose call row (row 20) already carries hold 8c713352.
// Both rows had callId 2af42c11. The old plan de-duplicated by call id and
// dropped row 19 silently: 30 selected, "29 archived". Archiving the call never
// closes that hold, so the row stays in Needs you either way.
function doneAndDustedFirst30() {
  const rows = Array.from({ length: 30 }, (_, i) => item(i));
  rows[18] = {
    id: "93ab7756-fad0-4997-8e18-f12eb677f3ac",
    callId: "2af42c11-4344-46d0-ad48-92d0a38e0dfb",
    lead: null,
    hold: { id: "93ab7756-fad0-4997-8e18-f12eb677f3ac", status: "open", request_type: "enquiry" },
    job: null,
  } as any;
  rows[19] = item(19, {
    id: "2af42c11-4344-46d0-ad48-92d0a38e0dfb",
    callId: "2af42c11-4344-46d0-ad48-92d0a38e0dfb",
    hold: { id: "8c713352-8f9f-4cef-b80d-3f0fe848c489", status: "open", request_type: "enquiry" },
  });
  return rows;
}

test("repro: 30 selected with a second request on one call: every row accounted for", async () => {
  const rows = doneAndDustedFirst30();
  const { calls, send } = countingSend();
  const res = await sendInboxBulk("archive", rows, send);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].ids.length, 29);
  assert.equal(res.applied.length, 29);
  assert.deepEqual(res.skipped, [{ itemId: "93ab7756-fad0-4997-8e18-f12eb677f3ac", reason: "open_request" }]);
  assert.equal(res.applied.length + res.missed.length + res.skipped.length, 30);
  assert.equal(
    inboxBulkOutcomeText("archive", res),
    "29 of 30 archived. 1 is an open request on a call, so use Done or Confirm on it."
  );
  assert.ok(res.applied.some((t) => t.itemId === "2af42c11-4344-46d0-ad48-92d0a38e0dfb"));
});

test("ids the server did not update are reported, not counted, and not offered for Undo", async () => {
  const rows = Array.from({ length: 30 }, (_, i) => item(i));
  const res = await sendInboxBulk("archive", rows, async (_kind, ids) => ({ ok: true, updatedIds: ids.filter((id) => id !== "call-7") }));
  assert.equal(res.applied.length, 29);
  assert.deepEqual(res.missed.map((t) => t.itemId), ["call-7"]);
  assert.equal(inboxBulkOutcomeText("archive", res), "29 of 30 archived. 1 was already handled.");
  // An older server without updatedIds changes nothing as far as the client claims.
  const old = await sendInboxBulk("archive", rows, async () => ({ ok: true }));
  assert.equal(old.applied.length, 0);
  assert.equal(old.missed.length, 30);
});

test("Undo restores exactly the archived rows and reports any that changed since", async () => {
  const archived = Array.from({ length: 29 }, (_, i) => ({ id: `call-${i}`, callId: `call-${i}` }));
  const sent: string[][] = [];
  const res = await sendInboxArchiveUndo(archived, async (_kind, ids) => {
    sent.push(ids);
    return { ok: true, updatedIds: ids.filter((id) => id !== "call-3") };
  });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], archived.map((r) => r.callId));
  assert.equal(res.restored.length, 28);
  assert.deepEqual(res.missed, [{ id: "call-3", callId: "call-3" }]);
  assert.equal(inboxUndoOutcomeText(res), "28 of 29 restored. 1 was changed since.");
  assert.equal(inboxUndoOutcomeText({ restored: archived, missed: [] }), null);
});

/** Fake supabase-js query builder: records every terminal round trip. */
function fakeClient(result: { data?: unknown; error?: unknown } = { data: [] }) {
  const trips: Array<{ table: string; ops: Array<[string, unknown[]]> }> = [];
  const client = {
    from(table: string) {
      const trip = { table, ops: [] as Array<[string, unknown[]]> };
      trips.push(trip);
      const chain: any = {};
      for (const op of ["update", "in", "eq", "select"]) {
        chain[op] = (...args: unknown[]) => {
          trip.ops.push([op, args]);
          return chain;
        };
      }
      chain.then = (resolve: (v: unknown) => void) => resolve({ data: result.data ?? null, error: result.error ?? null });
      return chain;
    },
  };
  return { client: client as any, trips };
}

test("inbox server: one UPDATE … IN (ids) scoped to the business, per action", async () => {
  for (const [kind, table, column, value] of [
    ["archive", "calls", "lead_status", "archived"],
    ["unarchive", "calls", "lead_status", "new"],
    ["mark_done", "calls", "lead_status", "resolved"],
    ["confirm", "appointments", "status", "confirmed"],
    ["done", "service_requests", "status", "fulfilled"],
  ] as const) {
    const ids = Array.from({ length: 30 }, (_, i) => `id-${i}`);
    const { client, trips } = fakeClient({ data: ids.map((id) => ({ id })) });
    const res = await runInboxBulkUpdate({ client, tenantId: "t1", kind, ids, now: new Date("2026-10-21T00:00:00Z") });
    assert.equal(trips.length, 1, kind);
    assert.equal(trips[0].table, table);
    const ops = Object.fromEntries(trips[0].ops.map(([op, args]) => [op, args]));
    assert.equal((ops.update[0] as Record<string, string>)[column], value, kind);
    assert.deepEqual(ops.in, ["id", ids]);
    assert.deepEqual(ops.eq, ["tenant_id", "t1"]);
    assert.equal(res.rows.length, 30);
    assert.equal(res.error, null);
  }
});

test("inbox server: a database error returns no rows", async () => {
  const { client } = fakeClient({ error: { message: "denied" } });
  const res = await runInboxBulkUpdate({ client, tenantId: "t1", kind: "archive", ids: ["a"] });
  assert.deepEqual(res, { rows: [], error: { message: "denied" } });
});

test("inbox server: Confirm and hold Done still text each caller when caller texts are on", () => {
  const tenant = { business_name: "Done and Dusted", notify_channels: { caller_sms: true } };
  const confirm = inboxBulkCallerTexts({
    kind: "confirm",
    tenant,
    rows: [
      { id: "a", caller_phone: "254700000001", caller_name: "Amina", service_name: "Deep clean", when_text: "Fri 10am", call_id: "c1" },
      { id: "b", caller_phone: "", caller_name: "No phone" },
    ],
  });
  assert.equal(confirm.length, 1);
  assert.equal(confirm[0].kind, "caller_appointment_confirmed");
  assert.equal(confirm[0].callId, "c1");
  const done = inboxBulkCallerTexts({
    kind: "done",
    tenant,
    rows: [
      { id: "h", caller_phone: "254700000002", request_type: "hold", item: "Mop" },
      { id: "q", caller_phone: "254700000003", request_type: "quote", item: "Sofa" },
    ],
  });
  assert.deepEqual(done.map((t) => t.kind), ["caller_hold_ready"]);
  assert.equal(inboxBulkCallerTexts({ kind: "archive", tenant, rows: [{ id: "x", caller_phone: "2547" }] }).length, 0);
  assert.equal(
    inboxBulkCallerTexts({ kind: "confirm", tenant: { business_name: "X", notify_channels: {} }, rows: [{ id: "a", caller_phone: "2547" }] }).length,
    0
  );
});

test("inbox wiring: the bar and Undo call the bulk action, not a per-row loop", () => {
  const select = src("components/InboxRowSelect.tsx");
  assert.match(select, /await inboxBulk\(kind, chosen\)/);
  // Undo is offered for applied rows only; leftovers stay selected with the reason.
  assert.match(select, /archive\.applied\s*\.filter\(\(target\) => target\.callId\)/);
  assert.match(select, /replace\(left\)/);
  assert.match(select, /inboxBulkOutcomeText\(kind, res\)/);
  assert.doesNotMatch(select, /for \(const item of chosen\)/);
  const toast = src("components/InboxArchiveToast.tsx");
  assert.match(toast, /await inboxUndoArchive\(notice\.rows\)/);
  assert.match(toast, /for \(const row of res\.restored\)/);
  assert.doesNotMatch(toast, /updateLeadStatus/);
  const action = src("app/(desk)/calls/bulkActions.ts");
  assert.match(action, /memberDenied\("inbox\.act"\)/);
  assert.match(action, /isAuthenticated\(\)/);
  assert.match(action, /getCurrentTenant\(\)/);
  assert.match(action, /tenantId: tenant\.id/);
  assert.match(action, /updatedIds/);
});

// --------------------------------------------------------------- prices ----

const services = Array.from({ length: 10 }, (_, i) => ({
  id: `svc_${String(i).padStart(16, "0")}`,
  name: `Service ${i}`,
  price_range: `KSh ${1000 + i * 100}`,
  pricing: { mode: "fixed", amount_ksh: 1000 + i * 100, source: "parsed", confirmed: false },
}));
const products = [{ sku: "P1", name: "Ream", price: "KSh 600", pricing: { mode: "fixed", amount_ksh: 600, source: "parsed", confirmed: false } }];

function priceInputs(): PriceConfirmInput[] {
  return [
    ...services.map((row, i) => ({
      kind: "service" as const,
      id: row.id,
      name: row.name,
      pricing: { mode: "fixed", amount_ksh: 2000 + i, unit: null } as any,
    })),
    { kind: "product" as const, id: null, name: "Ream", pricing: { mode: "fixed", amount_ksh: 650 } as any },
  ];
}

function countingPriceDeps() {
  const n = { readFresh: 0, write: 0, restamp: 0, recompile: 0 };
  const seen: { columns?: any; paths?: string[] } = {};
  const deps = {
    readFresh: async () => {
      n.readFresh += 1;
      return { services_catalog: structuredClone(services), product_catalog: structuredClone(products) };
    },
    write: async (columns: any) => {
      n.write += 1;
      seen.columns = columns;
      return { error: null };
    },
    restamp: async (paths: string[]) => {
      n.restamp += 1;
      seen.paths = paths;
    },
    recompile: async () => {
      n.recompile += 1;
    },
  };
  return { n, seen, deps };
}

test("prices: 11 prices = 1 read, 1 save, 1 hash re-stamp, 1 prompt rebuild (was 11 of each)", async () => {
  const inputs = priceInputs();
  const after = countingPriceDeps();
  const res = await runPriceBatch(after.deps, inputs);
  assert.deepEqual(res, { ok: true, message: "Prices saved." });
  assert.deepEqual(after.n, { readFresh: 1, write: 1, restamp: 1, recompile: 1 });
  assert.equal(after.seen.columns.services_catalog.length, 10);
  assert.equal(after.seen.columns.product_catalog[0].pricing.amount_ksh, 650);
  // .price and .name per item, keyed by stable id / sku.
  assert.equal(after.seen.paths!.length, 22);
  assert.ok(after.seen.paths!.includes("catalog.service.svc_0000000000000003.price"));
  assert.ok(after.seen.paths!.includes("catalog.product.P1.name"));

  // Before: the sheet ran the single-price save once per item.
  const before = countingPriceDeps();
  for (const input of inputs) await runPriceBatch(before.deps, [input]);
  assert.deepEqual(before.n, { readFresh: 11, write: 11, restamp: 11, recompile: 11 });
});

test("prices: the batch writes exactly what one-by-one confirms would have", () => {
  const inputs = priceInputs();
  const fresh = { services_catalog: structuredClone(services), product_catalog: structuredClone(products) };
  const batch = applyPriceBatch(fresh, inputs);
  assert.ok(batch.ok);
  let seq: any = structuredClone(fresh);
  for (const input of inputs) {
    const one = applyPriceBatch(seq, [input]);
    assert.ok(one.ok);
    seq = { ...seq, ...one.columns };
  }
  assert.deepEqual(batch.columns.services_catalog, seq.services_catalog);
  assert.deepEqual(batch.columns.product_catalog, seq.product_catalog);
  assert.deepEqual(priceStampPaths(batch.columns, [inputs[0]]), [
    "catalog.service.svc_0000000000000000.price",
    "catalog.service.svc_0000000000000000.name",
  ]);
});

test("prices: one bad price or a missing item saves nothing", async () => {
  const bad = priceInputs();
  bad[4] = { ...bad[4], pricing: { mode: "fixed", amount_ksh: null } as any };
  const a = countingPriceDeps();
  const res = await runPriceBatch(a.deps, bad);
  assert.equal(res.ok, false);
  assert.deepEqual(a.n, { readFresh: 0, write: 0, restamp: 0, recompile: 0 });

  const gone = [...priceInputs(), { kind: "service" as const, id: "svc_gone", name: "Gone", pricing: { mode: "fixed", amount_ksh: 5 } as any }];
  const b = countingPriceDeps();
  const res2 = await runPriceBatch(b.deps, gone);
  assert.deepEqual(res2, { ok: false, error: "That item is no longer in your catalogue." });
  assert.equal(b.n.write, 0);
  assert.equal(b.n.recompile, 0);
});

test("prices wiring: the Overview sheet makes one confirmPricesAction call", () => {
  const overview = src("app/(desk)/settings/overviewActions.ts");
  assert.match(overview, /await confirmPricesAction\(items\)/);
  assert.doesNotMatch(overview, /for \(const item of items\)/);
  const structured = src("app/(desk)/settings/structuredActions.ts");
  assert.match(structured, /return confirmPricesAction\(\[input\]\)/);
  assert.match(structured, /runPriceBatch\(/);
});

// --------------------------------------------------------------- attest ----

function attestRow() {
  return {
    business_name: "Done and Dusted",
    services_catalog: Array.from({ length: 30 }, (_, i) => ({ name: `Svc ${i}`, price_range: "KSh 100" })),
    product_catalog: [{ sku: "P1", name: "Ream" }],
    faqs: Array.from({ length: 40 }, (_, i) => ({ question: `Q${i}?`, answer: `A${i}`, status: i === 0 ? "golden" : "seed" })),
    business_policies: { payment: "M-Pesa", provenance: {} },
  };
}

function attestPaths() {
  return [
    ...Array.from({ length: 30 }, (_, i) => `catalog.service.${i + 1}.name`),
    "catalog.product.P1.name",
    ...Array.from({ length: 40 }, (_, i) => `faqs.${i + 1}`),
    "policies.payment",
    "identity.business_name",
    ...Array.from({ length: 7 }, (_, i) => `catalog.service.${i + 1}.price`),
  ];
}

function countingAttestDeps(row: any, batchError: unknown = null) {
  const n = { readRow: 0, writePatch: 0, confirmBatch: 0, confirmOne: 0 };
  const seen: { patch?: any; paths?: string[]; hashes?: string[] } = {};
  const deps = {
    readRow: async () => {
      n.readRow += 1;
      return row;
    },
    writePatch: async (patch: any) => {
      n.writePatch += 1;
      seen.patch = patch;
      return { error: null };
    },
    confirmBatch: async (paths: string[], hashes: string[]) => {
      n.confirmBatch += 1;
      seen.paths = paths;
      seen.hashes = hashes;
      return { error: batchError };
    },
    confirmOne: async () => {
      n.confirmOne += 1;
    },
  };
  return { n, seen, deps };
}

test("attest: an 80-path save = 1 read, 1 patch, 1 batch confirm (was 224 sequential queries incl. 72 whole-column rewrites)", async () => {
  const paths = attestPaths();
  assert.equal(paths.length, 80);
  const { n, seen, deps } = countingAttestDeps(attestRow());
  const run = await runOwnerAttest(deps, paths);
  assert.deepEqual(n, { readRow: 1, writePatch: 1, confirmBatch: 1, confirmOne: 0 });
  assert.deepEqual(run, { stamped: true, batched: true, fallbackPaths: 0 });
  assert.equal(seen.paths!.length, 80);
  assert.ok(seen.hashes!.every((h) => /^[0-9a-f]{64}$/.test(h)));
  assert.equal(seen.hashes![seen.paths!.indexOf("identity.business_name")], hashFactValue(factValueForPath("identity.business_name", attestRow())));
  // Every JSON row the old loop stamped, in one patch.
  assert.ok(seen.patch.services_catalog.every((r: any) => r.source === "owner"));
  assert.equal(seen.patch.product_catalog[0].source, "owner");
  assert.ok(seen.patch.faqs.every((f: any) => f.source === "owner" && f.confirmed === true));
  assert.equal(seen.patch.faqs[0].status, "golden");
  assert.equal(seen.patch.faqs[1].status, "confirmed");
  assert.deepEqual(seen.patch.business_policies.provenance, { payment: { source: "owner", confirmed: true } });
  assert.equal(seen.patch.business_policies.payment, "M-Pesa");
});

test("attest: the single patch equals stamping each path one by one", () => {
  const row = attestRow();
  const paths = attestPaths();
  const batch = ownerStampPatch(row, paths)!;
  let seq: any = structuredClone(row);
  for (const path of paths) {
    const one = ownerStampPatch(seq, [path]);
    if (one) seq = { ...seq, ...one };
  }
  for (const column of Object.keys(batch)) assert.deepEqual(batch[column as keyof typeof batch], seq[column], column);
  assert.equal(ownerStampPatch(row, ["identity.business_name", "hours.weekly_grid"]), null);
  assert.deepEqual(ownerAttestBatch(row, ["faqs.1", "faqs.1"]).paths, ["faqs.1"]);
});

test("attest: without the batch RPC, fall back to the old per-path meta confirm, still one patch", async () => {
  const paths = attestPaths();
  const { n, deps } = countingAttestDeps(attestRow(), { message: "Could not find the function public.confirm_tenant_fields" });
  const run = await runOwnerAttest(deps, paths);
  assert.deepEqual(n, { readRow: 1, writePatch: 1, confirmBatch: 1, confirmOne: 80 });
  assert.equal(run.fallbackPaths, 80);
  const unread = countingAttestDeps(null);
  await runOwnerAttest(unread.deps, paths);
  assert.deepEqual(unread.n, { readRow: 1, writePatch: 0, confirmBatch: 0, confirmOne: 80 });
});

test("attest wiring: ownerAttestFields goes through runOwnerAttest, no per-path loop", () => {
  const attest = src("lib/ownerAttestFields.ts");
  assert.match(attest, /await runOwnerAttest\(/);
  assert.doesNotMatch(attest, /for \(const fieldPath of paths\)/);
  assert.doesNotMatch(attest, /persistOwnerConfirm/);
});
