/** Run: npx tsx --tsconfig dashboard/tsconfig.json --test tests/checklistScore.test.ts */
import assert from "node:assert/strict";
import { it } from "node:test";
import { scoreCaptureTenant } from "../dashboard/src/lib/completenessStub.ts";

it("assistant reaches 100 with the paths Settings actually attests", () => {
  const s = scoreCaptureTenant(
    { agent_name: "Mary", agent_tone: "warm", agent_tools: {} },
    { "assistant.agent_name": "owner", "assistant.tone": "owner", "assistant.tools": "owner" }
  );
  assert.equal(s.domains.assistant, 100);
});
it("identity reaches 100 once name, vertical, line and spoken name are attested", () => {
  const s = scoreCaptureTenant(
    { business_name: "Aris", vertical: "retail", sautikit_virtual_number: "+254700000000", agent_name: "Mary" },
    { "identity.business_name": "owner", "identity.vertical": "owner", "identity.primary_phone": "owner", "assistant.agent_name": "owner" }
  );
  assert.equal(s.domains.identity, 100);
});
it("FAQs saved in Settings (faqs.N attested) count as confirmed", () => {
  const faqs = [1, 2, 3].map((i) => ({ question: `Q${i}`, answer: "A" }));
  const s = scoreCaptureTenant({ faqs }, { "faqs.1": "owner", "faqs.2": "owner", "faqs.3": "owner" });
  assert.equal(s.domains.faqs, 100);
});
it("a priced service on a shop is not 0%", () => {
  const s = scoreCaptureTenant(
    { vertical: "retail", services_catalog: [{ name: "QA Binding", price_range: "100" }] },
    { "catalog.service.1.name": "owner" }
  );
  assert.ok(s.domains.catalog > 0);
});
it("policies: cancellation fills the third slot", () => {
  const s = scoreCaptureTenant(
    { business_policies: { returns: "7 days", delivery: "Same day", cancellation: "Free" } },
    { "policies.returns": "owner", "policies.delivery": "owner", "policies.cancellation": "owner" }
  );
  assert.equal(s.domains.policies, 100);
});
