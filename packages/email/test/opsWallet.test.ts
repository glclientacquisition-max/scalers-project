import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generatedModule, renderWalletTemplates } from "../src/opsWalletExport.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const generated = path.resolve(here, "../../../dashboard/src/lib/opsWalletTemplates.ts");

test("ops wallet: committed Desk export matches source", async () => {
  const want = generatedModule(await renderWalletTemplates());
  assert.equal(readFileSync(generated, "utf8"), want, "run: cd packages/email && npm run export:ops-wallet");
});

test("ops wallet: staging templates never say PRODUCTION, production always does", async () => {
  const t = await renderWalletTemplates();
  for (const [key, v] of Object.entries(t)) {
    const all = `${v.subject}\n${v.preheader}\n${v.text}\n${v.html.replace(/<style[\s\S]*?<\/style>/gi, "")}`;
    if (key.startsWith("staging:")) {
      assert.ok(v.subject.startsWith("[STAGING] "), v.subject);
      assert.doesNotMatch(all, /PRODUCTION/, key);
    } else {
      assert.ok(v.subject.startsWith("[PRODUCTION] "), v.subject);
      assert.match(v.html, /class="band-prod"/);
    }
  }
});

test("env tag is one shared helper: any kind can be tagged at render time", async () => {
  const { renderEmail, envSubject } = await import("../src/index.ts");
  const { fixtures } = await import("../src/fixtures.ts");
  const fx = (fixtures as unknown as ReadonlyArray<{ kind: string; props: unknown }>).find((f) => f.kind === "ops_incident")!;
  const st = await renderEmail("ops_incident", fx.props as never, { env: { env: "staging", note: "test workspace only" } });
  assert.ok(st.subject.startsWith("[STAGING] "), st.subject);
  assert.match(st.html, /class="band-neu"/);
  assert.ok(st.text.startsWith("STAGING · test workspace only"));
  const plain = await renderEmail("ops_incident", fx.props as never);
  assert.doesNotMatch(plain.html, /class="band-/);
  assert.equal(envSubject("production", "[STAGING] x"), "[PRODUCTION] x");
});
