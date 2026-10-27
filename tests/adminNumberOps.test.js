/**
 * Admin number controls v1 (27 Oct 2026): server-action validation and copy.
 * Protected line refused before step-up and RPC; empty reason refused; noop → "Already done";
 * RPC errors → plain copy with no raw SQL text. Route gated by Unlock and registered.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const load = () => import(path.join(root, "dashboard/src/lib/ops/numberOps.ts"));
const loadCore = () => import(path.join(root, "dashboard/src/lib/ops/stepUpCore.ts"));

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const LONG_DASH = /[\u2013\u2014]/;

describe("protected line", () => {
  it("+254709221536 is refused in every form, before anything else", async () => {
    const { validateNumberOp, isProtectedNumber, PROTECTED_COPY } = await load();
    for (const n of ["+254709221536", "254709221536", "0709221536", "709221536", "+254 709 221 536"]) {
      assert.equal(isProtectedNumber(n), true, n);
      for (const body of [
        { action: "lift_quarantine", e164: n, reason: "test" },
        { action: "move", e164: n, from_business_id: A, to_business_id: B, reason: "test", confirm: true },
        { action: "restore", business_id: A, e164: n, reason: "test" },
        { action: "lift_quarantine", e164: n, reason: "" },
      ]) {
        const r = validateNumberOp(body);
        assert.equal(r.ok, false, `${body.action} ${n}`);
        assert.equal(r.status, 403);
        assert.equal(r.code, "protected_number");
        assert.equal(r.error, PROTECTED_COPY);
      }
    }
    assert.equal(isProtectedNumber("+254709221537"), false);
    assert.equal(isProtectedNumber("pending:709221536"), false);
  });

  it("UI disables all three controls on the protected line and says why", async () => {
    const { numberOpsFor } = await load();
    const row = { e164: "+254709221536", status: "assigned", businessId: A, lastBusinessId: null, businessActive: true };
    assert.equal(numberOpsFor(row).protectedLine, true);
    const ui = read("dashboard/src/components/admin/v2/NumberControls.tsx");
    assert.match(ui, /disabled=\{ops\.protectedLine\}/);
    assert.match(ui, /PROTECTED_COPY/);
  });

  it("route refuses before the Unlock gate and before the RPC", () => {
    const src = read("dashboard/src/app/api/admin/number-ops/route.ts");
    const v = src.indexOf("validateNumberOp(body)");
    const g = src.indexOf("stepUpGate(");
    const rpc = src.indexOf("runNumberOp(input");
    assert.ok(v > 0 && v < g && g < rpc, "validate, then gate, then RPC");
  });

  it("RPC 42501 maps to the protected copy", async () => {
    const { mapNumberOpError, PROTECTED_COPY } = await load();
    const e = mapNumberOpError({ code: "42501", message: "protected number: +254709221536 cannot be changed from Admin", hint: "This line is protected. Ask Alvin." });
    assert.deepEqual([e.status, e.code, e.error], [403, "protected_number", PROTECTED_COPY]);
  });
});

describe("reason and input", () => {
  it("empty, blank or short reasons are refused", async () => {
    const { validateNumberOp } = await load();
    for (const reason of [undefined, "", "   ", "ab", 42]) {
      const r = validateNumberOp({ action: "lift_quarantine", e164: "+254709221537", reason });
      assert.equal(r.ok, false);
      assert.equal(r.code, "reason_required");
      assert.equal(r.status, 400);
    }
    assert.equal(validateNumberOp({ action: "lift_quarantine", e164: "+254709221537", reason: "x".repeat(501) }).code, "reason_too_long");
  });

  it("accepts +254, 254 and 07 forms; rejects junk", async () => {
    const { validateNumberOp, normalizeKenyanE164 } = await load();
    for (const n of ["+254709221537", "254709221537", "0709221537", "+254 709 221 537"]) {
      assert.equal(normalizeKenyanE164(n), "+254709221537", n);
      const r = validateNumberOp({ action: "lift_quarantine", e164: n, reason: "Test line" });
      assert.equal(r.ok, true, n);
      assert.equal(r.input.e164, "+254709221537");
    }
    assert.equal(validateNumberOp({ action: "lift_quarantine", e164: "12345", reason: "ok ok" }).code, "bad_number");
    assert.equal(validateNumberOp({ action: "lift_quarantine", reason: "ok ok" }).code, "number_required");
    assert.equal(validateNumberOp({ action: "nuke", e164: "+254709221537", reason: "ok ok" }).code, "unknown_action");
    assert.equal(validateNumberOp(null).ok, false);
  });

  it("move needs two different businesses and confirm=true", async () => {
    const { validateNumberOp } = await load();
    const base = { action: "move", e164: "+254709221537", from_business_id: A, to_business_id: B, reason: "Owner sold it", confirm: true };
    assert.equal(validateNumberOp(base).ok, true);
    assert.equal(validateNumberOp({ ...base, confirm: false }).code, "confirm_required");
    assert.equal(validateNumberOp({ ...base, confirm: "true" }).code, "confirm_required");
    assert.equal(validateNumberOp({ ...base, to_business_id: A }).code, "same_business");
    assert.equal(validateNumberOp({ ...base, to_business_id: "x" }).code, "to_required");
    assert.equal(validateNumberOp({ ...base, from_business_id: null }).code, "from_required");
  });

  it("restore needs the business; lift sends confirm only when asked", async () => {
    const { validateNumberOp, numberOpRpc } = await load();
    assert.equal(validateNumberOp({ action: "restore", reason: "Released by mistake" }).code, "business_required");
    const r = validateNumberOp({ action: "restore", business_id: A, e164: "0709221537", reason: "Released by mistake" });
    assert.deepEqual(numberOpRpc(r.input, "alvin"), {
      fn: "admin_restore_business_number",
      args: { p_tenant_id: A, p_actor: "alvin", p_reason: "Released by mistake", p_confirm: true, p_e164: "+254709221537" },
    });
    const lift = validateNumberOp({ action: "lift_quarantine", e164: "+254709221537", reason: "Test line" });
    assert.equal(numberOpRpc(lift.input, "alvin").args.p_confirm, false);
    const liftC = validateNumberOp({ action: "lift_quarantine", e164: "+254709221537", reason: "Test line", confirm: true });
    assert.equal(numberOpRpc(liftC.input, "alvin").args.p_confirm, true);
    const mv = validateNumberOp({ action: "move", e164: "+254709221537", from_business_id: A, to_business_id: B, reason: "Sold", confirm: true });
    assert.deepEqual(numberOpRpc(mv.input, "alvin"), {
      fn: "admin_move_number",
      args: { p_e164: "+254709221537", p_from_tenant: A, p_to_tenant: B, p_actor: "alvin", p_reason: "Sold", p_confirm: true },
    });
  });
});

describe("result mapping", () => {
  it("noop:true reads Already done, not an error", async () => {
    const { mapNumberOpResult } = await load();
    for (const action of ["restore", "lift_quarantine", "move"]) {
      const r = mapNumberOpResult(action, { ok: true, action, noop: true, e164: "+254709221537", pool: { status: "available" } });
      assert.equal(r.ok, true);
      assert.equal(r.noop, true);
      assert.equal(r.headline, "Already done");
      assert.equal(r.note, null, "no cache note when nothing moved");
    }
  });

  it("a real move carries the 30 second routing note and both names", async () => {
    const { mapNumberOpResult, MOVE_CACHE_SECONDS } = await load();
    const r = mapNumberOpResult("move", {
      ok: true, action: "move_number", noop: false, e164: "+254709221537", pool: { status: "assigned" },
      from_tenant: { business_name: "Done and Dusted" }, to_tenant: { business_name: "Jirani Cleaning Services" },
    });
    assert.equal(r.headline, "Number moved to Jirani Cleaning Services");
    assert.equal(r.poolStatus, "Assigned");
    assert.equal(MOVE_CACHE_SECONDS, 30);
    assert.match(r.note, /30 seconds/);
    assert.match(r.note, /Done and Dusted/);
  });

  it("restore and lift summaries", async () => {
    const { mapNumberOpResult } = await load();
    assert.equal(mapNumberOpResult("restore", { noop: false, e164: "+254709221537", pool: { status: "assigned" }, tenant: { business_name: "Done and Dusted" } }).headline, "Number back with Done and Dusted");
    const lift = mapNumberOpResult("lift_quarantine", { noop: false, e164: "+254709221537", pool: { status: "available" } });
    assert.equal(lift.headline, "Number is Available now");
    assert.equal(lift.poolStatus, "Available");
  });
});

describe("error mapping", () => {
  it("lift on a waiting business offers Restore and a confirm", async () => {
    const { mapNumberOpError } = await load();
    const e = mapNumberOpError({
      code: "P0001",
      message: "its previous business is still active and has no line",
      hint: "Use restore (admin_restore_business_number) to give it back, or confirm to free the number anyway.",
    });
    assert.equal(e.suggestRestore, true);
    assert.equal(e.needsConfirm, true);
    assert.equal(e.status, 409);
    assert.doesNotMatch(e.error, /admin_restore|_number\(|tenant/i);
  });

  it("every known RPC message becomes plain copy without SQL, ids or the word tenant", async () => {
    const { mapNumberOpError, NUMBER_OPS_FALLBACK } = await load();
    const raised = [
      "say who is making this change", "a reason is required", "confirm the change", "not a phone number: 12",
      "number is not in our pool", "no number in our pool to restore for this business",
      "number +254709221537 is assigned, not in quarantine", "number +254709221537 is disabled; restore refused",
      "number +254709221537 is already available", "number +254709221537 is assigned for another business; restore refused",
      "number +254709221537 was released from another business; restore refused",
      "business is archived or inactive; restore the business first", "business is suspended by an admin; unsuspend it first",
      "line was closed for non-payment; the business must be paid up (billing status active) first",
      "business already has a number (+254700000001)", "business already has another number (+254700000001)",
      "business already has a pool number (+254700000001, status assigned)",
      "business to move to already has a number (+254700000001); no swaps", "business to move to already holds a pool number; no swaps",
      `another business (${A}) already has this number`,
      "number +254709221537 is not the live number of the business to move from",
      "business to move from is archived or inactive", "business to move to is archived or inactive",
      "business to move from not found", "business to move to not found", "business not found",
      "pick a different business to move the number to", "both businesses are required", "business id required",
    ];
    for (const message of raised) {
      const e = mapNumberOpError({ code: "P0001", message });
      assert.notEqual(e.error, NUMBER_OPS_FALLBACK, `unmapped: ${message}`);
      assert.ok(e.status >= 400 && e.status < 600);
      assert.doesNotMatch(e.error, /tenant|_tenant|admin_|p_|[0-9a-f]{8}-[0-9a-f]{4}/i, message);
      assert.doesNotMatch(e.error, LONG_DASH, message);
    }
  });

  it("missing SQL, unknown errors and thrown values never leak raw text", async () => {
    const { mapNumberOpError, NUMBER_OPS_SQL_MISSING, NUMBER_OPS_FALLBACK } = await load();
    assert.equal(mapNumberOpError({ code: "PGRST202", message: "Could not find the function public.admin_move_number" }).error, NUMBER_OPS_SQL_MISSING);
    assert.equal(mapNumberOpError({ code: "42883", message: "function admin_lift_quarantine does not exist" }).status, 503);
    const u = mapNumberOpError({ code: "XX000", message: "relation sautikit_did_pool deadlock detected" });
    assert.equal(u.error, NUMBER_OPS_FALLBACK);
    assert.equal(mapNumberOpError(new Error("boom")).error, NUMBER_OPS_FALLBACK);
    assert.equal(mapNumberOpError(undefined).error, NUMBER_OPS_FALLBACK);
  });
});

describe("Unlock and audit wiring", () => {
  it("all three actions are risky, always need Unlock and have plain names", async () => {
    const { riskyActionKeys, ALWAYS_UNLOCK, requiresUnlock, areaForAction } = await loadCore();
    const words = read("dashboard/src/lib/ops/stepUpWords.ts");
    for (const k of ["number-ops:restore", "number-ops:lift_quarantine", "number-ops:move"]) {
      assert.ok(riskyActionKeys().includes(k), k);
      assert.ok(ALWAYS_UNLOCK[k], `${k} always needs Unlock`);
      assert.equal(requiresUnlock(k, { numbers: false }), true);
      assert.equal(areaForAction(k), "numbers");
      assert.ok(words.includes(`"${k}"`), `${k} has words`);
    }
  });

  it("route audits with the Unlock proof; RPCs audit the change itself", () => {
    const route = read("dashboard/src/app/api/admin/number-ops/route.ts");
    assert.match(route, /requireAdminOperatorWrite\(\)/);
    assert.match(route, /stepUpGate\(gate\.operator, `number-ops:\$\{input\.action\}`/);
    assert.match(route, /auditNumberOp\(/);
    const lib = read("dashboard/src/lib/adminNumberOps.ts");
    assert.match(lib, /import "server-only"/);
    assert.match(lib, /step_up: entry\.stepUp/);
    assert.match(lib, /admin\.number_ops\./);
    assert.doesNotMatch(lib, /NEXT_PUBLIC_/);
  });

  it("UI copy: no long dashes, says business", () => {
    const ui = read("dashboard/src/components/admin/v2/NumberControls.tsx");
    const copy = read("dashboard/src/lib/ops/numberOps.ts");
    for (const src of [ui, copy]) assert.doesNotMatch(src, LONG_DASH);
    const strings = [...ui.matchAll(/>([^<>{}]+)</g)].map((m) => m[1]).join(" ");
    assert.doesNotMatch(strings, /\btenant\b|\bshop\b/i);
  });
});
