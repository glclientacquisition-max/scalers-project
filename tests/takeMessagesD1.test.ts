// Desk slice D1: "Take messages only" (tenants.brain_mode) on Identity, the Inbox note and Super Admin,
// and "My list is complete" (tenants.kb_catalogue_complete_at) on Catalogue.
// Run: node --experimental-strip-types --no-warnings --import ./tests/serverOnlyHook.mjs --test tests/takeMessagesD1.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import {
  CATALOGUE_COMPLETE_COPY,
  TAKE_MESSAGES_COPY,
  TAKE_MESSAGES_HREF,
  brainSettingError,
  catalogueCompleteLine,
  markedOnLine,
  ownerCanChange,
  takeMessagesIndicatorNote,
  takeMessagesLine,
  takeMessagesState,
} from "../dashboard/src/lib/takeMessages.ts";

const require = createRequire(import.meta.url);
const { brainMode } = require("../src/knowledge/kb/kbLive.js") as {
  brainMode: (t: unknown, o: { safeEnv?: string | null }) => { mode: string; reason: string };
};
const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

test("state follows the shared brainMode: owner, support (admin) and env; off by default", () => {
  const at = "2026-10-28T11:05:00.000Z";
  assert.deepEqual(takeMessagesState(brainMode({}, { safeEnv: null }), null), { on: false, by: null, setAt: null });
  assert.deepEqual(takeMessagesState(brainMode({ brain_mode: "full", brain_mode_source: "owner" }, {}), at), { on: false, by: null, setAt: at });
  assert.deepEqual(takeMessagesState(brainMode({ brain_mode: "safe", brain_mode_source: "owner" }, {}), at), { on: true, by: "owner", setAt: at });
  assert.deepEqual(takeMessagesState(brainMode({ brain_mode: "safe", brain_mode_source: "admin" }, {}), at), { on: true, by: "admin", setAt: at });
  // no recorded source reads as support (the shared rule), never as the owner's own switch
  assert.equal(takeMessagesState(brainMode({ brain_mode: "safe" }, {}), at).by, "admin");
  // BRAIN_SAFE_MODE=all wins over everything
  assert.equal(takeMessagesState(brainMode({ brain_mode: "full" }, { safeEnv: "all" }), null).by, "env");
});

test("the owner changes only their own choice; support and env holds stay locked with a plain why", () => {
  assert.equal(ownerCanChange({ on: false, by: null, setAt: null }), true);
  assert.equal(ownerCanChange({ on: true, by: "owner", setAt: null }), true);
  assert.equal(ownerCanChange({ on: true, by: "admin", setAt: null }), false);
  assert.equal(ownerCanChange({ on: true, by: "env", setAt: null }), false);
  assert.equal(takeMessagesLine({ on: false, by: null, setAt: null }), TAKE_MESSAGES_COPY.help);
  assert.match(takeMessagesLine({ on: true, by: "admin", setAt: null }), /^Turned on by Scalers support\. To turn it off, contact Scalers support\.$/);
  assert.match(takeMessagesLine({ on: true, by: "env", setAt: null }), /Scalers/);
  assert.equal(takeMessagesIndicatorNote({ on: true, by: "owner", setAt: null }), null);
  assert.equal(takeMessagesIndicatorNote({ on: true, by: "admin", setAt: null }), "Turned on by Scalers support");
  assert.equal(takeMessagesIndicatorNote({ on: false, by: null, setAt: null }), null);
  assert.equal(brainSettingError("forbidden"), "Only the owner or an admin can change this.");
  assert.equal(brainSettingError("anything"), "Couldn't save. Check your connection and try again.");
});

test("list complete: plain lines either way and the Nairobi day it was marked", () => {
  assert.match(catalogueCompleteLine(true), /don't offer it/);
  assert.match(catalogueCompleteLine(false), /team will confirm/);
  // 23:30 UTC on the 27th is already the 28th in Nairobi
  assert.equal(markedOnLine("2026-10-27T23:30:00.000Z"), "Marked 28 Oct 2026");
  assert.equal(markedOnLine(null), null);
  assert.equal(markedOnLine("not a date"), null);
});

test("copy: no em or en dashes, business never tenant or shop, no raw hex", () => {
  const words = [
    ...Object.values(TAKE_MESSAGES_COPY),
    ...Object.values(CATALOGUE_COMPLETE_COPY),
    ...(["owner", "admin", "env", null] as const).map((by) => takeMessagesLine({ on: by !== null, by, setAt: null })),
  ];
  for (const w of words) {
    assert.doesNotMatch(w, /[\u2013\u2014]/, w);
    assert.doesNotMatch(w, /\b(tenant|shop)\b/i, w);
  }
  for (const f of [
    "../dashboard/src/components/identity/TakeMessagesRow.tsx",
    "../dashboard/src/components/TakeMessagesIndicator.tsx",
    "../dashboard/src/components/catalogue/CatalogueCompleteRow.tsx",
    "../dashboard/src/components/admin/v2/BusinessKbBlock.tsx",
  ]) {
    const src = read(f);
    assert.doesNotMatch(src, /[\u2013\u2014]/, `${f}: dash in copy`);
    assert.doesNotMatch(src, /#[0-9a-fA-F]{3,8}\b/, `${f}: raw hex`);
  }
});

test("owner writes go through the session RPC hooks, never the service role, and respect a support hold", () => {
  const action = read("../dashboard/src/app/(desk)/settings/takeMessagesActions.ts");
  assert.match(action, /^"use server";/);
  assert.match(action, /memberDenied\("settings\.edit"\)/);
  assert.match(action, /setBrainModeAsOwner\(tenant\.id, on \? "safe" : "full"\)/);
  assert.match(action, /ownerCanChange\(now\.takeMessages\)/);
  assert.doesNotMatch(action, /getSupabaseAdmin|setBrainModeAsAdmin/);
  const kb = read("../dashboard/src/app/(desk)/settings/knowledge/actions.ts");
  assert.match(kb, /export async function setKbCatalogueCompleteAction[\s\S]*memberDenied\("settings\.edit"\)[\s\S]*setKbCatalogueCompleteAsOwner\(t\.id, complete\)/);
  assert.doesNotMatch(kb, /setKbCatalogueCompleteAsAdmin/);
});

test("editing the list never clears the complete mark (only set_kb_catalogue_complete writes it)", () => {
  for (const f of ["../dashboard/src/app/(desk)/settings/knowledge/actions.ts", "../dashboard/src/lib/kbWrite.server.ts"]) {
    const src = read(f)
      .replace(/export type KbCompleteResult[\s\S]*$/, "")
      .replace(/^import \{ setKbCatalogueCompleteAsOwner \} from "@\/lib\/kbLive\.server";$/m, "");
    assert.doesNotMatch(src, /kb_catalogue_complete|setKbCatalogueComplete/, f);
  }
  const screen = read("../dashboard/src/components/catalogue/CatalogueScreen.tsx");
  assert.equal((screen.match(/actions\.setComplete\(/g) || []).length, 1, "only the tick calls setComplete");
});

test("accessibility: a real switch and checkbox, named and described, 44px targets, a link back from the Inbox", () => {
  const sw = read("../dashboard/src/components/ui/Switch.tsx");
  assert.match(sw, /role="switch"/);
  assert.match(sw, /aria-describedby=\{describedBy\}/);
  assert.match(sw, /min-h-11 min-w-11/);
  const row = read("../dashboard/src/components/identity/TakeMessagesRow.tsx");
  assert.match(row, /id="take-messages"/);
  assert.match(row, /htmlFor="take-messages-switch"/);
  assert.match(row, /describedBy="take-messages-help"/);
  assert.match(row, /disabled=\{!canEdit \|\| locked\}/);
  assert.match(row, /Try again/);
  assert.ok(TAKE_MESSAGES_HREF.endsWith("#take-messages"));
  const ind = read("../dashboard/src/components/TakeMessagesIndicator.tsx");
  assert.match(ind, /href=\{TAKE_MESSAGES_HREF\}/);
  assert.match(ind, /min-h-11/);
  assert.match(ind, /focus-visible:ring-2/);
  const box = read("../dashboard/src/components/catalogue/CatalogueCompleteRow.tsx");
  assert.match(box, /type="checkbox"/);
  assert.match(box, /aria-describedby="catalogue-complete-help"/);
  assert.match(box, /min-h-11/);
  assert.match(box, /has-\[:focus-visible\]:ring-2/);
  const toolbar = read("../dashboard/src/components/InboxToolbar.tsx");
  assert.match(toolbar, /<TakeMessagesIndicator state=\{takeMessages\} \/>/);
  assert.match(read("../dashboard/src/app/(desk)/calls/page.tsx"), /takeMessages=\{brain\?\.takeMessages \?\? null\}/);
});

test("Super Admin: set_brain_mode is a risky action (Unlock + reason) through setBrainModeAsAdmin", async () => {
  const route = read("../dashboard/src/app/api/admin/businesses/[id]/kb/route.ts");
  assert.match(route, /"set_brain_mode"/);
  assert.match(route, /setBrainModeAsAdmin\(id, mode, null\)/);
  assert.match(route, /reason\.length < 3/);
  assert.match(route, /admin\.kb\.brain_mode/);
  const { ADMIN_WRITE_ROUTES } = await import("../dashboard/src/lib/ops/stepUpCore.ts");
  const kb = ADMIN_WRITE_ROUTES.find((r: { prefix: string }) => r.prefix === "business-kb") as { risky: string[] };
  assert.ok(kb.risky.includes("set_brain_mode"));
  const block = read("../dashboard/src/components/admin/v2/BusinessKbBlock.tsx");
  assert.match(block, /action: "set_brain_mode", mode, reason/);
  assert.match(block, /requireReason/);
});

test("old-brain pill stays while the shared contract still has the gate-off kill switch", () => {
  const live = read("../src/knowledge/kb/kbLive.js");
  const block = read("../dashboard/src/components/admin/v2/BusinessKbBlock.tsx");
  if (/reason: 'gate_off'/.test(live)) assert.match(block, /Old brain, KB gate off/);
});
