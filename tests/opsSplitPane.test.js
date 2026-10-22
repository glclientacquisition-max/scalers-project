// Admin slice 2b: split pane, v2 shell, stretch tiles. Source-level guards plus the section rule.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const pane = read("dashboard/src/components/ops/SplitPane.tsx");
const css = read("dashboard/src/styles/ops.css");
const v2css = read("dashboard/src/styles/admin-v2.css");
const nav = read("dashboard/src/components/AdminNav.tsx");
const links = read("dashboard/src/lib/adminLinks.ts");
const layout = read("dashboard/src/app/admin/(console)/layout.tsx");
const kit = read("dashboard/src/app/admin/(console)/%5Fkit/KitClient.tsx");
const pkg = JSON.parse(read("dashboard/package.json"));

function rule(src, sel) {
  const at = src.indexOf(sel + " {");
  assert.ok(at >= 0, sel);
  return src.slice(at, src.indexOf("}", at));
}

describe("split pane sections", () => {
  const run = (input) => {
    const script = `import { paneSections } from ${JSON.stringify(path.join(root, "dashboard/src/lib/ops/pane.ts"))};
      console.log(JSON.stringify(paneSections(${JSON.stringify(input)})));`;
    const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", script], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout.trim());
  };
  it("keeps the fixed order", () => {
    assert.deepEqual(run({ related: [1], history: [1], changes: [1], facts: [1] }), ["facts", "changes", "history", "related"]);
  });
  it("hides empty and missing sections", () => {
    assert.deepEqual(run({ facts: [1], changes: [], history: undefined }), ["facts"]);
    assert.deepEqual(run({}), []);
  });
});

describe("split pane layout", () => {
  it("is 560px, 640px from 1440, and the list keeps 640px", () => {
    assert.match(rule(css, ".ops-split-pane"), /width: min\(560px, calc\(100% - 640px\)\)/);
    assert.match(css, /@media \(min-width: 1440px\) \{\s*\.ops-split-pane \{\s*width: 640px;/);
    assert.match(rule(css, ".ops-split-list"), /min-width: 640px/);
  });
  it("is a bottom sheet below md and never a centred modal", () => {
    assert.match(pane, /if \(phone\) \{[\s\S]*<Sheet /);
    assert.doesNotMatch(pane, /Dialog|justify-center items-center|items-center justify-center fixed|translate-x-1\/2|-translate-y-1\/2/);
    assert.doesNotMatch(pane, /fixed inset-0/);
  });
  it("pins the confirm footer to the bottom of the pane", () => {
    assert.match(pane, /flex-1 overflow-y-auto[\s\S]*data-pane-footer="" className="shrink-0/);
  });
  it("collapses the sidebar while a pane is open below 1600px", () => {
    assert.match(pane, /root\.dataset\.paneOpen = ""/);
    assert.match(v2css, /:root\[data-pane-open\] \.admin-side \{\s*width: 56px;/);
  });
});

describe("admin v2 shell", () => {
  it("is behind ADMIN_V2=on", () => {
    assert.match(layout, /v2=\{process\.env\.ADMIN_V2 === "on"\}/);
  });
  it("sidebar is 200px with labels and collapses to 56px", () => {
    assert.match(rule(v2css, ".admin-side"), /width: 200px/);
    assert.match(v2css, /\.admin-side\[data-collapsed\],[\s\S]*?width: 56px/);
    assert.match(nav, /aria-expanded=\{!collapsed\}/);
  });
  it("top bar is 40px and main is full width with 16px margins", () => {
    assert.match(nav, /<AdminAccountMenu name=\{operatorName\} compact \/>/);
    assert.match(read("dashboard/src/components/AdminAccountMenu.tsx"), /md:h-10/);
    const main = links.match(/adminMainV2Class =\s*"([^"]+)"/)[1];
    assert.match(main, /\bw-full\b/);
    assert.match(main, /\bpx-4\b/);
    assert.doesNotMatch(main, /max-w-/);
  });
  it("tiles stretch 2 to 6 per row", () => {
    assert.match(rule(css, ".ops-tiles"), /repeat\(2, minmax\(0, 1fr\)\)/);
    assert.match(css, /repeat\(auto-fit, minmax\(max\(180px, calc\(\(100% - 40px\) \/ 6\)\), 1fr\)\)/);
  });
});

describe("kit and guards", () => {
  it("shows the split pane on the kit page", () => {
    assert.match(kit, /<SplitLayout/);
    assert.match(kit, /<SplitPane /);
    assert.match(kit, /className="ops-tiles"/);
  });
  it("adds no motion package and names no vendor on screen", () => {
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    for (const bad of ["framer-motion", "motion", "react-spring", "@react-spring/web", "gsap"]) assert.ok(!deps.includes(bad), bad);
    for (const src of [pane, kit]) assert.doesNotMatch(src, /Supabase|Vercel|Soniox|Gemini|Twilio|Africa'?s Talking|Stripe|M-?Pesa API/i);
  });
});
