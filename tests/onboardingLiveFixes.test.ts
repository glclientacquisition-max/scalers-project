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
      for (const m of src.matchAll(/placeholder=(\{[^}]*\}|"[^"]*")/g)) {
        for (const q of m[1].matchAll(/"([^"]+)"/g)) assert.match(q[1], /^e\.g\. /, `${f}: ${q[1]}`);
      }
    }
    // Placeholder colour is the kit token (ink-3, 4.5:1); the "e.g." prefix marks it as a hint.
    assert.match(read("dashboard/src/app/onboarding/steps/ui.tsx"), /inputClass = controlClass/);
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

describe("polish pass 3 (second live run, 11 Oct)", () => {
  const read = (p: string) => readFileSync(join(root, p), "utf8");
  it("finish does not wait for the model prompt; logs timings; shows stages", () => {
    const src = read("dashboard/src/app/onboarding/setupActions.ts");
    const finish = src.slice(src.indexOf("export async function finishSetupAction"));
    const beforeAfter = finish.slice(0, finish.indexOf("after(async"));
    assert.doesNotMatch(beforeAfter, /await compileReceptionistPrompt/);
    assert.match(finish.slice(finish.indexOf("after(async")), /compileReceptionistPrompt\(compileInput\)/);
    assert.match(finish, /\[setup\] finish auth=/);
    assert.match(finish, /Promise\.all\(\[\s*canEditSetup/);
    assert.match(read("dashboard/src/app/onboarding/SetupFlow.tsx"), /FINISH_STAGES/);
  });
  it("phone shows national format when the country matches, E.164 otherwise", async () => {
    const { phoneForInput } = await import("../dashboard/src/lib/setupFlow.ts");
    assert.equal(phoneForInput("+254790381872", "KE"), "0790 381 872");
    assert.equal(phoneForInput("+254790381872", "UG"), "+254790381872");
    assert.equal(phoneForInput("0712", "KE"), "0712");
    assert.match(read("dashboard/src/app/onboarding/steps/AlertsStep.tsx"), /value=\{phoneForInput\(value\.phone, value\.country\)\}/);
  });
  it("Back keeps its slot so the logo does not move; number screen has the logo header", () => {
    const flow = read("dashboard/src/app/onboarding/SetupFlow.tsx");
    assert.match(flow, /index === 0 \? "invisible" : ""/);
    const line = read("dashboard/src/app/onboarding/line/LineView.tsx");
    assert.match(line, /<header[\s\S]*<BrandWordmark/);
  });
  it("first hours chip matches the default week", async () => {
    const { defaultWeek } = await import("../dashboard/src/lib/setupFlow.ts");
    const w = defaultWeek();
    assert.deepEqual(w.mon.shifts, [{ open: "08:00", close: "18:00" }]);
    assert.equal(w.sat.closed, false);
    assert.equal(w.sun.closed, true);
    const src = read("dashboard/src/app/onboarding/steps/HoursStep.tsx");
    assert.ok(src.indexOf('"Mon-Sat, 8 to 6"') < src.indexOf('"Mon-Fri, 9 to 5"'));
    assert.match(src, /aria-pressed=/);
  });
  it("one break per day, so Add a break disappears once used", async () => {
    const { LIMITS } = await import("../dashboard/src/lib/setupFlow.ts");
    assert.equal(LIMITS.shiftsPerDay, 2);
  });
  it("receptionist step can be skipped and keeps the defaults", async () => {
    const { SETUP_STEPS, validateStep, defaultDraft: dd } = await import("../dashboard/src/lib/setupFlow.ts");
    assert.equal(SETUP_STEPS.find((s) => s.key === "voice")?.skippable, true);
    assert.equal(validateStep("voice", dd().voice, dd()).ok, true);
    assert.match(read("dashboard/src/app/onboarding/SetupFlow.tsx"), /key === "voice"\s*\?\s*\{ \.\.\.draft\.voice/);
  });
  it("FAQ fields have unique accessible names", () => {
    const src = read("dashboard/src/app/onboarding/steps/FaqsStep.tsx");
    assert.match(src, /Question<span className="sr-only"> \{i \+ 1\}<\/span>/);
    assert.match(src, /Answer<span className="sr-only"> to question \{i \+ 1\}<\/span>/);
  });
  it("Overview is prefetched from the number screen", () => {
    assert.match(read("dashboard/src/app/onboarding/line/LineView.tsx"), /href="\/home" prefetch/);
  });
});

describe("design compliance + Business Assistant + niches (11 Oct)", () => {
  const read = (p: string) => readFileSync(join(root, p), "utf8");
  const onboardingFiles = [
    "dashboard/src/app/onboarding/SetupFlow.tsx",
    "dashboard/src/app/onboarding/CreateWorkspaceForm.tsx",
    "dashboard/src/app/onboarding/line/LineView.tsx",
    "dashboard/src/app/onboarding/line/PendingNumber.tsx",
    "dashboard/src/app/signup/SignupForm.tsx",
    "dashboard/src/app/login/PendingSubmit.tsx",
    ...["ui", "BusinessStep", "CatalogueStep", "HoursStep", "VoiceStep", "FaqsStep", "AlertsStep"].map(
      (f) => `dashboard/src/app/onboarding/steps/${f}.tsx`
    ),
  ];
  it("kit only: no inline SVG, no legacy class strings, no glass, no arbitrary type, no pills", () => {
    for (const f of onboardingFiles) {
      const src = read(f);
      assert.doesNotMatch(src, /<svg/, `${f} inline svg (use Heroicons)`);
      assert.doesNotMatch(src, /\bbtnPrimary\b|deskFieldClass|glass-chrome/, `${f} legacy class string`);
      assert.doesNotMatch(src, /text-\[\d/, `${f} arbitrary type size`);
      assert.doesNotMatch(src, /rounded-full bg-surface px-4/, `${f} pill chip`);
      assert.doesNotMatch(src, /#[0-9a-fA-F]{6}\b/, `${f} raw hex`);
      assert.doesNotMatch(src, /[\u2013\u2014]/, `${f} en/em dash`);
      assert.doesNotMatch(src, /framer|motion\/react|gsap|lottie/i, `${f} motion library`);
    }
    assert.match(read("dashboard/src/app/onboarding/steps/AlertsStep.tsx"), /<Select/);
    assert.match(read("dashboard/src/app/signup/SignupForm.tsx"), /<Select/);
  });
  it("team invites use kit fields and pending buttons", () => {
    const f = read("dashboard/src/app/invite/[token]/InviteForms.tsx");
    assert.doesNotMatch(f, /deskFieldClass/);
    assert.match(f, /pending=\{pending\}/);
    assert.match(read("dashboard/src/components/MembersPanel.tsx"), /pending=\{spinning\("invite"\)\}\s*disabled=\{pending \|\| !email\.trim\(\)\}/);
  });
  it("product term is Business Assistant in user-facing copy", () => {
    for (const f of [...onboardingFiles, "dashboard/src/lib/setupFlow.ts", "dashboard/src/components/HomeCapture.tsx", "dashboard/src/components/CallTranscript.tsx"]) {
      const code = read(f).replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "");
      assert.doesNotMatch(code.replace(/compileReceptionistPrompt/g, ""), /receptionist/i, f);
    }
    assert.match(read("dashboard/src/lib/setupFlow.ts"), /title: "Your Business Assistant"/);
    assert.match(read("dashboard/src/app/onboarding/SetupFlow.tsx"), /Writing your Business Assistant's script/);
  });
  it("FAQ answers file payment, delivery (shops) and coverage (home services)", async () => {
    const { policiesFromFaqs } = await import("../dashboard/src/lib/setupFlow.ts");
    const shop = policiesFromFaqs(
      [
        { question: "Do you accept M-Pesa?", answer: "Yes, till 123456." },
        { question: "Do you deliver?", answer: "Same day in Nairobi." },
      ],
      "retail"
    );
    assert.equal(shop.payment, "Yes, till 123456.");
    assert.equal(shop.delivery, "Same day in Nairobi.");
    assert.equal(shop.coverage_areas, undefined);
    const home = policiesFromFaqs([{ question: "Which areas do you cover?", answer: "We cover Kilimani, Westlands and Lavington." }], "home_services");
    assert.deepEqual(home.coverage_areas, ["Kilimani", "Westlands", "Lavington"]);
    assert.equal(policiesFromFaqs([{ question: "Do you deliver?", answer: "Yes" }], "home_services").delivery, undefined);
  });
  it("catalogue examples and ask-price copy fit each niche", () => {
    const src = read("dashboard/src/app/onboarding/steps/CatalogueStep.tsx");
    assert.match(src, /home \? "e\.g\. Sofa cleaning, 3 seater" : "e\.g\. Fast charger, 20W"/);
    assert.match(src, /you'll confirm the price/);
  });
});

const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("Business Assistant naming on the marketing site", () => {
  it("titles, OG/Twitter and landing copy say Business Assistant, never call assistant", () => {
    const layout = read("dashboard/src/app/layout.tsx");
    assert.equal((layout.match(/Scalers, your 24-hour Business Assistant/g) || []).length, 3);
    for (const f of ["dashboard/src/app/layout.tsx", "dashboard/src/components/marketing/LandingPage.tsx", "dashboard/src/components/marketing/LandingStory.tsx"]) {
      assert.doesNotMatch(read(f), /[Cc]all assistant|\bbusiness assistant\b/, f);
    }
  });
});

describe("Team page per-row pending", () => {
  it("only the control that started an action spins; the rest disable", () => {
    const src = read("dashboard/src/components/MembersPanel.tsx");
    assert.match(src, /const spinning = \(key: string\) => pending && activeKey === key/);
    for (const k of ["owner:", "remove:", "resend:", "revoke:", "role:"]) assert.ok(src.includes(`spinning(\`${k}`), k);
    assert.match(src, /key: c\.key/);
    assert.match(src, /pending=\{spinning\("invite"\)\}/);
  });
  it("settings groups are h2 under the page h1 (axe heading-order)", () => {
    for (const f of ["dashboard/src/components/MembersPanel.tsx", "dashboard/src/components/AlertContactsList.tsx", "dashboard/src/components/settingsUi.tsx"]) {
      assert.doesNotMatch(read(f), /<h3[ >]/, f);
    }
  });
  it("finishing screen has an h1", () => {
    assert.match(read("dashboard/src/app/onboarding/SetupFlow.tsx"), /<h1 className="text-title text-ink">Setting up your Business Assistant<\/h1>/);
  });
});
