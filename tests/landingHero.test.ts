// Landing P0-2 (30 Oct): light hero, one landing-only CTA accent token, Request access, calm motion.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (p: string) => fs.readFileSync(path.join(import.meta.dirname, "..", "dashboard/src", p), "utf8");
const landing = read("components/marketing/LandingPage.tsx");
const cta = read("components/marketing/LandingCta.tsx");
const css = read("app/globals.css");

test("hero is on the light canvas, one H1, no dark brand plane", () => {
  assert.doesNotMatch(landing, /bg-brand-900|text-white|glass-chrome/);
  assert.equal((landing.match(/<h1/g) || []).length, 1);
  assert.match(landing, /Your calls get answered, even when you can&apos;t\./);
  assert.match(landing, /Keep your number\. Turn it off with one code\./);
});

test("CTA is Request access and uses the landing token only", () => {
  assert.match(cta, /LANDING_CTA_LABEL = "Request access"/);
  assert.match(cta, /landing-cta/);
  assert.match(css, /\.landing-scope \{\s*--landing-cta: #c2410c;/);
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
