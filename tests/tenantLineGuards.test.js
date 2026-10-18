/**
 * Desk guards for a paused (suspended) or closed (archived) line.
 * - tenantLineState.ts mirrors the voice gate (src/sautikit/inactiveTenantGate.js) so the two
 *   can't drift: same reason for every row shape.
 * - Every Desk outbound send (caller SMS, teammate ping) checks the line first and returns a
 *   plain error before any ledger row, claim or charge.
 * - A suspended owner can still read Desk, with a calm banner. Archived stays fully blocked:
 *   memberDenied / requireMember refuse every write.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const line = require("../dashboard/src/lib/tenantLineState.ts");
const gate = require("../src/sautikit/inactiveTenantGate.js");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const DASH = "dashboard/src";

function fnBody(src, name) {
  const start = src.search(new RegExp(`export (async )?function ${name}\\(`));
  assert.ok(start >= 0, `${name} not found`);
  const next = src.slice(start + 10).search(/\nexport /);
  return next < 0 ? src.slice(start) : src.slice(start, start + 10 + next);
}

const MATRIX = [];
for (const archived_at of [undefined, null, "", "2026-10-17T10:00:00Z"]) {
  for (const archived of [undefined, null, false, true]) {
    for (const is_active of [undefined, null, true, false]) {
      for (const line_status of [undefined, null, "", "active", "grace", "suspended", " Suspended ", "SUSPENDED"]) {
        MATRIX.push({ archived_at, archived, is_active, line_status });
      }
    }
  }
}

describe("tenantLineState mirrors the voice gate", () => {
  it("gives the same reason as the gate for every row shape", () => {
    for (const row of MATRIX) {
      assert.equal(line.tenantLineInactiveReason(row), gate.tenantLineInactiveReason(row), JSON.stringify(row));
      assert.equal(line.tenantLineClosed(row), gate.isTenantLineInactive(row), JSON.stringify(row));
    }
    for (const row of [null, undefined, "x", 3]) {
      assert.equal(line.tenantLineInactiveReason(row), gate.tenantLineInactiveReason(row));
    }
  });

  it("maps suspended to paused, archived or switched off to closed", () => {
    assert.equal(line.deskLineState({ is_active: true, line_status: "active" }), "open");
    assert.equal(line.deskLineState({ is_active: true, line_status: "grace" }), "open");
    assert.equal(line.deskLineState({ is_active: true, line_status: "suspended" }), "paused");
    assert.equal(line.deskLineState({ is_active: false, archived_at: "2026-10-01" }), "closed");
    assert.equal(line.deskLineState({ is_active: true, archived_at: "2026-10-01", line_status: "suspended" }), "closed");
    assert.equal(line.deskLineState({ is_active: false, line_status: "suspended" }), "closed");
    assert.equal(line.deskLineState({ is_active: false }), "closed");
    assert.equal(line.deskLineState(null), "open");
  });

  it("uses the agreed owner copy", () => {
    assert.deepEqual(line.sendBlock({ line_status: "suspended" }), {
      reason: "line_paused",
      message: "Your line is paused, so messages can't go out right now.",
    });
    assert.deepEqual(line.sendBlock({ is_active: false, archived_at: "2026-10-01" }), {
      reason: "business_closed",
      message: "This business is closed.",
    });
    assert.equal(line.sendBlock({ is_active: true, line_status: "active" }), null);
    assert.equal(line.LINE_PAUSED_BANNER, "Your line is paused. Callers hear that the line is unavailable.");
    for (const s of [line.LINE_PAUSED_SEND_ERROR, line.BUSINESS_CLOSED_ERROR, line.LINE_PAUSED_BANNER]) {
      assert.doesNotMatch(s, /\u2014|supabase|vercel|africa.?s talking|sautikit/i);
    }
  });

  it("stays a pure module the node tests can load", () => {
    assert.doesNotMatch(read(`${DASH}/lib/tenantLineState.ts`), /from "@\//);
  });
});

describe("outbound sends check the line before any ledger or charge", () => {
  it("sendRecordedDeskCallerSms returns the block before lookup, claim or send", () => {
    const body = fnBody(read(`${DASH}/lib/sendLedger.ts`), "sendRecordedDeskCallerSms");
    const guard = body.indexOf("outboundSendBlock(");
    assert.ok(guard > 0, "guard missing");
    assert.match(body, /if \(blocked\) return \{ ok: false, reason: blocked\.reason, message: blocked\.message \}/);
    for (const later of ["deskLedgerLookup", "claimDeskSms", "sendDeskCallerSms(", ".insert("]) {
      const at = body.indexOf(later);
      if (at >= 0) assert.ok(at > guard, `${later} runs before the line check`);
    }
  });

  it("pingTeammateAction returns the block before any voice call", () => {
    const body = fnBody(read(`${DASH}/app/(desk)/calls/escalateActions.ts`), "pingTeammateAction");
    const guard = body.indexOf("outboundSendBlock(workspace.client, tenant.id)");
    assert.ok(guard > 0, "ping guard missing");
    assert.match(body, /if \(blocked\) return \{ error: pingBlockMessage\(blocked\) \}/);
    for (const later of ["fetch(", ".insert(", ".update("]) {
      const at = body.indexOf(later);
      if (at >= 0) assert.ok(at > guard, `${later} runs before the line check`);
    }
  });

  it("maps the voice server's 409 tenant_line_closed to plain owner text, not a retry", () => {
    const paused = "Your line is paused, so teammates can't be pinged right now.";
    const closed = "This business is closed.";
    assert.equal(line.escalateRefusalMessage({ ok: false, reason: "tenant_line_closed", lineState: "suspended" }), paused);
    assert.equal(line.escalateRefusalMessage({ ok: false, reason: "tenant_line_closed", lineState: { closed: true, reason: "suspended" } }), paused);
    assert.equal(line.escalateRefusalMessage({ ok: false, reason: "tenant_line_closed", lineState: "archived" }), closed);
    assert.equal(line.escalateRefusalMessage({ ok: false, reason: "tenant_line_closed", lineState: { reason: "inactive" } }), closed);
    assert.equal(line.escalateRefusalMessage({ ok: false, reason: "instance_already_sent" }), null);
    assert.equal(line.escalateRefusalMessage(null), null);
    assert.equal(line.pingBlockMessage({ reason: "line_paused", message: "x" }), paused);
    assert.equal(line.pingBlockMessage({ reason: "business_closed", message: "x" }), closed);
    const body = fnBody(read(`${DASH}/app/(desk)/calls/escalateActions.ts`), "pingTeammateAction");
    const refusal = body.indexOf("escalateRefusalMessage(json)");
    assert.ok(refusal > 0 && refusal < body.indexOf("Notification retry pending"), "409 must be mapped before the retry branch");
    assert.match(body, /if \(refused\) return \{ error: refused \}/);
  });

  it("every caller SMS goes through the guarded ledger", () => {
    const callers = [
      `${DASH}/app/(desk)/requests/actions.ts`,
      `${DASH}/app/(desk)/appointments/actions.ts`,
      `${DASH}/app/(desk)/calls/noteActions.ts`,
    ];
    for (const rel of callers) {
      const src = read(rel);
      assert.match(src, /sendRecordedDeskCallerSms\(/, rel);
      assert.doesNotMatch(src, /\bsendDeskCallerSms\(/, `${rel} bypasses the ledger guard`);
    }
  });

  it("surfaces the blocked text to the owner", () => {
    for (const rel of [`${DASH}/app/(desk)/requests/actions.ts`, `${DASH}/app/(desk)/appointments/actions.ts`]) {
      const src = read(rel);
      assert.match(src, /if \(sent\.message\) notice = sent\.message;/, rel);
      assert.match(src, /notice \? \{ ok: true, notice \} : \{ ok: true \}/, rel);
    }
    assert.match(read(`${DASH}/app/(desk)/calls/noteActions.ts`), /if \(sent\.message\) return \{ error: sent\.message \};/);
    for (const c of [
      "RequestStatusToggle",
      "InboxJobActions",
      "AppointmentStatusToggle",
      "InboxJobEditor",
      "InboxHoldEditor",
    ]) {
      assert.match(read(`${DASH}/components/${c}.tsx`), /state\.notice \?[\s\S]{0,120}role="status"[\s\S]{0,60}\{state\.notice\}/, c);
    }
    assert.match(read(`${DASH}/components/CallerNoteComposer.tsx`), /\{sendState\.error\}/);
  });
});

describe("Desk access by line state", () => {
  it("shows the paused banner in the Desk layout and keeps reads open", () => {
    const layout = read(`${DASH}/app/(desk)/layout.tsx`);
    assert.match(layout, /tenant\?\.linePaused \? <LinePausedBanner \/> : null/);
    assert.match(read(`${DASH}/components/LinePausedBanner.tsx`), /LINE_PAUSED_BANNER/);
    const tenant = read(`${DASH}/lib/tenant.ts`);
    assert.match(tenant, /archived_at, is_active, line_status/);
    assert.match(tenant, /linePaused: deskLineState\(row\) === "paused"/);
    assert.match(tenant, /archived: deskLineState\(row\) === "closed"/);
  });

  it("refuses every write for a closed business, not for a paused one", () => {
    const src = read(`${DASH}/lib/requireMember.ts`);
    assert.match(src, /deskLineState\(tenant\) === "closed"/);
    const denied = fnBody(src, "memberDenied");
    assert.match(denied, /if \(await currentTenantClosed\(\)\) return \{ ok: false, error: BUSINESS_CLOSED_ERROR, denied: true \}/);
    const req = fnBody(src, "requireMember");
    assert.match(req, /if \(await currentTenantClosed\(\)\) throw new WorkspaceClosedError\(\)/);
    assert.ok(denied.indexOf("currentTenantClosed") < denied.indexOf("currentMemberRole"));
  });

  it("owner API write routes go through memberDenied", () => {
    for (const rel of [`${DASH}/app/api/tenant/route.ts`, `${DASH}/app/api/pronunciation/preview/route.ts`]) {
      assert.match(read(rel), /memberDenied\(/, rel);
    }
  });

  it("getCurrentTenant still returns an archived tenant (no fresh number on re-signup)", () => {
    const src = read(`${DASH}/lib/tenant.ts`);
    const start = src.indexOf("export const getCurrentTenant = cache(");
    assert.ok(start >= 0);
    const fn = src.slice(start, start + src.slice(start + 10).search(/\nexport /) + 10);
    assert.doesNotMatch(fn, /archived_at|deskLineState/);
  });
});
