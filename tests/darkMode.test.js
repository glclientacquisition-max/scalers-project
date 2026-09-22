// Dark mode: token-driven, desk-scoped, per-device choice.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DASH = path.join(ROOT, "dashboard/src");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(tsx|ts)$/.test(entry.name)) yield full;
  }
}

const DARK_TOKENS = [
  "--bg:",
  "--card:",
  "--ink:",
  "--ink-soft:",
  "--line:",
  "--accent:",
  "--accent-deep:",
  "--accent-fill:",
  "--accent-on-fill:",
  "--warn:",
  "--ok:",
];

describe("dark palette", () => {
  const css = read("dashboard/src/app/globals.css");

  it("activates on explicit choice and on system dark, scoped to the desk", () => {
    assert.match(css, /:root\[data-theme="dark"\] \.desk-theme/);
    assert.match(css, /@media \(prefers-color-scheme: dark\)/);
    assert.match(css, /:root:not\(\[data-theme="light"\]\) \.desk-theme/);
    assert.match(css, /color-scheme: dark/);
  });

  it("redefines every core token in both dark blocks", () => {
    const blocks = css.match(/\.desk-theme\s*\{[^}]+\}/gs) || [];
    assert.ok(blocks.length >= 2, "two dark blocks stay in sync");
    for (const block of blocks.slice(0, 2)) {
      for (const token of DARK_TOKENS) {
        assert.ok(block.includes(token), `dark block defines ${token}`);
      }
    }
  });

  it("keeps light values identical to the pre-dark palette", () => {
    for (const pair of [
      /--bg: #f4f7fb/,
      /--card: #ffffff/,
      /--ink: #0a192f/,
      /--accent: #0096ff/,
      /--accent-deep: #005ccc/,
      /--accent-fill: #005ccc/,
    ]) {
      assert.match(css, pair);
    }
  });

  it("offsets focus rings against the card token, never white, in dark", () => {
    assert.match(css, /--tw-ring-offset-color: var\(--card\)/);
  });

  it("recomputes ink on the desk shell so typed text is not inherited navy", () => {
    assert.match(css, /\.desk-theme \{\s*color: var\(--ink\);\s*caret-color: var\(--ink\);/);
    assert.match(css, /\.desk-theme textarea,\s*\.desk-theme select \{\s*color: var\(--ink\);/);
    assert.match(css, /-webkit-text-fill-color: var\(--ink\)/);
  });
});

describe("theme activation", () => {
  it("sets data-theme before paint from the per-device choice", () => {
    const layout = read("dashboard/src/app/layout.tsx");
    const themeLib = read("dashboard/src/lib/deskTheme.ts");
    assert.match(themeLib, /export const DESK_THEME_STORAGE_KEY = "scalers-desk-theme"/);
    assert.match(themeLib, /localStorage\.getItem\(DESK_THEME_STORAGE_KEY\)/);
    assert.match(themeLib, /localStorage\.setItem\(DESK_THEME_STORAGE_KEY, choice\)/);
    assert.match(themeLib, /localStorage\.removeItem\(DESK_THEME_STORAGE_KEY\)/);
    assert.match(layout, /DESK_THEME_STORAGE_KEY/);
    assert.match(layout, /localStorage\.getItem\(\$\{JSON\.stringify\(DESK_THEME_STORAGE_KEY\)\}\)/);
    assert.match(layout, /document\.documentElement\.dataset\.theme/);
    assert.match(layout, /dangerouslySetInnerHTML/);
  });

  it("scopes the desk layout and the dev bench to the theme", () => {
    assert.match(read("dashboard/src/app/(desk)/layout.tsx"), /desk-theme/);
    assert.match(read("dashboard/src/app/dev/inbox/page.tsx"), /desk-theme/);
  });

  it("keeps lockup ink theme-aware after the phone header was removed", () => {
    const layout = read("dashboard/src/app/(desk)/layout.tsx");
    assert.doesNotMatch(layout, /DeskPhoneHeader/);
    assert.doesNotMatch(layout, /bg-surface\/95/);
    assert.doesNotMatch(layout, /backdrop-blur/);
    const lockup = read("dashboard/src/components/brand/BrandMark.tsx");
    assert.match(lockup, /onDark \? "text-white" : "text-ink"/);
    assert.doesNotMatch(lockup, /text-brand-900/);
  });

  it("offers System, Light, Dark as an instant This device preference", () => {
    const picker = read("dashboard/src/components/ThemePicker.tsx");
    const themeLib = read("dashboard/src/lib/deskTheme.ts");
    const ui = read("dashboard/src/components/settingsUi.tsx");
    assert.match(ui, /role="radiogroup"/);
    assert.match(picker, /SettingsSegmented/);
    assert.match(picker, /label="This device"/);
    assert.match(picker, /readDeskTheme/);
    assert.match(picker, /writeDeskTheme/);
    assert.match(picker, /applyDeskTheme/);
    assert.doesNotMatch(picker, /tenant\.|saveAndCompile|llm_system_prompt/);
    for (const label of ['"system"', '"light"', '"dark"']) {
      assert.ok(picker.includes(`id: ${label}`), `choice ${label}`);
    }
    assert.match(themeLib, /delete root\.dataset\.theme/);
    assert.match(themeLib, /root\.dataset\.theme = choice/);
    const shell = read("dashboard/src/components/BusinessSettingsShell.tsx");
    const settingsNav = read("dashboard/src/lib/businessSettingsNav.ts");
    assert.match(shell, /<ThemePicker \/>/);
    assert.match(shell, /title="This device"/);
    assert.match(settingsNav, /This device/);
    assert.match(settingsNav, /label: "Appearance"/);
  });
});

describe("desk token hygiene", () => {
  const SKIP = new Set([
    "components/AdminNav.tsx",
    "components/AdminVoicesManager.tsx",
    "components/AdminWalletsPanel.tsx",
    "components/AdminBusinessesPanel.tsx",
    "components/DidPoolManager.tsx",
    "components/SautikitTelecomPanel.tsx",
  ]);

  it("leaves no hardcoded hex or white surfaces inside the desk scope", () => {
    const offenders = [];
    for (const full of walk(DASH)) {
      const rel = path.relative(DASH, full);
      if (SKIP.has(rel)) continue;
      if (rel.startsWith("components/marketing/") || rel.startsWith("components/brand/")) continue;
      if (!rel.startsWith("app/(desk)/") && !rel.startsWith("components/")) continue;
      const src = fs.readFileSync(full, "utf8");
      if (/#[0-9a-fA-F]{6}\b/.test(src) || /\bbg-white\b/.test(src)) {
        offenders.push(rel);
      }
    }
    assert.deepEqual(offenders, []);
  });

  it("runs filled primary on the accent-fill ramp with an on-fill label", () => {
    const chrome = read("dashboard/src/components/ui/deskChrome.ts");
    assert.match(chrome, /bg-accent-fill/);
    assert.match(chrome, /text-accent-on-fill/);
    assert.match(chrome, /hover:bg-accent-fill-hover/);
    assert.doesNotMatch(chrome, /bg-\[#005CCC\]|text-white/);
  });

  it("puts text-ink on every settings field class", () => {
    const ui = read("dashboard/src/components/settingsUi.tsx");
    assert.match(ui, /export const settingsDenseFieldClass =\s*[`"'][^`"']*text-ink/);
    assert.match(ui, /export const settingsTableFieldClass =\s*[`"'][^`"']*text-ink/);
    assert.match(ui, /deskFieldClass/);
    assert.match(ui, /lg:w-\[13\.5rem\]/);
    assert.match(ui, /focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/);
  });

  it("documents the dark system in MASTER", () => {
    const master = read("docs/frontend/design-system/MASTER.md");
    assert.match(master, /## Dark mode/);
    assert.match(master, /desk-theme/);
    assert.match(master, /accent-on-fill/);
  });
});
