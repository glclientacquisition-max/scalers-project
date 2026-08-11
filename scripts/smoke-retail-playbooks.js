#!/usr/bin/env node
// Retail playbook scenario smoke (no network).

const {
  classifyRetailIntent,
  missingRetailSlots,
  canCompleteRetailIntent,
} = require('../src/conversation/playbooks/retail');
const { parseGeminiResponse } = require('../src/conversation/toolMarkers');

/** @type {Array<{ name: string, utter: string, intent: string, slots?: object, missing?: string[], complete?: boolean, toolRaw?: string, expectToolType?: string }>} */
const scenarios = [
  {
    name: 'Hours ask — no slots',
    utter: 'Are you open?',
    intent: 'hours_open',
    slots: {},
    missing: [],
    complete: true,
  },
  {
    name: 'Directions ask',
    utter: 'How do I find you?',
    intent: 'directions',
    complete: true,
  },
  {
    name: 'Price needs product',
    utter: 'How much does it cost?',
    intent: 'price',
    slots: {},
    missing: ['product'],
    complete: false,
  },
  {
    name: 'Hold incomplete without name/when',
    utter: 'Can you hold a charger for me?',
    intent: 'hold_or_pickup',
    slots: { product: 'charger' },
    missing: ['name', 'when'],
    complete: false,
  },
  {
    name: 'Hold complete fires create_service_request',
    utter: 'Hold two chargers, name is Jane, I will pick up at 5',
    intent: 'hold_or_pickup',
    slots: { product: 'charger', name: 'Jane', when: '5', quantity: '2' },
    missing: [],
    complete: true,
    toolRaw:
      'Done Jane. ###TOOL###{"create_service_request":{"type":"hold","name":"Jane","item":"charger","quantity":"2","when_text":"5"}}###ENDTOOL###',
    expectToolType: 'hold',
  },
  {
    name: 'Human handoff intent',
    utter: 'I want to speak to the owner',
    intent: 'human',
    slots: { name: 'Peter', reason: 'billing' },
    complete: true,
  },
  {
    name: 'Policy ask',
    utter: 'Do you accept M-Pesa?',
    intent: 'policy',
    complete: true,
  },
];

let failed = 0;
for (const s of scenarios) {
  const intent = classifyRetailIntent(s.utter);
  if (intent !== s.intent) {
    failed += 1;
    console.error('FAIL intent', s.name, { got: intent, want: s.intent });
    continue;
  }
  if (s.missing) {
    const missing = missingRetailSlots(intent, s.slots || {});
    if (JSON.stringify(missing) !== JSON.stringify(s.missing)) {
      failed += 1;
      console.error('FAIL missing', s.name, { got: missing, want: s.missing });
      continue;
    }
  }
  if (typeof s.complete === 'boolean') {
    const ok = canCompleteRetailIntent(intent, s.slots || {});
    if (ok !== s.complete) {
      failed += 1;
      console.error('FAIL complete', s.name, { got: ok, want: s.complete });
      continue;
    }
  }
  if (s.toolRaw) {
    const parsed = parseGeminiResponse(s.toolRaw);
    if (parsed.serviceRequest?.type !== s.expectToolType) {
      failed += 1;
      console.error('FAIL tool', s.name, parsed.serviceRequest);
      continue;
    }
  }
  console.log('OK', s.name);
}

if (failed) {
  console.error(`\n${failed} retail scenario(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${scenarios.length} retail scenarios passed.`);
