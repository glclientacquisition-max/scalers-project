// Landing P0-2 (30 Oct, v2): light hero, blue landing CTA token, Request access, soft blue orbs, calm motion.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (p: string) => fs.readFileSync(path.join(import.meta.dirname, "..", "dashboard/src", p), "utf8");
const landing = read("components/marketing/LandingPage.tsx");
const cta = read("components/marketing/LandingCta.tsx");
const css = read("app/globals.css");

test("hero is a luminous blue that fades into the page, with a frosted call card, one H1", () => {
  assert.match(landing, /landing-hero-sky/);
  assert.match(landing, /data-landing-fade=/);
  assert.match(landing, /to-canvas/);
  assert.doesNotMatch(landing, /bg-brand-900/);
  assert.match(landing, /<HeroCall glass/);
  assert.match(landing, /text-white\/90/);
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

test("orange is a soft sunset across the hero, nowhere else, and static when effects are reduced", () => {
  assert.match(landing, /className="landing-horizon"/);
  assert.doesNotMatch(landing, /landing-warm-orb|border-radius:\s*9999px/);
  const hero = landing.slice(landing.indexOf("data-landing-hero"), landing.indexOf("<HeroCall"));
  assert.match(hero, /landing-horizon/, "the wash is on the hero plane, not on the call card");
  const tokenAt = css.indexOf("--landing-warm:");
  const at = css.lastIndexOf(".landing-horizon {", tokenAt);
  const end = css.indexOf("@keyframes landing-horizon-in", tokenAt);
  const wash = css.slice(at, end);
  assert.ok(at > 0 && end > at);
  assert.match(wash, /--landing-warm:\s*255 122 26;/);
  assert.match(wash, /linear-gradient\(to top/);
  assert.match(wash, /transparent 72%\)/);
  assert.doesNotMatch(wash, /rgb\(10 25 47/);
  assert.match(wash, /animation: landing-horizon-in var\(--motion-fast\)/);
  assert.doesNotMatch(wash, /border-radius|filter:\s*blur|0\.9\d/);
  const alphas = [...wash.matchAll(/\/ (0\.\d+)/g)].map((m) => Number(m[1]));
  assert.ok(alphas.length >= 3 && Math.max(...alphas) <= 0.5, alphas.join(","));
  const outside = css.slice(0, at) + css.slice(end);
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
  assert.match(css, /\.landing-horizon, \.landing-drift \{ animation: none; \}/);
  assert.match(css, /\.landing-horizon,\n {2}\.desk-live-ping/);
  assert.match(css, /@media \(max-width: 767px\) \{\s*\.landing-scope \.glass-chrome \{[^}]*blur\(12px\)/);
});

test("premium backdrop is CSS-only orbs behind the hero card and stops with reduced motion", () => {
  assert.match(css, /\.landing-orbs::before \{[^}]*radial-gradient/);
  assert.doesNotMatch(css.slice(css.indexOf(".landing-orbs {"), css.indexOf("@keyframes landing-orb")), /filter:\s*blur/);
  assert.match(css, /\.landing-rise, \.landing-orbs::before, \.landing-orbs::after \{ animation: none; \}/);
});
