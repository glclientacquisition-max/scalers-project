"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const consoleRoot = path.join(root, "dashboard/src/app/admin/(console)");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

function walkLoading(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "_screens" || entry.name === "%5Fkit") continue;
      walkLoading(full, acc);
    } else if (entry.name === "loading.tsx") acc.push(full);
  }
  return acc;
}

const REQUIRED = [
  "loading.tsx",
  "businesses/loading.tsx",
  "businesses/[id]/loading.tsx",
  "businesses/[id]/usage/loading.tsx",
  "numbers/loading.tsx",
  "quality/loading.tsx",
  "quality/[business]/loading.tsx",
  "quality/call/[id]/loading.tsx",
  "quality/insights/loading.tsx",
  "billing/loading.tsx",
  "billing/home/loading.tsx",
  "billing/invoices/loading.tsx",
  "billing/invoices/[id]/loading.tsx",
  "billing/payments/loading.tsx",
  "billing/packages/loading.tsx",
  "settings/loading.tsx",
  "settings/general/loading.tsx",
  "settings/services/loading.tsx",
  "settings/voices/loading.tsx",
  "settings/audit/loading.tsx",
  "packages/loading.tsx",
  "platform/loading.tsx",
];

test("required Admin console routes have loading.tsx", () => {
  for (const rel of REQUIRED) {
    assert.equal(fs.existsSync(path.join(consoleRoot, rel)), true, rel);
  }
});

test("every Admin console loading.tsx is ops-shaped (no ui Skeleton / SkeletonList)", () => {
  const files = walkLoading(consoleRoot);
  assert.ok(files.length >= REQUIRED.length, `expected >= ${REQUIRED.length} loaders, got ${files.length}`);
  for (const full of files) {
    const rel = path.relative(root, full);
    const src = fs.readFileSync(full, "utf8");
    assert.doesNotMatch(src, /SkeletonList/, rel);
    assert.doesNotMatch(src, /@\/components\/ui\/Skeleton/, rel);
    assert.match(
      src,
      /OpsLoading|UsageSkeleton|InsightsSkeleton/,
      `${rel} must use OpsLoading* / UsageSkeleton / InsightsSkeleton`,
    );
  }
});

test("OpsRouteLoading exports detail + platform loaders used by nested routes", () => {
  const src = read("dashboard/src/components/admin/v2/OpsRouteLoading.tsx");
  for (const name of [
    "OpsLoadingConsole",
    "OpsLoadingBusinesses",
    "OpsLoadingNumbers",
    "OpsLoadingQuality",
    "OpsLoadingInvoices",
    "OpsLoadingPackages",
    "OpsLoadingBillingHome",
    "OpsLoadingPayments",
    "OpsLoadingSettings",
    "OpsLoadingBusinessDetail",
    "OpsLoadingInvoiceDetail",
    "OpsLoadingQualityDetail",
    "OpsLoadingQualityCall",
    "OpsLoadingPlatform",
  ]) {
    assert.match(src, new RegExp(`export function ${name}\\(`), name);
  }
  assert.match(src, /ops-theme/);
  assert.match(src, /h-ops-row|gap-ops-|pe-ops-|p-ops-/);
  // Ban import/usage of the generic SkeletonList — ignore the ban named in the file comment.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /SkeletonList/);
  assert.doesNotMatch(code, /@\/components\/ui\/Skeleton/);
});

test("nested detail loaders wire the matching OpsLoading* export", () => {
  const pairs = [
    ["businesses/[id]/loading.tsx", "OpsLoadingBusinessDetail"],
    ["billing/invoices/[id]/loading.tsx", "OpsLoadingInvoiceDetail"],
    ["quality/[business]/loading.tsx", "OpsLoadingQualityDetail"],
    ["quality/call/[id]/loading.tsx", "OpsLoadingQualityCall"],
    ["platform/loading.tsx", "OpsLoadingPlatform"],
    ["settings/loading.tsx", "OpsLoadingSettings"],
    ["billing/loading.tsx", "OpsLoadingBillingHome"],
  ];
  for (const [rel, name] of pairs) {
    const src = read(`dashboard/src/app/admin/(console)/${rel}`);
    assert.match(src, new RegExp(`import \\{ ${name} \\}`), rel);
    assert.match(src, new RegExp(`<${name} />`), rel);
  }
});
