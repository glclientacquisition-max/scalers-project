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
  "--scrim:",
];

describe("dark palette", () => {
  const css = read("dashboard/src/app/globals.css");

  it("activates only on an explicit dark pick; the OS setting never turns it on", () => {
    assert.match(css, /:root\[data-theme="dark"\] \{/);
    assert.doesNotMatch(css, /@media \(prefers-color-scheme: dark\)/);
    assert.doesNotMatch(css, /:root:not\(\[data-theme="light"\]\) \{/);
    assert.match(css, /color-scheme: dark/);
    assert.match(css, /:root,\s*:root\[data-theme="light"\] \{\s*color-scheme: light only;/);
    assert.match(css, /html \{\s*background-color: var\(--canvas\);/);
  });

  it("redefines every core token on :root in the dark block", () => {
    const explicit = css.match(/:root\[data-theme="dark"\]\s*\{[^}]+\}/s);
    assert.ok(explicit, "explicit dark :root block");
    for (const token of DARK_TOKENS) {
      assert.ok(explicit[0].includes(token), `dark block defines ${token}`);
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

  it("defines glass chrome for elevated shells, not the sheet", () => {
    assert.match(css, /\.glass-chrome \{/);
    assert.match(css, /backdrop-filter: blur\(var\(--glass-blur\)\)/);
    assert.match(css, /prefers-reduced-transparency: reduce/);
    const sheet = read("dashboard/src/components/ui/Sheet.tsx");
    assert.doesNotMatch(sheet, /glass-chrome/);
    assert.match(sheet, /bg-surface/);
    assert.match(sheet, /themeClass/);
  });

  it("makes every sheet an opaque surface so page buttons cannot show through", () => {
    assert.match(
      css,
      /\.desk-drawer \{[\s\S]*?background-color: var\(--surface\);[\s\S]*?backdrop-filter: none;/,
    );
    assert.doesNotMatch(css, /\.desk-drawer\.glass-chrome/);
    const nav = read("dashboard/src/components/DeskNav.tsx");
    assert.match(nav, /glass-chrome/);
    assert.doesNotMatch(nav, /desk-drawer/);
    const sheet = read("dashboard/src/components/ui/Sheet.tsx");
    assert.match(sheet, /desk-drawer-viewport/);
    assert.match(
      css,
      /:root\[data-theme="dark"\] \.desk-drawer-viewport,\s*:root\[data-theme="light"\] \.desk-drawer-viewport \{\s*background: transparent;/,
    );
  });

  it("dims the drawer scrim with --scrim, never flipping --ink", () => {
    assert.match(css, /:root \{[\s\S]*?--scrim:/);
    assert.doesNotMatch(
      css,
      /\.desk-drawer-backdrop \{[\s\S]*?background-color: var\(--ink\);/,
    );
    assert.match(
      css,
      /\.desk-drawer-backdrop \{[\s\S]*?background-color: var\(--scrim\);/,
    );
    assert.match(css, /:root\[data-theme="dark"\] \.desk-drawer-backdrop/);
    assert.match(css, /:root\[data-theme="light"\] \.desk-drawer-backdrop/);
    const explicit = css.match(/:root\[data-theme="dark"\]\s*\{[^}]+\}/s);
    assert.ok(explicit && /--scrim:\s*#000/.test(explicit[0]), "dark scrim stays black");
    assert.match(css, /--scrim:\s*#0a192f/);
  });

  it("recomputes ink on the desk shell so typed text is not inherited navy", () => {
    assert.match(css, /\.desk-theme \{\s*color: var\(--ink\);\s*caret-color: var\(--ink\);/);
    assert.match(css, /\.desk-theme textarea,\s*\.desk-theme select \{\s*color: var\(--ink\);/);
    assert.match(css, /-webkit-text-fill-color: var\(--ink\)/);
  });
});

describe("theme activation", () => {
  it("renders light by default and applies a saved dark pick in <head> before paint", () => {
    const layout = read("dashboard/src/app/layout.tsx");
    const themeLib = read("dashboard/src/lib/deskTheme.ts");
    assert.match(themeLib, /export const DESK_THEME_STORAGE_KEY = "scalers-desk-theme"/);
    assert.match(themeLib, /localStorage\.getItem\(DESK_THEME_STORAGE_KEY\)/);
    assert.match(themeLib, /localStorage\.setItem\(DESK_THEME_STORAGE_KEY, choice\)/);
    assert.match(themeLib, /document\.cookie/);
    assert.match(themeLib, /SameSite=Lax/);
    assert.match(themeLib, /export function subscribeDeskTheme/);
    assert.match(themeLib, /export function readDeskThemeCookie/);
    assert.match(themeLib, /export const DESK_THEME_INIT_SCRIPT/);
    assert.match(themeLib, /r\.dataset\.theme=t/);
    assert.match(themeLib, /meta\[name="theme-color"\]/);
    // cacheComponents: a cookies() read in the root layout would make every route blocking.
    assert.doesNotMatch(layout, /cookies\(\)/);
    assert.match(layout, /data-theme="light"/);
    assert.match(themeLib, /document\.cookie\.match/);
    assert.match(layout, /<head>[\s\S]*DESK_THEME_INIT_SCRIPT[\s\S]*<\/head>/);
    assert.match(layout, /themeColor: DESK_THEME_COLOR_LIGHT/);
    assert.match(layout, /DeskThemeProvider initial="light"/);
    assert.match(themeLib, /DESK_THEME_COLOR_DARK/);
    assert.doesNotMatch(layout, /themeColor:\s*"#0096FF"/);
    assert.doesNotMatch(layout, /prefers-color-scheme/);
  });

  it("offers Light and Dark only, hydrated from the saved choice", () => {
    const picker = read("dashboard/src/components/ThemePicker.tsx");
    const kit = read("dashboard/src/app/dev/kit/KitShowcase.tsx");
    const provider = read("dashboard/src/components/DeskThemeProvider.tsx");
    assert.match(picker, /useSyncExternalStore/);
    assert.match(picker, /subscribeDeskTheme/);
    assert.doesNotMatch(picker, /"system"/);
    assert.match(picker, /id: "light", label: "Light"/);
    assert.match(picker, /id: "dark", label: "Dark"/);
    assert.match(provider, /DeskThemeProvider/);
    assert.match(kit, /useThemeChoice/);
    assert.match(kit, /pick\(/);
    assert.doesNotMatch(kit, /previous/);
  });

  it("pins the document color-scheme so native option lists match the card", () => {
    const css = read("dashboard/src/app/globals.css");
    const themeLib = read("dashboard/src/lib/deskTheme.ts");
    const master = read("docs/reference/design-system/MASTER.md");
    assert.match(themeLib, /deskColorSchemeValue/);
    assert.match(themeLib, /root\.style\.colorScheme = scheme/);
    assert.match(themeLib, /document\.body\.style\.colorScheme/);
    assert.match(themeLib, /meta\[name="color-scheme"\]/);
    assert.match(themeLib, /meta\[name="theme-color"\]/);
    assert.match(themeLib, /getPropertyValue\("--canvas"\)/);
    assert.match(themeLib, /DESK_THEME_COLOR_LIGHT/);
    assert.match(themeLib, /DESK_THEME_COLOR_DARK/);
    assert.match(themeLib, /"dark only"/);
    assert.match(themeLib, /"light only"/);
    assert.match(css, /:root\[data-theme="dark"\] \{\s*color-scheme: dark only;/);
    assert.match(css, /:root,\s*:root\[data-theme="light"\] \{\s*color-scheme: light only;\s*\}/);
    assert.match(css, /:root\[data-theme="dark"\] body \{\s*color-scheme: dark only;\s*\}/);
    assert.match(css, /:root\[data-theme="light"\] body \{\s*color-scheme: light only;\s*\}/);
    assert.match(css, /color-scheme: dark only;/);
    assert.match(
      css,
      /:root\[data-theme="dark"\] \.desk-theme select,\s*:root\[data-theme="dark"\] \.desk-theme select option,\s*:root\[data-theme="dark"\] \.admin-theme select,\s*:root\[data-theme="dark"\] \.admin-theme select option \{\s*color-scheme: inherit;\s*\}/,
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

  it("offers Light and Dark as an instant This device preference", () => {
    const picker = read("dashboard/src/components/ThemePicker.tsx");
    const themeLib = read("dashboard/src/lib/deskTheme.ts");
    const ui = read("dashboard/src/components/settingsUi.tsx");
    assert.match(ui, /role="radiogroup"/);
    assert.match(picker, /<SegmentedControl/);
    assert.match(picker, /label="On this device"/);
    assert.match(picker, /data-theme-cluster=""/);
    assert.match(picker, /readDeskTheme/);
    assert.match(picker, /writeDeskTheme/);
    assert.match(picker, /applyDeskTheme/);
    assert.doesNotMatch(picker, /tenant\.|saveAndCompile|llm_system_prompt/);
    for (const label of ['"light"', '"dark"']) {
      assert.ok(picker.includes(`id: ${label}`), `choice ${label}`);
    }
    assert.ok(!picker.includes('id: "system"'), "no System choice: light unless dark is picked");
    assert.doesNotMatch(themeLib, /delete root\.dataset\.theme/);
    assert.match(themeLib, /root\.dataset\.theme = choice/);
    const shell = read("dashboard/src/components/BusinessSettingsShell.tsx");
    const account = read("dashboard/src/components/DeskAccountMenu.tsx");
    const settingsNav = read("dashboard/src/lib/businessSettingsNav.ts");
    const landing = read("dashboard/src/components/marketing/LandingPage.tsx");
    const login = read("dashboard/src/app/login/page.tsx");
    const adminLogin = read("dashboard/src/app/admin/login/page.tsx");
    const adminMenu = read("dashboard/src/components/AdminAccountMenu.tsx");
    assert.match(picker, /export function AppearanceFooter/);
    assert.match(landing, /<AppearanceFooter/);
    // Login dropped the theme dock in the onboarding rebuild (#656); it follows the system theme.
    assert.doesNotMatch(login, /data-theme="(light|dark)"/);
    assert.match(adminLogin, /<AppearanceFooter/);
    assert.match(adminMenu, /<ThemePicker \/>/);
    assert.match(adminMenu, /appearanceLabel\(/);
    assert.match(account, /<ThemePicker \/>/);
    assert.match(account, /appearanceLabel\(/);
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
    assert.match(ui, /settingsControlMaxClass = "max-w-md"/);
    assert.match(ui, /settingsSelectMaxClass = "max-w-xs"/);
    assert.match(ui, /focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/);
  });

  it("documents the dark system in MASTER", () => {
    const master = read("docs/reference/design-system/MASTER.md");
    assert.match(master, /## Dark mode/);
    assert.match(master, /desk-theme/);
    assert.match(master, /accent-on-fill/);
    assert.match(master, /entire platform/);
    assert.match(master, /glass-chrome/);
    assert.match(master, /opaque/);
    assert.match(master, /--scrim/);
    assert.match(master, /theme-color/);
  });
});
