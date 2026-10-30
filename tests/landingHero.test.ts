// Landing P0-2 (30 Oct, v2): light hero, blue landing CTA token, Request access, soft blue orbs, calm motion.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (p: string) => fs.readFileSync(path.join(import.meta.dirname, "..", "dashboard/src", p), "utf8");
const landing = read("components/marketing/LandingPage.tsx");
const cta = read("components/marketing/LandingCta.tsx");
const css = read("app/globals.css");

test("hero is main's dark navy plane with a frosted call card, one H1", () => {
  assert.match(landing, /bg-gradient-to-br from-brand-900 via-brand-800\/95 to-brand-700\/80/);
  assert.match(landing, /<HeroCall glass/);
  assert.match(landing, /text-sky-100\/90/);
  assert.equal((landing.match(/<h1/g) || []).length, 1);
  const copy = read("components/marketing/landingCopy.ts");
  assert.match(copy, /h1: "Your 24-hour Business Assistant\."/);
  assert.match(copy, /sub: "Answers your calls when you're busy, closed, or on another call\."/);
});

test("CTA is Request access and uses the landing token only", () => {
  assert.match(cta, /LANDING_CTA_LABEL = "Request access"/);
  assert.match(cta, /landing-cta/);
  // Blue is the only button colour; no orange (Ember) left on marketing pages.
  assert.match(css, /\.landing-scope \{\s*--landing-cta: #005ccc;/);
  assert.doesNotMatch(css, /#c2410c|#9a3412|rgb\(194 65 12/i);
  // The Desk CTA blue is untouched.
  assert.match(css, /--accent: #005ccc;/);
  const desk = fs.readdirSync(path.join(import.meta.dirname, "..", "dashboard/src/components")).filter((f) => f.endsWith(".tsx"));
  for (const f of desk) assert.doesNotMatch(read(`components/${f}`), /landing-cta|--landing-cta/, f);
});

test("reduced motion shows the finished call card; marketing fonts are DM Sans + Sora", () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.hero-in, \.hero-ring \{ opacity: 0; \}/);
  const fonts = read("app/marketingFonts.ts");
  assert.match(fonts, /DM_Sans/);
  assert.match(fonts, /Sora/);
  assert.match(read("app/page.tsx"), /marketingFontClass/);
});

test("orange appears only in the hero glow, strong enough to read, and stops with reduced motion", () => {
  assert.match(landing, /className="landing-warm-orb" aria-hidden/);
  const orbAt = css.indexOf(".landing-warm-orb {");
  const orbEnd = css.indexOf("@keyframes landing-warm");
  const orb = css.slice(orbAt, orbEnd);
  assert.ok(orbAt > 0 && orbEnd > orbAt);
  assert.match(orb, /--landing-warm:\s*255 122 26;/);
  assert.match(orb, /rgb\(var\(--landing-warm\) \/ 0\.9[0-9]\)/);
  assert.doesNotMatch(orb, /filter:\s*blur/);
  const outside = css.slice(0, orbAt) + css.slice(orbEnd);
  assert.doesNotMatch(outside, /--landing-warm|255 122 26|#ff7a1a/i);
  const marketing = [
    landing,
    cta,
    read("components/marketing/LandingSections.tsx"),
    read("components/marketing/LandingStory.tsx"),
    read("components/marketing/PackagePrices.tsx"),
    read("components/marketing/landingCopy.ts"),
    read("app/pricing/page.tsx"),
    read("app/cleaning/page.tsx"),
  ].join("\n");
  assert.doesNotMatch(marketing, /--landing-warm|255 122 26|#ff7a1a|(bg|text|border|from|via|to)-(orange|amber)|ember/i);
  assert.match(css, /\.landing-cta-on-dark \{ background: #ffffff; color: #0a192f; \}/);
  assert.match(css, /\.landing-warm-orb, \.landing-drift \{ animation: none; \}/);
  assert.match(css, /\.landing-warm-orb,\n {2}\.desk-live-ping/);
});

test("premium backdrop is CSS-only orbs behind the hero card and stops with reduced motion", () => {
  assert.match(css, /\.landing-orbs::before \{[^}]*radial-gradient/);
  assert.doesNotMatch(css.slice(css.indexOf(".landing-orbs {"), css.indexOf("@keyframes landing-orb")), /filter:\s*blur/);
  assert.match(css, /\.landing-rise, \.landing-orbs::before, \.landing-orbs::after \{ animation: none; \}/);
});
