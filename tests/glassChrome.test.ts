import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deskShellGlowFromEnv, STAGING_DESK_PROJECT_ID } from "../dashboard/src/lib/deskFeatureFlags.ts";
import { parseDeskEffects } from "../dashboard/src/lib/deskEffects.ts";

const css = readFileSync(new URL("../dashboard/src/app/globals.css", import.meta.url), "utf8");
const layout = readFileSync(new URL("../dashboard/src/app/layout.tsx", import.meta.url), "utf8");
const picker = readFileSync(new URL("../dashboard/src/components/ThemePicker.tsx", import.meta.url), "utf8");

function glassPercent(block: string): number {
  const match = block.match(/--glass:\s*color-mix\(in srgb, var\(--surface\)\s+(\d+)%/);
  assert.ok(match, "glass fill percent");
  return Number(match[1]);
}

test("glass blur is 12px on the phone and 20px from md", () => {
  assert.match(css, /--glass-blur:\s*12px;/);
  assert.match(css, /@media \(min-width: 768px\) \{[\s\S]*?--glass-blur:\s*20px;/);
  assert.doesNotMatch(css, /--glass-blur:\s*16px/);
});

test("light and dark glass fills stay at least 0.72", () => {
  const light = css.match(/:root \{[\s\S]*?\n\}/);
  const dark = css.match(/:root\[data-theme="dark"\] \{[\s\S]*?\n\}/);
  assert.ok(light && dark);
  assert.ok(glassPercent(light[0]) >= 72);
  assert.equal(glassPercent(dark[0]), 72);
  assert.doesNotMatch(dark[0], /58%/);
});

test("missing backdrop-filter falls back to a solid fill and a 1px slate border", () => {
  assert.match(css, /@supports not \(backdrop-filter: blur\(1px\)\) \{[\s\S]*?\.glass-chrome \{[\s\S]*?background-color: var\(--surface\);[\s\S]*?border: 1px solid var\(--hairline\);/);
});

test("Reduce effects and OS reduce preferences drop blur and the glow", () => {
  assert.match(css, /html\[data-effects="reduced"\] \.glass-chrome/);
  assert.match(css, /prefers-reduced-transparency: reduce/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(picker, /Reduce effects/);
  assert.match(picker, /writeDeskEffects/);
  assert.match(picker, /<Switch/);
  assert.match(layout, /DESK_EFFECTS_INIT_SCRIPT/);
  assert.match(layout, /data-theme="light"/);
  assert.equal(parseDeskEffects("reduced"), "reduced");
  assert.equal(parseDeskEffects("full"), "full");
  assert.equal(parseDeskEffects(null), "full");
});

test("shell glow is one fixed layer, staging on by default, easy off", () => {
  assert.match(css, /position: fixed;/);
  assert.match(css, /pointer-events: none;/);
  assert.match(css, /var\(--brand\)/);
  assert.match(css, /var\(--attention\)/);
  assert.match(layout, /data-shell-glow=\{deskShellGlowEnabled\(\) \? "on" : "off"\}/);
  assert.equal(deskShellGlowFromEnv({}), false);
  assert.equal(deskShellGlowFromEnv({ VERCEL_PROJECT_ID: STAGING_DESK_PROJECT_ID }), true);
  assert.equal(deskShellGlowFromEnv({ VERCEL_URL: "scalers-staging-abc.vercel.app" }), true);
  assert.equal(deskShellGlowFromEnv({ VERCEL_PROJECT_ID: STAGING_DESK_PROJECT_ID, DESK_SHELL_GLOW: "off" }), false);
  assert.equal(deskShellGlowFromEnv({ DESK_SHELL_GLOW: "on" }), true);
  assert.equal(deskShellGlowFromEnv({ DESK_SHELL_GLOW: "OFF" }), false);
  assert.equal(deskShellGlowFromEnv({ VERCEL_URL: "scalers-project.vercel.app" }), false);
});
