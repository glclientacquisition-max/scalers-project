// 30 Oct (Alvin: "yes we clean up and push to staging"): the Import tab is gone. Add many on the Catalogue is
// the one bulk add; old ?tab=import links open it. No flag, no Paste-a-list fallback.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

test("old Import UI and actions are deleted", () => {
  for (const f of [
    "dashboard/src/components/CatalogImportPanel.tsx",
    "dashboard/src/components/KnowledgeIngestPanel.tsx",
    "dashboard/src/app/(desk)/settings/ingestActions.ts",
    "dashboard/src/app/(desk)/settings/catalogActions.ts",
    "dashboard/src/lib/importFactDiff.ts",
  ]) assert.equal(fs.existsSync(path.join(root, f)), false, f);
});

test("Knowledge list is Catalogue then FAQs; Catalogue mentions Add many", () => {
  const nav = read("dashboard/src/lib/businessSettingsNav.ts");
  assert.doesNotMatch(nav, /label: "Import"/);
  assert.match(nav, /label: "Catalogue", description: "What you sell and its prices\. Add many at once"/);
});

test("?tab=import redirects to Add many; ?many=1 opens the sheet", () => {
  assert.match(read("dashboard/src/app/(desk)/settings/page.tsx"), /if \(tab === "import"\) redirect\("\/settings\/knowledge\?many=1"\);/);
  assert.match(read("dashboard/src/app/(desk)/settings/knowledge/page.tsx"), /initialPaste=\{first\(search\.many\) === "1" \|\|/);
  assert.doesNotMatch(read("dashboard/src/components/BusinessSettingsShell.tsx"), /tab === "import"/);
});
