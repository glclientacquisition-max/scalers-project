const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("path");
const { spawnSync } = require("node:child_process");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

function loadMergeCases() {
  const src = path.join(__dirname, "..", "dashboard", "src");
  const hookPath = path.join(os.tmpdir(), "scalers-ingest-resolve-hook.mjs");
  const registerPath = path.join(os.tmpdir(), "scalers-ingest-resolve-register.mjs");
  fs.writeFileSync(
    hookPath,
    `import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
const SRC = ${JSON.stringify(src)};
function withExt(file) {
  if (existsSync(file)) return file;
  for (const ext of [".ts", ".tsx", ".js", ".mjs", ".json"]) {
    if (existsSync(file + ext)) return file + ext;
  }
  return file;
}
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    return nextResolve(pathToFileURL(withExt(path.join(SRC, specifier.slice(2)))).href, context);
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL) {
    const parent = fileURLToPath(context.parentURL);
    const resolved = withExt(path.resolve(path.dirname(parent), specifier));
    if (resolved !== path.resolve(path.dirname(parent), specifier)) {
      return nextResolve(pathToFileURL(resolved).href, context);
    }
  }
  return nextResolve(specifier, context);
}
export async function load(url, context, nextLoad) {
  if (url.endsWith(".json")) {
    return {
      format: "json",
      source: readFileSync(fileURLToPath(url), "utf8"),
      shortCircuit: true,
    };
  }
  return nextLoad(url, context);
}
`
  );
  fs.writeFileSync(
    registerPath,
    `import { register } from "node:module";
import { pathToFileURL } from "node:url";
register(${JSON.stringify(hookPath)}, { parentURL: pathToFileURL(${JSON.stringify(hookPath)}).href });
`
  );
  const extractPath = path.join(src, "lib", "ingest", "extract.ts");
  const script = `
    import { mergeIngestDraft, parseIngestIndexes } from ${JSON.stringify(extractPath)};
    const svc = (name) => ({
      name,
      price_range: "",
      notes: "",
      out_of_scope: "",
      in_stock: "",
      category: "",
    });
    const faq = (question, answer) => ({ question, answer });
    const mate = (name) => ({ name, role: "Owner", phone: "", email: "" });
    const blankDraft = {
      services: [svc("Book sales"), svc("Same-day delivery")],
      faqs: [faq("Do you deliver?", "Yes")],
      team: [mate("Bosco")],
      unknownAnswerFallback: "",
      sourceLabel: "import",
    };
    const proseDraft = {
      services: [svc("Operating Hours"), svc("Sofa cleaning"), svc("Carpet wash")],
      faqs: [faq("Do you deliver?", "Yes")],
      team: [mate("Bosco")],
      unknownAnswerFallback: "",
      sourceLabel: "import",
    };
    const existing = {
      existingServices: [svc("Live cleaning")],
      existingFaqs: [faq("Where are you?", "Ngong Road")],
      existingTeam: [mate("Amina")],
      existingUnknown: "",
      includeUnknown: false,
    };
    const blankIndexes = {
      selectedServiceIndexes: parseIngestIndexes(""),
      selectedFaqIndexes: parseIngestIndexes(""),
      selectedTeamIndexes: parseIngestIndexes(""),
    };
    process.stdout.write(JSON.stringify({
      blank: parseIngestIndexes(""),
      zero: parseIngestIndexes("0"),
      spaced: parseIngestIndexes(" , "),
      blankMerge: mergeIngestDraft({
        ...existing,
        draft: blankDraft,
        ...blankIndexes,
        mode: "merge",
      }),
      freshOff: mergeIngestDraft({
        ...existing,
        draft: blankDraft,
        ...blankIndexes,
        mode: "replace_services_faqs",
      }),
      checkedFirst: mergeIngestDraft({
        ...existing,
        draft: blankDraft,
        selectedServiceIndexes: parseIngestIndexes("0"),
        selectedFaqIndexes: parseIngestIndexes("0"),
        selectedTeamIndexes: parseIngestIndexes("0"),
        mode: "merge",
      }),
      prose: mergeIngestDraft({
        ...existing,
        draft: proseDraft,
        selectedServiceIndexes: [1],
        selectedFaqIndexes: [],
        selectedTeamIndexes: [],
        mode: "merge",
      }),
      proseReplace: mergeIngestDraft({
        ...existing,
        draft: proseDraft,
        selectedServiceIndexes: [1],
        selectedFaqIndexes: [],
        selectedTeamIndexes: [],
        mode: "replace_services_faqs",
      }),
    }));
  `;
  const ran = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--import", registerPath, "--input-type=module", "-e", script],
    { encoding: "utf8" }
  );
  assert.equal(ran.status, 0, ran.stderr || ran.stdout);
  return JSON.parse(ran.stdout);
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

  it("starts service, FAQ, and team rows unchecked", () => {
    assert.match(afterScan, /setSelectedServices\(new Set\(\)\)/);
    assert.match(afterScan, /setSelectedFaqs\(new Set\(\)\)/);
    assert.match(afterScan, /setSelectedTeam\(new Set\(\)\)/);
    assert.doesNotMatch(afterScan, /draft\.services\.map/);
    assert.doesNotMatch(afterScan, /draft\.faqs\.map/);
    assert.doesNotMatch(afterScan, /draft\.team\.map/);
    assert.match(ingest, /const allOn = selected > 0 && selected === total/);
    assert.match(ingest, /const label = allOn \? "Clear all" : "Select all"/);
    assert.match(ingest, /className=\{settingsGhostButtonClass\}/);
    assert.match(ingest, /s\.name/);
    assert.match(ingest, /htmlFor=\{`ingest-faq-q-/);
    assert.match(ingest, /htmlFor=\{`ingest-faq-a-/);
    const ghost = read("dashboard/src/components/settingsUi.tsx");
    assert.match(ghost, /export const settingsGhostButtonClass =/);
    assert.match(
      ghost.slice(ghost.indexOf("export const settingsGhostButtonClass")),
      /min-h-11[\s\S]{0,180}text-ink-soft/
    );
    assert.doesNotMatch(catalog, /ListSelectAll|selected_services/);
  });
});

describe("import row selection", () => {
  const actions = read("dashboard/src/app/(desk)/settings/ingestActions.ts");

  it("does not turn a blank selection into row 0 or wipe an off list when hours are on", () => {
    const cases = loadMergeCases();
    assert.deepEqual(cases.blank, []);
    assert.deepEqual(cases.spaced, []);
    assert.deepEqual(cases.zero, [0]);
    assert.deepEqual(
      cases.checkedFirst.services.map((row) => row.name),
      ["Live cleaning", "Book sales"]
    );
    assert.deepEqual(
      cases.checkedFirst.faqs.map((row) => row.question),
      ["Where are you?", "Do you deliver?"]
    );
    assert.deepEqual(
      cases.checkedFirst.team.map((row) => row.name),
      ["Amina", "Bosco"]
    );
    assert.equal(cases.blankMerge.touched.services, false);
    assert.equal(cases.blankMerge.touched.faqs, false);
    assert.equal(cases.blankMerge.touched.team, false);
    assert.deepEqual(
      cases.blankMerge.services.map((row) => row.name),
      ["Live cleaning"]
    );
    assert.deepEqual(
      cases.blankMerge.faqs.map((row) => row.question),
      ["Where are you?"]
    );
    assert.deepEqual(
      cases.blankMerge.team.map((row) => row.name),
      ["Amina"]
    );
    assert.equal(cases.blankMerge.added.services, 0);
    assert.equal(cases.blankMerge.added.faqs, 0);
    assert.equal(cases.blankMerge.added.team, 0);

    assert.equal(cases.freshOff.touched.services, false);
    assert.equal(cases.freshOff.touched.faqs, false);
    assert.equal(cases.freshOff.touched.team, false);
    assert.deepEqual(
      cases.freshOff.services.map((row) => row.name),
      ["Live cleaning"]
    );
    assert.deepEqual(
      cases.freshOff.faqs.map((row) => row.question),
      ["Where are you?"]
    );
    assert.deepEqual(
      cases.freshOff.team.map((row) => row.name),
      ["Amina"]
    );

    assert.deepEqual(
      cases.prose.services.map((row) => row.name),
      ["Live cleaning", "Sofa cleaning"]
    );
    assert.equal(cases.prose.touched.services, true);
    assert.equal(
      cases.proseReplace.services.map((row) => row.name).join("|"),
      "Sofa cleaning"
    );

    const hours = actions.slice(
      actions.indexOf("if (includeHours)"),
      actions.indexOf("if (policiesFilled)")
    );
    assert.match(hours, /patch\.business_hours = businessHours/);
    assert.doesNotMatch(hours, /services_catalog|faqs|team_directory/);
    assert.match(
      actions,
      /const businessHours = includeHours\s*\?\s*draftHoursNotes \|\| compiledHours \|\| "Hours not set yet\. Confirm with the team\."\s*: compiledHours;/
    );
    assert.doesNotMatch(actions, /else if \(!String\(tenant\.business_hours/);
    assert.match(actions, /if \(merged\.touched\.services\)/);
    assert.match(actions, /patch\.services_catalog = merged\.services/);
    assert.match(actions, /parseIngestIndexes\(formData\.get\("selected_services"\)\)/);
    assert.doesNotMatch(
      actions.slice(actions.indexOf("const merged = mergeIngestDraft"), actions.indexOf("if (merged.touched.services)")),
      /draftServices/
    );
  });
});
