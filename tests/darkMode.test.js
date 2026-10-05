// Dark mode: token-driven, platform-wide, per-device choice. Glass chrome only.

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
  "--canvas:",
  "--surface:",
  "--surface-2:",
  "--hairline:",
  "--ink:",
  "--ink-2:",
  "--accent:",
  "--accent-on:",
  "--brand:",
  "--glass:",
  "--ok:",
];

describe("dark palette", () => {
  const css = read("dashboard/src/app/globals.css");

  it("activates on explicit choice and on system dark for the whole document", () => {
    assert.match(css, /:root\[data-theme="dark"\] \{/);
    assert.match(css, /@media \(prefers-color-scheme: dark\)/);
    assert.match(css, /:root:not\(\[data-theme="light"\]\) \{/);
    assert.match(css, /color-scheme: dark/);
  });

  it("redefines every core token on :root in both dark blocks", () => {
    const explicit = css.match(/:root\[data-theme="dark"\]\s*\{[^}]+\}/s);
    const system = css.match(
      /@media \(prefers-color-scheme: dark\)\s*\{[\s\S]*?:root:not\(\[data-theme="light"\]\)\s*\{[^}]+\}/,
    );
    assert.ok(explicit, "explicit dark :root block");
    assert.ok(system, "system dark :root block");
    for (const block of [explicit[0], system[0]]) {
      for (const token of DARK_TOKENS) {
        assert.ok(block.includes(token), `dark block defines ${token}`);
      }
    }
  });

  it("keeps charter light values on :root", () => {
    for (const pair of [
      /--canvas: #f4f7fb/,
      /--surface: #ffffff/,
      /--ink: #0a192f/,
      /--accent: #005ccc/,
      /--brand: #0096ff/,
    ]) {
      assert.match(css, pair);
    }
  });

  it("offsets focus rings against the surface token, never white, in dark", () => {
    assert.match(css, /--tw-ring-offset-color: var\(--surface\)/);
  });

  it("defines glass chrome for elevated shells only", () => {
    assert.match(css, /\.glass-chrome \{/);
    assert.match(css, /backdrop-filter: blur\(var\(--glass-blur\)\)/);
    assert.match(css, /prefers-reduced-transparency: reduce/);
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
    assert.match(layout, /var r=document\.documentElement;r\.dataset\.theme=t/);
    assert.match(layout, /style\.colorScheme=s/);
    assert.match(layout, /dark only/);
    assert.match(layout, /meta\[name="color-scheme"\]/);
    assert.match(layout, /dangerouslySetInnerHTML/);
  });

  it("pins the document color-scheme so native option lists match the card", () => {
    const css = read("dashboard/src/app/globals.css");
    const themeLib = read("dashboard/src/lib/deskTheme.ts");
    const master = read("docs/frontend/design-system/MASTER.md");
    assert.match(themeLib, /deskColorSchemeValue/);
    assert.match(themeLib, /root\.style\.colorScheme = scheme/);
    assert.match(themeLib, /root\.style\.colorScheme = ""/);
    assert.match(themeLib, /document\.body\.style\.colorScheme/);
    assert.match(themeLib, /meta\[name="color-scheme"\]/);
    assert.match(themeLib, /"dark only"/);
    assert.match(themeLib, /"light only"/);
    assert.match(css, /:root\[data-theme="dark"\] \{\s*color-scheme: dark only;/);
    assert.match(css, /:root\[data-theme="light"\] \{\s*color-scheme: light only;\s*\}/);
    assert.match(css, /:root\[data-theme="dark"\] body \{\s*color-scheme: dark only;\s*\}/);
    assert.match(css, /:root\[data-theme="light"\] body \{\s*color-scheme: light only;\s*\}/);
    assert.match(css, /color-scheme: dark only;/);
    assert.match(
      css,
      /:root\[data-theme="dark"\] \.desk-theme select,\s*:root\[data-theme="dark"\] \.desk-theme select option,\s*:root\[data-theme="dark"\] \.admin-theme select,\s*:root\[data-theme="dark"\] \.admin-theme select option \{\s*color-scheme: inherit;\s*\}/,
    );
    assert.match(
      css,
      /:root:not\(\[data-theme="light"\]\) \.desk-theme select,\s*:root:not\(\[data-theme="light"\]\) \.desk-theme select option,\s*:root:not\(\[data-theme="light"\]\) \.admin-theme select,\s*:root:not\(\[data-theme="light"\]\) \.admin-theme select option \{\s*color-scheme: inherit;\s*\}/,
    );
    assert.match(css, /\.desk-theme option,\s*\.desk-theme optgroup,\s*\.admin-theme option,\s*\.admin-theme optgroup \{\s*color: var\(--ink\);\s*background-color: var\(--card\);/);
    assert.match(master, /color-scheme: dark only/);
    assert.match(css, /:root\[data-theme="dark"\] \{\s*color-scheme: dark only;[\s\S]*?--canvas:/);
  });

  it("scopes the desk layout and the dev bench to the theme", () => {
    assert.match(read("dashboard/src/app/(desk)/layout.tsx"), /deskShellClass/);
    assert.match(read("dashboard/src/components/DeskNav.tsx"), /desk-theme fixed inset-0 flex/);
    assert.match(read("dashboard/src/app/globals.css"), /body:has\(\.desk-theme\)/);
    assert.match(read("dashboard/src/app/dev/inbox/page.tsx"), /deskShellClass/);
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
    assert.match(picker, /role="radiogroup"/);
    assert.match(picker, /aria-label="This device"/);
    assert.match(picker, /data-theme-cluster=""/);
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
    const account = read("dashboard/src/components/DeskAccountMenu.tsx");
    const settingsNav = read("dashboard/src/lib/businessSettingsNav.ts");
    const landing = read("dashboard/src/components/marketing/LandingPage.tsx");
    const login = read("dashboard/src/app/login/page.tsx");
    const adminLogin = read("dashboard/src/app/admin/login/page.tsx");
    assert.match(picker, /export function ThemeDock/);
    assert.match(landing, /<ThemeDock/);
    assert.match(login, /<ThemeDock/);
    assert.match(adminLogin, /<ThemeDock/);
    assert.match(account, /<ThemePicker \/>/);
    assert.match(account, />\s*This device\s*</);
    assert.doesNotMatch(account, /\/settings/);
    assert.doesNotMatch(shell, /<ThemePicker \/>/);
    assert.doesNotMatch(shell, /title="This device"/);
    assert.doesNotMatch(settingsNav, /raw === "appearance"/);
    assert.doesNotMatch(settingsNav, /title: "This device"/);
    assert.doesNotMatch(settingsNav, /label: "Appearance"/);
  });
});

describe("desk token hygiene", () => {
  const SKIP = new Set([
    "components/AdminNav.tsx",
    "components/AdminVoicesManager.tsx",
    "components/AdminBillingListPanel.tsx",
    "components/AdminBillingDetailPanel.tsx",
    "components/AdminBusinessesPanel.tsx",
    "components/DidPoolManager.tsx",
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
    assert.match(ui, /md:w-max md:max-w-\[13\.5rem\]/);
    assert.match(ui, /focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/);
  });

  it("documents the dark system in MASTER", () => {
    const master = read("docs/frontend/design-system/MASTER.md");
    assert.match(master, /## Dark mode/);
    assert.match(master, /desk-theme/);
    assert.match(master, /accent-on-fill/);
    assert.match(master, /entire platform/);
    assert.match(master, /glass-chrome/);
  });
});
