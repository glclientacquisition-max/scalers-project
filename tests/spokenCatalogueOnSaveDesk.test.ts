/** Run: node --experimental-strip-types --no-warnings --import ./tests/serverOnlyHook.mjs --test tests/spokenCatalogueOnSaveDesk.test.ts */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SPOKEN_CATALOGUE_FIELDS,
  touchesSpokenCatalogue,
  spokenCatalogueOnSaveEnabled,
  pingSpokenCatalogueCompile,
} from "../dashboard/src/lib/spokenCatalogueOnSave.ts";

test("fields include Locations coverage + delivery fees and their policies mirror", () => {
  for (const f of ["services_catalog", "product_catalog", "service_areas", "business_locations", "business_policies"]) assert.ok((SPOKEN_CATALOGUE_FIELDS as readonly string[]).includes(f), f);
  assert.equal(touchesSpokenCatalogue({ service_areas: { areas: [{ id: "place:kitengela", fee_mode: "fixed", fee_ksh: 300 }] } }), true);
  assert.equal(touchesSpokenCatalogue({ agent_name: "Shy" }), false);
});

test("flag off by default", () => {
  assert.equal(spokenCatalogueOnSaveEnabled({}), false);
  assert.equal(spokenCatalogueOnSaveEnabled({ SPOKEN_CATALOGUE_ON_SAVE: "1" }), true);
});

test("a failed ping warns and returns false", async () => {
  process.env.VOICE_INTERNAL_SECRET = "s";
  process.env.VOICE_PUBLIC_BASE_URL = "https://brain.example";
  const warns: string[] = []; const ow = console.warn; console.warn = (m: string) => warns.push(m);
  try {
    assert.equal(await pingSpokenCatalogueCompile("t1", (async () => new Response("{}", { status: 500 })) as typeof fetch), false);
    assert.equal(await pingSpokenCatalogueCompile("t1", (async () => { throw new Error("down"); }) as typeof fetch), false);
    assert.equal(await pingSpokenCatalogueCompile("t1", (async () => new Response("{}", { status: 202 })) as typeof fetch), true);
  } finally { console.warn = ow; delete process.env.VOICE_INTERNAL_SECRET; }
  assert.equal(warns.filter((w) => /ping failed tenant=t1/.test(w)).length, 2);
});
