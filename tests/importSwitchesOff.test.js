const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("import switches start off", () => {
  const ingest = read("dashboard/src/components/KnowledgeIngestPanel.tsx");
  const catalog = read("dashboard/src/components/CatalogImportPanel.tsx");
  const scope = read("dashboard/src/lib/settingsSaveScope.ts");
  const shell = read("dashboard/src/components/BusinessSettingsShell.tsx");

  const afterScan = ingest.slice(
    ingest.indexOf("if (extractState.ok && extractState.draft)"),
    ingest.indexOf("const looksLikeBrief")
  );

  it("starts knowledge include switches off after a scan", () => {
    for (const flag of [
      "includeUnknown",
      "includeLocations",
      "includeHours",
      "includePolicies",
      "includeVertical",
      "includeContactPhone",
      "renameBusiness",
    ]) {
      assert.match(ingest, new RegExp(`\\[${flag}, set\\w+\\] = useState\\(false\\)`));
      assert.match(afterScan, new RegExp(`set\\w*${flag[0].toUpperCase()}${flag.slice(1)}\\(false\\)`));
    }
    assert.doesNotMatch(afterScan, /setInclude\w+\(\s*Boolean/);
    assert.match(ingest, /label="Hours"/);
    assert.match(ingest, /label="Location"/);
    assert.match(ingest, /label="Policies"/);
    assert.match(ingest, /label="Business type"/);
    assert.match(ingest, /label="Sales \/ WhatsApp phone"/);
    assert.match(ingest, /title="When unsure"/);
    assert.match(ingest, /draft\.hoursNotes \|\| draft\.hoursSchedule/);
    assert.match(ingest, /draft\.locations\?\.length/);
    assert.doesNotMatch(ingest, /Weekly schedule extracted/);
    assert.doesNotMatch(ingest, /[—–]/);
  });

  it("labels the knowledge apply Add selected and mutes Start over", () => {
    assert.match(ingest, /\{applyPending \? "Adding…" : "Add selected"\}/);
    assert.doesNotMatch(ingest, /Add to my assistant/);
    assert.match(ingest, /disabled=\{applyPending \|\| nothingSelected\}/);
    assert.match(ingest, /className=\{settingsPrimaryButtonClass\}/);
    const applyButton = ingest.slice(
      ingest.indexOf('{applyPending ? "Adding…" : "Add selected"}') - 220,
      ingest.indexOf('{applyPending ? "Adding…" : "Add selected"}')
    );
    assert.match(applyButton, /settingsPrimaryButtonClass/);
    assert.match(ingest, /Select what to add\./);
    assert.match(ingest, />\s*Start over\s*</);
    const startOver = ingest.slice(
      ingest.indexOf("Start over") - 280,
      ingest.indexOf("Start over")
    );
    assert.match(startOver, /settingsActionClass/);
    assert.doesNotMatch(startOver, /settingsPrimaryButtonClass/);
  });

  it("does not scroll either import path to train", () => {
    assert.doesNotMatch(ingest, /getElementById\("train"\)/);
    assert.doesNotMatch(ingest, /scrollIntoView/);
    assert.doesNotMatch(catalog, /getElementById\("train"\)/);
    assert.doesNotMatch(catalog, /scrollIntoView/);
    assert.equal(fs.existsSync(path.join(__dirname, "../dashboard/src/app/(desk)/loading.tsx")), false);
  });

  it("keeps retail catalog import as one product job", () => {
    assert.match(catalog, /\{applyPending \? "Saving…" : "Add to catalogue"\}/);
    assert.doesNotMatch(catalog, /Add selected/);
    assert.doesNotMatch(catalog, /includeHours|includePolicies|includeVertical|includeUnknown/);
    assert.match(catalog, /title="Products"/);
    assert.match(catalog, /name="products_json"/);
    assert.match(catalog, /label: "Text"/);
    assert.match(catalog, /label: "URL"/);
    assert.match(catalog, /label: "CSV"/);
    assert.match(shell, /parseVertical\(tenant\.vertical\) === "retail"/);
    assert.match(shell, /<CatalogImportPanel tenant=\{tenant\} \/>/);
    assert.match(shell, /<KnowledgeIngestPanel tenant=\{tenant\} \/>/);
    assert.doesNotMatch(shell, /<KnowledgeIngestPanel[\s\S]{0,80}<CatalogImportPanel/);
  });

  it("still writes only the checked include flags and protects save scope", () => {
    for (const name of [
      "include_unknown",
      "include_locations",
      "include_hours",
      "include_policies",
      "include_vertical",
      "include_contact_phone",
      "rename_business",
    ]) {
      assert.match(ingest, new RegExp(`name="${name}"`));
    }
    assert.match(scope, /catalog: \["servicesNotes", "servicesCatalog", "productCatalog"\]/);
    assert.match(scope, /faqs: \["faqs"\]/);
    assert.match(scope, /team: \["teamDirectory", "handoffMode"\]/);
    assert.match(scope, /pronunciation: \["ttsLexicon"\]/);
  });
});
