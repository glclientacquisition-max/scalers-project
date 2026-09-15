const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

function walkFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, acc);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

describe("desk control craft", () => {
  it("keeps filled primary on #005CCC in deskChrome", () => {
    const chrome = read("dashboard/src/components/ui/deskChrome.ts");
    assert.match(chrome, /export const btnPrimaryFill/);
    assert.match(chrome, /bg-\[#005CCC\]/);
    assert.match(chrome, /export const btnPrimary/);
    assert.match(chrome, /pendingSpinnerClass/);
    assert.match(chrome, /deskFieldClass/);
    assert.match(chrome, /filterTabClass/);
    assert.match(chrome, /motion-reduce:active:scale-100/);
  });

  it("aliases settings primary to btnPrimary", () => {
    const settings = read("dashboard/src/components/settingsUi.tsx");
    assert.match(settings, /export const settingsPrimaryButtonClass = btnPrimary/);
  });

  it("uses FilterTabs on Inbox and Contacts", () => {
    assert.match(read("dashboard/src/components/InboxToolbar.tsx"), /<FilterTabs/);
    assert.match(read("dashboard/src/app/(desk)/contacts/page.tsx"), /<FilterTabs/);
    assert.match(read("dashboard/src/components/ui/FilterTabs.tsx"), /filterTabClass/);
  });

  it("does not keep the unused TriageLeadCard", () => {
    assert.equal(
      fs.existsSync(path.join(__dirname, "../dashboard/src/components/TriageLeadCard.tsx")),
      false
    );
  });

  it("mounts CallRecording once on call detail", () => {
    const page = read("dashboard/src/app/(desk)/calls/[id]/page.tsx");
    assert.equal((page.match(/<CallRecording/g) || []).length, 1);
    assert.doesNotMatch(page, /variant="empty"/);
    assert.doesNotMatch(page, /variant="player"/);
  });

  it("does not tell owners to apply SQL", () => {
    const roots = [
      "dashboard/src/app/(desk)",
      "dashboard/src/app/signup",
      "dashboard/src/app/onboarding",
      "dashboard/src/app/login",
      "dashboard/src/components",
      "dashboard/src/lib/ownerFacingError.ts",
    ].map((rel) => path.join(__dirname, "..", rel));

    const leaks = [];
    for (const root of roots) {
      const files = fs.statSync(root).isDirectory() ? walkFiles(root) : [root];
      for (const file of files) {
        const source = fs.readFileSync(file, "utf8");
        if (/Apply docs\/supabase/i.test(source)) {
          leaks.push(path.relative(path.join(__dirname, ".."), file));
        }
      }
    }
    assert.deepEqual(leaks, []);
  });

  it("corrects the Desk CTA color in lane prompts", () => {
    const prompts = read("docs/agents/PROMPTS.md");
    assert.doesNotMatch(prompts, /primary CTA #0096FF/);
    assert.match(prompts, /filled primary CTA `#005CCC`/);
    assert.match(prompts, /ribbon\/focus\/tab underline `#0096FF`/);
  });

  it("underlines the active desk destination with the ribbon", () => {
    const nav = read("dashboard/src/components/DeskNav.tsx");
    assert.match(nav, /border-b-2/);
    assert.match(nav, /border-t-2/);
    assert.match(nav, /border-\[#0096FF\] font-semibold text-\[#005CCC\]/);
    assert.doesNotMatch(nav, /rounded-full|bg-\[#0096FF\]/);
  });

  it("does not use filled primary for Inbox List/Week", () => {
    const toolbar = read("dashboard/src/components/InboxToolbar.tsx");
    assert.match(toolbar, /label="Visit layout"/);
    assert.doesNotMatch(toolbar, /btnPrimary/);
  });

  it("keeps Add contact as the only Contacts filled primary", () => {
    assert.match(read("dashboard/src/components/AddContactPanel.tsx"), /settingsPrimaryButtonClass/);
    const phonebook = read("dashboard/src/components/PhonebookImportButton.tsx");
    assert.doesNotMatch(phonebook, /ContactPickButton available primary/);
  });

  it("traps Tab inside DeskDialog without enter animation", () => {
    const dialog = read("dashboard/src/components/ui/DeskDialog.tsx");
    assert.match(dialog, /event\.key !== "Tab"/);
    assert.match(dialog, /focusableIn/);
    assert.match(dialog, /Escape/);
    assert.doesNotMatch(dialog, /animate-|transition-all|framer-motion/);
  });
});
