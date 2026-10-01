// DeskSelect: themed open list for dark DoD paths (Contacts Sort, SettingsSelect).

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

describe("DeskSelect primitive", () => {
  const desk = read("dashboard/src/components/ui/DeskSelect.tsx");

  it("uses Base UI Select with surface+ink open popup tokens", () => {
    assert.match(desk, /from "@base-ui\/react\/select"/);
    assert.match(desk, /export function DeskSelect/);
    assert.match(desk, /bg-surface/);
    assert.match(desk, /text-ink/);
    assert.match(desk, /shadow-menu/);
    assert.match(desk, /border-hairline/);
    assert.match(desk, /data-\[highlighted\]:bg-surface-2/);
    assert.doesNotMatch(desk, /<select[\s>]/);
  });

  it("keeps closed trigger className passthrough for field chrome", () => {
    assert.match(desk, /className/);
    assert.match(desk, /Select\.Trigger/);
    assert.match(desk, /Select\.Popup/);
    assert.match(desk, /Select\.Item/);
  });

  it("wraps portal content in desk-theme so dark tokens resolve under body", () => {
    assert.match(desk, /Select\.Portal/);
    assert.match(desk, /className="desk-theme"/);
    // Popup still uses token utilities that resolve under .desk-theme
    assert.match(desk, /bg-surface/);
    assert.match(desk, /text-ink/);
  });
});

describe("DoD path swaps", () => {
  it("Contacts Sort uses DeskSelect, not a native option list", () => {
    const sort = read("dashboard/src/components/ContactSortSelect.tsx");
    assert.match(sort, /from "@\/components\/ui\/DeskSelect"/);
    assert.match(sort, /<DeskSelect/);
    assert.match(sort, /aria-label="Sort contacts"/);
    assert.match(sort, /label: "Last call"/);
    assert.match(sort, /label: "Name"/);
    assert.doesNotMatch(sort, /<select[\s>]/);
  });

  it("SettingsSelect wraps DeskSelect so Tone and siblings theme open", () => {
    const ui = read("dashboard/src/components/settingsUi.tsx");
    const start = ui.indexOf("export function SettingsSelect");
    assert.ok(start >= 0);
    const chunk = ui.slice(start, start + 900);
    assert.match(chunk, /<DeskSelect/);
    assert.match(chunk, /settingsDenseFieldClass/);
    assert.doesNotMatch(chunk, /<select[\s>]/);
    assert.match(ui, /from "@\/components\/ui\/DeskSelect"/);
  });
});
