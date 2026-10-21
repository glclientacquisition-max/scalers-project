// Desk: browser retest of the shared save pattern (Policies, snap-back, error toast, key warning).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

const f = await import("../dashboard/src/lib/formSave.ts");
const peel = await import("../dashboard/src/lib/peelMissingColumns.ts");

// --- 1. Policies: every save said "Could not save." -------------------------
// Owner writes run as `authenticated`, which has no UPDATE grant on
// tenants.unknown_answer_spoken. Postgres refuses the whole update.

const DENIED = "permission denied for table tenants";

test("policies: permission denied on tenants is recognised", () => {
  assert.ok(peel.isTenantPermissionDenied(DENIED));
  assert.ok(peel.isTenantPermissionDenied('permission denied for relation "tenants"'));
  assert.ok(!peel.isTenantPermissionDenied("permission denied for table wallet_ledger"));
  assert.ok(!peel.isTenantPermissionDenied(null));
});

test("policies: the update is retried without the spoken lines, the rest still saves", () => {
  const patch = { business_policies: { returns: "7 days" }, unknown_answer_fallback: "x", unknown_answer_spoken: null };
  const next = peel.withoutUnknownSpokenColumn(DENIED, patch);
  assert.deepEqual(next, { business_policies: { returns: "7 days" }, unknown_answer_fallback: "x" });
  // No spoken column in the patch: nothing to peel, the real error surfaces.
  assert.equal(peel.withoutUnknownSpokenColumn(DENIED, { business_policies: {} }), null);
  // Unrelated errors still fail the save.
  assert.equal(peel.withoutUnknownSpokenColumn("violates check constraint", patch), null);
});

test("policies: the old failure reached the hook as an error inside a 200", () => {
  const out = f.saveOutcome({ ok: false, error: "Could not save." }, "Saved");
  assert.equal(out.kind, "error");
  assert.equal(out.message, "Could not save.");
});

test("policies: save action notes a partial save only when the spoken lines changed", () => {
  const src = read("dashboard/src/app/(desk)/settings/actions.ts");
  assert.match(src, /spokenSkipped = true/);
  assert.match(src, /spokenLost =\s+spokenSkipped && JSON\.stringify\(unknownAnswerSpoken \?\? null\) !== JSON\.stringify\(storedSpoken \?\? null\)/);
  assert.match(src, /Saved\. The spoken When unsure lines could not be updated yet\./);
  // The form shows what is stored, not what was refused.
  assert.match(src, /spokenSkipped \? storedSpoken : unknownAnswerSpoken/);
});

test("policies: a partial save still counts as landed (Saved, baseline moves)", () => {
  const out = f.saveOutcome({ ok: true, error: "Saved. The spoken When unsure lines could not be updated yet." }, "Saved");
  assert.equal(out.kind, "ok");
  assert.ok(f.saveLanded({ ok: true, error: "partial" }));
});

// --- 2. Catalogue, FAQs, Voice: snap back to the old value after Save -------

const at = (ms: number) => 1_000_000 + ms;

test("snap-back: the form's own save echo does not remount it", () => {
  let key = { scope: "t1:catalog", seen: "a", mounted: "a" };
  const saveAt = at(0);
  // Stale render (old row) and fresh render (new row) right after the save.
  key = f.nextFormMountKey(key, { scope: "t1:catalog", content: "b" }, saveAt, at(900));
  assert.equal(key.mounted, "a");
  key = f.nextFormMountKey(key, { scope: "t1:catalog", content: "a" }, saveAt, at(1500));
  assert.equal(key.mounted, "a");
  key = f.nextFormMountKey(key, { scope: "t1:catalog", content: "b" }, saveAt, at(3000));
  assert.equal(key.mounted, "a");
  // Once settled, a re-render with the same content does not remount late.
  key = f.nextFormMountKey(key, { scope: "t1:catalog", content: "b" }, saveAt, at(60_000));
  assert.equal(key.mounted, "a");
});

test("snap-back: unchanged content returns the same key object (no state update loop)", () => {
  const key = { scope: "s", seen: "a", mounted: "a" };
  assert.equal(f.nextFormMountKey(key, { scope: "s", content: "a" }, 0, at(0)), key);
});

test("snap-back: changes made elsewhere still remount once the save has settled", () => {
  const key = { scope: "t1:catalog", seen: "a", mounted: "a" };
  const next = f.nextFormMountKey(key, { scope: "t1:catalog", content: "c" }, at(0), at(f.OWN_SAVE_SETTLE_MS + 1));
  assert.equal(next.mounted, "c");
  assert.equal(f.nextFormMountKey(key, { scope: "t1:catalog", content: "c" }, 0, at(0)).mounted, "c");
});

test("snap-back: a new business or panel always remounts", () => {
  const key = { scope: "t1:catalog", seen: "a", mounted: "a" };
  const next = f.nextFormMountKey(key, { scope: "t1:faqs", content: "a" }, at(0), at(10));
  assert.deepEqual(next, { scope: "t1:faqs", seen: "a", mounted: "a" });
});

test("snap-back: settings shell keys the form by the settled mount, the form reports its saves", () => {
  const shell = read("dashboard/src/components/BusinessSettingsShell.tsx");
  assert.match(shell, /nextFormMountKey\(formMount/);
  assert.match(shell, /const tenantFormKey = `\$\{formMount\.scope\}:\$\{formMount\.mounted\}`/);
  assert.match(shell, /onSaveActivity=\{markOwnSave\}/);
  const form = read("dashboard/src/components/TenantForm.tsx");
  assert.match(form, /onSaveStart: onSaveActivity/);
  assert.match(form, /onLanded: onSaveActivity/);
  const hook = read("dashboard/src/components/useFormSave.ts");
  // Marked inside the action, before the response re-renders the page.
  assert.match(hook, /opts\.onSaveStart\?\.\(\);/);
  assert.match(hook, /optionsRef\.current\.onLanded\?\.\(result\)/);
});

// --- 3. How we notify: error shown inline, no toast --------------------------

test("error toast: failures toast with the error tone and stay up long enough to read", async () => {
  const hook = read("dashboard/src/components/useFormSave.ts");
  assert.match(hook, /notify\(outcome\.message, \{ tone: "error" \}\)/);
  const notice = read("dashboard/src/components/ui/DeskNotice.tsx");
  assert.match(notice, /noticeHoldMs\(notice\.tone\)/);
  assert.match(notice, /role=\{notice\.tone === "error" \? "alert" : undefined\}/);
  assert.match(notice, /NOTIFY_ERROR_HOLD_MS = 8000/);
  // The same error twice in a row is a new toast (Try again, fail again).
  assert.match(notice, /seq \+= 1/);
});

test("error toast: alerts panel keeps the default error toast", () => {
  const src = read("dashboard/src/components/AlertsPanel.tsx");
  assert.doesNotMatch(src, /errorToast:\s*false/);
  assert.match(src, /useFormSave/);
});

// --- 5. Dev overlay: missing key on server-built slots -----------------------

test("slots: server-built settings slots carry keys", () => {
  const src = read("dashboard/src/components/structured/StructuredSettingsSlots.tsx");
  assert.match(src, /<BusinessCategoryPicker key="business-category"/);
  assert.match(src, /<div key="catalog-checks"/);
});
