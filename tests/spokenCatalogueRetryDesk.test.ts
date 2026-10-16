/** Run: node --experimental-strip-types --no-warnings --import ./tests/serverOnlyHook.mjs --test tests/spokenCatalogueRetryDesk.test.ts */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { pingSpokenCatalogueCompile } from "../dashboard/src/lib/spokenCatalogueOnSave.ts";

test("a failed rebuild ping is retried once", async () => {
  process.env.VOICE_INTERNAL_SECRET = "s"; process.env.VOICE_PUBLIC_BASE_URL = "https://brain.example";
  let calls = 0;
  const flaky = (async () => { calls += 1; if (calls === 1) throw new Error("down"); return new Response("{}", { status: 202 }); }) as typeof fetch;
  try {
    assert.equal(await pingSpokenCatalogueCompile("t1", flaky, { retryDelayMs: 0 }), true);
    assert.equal(calls, 2);
    calls = 0;
    const bad = (async () => { calls += 1; return new Response("{}", { status: 400 }); }) as typeof fetch;
    assert.equal(await pingSpokenCatalogueCompile("t1", bad, { retryDelayMs: 0 }), false);
    assert.equal(calls, 1, "4xx is not retried");
  } finally { delete process.env.VOICE_INTERNAL_SECRET; }
});

test("website/document import requests a rebuild after the tenants update", () => {
  const src = readFileSync(new URL("../dashboard/src/app/(desk)/settings/ingestActions.ts", import.meta.url), "utf8");
  assert.match(src, /requestSpokenCatalogueCompile\(/);
});
