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
  const order = ["<LandingMoments", "<LandingReach", "<LandingHowItWorks", "<LandingKeepNumber", "<LandingPackages", "<LandingQuestions", "data-landing-final"];
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

test("the inbox is a drawn example, not a cropped desk screenshot", () => {
  assert.match(sections, /data-landing-inbox=""/);
  assert.doesNotMatch(sections, /how-inbox\.webp|<img|next\/image/);
  assert.doesNotMatch(sections, /Amina|Otieno|hang-up|Sep 12/);
  assert.match(sections, /New caller/);
  assert.match(sections, /Just now/);
  assert.equal(existsSync(new URL("../dashboard/public/landing/how-inbox.webp", import.meta.url)), false);
});

test("off code matches the forwarding lib", () => {
  const fwd = read("lib/callForwarding.ts");
  assert.match(fwd, /ALL_OFF_CODE = "##002#"/);
  assert.match(sections, /##002#/);
});

test("v2: few words, the three moments the product answers, no orange", () => {
  const visible = (sections + page)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/className="[^"]*"|alt="[^"]*"|import[^\n]*|<[^>]*>/g, " ");
  const words = (sections.match(/"[^"]*"/g) ?? []).length;
  assert.ok(words < 100, `sections stay short (${words} strings)`);
  for (const m of ["You're busy", "After hours", "On another call"]) assert.match(sections + read("components/marketing/landingCopy.ts"), new RegExp(m));
  assert.doesNotMatch(visible, /Phone off|no signal/i);
  assert.doesNotMatch(sections + page, /#c2410c|ember/i);
});

test("segment pages reuse the skeleton; /cleaning redirects to Home services", () => {
  const route = read("app/for/[segment]/page.tsx");
  const hub = read("app/for/page.tsx");
  const config = readFileSync(new URL("../dashboard/next.config.ts", import.meta.url), "utf8");
  assert.match(route, /generateStaticParams/);
  assert.match(route, /copy=\{segmentCopy\(segment\)\}/);
  assert.match(hub, /data-for-hub=/);
  assert.match(page, /<LandingMoments items=\{copy\.moments\} \/>/);
  assert.match(page, /\{copy\.finalHeading\}/);
  assert.match(config, /source: "\/cleaning", destination: "\/for\/home-services", permanent: true/);
  assert.equal(existsSync(new URL("../dashboard/src/app/cleaning/page.tsx", import.meta.url)), false);
});
