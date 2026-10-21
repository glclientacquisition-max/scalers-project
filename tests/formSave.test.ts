// Desk: one shared form-save pattern (dashboard/src/lib/formSave.ts +
// dashboard/src/components/useFormSave.ts) for Settings, setup and onboarding.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

const f = await import("../dashboard/src/lib/formSave.ts");

// --- Dirty normalisation ------------------------------------------------------

test("dirty: NULL, undefined and empty string are the same empty value", () => {
  assert.ok(f.draftsEqual(null, ""));
  assert.ok(f.draftsEqual(undefined, ""));
  assert.ok(f.draftsEqual({ greeting_text: null }, { greeting_text: "" }));
  assert.ok(f.draftsEqual({ greeting_language: null }, {}));
  assert.ok(f.draftsEqual(["a", null], ["a", ""]));
});

test("dirty: whitespace at the ends and CRLF are not edits", () => {
  assert.ok(f.draftsEqual("Karibu  ", "Karibu"));
  assert.ok(f.draftsEqual("one\r\ntwo", "one\ntwo"));
  assert.ok(!f.draftsEqual("Karibu", "Karibu sana"));
});

test("dirty: key order does not matter, values do", () => {
  assert.ok(f.draftsEqual({ a: 1, b: "x" }, { b: "x", a: 1 }));
  assert.ok(!f.draftsEqual({ a: 1 }, { a: 2 }));
  assert.ok(!f.draftsEqual({ on: true }, { on: false }));
  assert.ok(f.draftsEqual({ n: 3 }, { n: "3" }));
});

test("dirty: a greeting loaded as NULL and an unpicked language are clean", () => {
  const loaded = { greetingText: null, greetingLanguage: null, spokenName: "Done and Dusted" };
  const onScreen = { greetingText: "", greetingLanguage: "", spokenName: "Done and Dusted" };
  assert.equal(f.draftSignature(loaded), f.draftSignature(onScreen));
  assert.notEqual(f.draftSignature(onScreen), f.draftSignature({ ...onScreen, greetingLanguage: "sw" }));
});

test("dirty: typing and then undoing it is clean", () => {
  const base = f.draftSignature({ name: "Esga" });
  assert.notEqual(f.draftSignature({ name: "Esga Stationery" }), base);
  assert.equal(f.draftSignature({ name: "Esga" }), base);
});

// --- Reset after save ---------------------------------------------------------

test("reset: a landed save moves the baseline to what was submitted", () => {
  assert.equal(f.nextBaseline({ ok: true }, "submitted", "old"), "submitted");
  // Partial save (for example a price note) still landed.
  assert.equal(f.nextBaseline({ ok: true, error: "One price needs a look." }, "submitted", "old"), "submitted");
});

test("reset: a failed save keeps the old baseline, so edits stay unsaved", () => {
  assert.equal(f.nextBaseline({ error: "Could not save." }, "submitted", "old"), "old");
  assert.equal(f.nextBaseline({ networkError: true }, "submitted", "old"), "old");
  assert.equal(f.nextBaseline(null, "submitted", "old"), "old");
});

test("reset: the hook moves the baseline in render, from the submitted draft", () => {
  const src = read("dashboard/src/components/useFormSave.ts");
  assert.match(src, /submittedFor\.set\(result, submitted\)/);
  assert.match(src, /setBaseline\(\(prev\) => nextBaseline\(saveState, submitted, prev\)\)/);
  // Render-phase sync, not an effect: the first frame after a save is already clean.
  assert.match(src, /if \(save && seen !== saveState\) \{/);
});

// --- Error path ---------------------------------------------------------------

test("error: a failed result reads as an error with the server's words", () => {
  assert.deepEqual(f.saveOutcome({ error: "Add a valid phone." }), {
    kind: "error",
    message: "Add a valid phone.",
    network: false,
  });
  assert.equal(f.saveOutcome({}).kind, "error");
  assert.equal(f.saveOutcome({}).message, f.FORM_SAVE_GENERIC_ERROR);
  assert.equal(f.saveOutcome(undefined).kind, "error");
});

test("error: a thrown save becomes a network error, never a silent failure", () => {
  const res = f.thrownSaveResult(new TypeError("network error"));
  assert.equal(res.networkError, true);
  assert.equal(f.saveOutcome(res).kind, "error");
  assert.equal(f.saveOutcome(res).message, f.FORM_SAVE_NETWORK_ERROR);
});

test("error: redirects and notFound pass straight through", () => {
  assert.throws(() => f.thrownSaveResult({ digest: "NEXT_REDIRECT;replace;/home;307;" }));
  assert.throws(() => f.thrownSaveResult({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" }));
  assert.ok(!f.isNavigationError(new Error("boom")));
});

test("error: success uses the server message, else the form's copy", () => {
  assert.deepEqual(f.saveOutcome({ ok: true }, "Saved · training line"), { kind: "ok", message: "Saved · training line" });
  assert.deepEqual(f.saveOutcome({ ok: true, message: "Alerts updated" }), { kind: "ok", message: "Alerts updated" });
});

test("error: the hook toasts failures and offers Try again", () => {
  const hook = read("dashboard/src/components/useFormSave.ts");
  assert.match(hook, /notify\(outcome\.message\)/);
  assert.match(hook, /const retry = useCallback/);
  const ui = read("dashboard/src/components/settingsUi.tsx");
  assert.match(ui, /onRetry \? \(/);
  assert.match(ui, /Try again/);
});

// --- beforeunload guard -------------------------------------------------------

test("guard: asks only while dirty or saving", () => {
  assert.equal(f.shouldGuardUnload({ dirty: false, pending: false }), false);
  assert.equal(f.shouldGuardUnload({ dirty: true, pending: false }), true);
  assert.equal(f.shouldGuardUnload({ dirty: false, pending: true }), true);
  assert.equal(f.shouldGuardUnload({ dirty: true, pending: true, disabled: true }), false);
});

test("guard: the handler prompts only when asked to", () => {
  let prevented = 0;
  const event = () => ({ preventDefault: () => void prevented++, returnValue: undefined as unknown });
  let guard = false;
  const handler = f.formSaveUnloadHandler(() => guard);
  const clean = event();
  handler(clean);
  assert.equal(prevented, 0);
  assert.equal(clean.returnValue, undefined);
  guard = true;
  const dirty = event();
  handler(dirty);
  assert.equal(prevented, 1);
  assert.equal(dirty.returnValue, "");
});

test("guard: the hook wires beforeunload and the Settings leave guard", () => {
  const src = read("dashboard/src/components/useFormSave.ts");
  assert.match(src, /window\.addEventListener\("beforeunload", onBeforeUnload\)/);
  assert.match(src, /window\.removeEventListener\("beforeunload", onBeforeUnload\)/);
  assert.match(src, /useSettingsLeaveSource\(id, !guardDisabled && dirty\)/);
});

// --- Every migrated form uses it -----------------------------------------------

const MIGRATED: Array<{ file: string; save: boolean; draft: boolean }> = [
  // Identity, Hours, Locations, Policies, Catalogue, FAQs, Voice, Team, Pronunciation panel.
  { file: "dashboard/src/components/TenantForm.tsx", save: true, draft: true },
  // How we notify.
  { file: "dashboard/src/components/AlertsPanel.tsx", save: true, draft: true },
  // What it will say: When unsure lines.
  { file: "dashboard/src/components/assistantSay/AssistantSayFallbackEditor.tsx", save: true, draft: true },
  // Guided setup steps (own save choreography: draft side only).
  { file: "dashboard/src/app/onboarding/SetupFlow.tsx", save: false, draft: true },
  // Onboarding wizard and create workspace (success redirects).
  { file: "dashboard/src/app/onboarding/OnboardingWizard.tsx", save: true, draft: false },
  { file: "dashboard/src/app/onboarding/CreateWorkspaceForm.tsx", save: true, draft: false },
];

for (const form of MIGRATED) {
  test(`migrated: ${path.basename(form.file)} uses the shared save pattern`, () => {
    const src = read(form.file);
    assert.match(src, /from "@\/components\/useFormSave"/);
    if (form.save) assert.match(src, /useFormSave(<[^>]+>)?\(\{/);
    if (form.draft) assert.match(src, /useFormDraft\(/);
    // No hand-rolled save plumbing left behind.
    assert.doesNotMatch(src, /useActionState\(/);
    assert.doesNotMatch(src, /addEventListener\("beforeunload"/);
    assert.doesNotMatch(src, /useSettingsLeaveSource\(/);
  });
}

test("migrated: Settings Save buttons show Saving, then Saved", () => {
  const btn = read("dashboard/src/components/TenantSettingsSaveButton.tsx");
  assert.match(btn, /saved \? \(/);
  assert.match(read("dashboard/src/components/TenantForm.tsx"), /saved=\{justSaved\}/);
  assert.match(read("dashboard/src/components/AlertsPanel.tsx"), /saved=\{justSaved\}/);
});

test("copy: no em or en dashes in the shared save copy", () => {
  for (const msg of [f.FORM_SAVE_NETWORK_ERROR, f.FORM_SAVE_GENERIC_ERROR, f.FORM_SAVE_DEFAULT_SUCCESS]) {
    assert.doesNotMatch(msg, /[\u2013\u2014]/);
  }
});
