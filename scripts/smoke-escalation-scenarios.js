#!/usr/bin/env node
// Case scenarios for team-directory escalation (no network).

const {
  resolveEscalation,
  buildEscalationText,
} = require('../src/conversation/escalation');

const onlyCeo = [{ name: 'Wanjiku', role: 'CEO', phone: '0711000000' }];
const ceoAndGeneral = [
  { name: 'Wanjiku', role: 'CEO', phone: '0711000000' },
  { name: 'Desk', role: 'General queries', phone: '0711333333' },
];
const fullTeam = [
  { name: 'Jane', role: 'Billing', phone: '0711111111' },
  { name: 'Peter', role: 'Sales', phone: '0711222222' },
  { name: 'Wanjiku', role: 'CEO', phone: '0711000000' },
];

/** @type {Array<{ name: string, team: object[], ask: string, expectMatch: string, expectName: string|null }>} */
const scenarios = [
  {
    name: 'Ask for sales guy — only CEO listed',
    team: onlyCeo,
    ask: 'the sales guy',
    expectMatch: 'fallback',
    expectName: 'Wanjiku',
  },
  {
    name: 'Ask for sales guy — General queries catch-all preferred over CEO',
    team: ceoAndGeneral,
    ask: 'the sales guy',
    expectMatch: 'fallback',
    expectName: 'Desk',
  },
  {
    name: 'Ask for sales — sales exists',
    team: fullTeam,
    ask: 'sales',
    expectMatch: 'exact_role',
    expectName: 'Peter',
  },
  {
    name: 'Ask for CEO by role — only CEO',
    team: onlyCeo,
    ask: 'CEO',
    expectMatch: 'exact_role',
    expectName: 'Wanjiku',
  },
  {
    name: 'Ask for Wanjiku by name',
    team: onlyCeo,
    ask: 'Wanjiku',
    expectMatch: 'exact_name',
    expectName: 'Wanjiku',
  },
  {
    name: 'Angry refund — only CEO (fallback)',
    team: onlyCeo,
    ask: 'billing refund',
    expectMatch: 'fallback',
    expectName: 'Wanjiku',
  },
  {
    name: 'Empty directory — no invent',
    team: [],
    ask: 'sales',
    expectMatch: null,
    expectName: null,
  },
];

let failed = 0;
for (const s of scenarios) {
  const r = resolveEscalation(s.team, s.ask);
  const ok =
    r.match === s.expectMatch && (r.teammate?.name || null) === s.expectName;
  if (!ok) {
    failed += 1;
    console.error('FAIL', s.name, r);
  } else {
    console.log('OK  ', s.name);
    if (r.match === 'fallback') {
      console.log(
        '     notify:\n' +
          buildEscalationText({
            businessName: 'Aris Kenya',
            teammate: r.teammate,
            callerName: 'James',
            reason: 'Wants to speak to sales',
            callerNumber: '+254711000000',
            requested: r.requested,
            match: r.match,
          })
            .split('\n')
            .map((l) => `     ${l}`)
            .join('\n')
      );
    }
  }
}

if (failed) {
  console.error(`\n${failed} scenario(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${scenarios.length} scenarios passed`);
