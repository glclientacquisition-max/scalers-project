/** Run: node --experimental-strip-types --test tests/onboardingLiveFixes.test.ts
 * Regressions from the 11 Oct 2026 staging live test of #656. */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  countryOfPhone,
  defaultDraft,
  dialCode,
  draftStorageKey,
  normalizePhone,
  parseDraft,
  readLocalDraft,
  saveErrorMessage,
  validateAlerts,
} from "../dashboard/src/lib/setupFlow.ts";
import { staleSessionCookies } from "../dashboard/src/lib/authCallback.ts";

const root = new URL("..", import.meta.url).pathname;
const migrations = readdirSync(join(root, "supabase/migrations"))
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(join(root, "supabase/migrations", f), "utf8"))
  .join("\n");

describe("step 1 save (regression: permission denied for table tenants)", () => {
  // tenants uses column-level UPDATE grants for `authenticated`. save_onboarding_step is
  // SECURITY INVOKER, so every column it and finishSetupAction write needs a grant.
  const granted = new Set<string>();
  for (const m of migrations.matchAll(/grant\s+update\s*\(([^)]+)\)\s*on\s+(?:table\s+)?public\.tenants\s+to\s+[^;]*authenticated/gi)) {
    for (const c of m[1].split(",")) granted.add(c.trim().toLowerCase());
  }
  for (const col of ["onboarding_draft", "onboarding_step", "onboarding_draft_version", "setup_completed_at"]) {
    it(`authenticated can update tenants.${col}`, () => assert.ok(granted.has(col), `missing grant update (${col})`));
  }
  it("finishSetupAction only writes granted columns", () => {
    const src = readFileSync(join(root, "dashboard/src/app/onboarding/setupActions.ts"), "utf8");
    for (const col of ["setup_completed_at", "onboarding_step"]) assert.ok(src.includes(col));
  });
});

describe("server errors show the real reason", () => {
  it("permission denied is not blamed on the connection", () => {
    const m = saveErrorMessage({ code: "42501", message: "permission denied for table tenants" });
    assert.doesNotMatch(m, /connection/i);
    assert.match(m, /isn't allowed/);
    assert.match(m, /42501/);
  });
  it("missing function and unknown errors carry a ref", () => {
    assert.match(saveErrorMessage({ code: "PGRST202", message: "Could not find the function" }), /being updated.*PGRST202/);
    assert.match(saveErrorMessage({ code: "XX000", message: "boom" }), /server error.*XX000/);
    assert.doesNotMatch(saveErrorMessage(null), /connection/i);
  });
});

describe("mobile number by country (E.164)", () => {
  it("defaults to Kenya", () => {
    assert.equal(normalizePhone("0712 345 678"), "+254712345678");
    assert.equal(dialCode("KE"), "+254");
    assert.equal(defaultDraft().alerts.country, "KE");
  });
  it("validates per country", () => {
    assert.equal(normalizePhone("0772 123 456", "UG"), "+256772123456");
    assert.equal(normalizePhone("0772 123", "UG"), null);
    assert.equal(normalizePhone("+44 7911 123456", "KE"), "+447911123456");
    assert.equal(countryOfPhone("+256772123456"), "UG");
  });
  it("alerts step stores E.164 and the matching country", () => {
    const r = validateAlerts({ country: "TZ", phone: "0712 345 678", email: "", whatsapp: true, sms: true, emailOn: false });
    assert.ok(r.ok);
    assert.equal(r.ok && r.value.phone, "+255712345678");
    assert.equal(r.ok && r.value.country, "TZ");
    const bad = validateAlerts({ country: "UG", phone: "123", email: "", whatsapp: true, sms: false, emailOn: false });
    assert.equal(bad.ok, false);
    assert.match(!bad.ok ? bad.fields.phone : "", /Uganda/);
  });
  it("unknown country falls back to Kenya", () => {
    assert.equal(parseDraft({ alerts: { country: "ZZ", phone: "" } }).alerts.country, "KE");
  });
});

describe("typed choices survive reload (local draft per account)", () => {
  it("key is per workspace and per user", () => {
    assert.notEqual(draftStorageKey("t1", "u1"), draftStorageKey("t1", "u2"));
  });
  it("restores only on the same server version", () => {
    const stored = JSON.stringify({ base: 0, draft: { business: { vertical: "home_services", landmark: "Opp. Total", directions: "" } } });
    const got = readLocalDraft(stored, 0) as { business: { vertical: string; landmark: string } };
    assert.equal(parseDraft(got).business.vertical, "home_services");
    assert.equal(parseDraft(got).business.landmark, "Opp. Total");
    assert.equal(readLocalDraft(stored, 1), null);
    assert.equal(readLocalDraft("{bad", 0), null);
    assert.equal(readLocalDraft(null, 0), null);
  });
});

describe("confirmation link never lands in the old account", () => {
  const existing = ["sb-abc-auth-token.0", "sb-abc-auth-token.1", "sb-abc-auth-token-code-verifier", "theme"];
  it("failed link signs the old session out, keeps verifier and other cookies", () => {
    assert.deepEqual(staleSessionCookies(existing, [], false), ["sb-abc-auth-token.0", "sb-abc-auth-token.1"]);
  });
  it("successful link drops leftover chunks of the old session", () => {
    assert.deepEqual(staleSessionCookies(existing, ["sb-abc-auth-token.0"], true), ["sb-abc-auth-token.1"]);
    assert.deepEqual(staleSessionCookies(["sb-abc-auth-token"], ["sb-abc-auth-token"], true), []);
  });
});

describe("signup keeps what was typed", () => {
  const src = readFileSync(join(root, "dashboard/src/app/signup/SignupForm.tsx"), "utf8");
  it("password and other fields are controlled", () => {
    assert.match(src, /name="password" value=\{form\.password\}/);
    assert.doesNotMatch(src, /defaultValue=/);
    assert.match(src, /name="phone_country"/);
  });
});

describe("sticky Continue bar never covers content", () => {
  it("setup content has bottom padding taller than the bar plus a banner", () => {
    const src = readFileSync(join(root, "dashboard/src/app/onboarding/SetupFlow.tsx"), "utf8");
    assert.match(src, /pb-\[calc\(10rem\+env\(safe-area-inset-bottom\)\)\]/);
  });
});
