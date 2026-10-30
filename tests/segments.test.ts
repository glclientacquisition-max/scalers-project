/** Run: node --experimental-strip-types --import ./tests/serverOnlyHook.mjs --test tests/segments.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { ReactNode } from "react";
import { exampleLine, SEGMENTS, segmentBySlug, segmentCopy, type Segment } from "../dashboard/src/components/marketing/segments.ts";

const require = createRequire(new URL("../dashboard/package.json", import.meta.url));
const { createElement } = require("react") as typeof import("react");
const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");

const BANNED = /coming soon|whatsapp as|landing page|subdomain|m-?pesa|testimonial|customers trust|\d{2,}%|free trial|book(?:ing)? automation/i;

function SegmentEntry({ segment }: { segment: Segment }): ReactNode {
  const copy = segmentCopy(segment);
  const note = exampleLine(segment.examples);
  return createElement(
    "article",
    { "data-segment": segment.slug },
    createElement("h1", null, copy.h1),
    createElement("p", null, copy.sub),
    createElement("ul", null, ...segment.pains.map((pain) => createElement("li", { key: pain }, pain))),
    createElement("p", null, segment.example.caller),
    createElement("p", null, segment.example.does),
    createElement("a", null, segment.cta),
    note ? createElement("p", null, note) : null,
  );
}

test("every segment renders a hero, pains, example call, and CTA", () => {
  assert.deepEqual(SEGMENTS.map((segment) => segment.slug), ["home-services", "shop", "other"]);
  assert.deepEqual(SEGMENTS.map((segment) => segment.name), ["Home services", "Shop", "Other business"]);
  for (const segment of SEGMENTS) {
    assert.equal(segmentBySlug(segment.slug)?.slug, segment.slug);
    assert.ok(segment.pains.length >= 2 && segment.pains.length <= 3);
    assert.ok(segment.hero.split(/\s+/).length <= 8, segment.hero);
    assert.match(segment.example.does, /assistant/);
    assert.equal(segment.cta, "Request access");
    assert.doesNotMatch(JSON.stringify(segment), BANNED);
    const html = renderToStaticMarkup(createElement(SegmentEntry, { segment })).replace(/&#x27;/g, "'");
    assert.match(html, new RegExp(`data-segment="${segment.slug}"`));
    assert.ok(html.includes(segment.hero), segment.hero);
    assert.ok(html.includes(segment.example.caller), segment.example.caller);
    assert.ok(html.includes(segment.example.does), segment.example.does);
    for (const pain of segment.pains) assert.ok(html.includes(pain), pain);
  }
  assert.equal(exampleLine(["Cleaning", "Plumbing"]), "Cleaning and Plumbing, for example.");
  assert.equal(segmentBySlug("nope"), null);
});

test("the segment route is one static template", () => {
  const page = readFileSync(new URL("../dashboard/src/app/for/[segment]/page.tsx", import.meta.url), "utf8");
  const sitemap = readFileSync(new URL("../dashboard/src/app/sitemap.ts", import.meta.url), "utf8");
  assert.match(page, /export function generateStaticParams/);
  assert.match(page, /generateMetadata/);
  assert.match(page, /notFound\(\)/);
  assert.match(page, /SEGMENTS\.map/);
  assert.match(sitemap, /\/for\/\$\{segment\.slug\}/);
  assert.match(sitemap, /"\/for"/);
});
