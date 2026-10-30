// PR 3 (30 Oct): Import adds items only. It never renames the business, changes its type, overwrites the alert
// WhatsApp number, sets the "when unsure" line or team, and never preselects replacing FAQs.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const actions = read("dashboard/src/app/(desk)/settings/ingestActions.ts");
const panel = read("dashboard/src/components/KnowledgeIngestPanel.tsx");

test("apply never writes business name, vertical, alert number or team", () => {
  assert.doesNotMatch(actions, /patch\.business_name\s*=/);
  assert.doesNotMatch(actions, /patch\.vertical\s*=/);
  assert.doesNotMatch(actions, /whatsapp_notification_number/);
  assert.match(actions, /const includeUnknown = false;/);
  assert.match(actions, /const selectedTeamIndexes: number\[\] = \[\];/);
});

test("replace is never preselected and says what it does", () => {
  assert.doesNotMatch(panel, /looksLikeBrief/);
  assert.match(panel, /setMergeMode\("merge"\)/);
  assert.match(panel, /Replace my FAQs/);
  assert.doesNotMatch(panel, /Start fresh/);
});

test("messages come from the KB result and restamp the reviewed rows", () => {
  assert.match(actions, /kb && kb\.ok \? kb\.added/);
  assert.match(actions, /restamp: true/);
  assert.doesNotMatch(actions, /Catalogue saved for the next call/);
});
