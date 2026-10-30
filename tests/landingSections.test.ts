/** Run: node --experimental-strip-types --test tests/landingSections.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../dashboard/src/${p}`, import.meta.url), "utf8");
const page = read("components/marketing/LandingPage.tsx");
const sections = read("components/marketing/LandingSections.tsx");

test("home has one H1 and the sections in plan order", () => {
  assert.equal((page.match(/<h1\b/g) ?? []).length, 1);
  assert.doesNotMatch(sections, /<h1\b/);
  const order = ["<LandingMoments", "<LandingHowItWorks", "<LandingTrust", "<LandingKeepNumber", "<LandingPackages", "<LandingQuestions", "data-landing-final"];
  const at = order.map((k) => page.indexOf(k));
  assert.ok(at.every((i) => i > 0), "every section is on the page");
  assert.deepEqual([...at].sort((a, b) => a - b), at, "sections keep the plan order");
});

test("no proof section, no unbuilt or vendor claims, no free trial", () => {
  const text = sections + page;
  assert.doesNotMatch(text, /coming soon|free trial|testimonial|trusted by|\bAris\b/i);
  assert.doesNotMatch(text, /Telkom/, "Telkom forwarding is untested, so it is not claimed");
  assert.doesNotMatch(text, /Twilio|Africa'?s Talking|OpenAI|Deepgram|ElevenLabs|SautiKit/i);
});

test("how-it-works screens ship in public/landing", () => {
  for (const f of ["how-prices.webp", "how-call.webp", "how-inbox.webp"]) {
    assert.ok(existsSync(new URL(`../dashboard/public/landing/${f}`, import.meta.url)), f);
    assert.match(sections, new RegExp(`/landing/${f.replace(".", "\\.")}`));
  }
});

test("off code matches the forwarding lib", () => {
  const fwd = read("lib/callForwarding.ts");
  assert.match(fwd, /ALL_OFF_CODE = "##002#"/);
  assert.match(sections, /##002#/);
});

test("cleaning page reuses the skeleton with cleaning words", () => {
  const route = read("app/cleaning/page.tsx");
  const copy = read("components/marketing/landingCopy.ts");
  assert.match(route, /copy=\{CLEANING_COPY\}/);
  assert.match(copy, /h1: "Never lose a cleaning job to a missed call\."/);
  assert.doesNotMatch(copy, /coming soon|free trial|guarantee|\d+%/i);
});
