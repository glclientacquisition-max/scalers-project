/** Run: node --experimental-strip-types --test tests/shortCallLink.test.ts */
// Desk /c/<code> (short call link in staff SMS, #777): who gets the call,
// who signs in first, and who sees the same not-found.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  decideShortCallLink,
  loginNextPath,
  normalizeShortCode,
  shortLinkLoginHref,
} from "../dashboard/src/lib/shortCallLink.ts";

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const CALL = { id: "3f2b9c1e-7a4d-4e8b-9c21-5d6e7f8a9b0c", tenant_id: T1 };
const read = (rel: string) => fs.readFileSync(path.join(import.meta.dirname, "..", rel), "utf8");

describe("short call link: decisions", () => {
  it("member: opens the existing call page", () => {
    assert.deepEqual(decideShortCallLink({ code: "K7P2QX", signedIn: true, call: CALL, memberTenantIds: [T1], currentTenantId: T1 }), {
      kind: "open",
      callId: CALL.id,
      tenantId: T1,
      href: `/calls/${CALL.id}`,
      switchTenant: false,
    });
  });
  it("member of several businesses: switches to the call's business first", () => {
    const d = decideShortCallLink({ code: "K7P2QX", signedIn: true, call: CALL, memberTenantIds: [T2, T1], currentTenantId: T2 });
    assert.equal(d.kind, "open");
    assert.equal(d.kind === "open" && d.switchTenant, true);
  });
  it("non-member and unknown code: the same not-found", () => {
    const nonMember = decideShortCallLink({ code: "K7P2QX", signedIn: true, call: CALL, memberTenantIds: [T2], currentTenantId: T2 });
    const unknown = decideShortCallLink({ code: "K7P2QX", signedIn: true, call: null, memberTenantIds: [T1], currentTenantId: T1 });
    assert.deepEqual(nonMember, { kind: "not_found" });
    assert.deepEqual(unknown, nonMember);
    assert.deepEqual(decideShortCallLink({ code: null, signedIn: true, call: CALL, memberTenantIds: [T1] }), { kind: "not_found" });
  });
  it("signed out: sign in, then back to the link (before any lookup)", () => {
    assert.deepEqual(decideShortCallLink({ code: "K7P2QX", signedIn: false, call: CALL, memberTenantIds: [T1] }), {
      kind: "login",
      href: "/login?next=%2Fc%2FK7P2QX",
    });
    assert.deepEqual(
      decideShortCallLink({ code: "K7P2QX", signedIn: false, call: null, memberTenantIds: [] }),
      decideShortCallLink({ code: "K7P2QX", signedIn: false, call: CALL, memberTenantIds: [] }),
      "signed out cannot tell a real code from a made-up one"
    );
  });
});

describe("short call link: code and next", () => {
  it("codes: 6-8 chars, no 0/O/1/I/L, case-insensitive", () => {
    assert.equal(normalizeShortCode(" k7p2qx "), "K7P2QX");
    assert.equal(normalizeShortCode("K7P2QXZW"), "K7P2QXZW");
    for (const bad of ["", "K7P2Q", "K7P2QXZWA", "K0P2QX", "KOP2QX", "K1P2QX", "KIP2QX", "KLP2QX", "K7P2Q%", CALL.id, null, undefined]) {
      assert.equal(normalizeShortCode(bad), null, String(bad));
    }
  });
  it("login next: only a short call link path", () => {
    assert.equal(loginNextPath("/c/K7P2QX"), "/c/K7P2QX");
    assert.equal(loginNextPath("/c/k7p2qx"), "/c/K7P2QX");
    for (const bad of ["/home", "/calls/x", "https://evil.com/c/K7P2QX", "//evil.com", "/c/K7P2QX/open", "/c/K7P2QX?x=1", "/c/0OOOOO", "", null]) {
      assert.equal(loginNextPath(bad), null, String(bad));
    }
    assert.equal(loginNextPath(new URLSearchParams(shortLinkLoginHref("K7P2QX").split("?")[1]).get("next")), "/c/K7P2QX");
  });
});

describe("short call link: wiring", () => {
  it("page: login redirect, notFound for unknown / non-member, call page for members", () => {
    const page = read("dashboard/src/app/c/[code]/page.tsx");
    assert.match(page, /resolveShortCallLink\(code\)/);
    assert.match(page, /next\.kind === "login"\) redirect\(next\.href\)/);
    assert.match(page, /next\.kind === "not_found"\) notFound\(\)/);
  });
  it("server: reads the call with the person's session and re-checks membership", () => {
    const server = read("dashboard/src/lib/shortCallLinkServer.ts");
    assert.match(server, /createSupabaseServerClient\(\)/);
    assert.doesNotMatch(server, /getSupabaseAdmin/);
    assert.match(server, /memberRowsForUser\(user\.id\)/);
    assert.match(server, /\.eq\("short_code", code\)/);
  });
  it("not-found: kit component, no detail about the call", () => {
    const nf = read("dashboard/src/app/c/[code]/not-found.tsx");
    assert.match(nf, /<DeskRecovery screen/);
    assert.doesNotMatch(nf, /member|business name|tenant|exists|access/i);
    assert.doesNotMatch(nf, /#[0-9a-f]{3,6}\b/i, "MASTER tokens only, no raw hex");
  });
  it("login keeps next through the form and failed attempts", () => {
    const route = read("dashboard/src/app/api/login/route.ts");
    assert.match(route, /loginNextPath\(form\.get\("next"\)\)/);
    assert.match(route, /NextResponse\.redirect\(new URL\(next \|\| "\/home", request\.url\), 303\)/);
    const page = read("dashboard/src/app/login/page.tsx");
    assert.match(page, /name="next" value=\{next\}/);
    assert.match(page, /redirect\(next \|\| "\/home"\)/);
  });
});
