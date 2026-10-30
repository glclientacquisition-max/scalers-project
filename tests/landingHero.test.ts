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
  assert.match(landing, /Your 24-hour Business Assistant\./);
  assert.match(landing, /Answers your calls when you&apos;re busy, closed, or on another call\./);
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

test("one soft orange orb behind the hero card; orange nowhere else; stops with reduced motion", () => {
  assert.match(landing, /className="landing-warm-orb" aria-hidden/);
  assert.equal((css.match(/rgb\(255 122 26/g) || []).length, 2);
  assert.doesNotMatch(landing + cta, /(bg|text|border|from|via|to)-(orange|amber)|#ff7a1a|ember/i);
  assert.match(css, /\.landing-cta-on-dark \{ background: #ffffff; color: #0a192f; \}/);
  assert.match(css, /\.landing-warm-orb, \.landing-drift \{ animation: none; \}/);
});

test("premium backdrop is CSS-only orbs behind the hero card and stops with reduced motion", () => {
  assert.match(css, /\.landing-orbs::before \{[^}]*radial-gradient/);
  assert.doesNotMatch(css.slice(css.indexOf(".landing-orbs {"), css.indexOf("@keyframes landing-orb")), /filter:\s*blur/);
  assert.match(css, /\.landing-rise, \.landing-orbs::before, \.landing-orbs::after \{ animation: none; \}/);
});
