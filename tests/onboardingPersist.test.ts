/** Run: npx tsx --tsconfig dashboard/tsconfig.json --test tests/onboardingPersist.test.ts */
import assert from "node:assert/strict";
import { it } from "node:test";
import { missingColumnFromError, updateWithColumnPeel } from "../dashboard/src/lib/peelMissingColumns.ts";
import { parseOnboardingDraft, validateAgentName } from "../dashboard/src/lib/onboardingDraft.ts";

it("parses PostgREST missing-column messages", () => {
  assert.equal(missingColumnFromError("Could not find the 'after_hours_mode' column of 'tenants' in the schema cache"), "after_hours_mode");
  assert.equal(missingColumnFromError('column tenants.agent_tools does not exist'), "agent_tools");
  assert.equal(missingColumnFromError("permission denied"), null);
});

it("drops only the missing column and keeps hours/agent name", async () => {
  const seen: Record<string, unknown>[] = [];
  const res = await updateWithColumnPeel(
    { hours_schedule: { a: 1 }, agent_name: "Mary", after_hours_mode: "serve", llm_system_prompt: "x" },
    async (p) => {
      seen.push(p);
      return "after_hours_mode" in p
        ? { error: { message: "Could not find the 'after_hours_mode' column of 'tenants' in the schema cache" } }
        : { error: null };
    },
    ["llm_system_prompt"]
  );
  assert.deepEqual(res, { error: null, dropped: ["after_hours_mode"] });
  assert.deepEqual(Object.keys(seen[1]).sort(), ["agent_name", "hours_schedule", "llm_system_prompt"]);
});

it("does not peel required columns or unknown errors", async () => {
  const res = await updateWithColumnPeel({ llm_system_prompt: "x" }, async () => ({
    error: { message: "Could not find the 'llm_system_prompt' column" },
  }), ["llm_system_prompt"]);
  assert.ok(res.error);
});

it("restores a wizard draft safely", () => {
  const d = parseOnboardingDraft(JSON.stringify({ step: 2, products: [{ name: "Test Notebook", price: "150" }], hoursLocation: "Mon-Sat 9-6", agentName: "Mary" }));
  assert.equal(d?.step, 2);
  assert.equal(d?.products?.[0].name, "Test Notebook");
  assert.equal(parseOnboardingDraft("{bad"), null);
  assert.equal(parseOnboardingDraft(JSON.stringify({ step: 99 }))?.step, 0);
});

it("requires a receptionist name", () => {
  assert.equal(validateAgentName("  ").ok, false);
  assert.equal(validateAgentName("x".repeat(41)).ok, false);
  assert.deepEqual(validateAgentName(" Mary "), { ok: true, name: "Mary" });
});
