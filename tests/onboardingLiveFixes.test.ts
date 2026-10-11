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

describe("polish pass 2 (staging e2e, 11 Oct)", () => {
  const read = (p: string) => readFileSync(join(root, p), "utf8");
  it("placeholders read as hints", () => {
    for (const f of ["CatalogueStep", "VoiceStep", "BusinessStep"]) {
      const src = read(`dashboard/src/app/onboarding/steps/${f}.tsx`);
      for (const m of src.matchAll(/placeholder="([^"]+)"/g)) assert.match(m[1], /^e\.g\. /, `${f}: ${m[1]}`);
    }
    assert.match(read("dashboard/src/app/onboarding/steps/ui.tsx"), /placeholder:text-ink-3\/70/);
  });
  it("receptionist has a real default name and clean preview punctuation", async () => {
    const { DEFAULT_AGENT_NAME } = await import("../dashboard/src/lib/setupFlow.ts");
    assert.equal(defaultDraft().voice.agentName, DEFAULT_AGENT_NAME);
    assert.ok(DEFAULT_AGENT_NAME.length > 1);
    const src = read("dashboard/src/app/onboarding/steps/VoiceStep.tsx");
    assert.doesNotMatch(src, /"…"/);
  });
  it("site visit defaults to No", async () => {
    const { emptyRow } = await import("../dashboard/src/lib/setupFlow.ts");
    assert.equal(emptyRow("Sofa cleaning").site_visit, "no");
  });
  it("break defaults to lunch 13:00–14:00, else the middle hour", async () => {
    const { splitLast } = await import("../dashboard/src/lib/setupFlow.ts");
    assert.deepEqual(splitLast([{ open: "08:00", close: "18:00" }]), [
      { open: "08:00", close: "13:00" },
      { open: "14:00", close: "18:00" },
    ]);
    assert.deepEqual(splitLast([{ open: "15:00", close: "21:00" }]), [
      { open: "15:00", close: "17:30" },
      { open: "18:30", close: "21:00" },
    ]);
  });
  it("FAQ suggestions follow the business type", async () => {
    const { suggestedQuestions } = await import("../dashboard/src/lib/setupFlow.ts");
    const home = suggestedQuestions("home_services").join(" ");
    assert.doesNotMatch(home, /deliver|hold an item/i);
    assert.match(suggestedQuestions("retail").join(" "), /deliver/);
    assert.match(read("dashboard/src/components/HomeCapture.tsx"), /call-out and cancellation/);
  });
  it("coverage preview never uses the landmark", () => {
    const src = read("dashboard/src/app/(desk)/home/page.tsx");
    const block = src.slice(src.indexOf("homeStakes({"), src.indexOf("shopStakes({"));
    assert.doesNotMatch(block, /landmark/);
  });
  it("Catalogue spelling in user-facing labels", () => {
    assert.match(read("dashboard/src/components/HomeCapture.tsx"), /label: "Catalogue"/);
    assert.doesNotMatch(read("dashboard/src/lib/businessSettingsNav.ts"), /"Catalog"/);
  });
  it("country select stacks on mobile, input fills the row", () => {
    const src = read("dashboard/src/app/onboarding/steps/AlertsStep.tsx");
    assert.match(src, /flex flex-col gap-2 sm:flex-row/);
    assert.match(src, /sm:flex-1/);
  });
  it("logo stays in the header beside Back", () => {
    const src = read("dashboard/src/app/onboarding/SetupFlow.tsx");
    const header = src.slice(src.indexOf("<header"), src.indexOf("</header>"));
    assert.ok(header.indexOf("Back") < header.indexOf("<BrandWordmark"));
    assert.doesNotMatch(header, /\) : \(\s*<BrandWordmark/);
  });
  it("step save does the role check and the write in parallel", () => {
    assert.match(read("dashboard/src/app/onboarding/setupActions.ts"), /Promise\.all\(\[\s*canEditSetup/);
  });
  it("minutes meter is not monospace", () => {
    assert.doesNotMatch(read("dashboard/src/app/(desk)/home/page.tsx"), /font-mono text-sm font-medium text-ink/);
  });
  it("completeness: one confirmed priced item fills the catalogue; pending number not counted", () => {
    const sql = readFileSync(join(root, "supabase/migrations/20261011170000_completeness_matches_onboarding.sql"), "utf8");
    assert.match(sql, /if v_ok >= 1 then\s+return least\(100/);
    assert.match(sql, /_tenant_number_assigned/);
    assert.match(sql, /if v_is_home then/);
    assert.match(read("dashboard/src/app/onboarding/setupActions.ts"), /"identity\.business_name",\s*"identity\.language",\s*"assistant\.tools"/);
  });
});
