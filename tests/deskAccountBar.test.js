const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("desk account bar", () => {
  const bar = read("dashboard/src/components/DeskAccountBar.tsx");
  const menu = read("dashboard/src/components/DeskAccountMenu.tsx");
  const picker = read("dashboard/src/components/ThemePicker.tsx");
  const shell = read("dashboard/src/components/BusinessSettingsShell.tsx");

  it("keeps the strip to initials and hides Sign out until the menu", () => {
    assert.match(bar, /<DeskAccountMenu/);
    assert.doesNotMatch(bar, />\s*Sign out\s*</);
    assert.doesNotMatch(bar, /<p[\s>]/);
    assert.match(menu, /data-account-bar=""/);
    assert.match(menu, /aria-label=\{name\}/);
    assert.match(menu, /h-7 w-7/);
    assert.match(menu, /bg-accent text-meta font-semibold text-accent-on/);
    assert.match(menu, /ring-2 ring-accent ring-offset-2 ring-offset-surface/);
    assert.match(menu, /md:hidden/);
    assert.match(menu, /markOnly/);
    assert.match(menu, /href="\/home"/);
    assert.match(menu, /<Sheet/);
    const appearance = menu.indexOf("data-account-appearance");
    const signOut = menu.indexOf('<SignOutButton layout="sheet"');
    assert.doesNotMatch(menu, />\s*Profile\s*</);
    assert.ok(appearance > 0 && signOut > appearance);
    assert.doesNotMatch(menu, /themeOpen/);
  });

  it("switches workspace inside the sheet only when there is more than one", () => {
    assert.match(menu, /workspaces\.length > 1/);
    assert.match(menu, /switchDeskTenant/);
    assert.match(menu, /name="tenant_id"/);
    assert.match(menu, />\s*Workspace\s*</);
    assert.doesNotMatch(menu, /text-gray-500/);
  });

  it("shows a theme cluster on Appearance and keeps Line live off that control", () => {
    assert.match(picker, /<SegmentedControl/);
    assert.match(picker, /label="On this device"/);
    assert.match(picker, /data-theme-cluster=""/);
    // MASTER: Light / Dark only, light by default (System left the picker).
    for (const label of ["Light", "Dark"]) {
      assert.match(picker, new RegExp(`label: "${label}"`));
    }
    assert.doesNotMatch(picker, /label: "System"/);
    assert.doesNotMatch(picker, /Line live|SettingsSegmented|bg-white|#[0-9a-fA-F]{6}/);
    assert.match(menu, /<ThemePicker \/>/);
    assert.match(menu, /appearanceLabel\(/);
    assert.match(menu, /data-account-appearance=""/);
    assert.doesNotMatch(menu, /\/settings/);
    assert.doesNotMatch(shell, /<ThemePicker \/>/);
    assert.doesNotMatch(shell, /AppearancePanel/);
    assert.match(shell, /showLine=\{tab === "test"\}/);
    const appearance = menu.slice(
      menu.indexOf("data-account-appearance"),
      menu.indexOf('<SignOutButton layout="sheet"')
    );
    assert.doesNotMatch(appearance, /Line live/);
  });
});
