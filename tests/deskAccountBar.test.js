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
    assert.match(menu, /from "@\/components\/ui\/Menu"/);
    assert.match(menu, /<button type="button" aria-label=\{name\} className=\{iconButtonClass\(\)\}>/);
    assert.match(menu, /h-7 w-7/);
    assert.match(menu, /bg-accent text-xs font-semibold text-accent-on/);
    assert.match(menu, /ring-2 ring-accent ring-offset-2 ring-offset-surface/);
    assert.match(read("dashboard/src/components/ui/Menu.tsx"), /shadow-menu/);
    assert.match(menu, /md:hidden/);
    assert.match(menu, /markOnly/);
    assert.match(menu, /href="\/home"/);
    assert.match(menu, /label=\{name\}/);
    assert.match(menu, /pointer-events-none truncate[\s\S]*\{name\}/);
    const appearance = menu.indexOf("Appearance");
    const signOut = menu.indexOf('<SignOutButton layout="menu"');
    assert.doesNotMatch(menu, />\s*Profile\s*</);
    assert.ok(appearance > 0 && signOut > appearance);
    assert.match(menu, /MenuSeparator/);
  });

  it("switches workspace inside the menu only when there is more than one", () => {
    assert.match(menu, /workspaces\.length > 1/);
    assert.match(menu, /switchDeskTenant/);
    assert.match(menu, /name="tenant_id"/);
    assert.match(menu, />\s*Workspace\s*</);
    assert.match(menu, /MenuLabel/);
    assert.match(menu, /text-ink-3/);
    assert.doesNotMatch(menu, /text-gray-500/);
    assert.match(menu, /pointer-events-none/);
  });

  it("shows a theme cluster on Appearance and keeps Line live off that control", () => {
    assert.match(picker, /role="radiogroup"/);
    assert.match(picker, /aria-label="This device"/);
    assert.match(picker, /data-theme-cluster=""/);
    for (const label of ["System", "Light", "Dark"]) {
      assert.match(picker, new RegExp(`label: "${label}"`));
    }
    assert.doesNotMatch(picker, /Line live|SettingsSegmented|bg-white|#[0-9a-fA-F]{6}/);
    assert.match(menu, /<ThemePicker \/>/);
    assert.match(menu, />\s*This device\s*</);
    assert.match(menu, /data-account-appearance=""/);
    assert.doesNotMatch(menu, /\/settings/);
    assert.doesNotMatch(shell, /<ThemePicker \/>/);
    assert.doesNotMatch(shell, /AppearancePanel/);
    assert.match(shell, /showLine=\{tab === "test"\}/);
    const appearance = menu.slice(
      menu.indexOf("data-account-appearance"),
      menu.indexOf('<SignOutButton layout="menu"')
    );
    assert.doesNotMatch(appearance, /Line live/);
  });
});
