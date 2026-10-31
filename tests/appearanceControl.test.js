// One worded Appearance control everywhere (approved /workspace/appearance-review.md).
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const D = "dashboard/src/";

const OUTSIDE = {
  landing: "components/marketing/LandingPage.tsx",
  login: "app/login/page.tsx",
  signup: "app/signup/page.tsx",
  invite: "app/invite/[token]/InviteView.tsx",
  onboarding: "app/onboarding/page.tsx",
  adminLogin: "app/admin/login/page.tsx",
};

describe("Appearance control", () => {
  const picker = read(D + "components/ThemePicker.tsx");

  it("is worded, shows the current choice, and has no icon glyphs", () => {
    assert.match(picker, /export function appearanceLabel/);
    assert.match(picker, /`Appearance · \$\{/);
    assert.match(picker, /On this device/);
    assert.match(picker, /<SegmentedControl/);
    assert.doesNotMatch(picker, /ThemeDock|ThemeMark|SunIcon|MoonIcon|ComputerDesktopIcon/);
  });

  it("outside: footer text button, Sheet on phones, popover on desktop", () => {
    assert.match(picker, /export function AppearanceFooter/);
    assert.match(picker, /useIsPhone\(\)/);
    assert.match(picker, /<Sheet[\s\S]*title="Appearance"/);
    assert.match(picker, /@base-ui\/react\/popover/);
    assert.match(picker, /data-appearance-footer=""/);
  });

  it("popover opens beside the footer button, bottom-aligned, so it never covers the page form or links above", () => {
    assert.match(picker, /<Popover\.Positioner side="right" align="end"/);
    assert.match(picker, /collisionPadding=\{12\}/);
  });

  it("phones (below md) get the Sheet, md and up the popover; the trigger stays a 44px hit", () => {
    assert.match(read(D + "components/ui/useIsPhone.ts"), /max-width: 767\.98px/);
    assert.match(picker, /min-h-11/);
  });

  for (const [name, file] of Object.entries(OUTSIDE)) {
    it(`${name} mounts the footer control once and no icon dock`, () => {
      const src = read(D + file);
      assert.doesNotMatch(src, /ThemeDock/);
      const count = (src.match(/<AppearanceFooter/g) || []).length;
      assert.ok(count >= 1, `${file} has AppearanceFooter`);
      assert.match(src, /<footer[\s\S]*<AppearanceFooter/);
    });
  }

  it("nothing in the app still uses the round icon dock", () => {
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
    for (const f of walk(path.join(__dirname, "..", D)).filter((f) => /\.tsx?$/.test(f))) {
      assert.doesNotMatch(fs.readFileSync(f, "utf8"), /ThemeDock/, f);
    }
  });

  it("inside: desk menu, desk phone sheet and admin menu use the same words and widget", () => {
    for (const file of ["components/DeskAccountMenu.tsx", "components/AdminAccountMenu.tsx"]) {
      const src = read(D + file);
      assert.match(src, /appearanceLabel\(/, file);
      assert.match(src, /<ThemePicker \/>/, file);
      assert.doesNotMatch(src, /MenuRadioItem/, file);
      assert.doesNotMatch(src, />\s*This device\s*</, file);
    }
    const desk = read(D + "components/DeskAccountMenu.tsx");
    assert.equal((desk.match(/appearanceLabel\(/g) || []).length >= 1, true, "sheet shows the choice");
    assert.doesNotMatch(desk, /themeOpen/);
  });

  it("MASTER documents the pattern", () => {
    const master = read("docs/reference/design-system/MASTER.md");
    assert.match(master, /Appearance · Light/);
    assert.match(master, /AppearanceFooter/);
    assert.doesNotMatch(master, /ThemeDock/);
  });
});

describe("Appearance polish (signed-in review)", () => {
  const seg = read(D + "components/ui/Segmented.tsx");
  const picker = read(D + "components/ThemePicker.tsx");
  const desk = read(D + "components/DeskAccountMenu.tsx");
  const menu = read(D + "components/ui/Menu.tsx");
  const css = read(D + "app/globals.css");

  it("segmented options are 44px on touch and below lg, compact only on lg+ fine pointers", () => {
    const seg2 = seg.slice(seg.indexOf("export function SegmentedControl"));
    assert.match(seg2, /min-h-11 lg:min-h-9 \[@media\(pointer:coarse\)\]:min-h-11/);
  });

  it("caption sits on the same left edge as the option buttons", () => {
    assert.match(picker, /<p className="pb-2 ps-1 text-meta text-ink-2">On this device<\/p>/);
    assert.match(picker, /SegmentedControl[\s\S]*className="grid w-full p-1/);
  });

  it("phone sheet: Appearance heading lives in the same card as the switch", () => {
    const sec = desk.slice(desk.indexOf('aria-labelledby="account-sheet-appearance"'));
    const card = sec.indexOf("data-account-sheet-card");
    assert.ok(card > -1 && card < sec.indexOf('id="account-sheet-appearance"'), "heading inside card");
    assert.ok(sec.indexOf('id="account-sheet-appearance"') < sec.indexOf("<ThemePicker />"));
  });

  it("sheet cards use the MASTER line token on an inset canvas so dark borders read", () => {
    const sheet = desk.slice(desk.indexOf("function AccountSheet"), desk.indexOf("export function DeskAccountMenu"));
    assert.doesNotMatch(sheet, /border-hairline bg-surface/);
    assert.match(sheet, /border border-line bg-canvas/);
  });

  it("menus keep clear of the scrollbar, and dark scrollbars are dark", () => {
    assert.match(menu, /collisionPadding=\{\{ top: 12, bottom: 12, left: 12, right: 24 \}\}/);
    assert.match(css, /\[data-desk-main\][\s\S]{0,200}scrollbar-color: var\(--hairline\) var\(--canvas\)/);
  });
});
