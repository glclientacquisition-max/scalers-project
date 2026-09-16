// Run: node --test tests/teamPermissions.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  directoryHasExplicitPermissions,
  findNotifyCatchAll,
  normalizeNotifyTeam,
  staffRecipients,
  uniqueDestinations,
} = require('../src/conversation/teamPermissions');
const { resolveEscalation } = require('../src/conversation/escalation');

const ceo = { name: 'Wanjiku', role: 'CEO', phone: '0711000000' };
const desk = { name: 'Desk', role: 'General queries', phone: '0711333333' };
const sales = { name: 'Peter', role: 'Sales', phone: '0711222222' };

describe('team notify permissions', () => {
  it('treats unmigrated directories as inferred, not explicit', () => {
    assert.equal(directoryHasExplicitPermissions([ceo, sales]), false);
    assert.equal(
      directoryHasExplicitPermissions([
        { ...sales, receives_inbox: false },
      ]),
      true
    );
  });

  it('infers escalate for anyone with a phone and inbox for owner/general', () => {
    const team = normalizeNotifyTeam([ceo, sales, desk]);
    const byName = Object.fromEntries(team.map((m) => [m.name, m]));
    assert.equal(byName.Wanjiku.receives_escalation, true);
    assert.equal(byName.Wanjiku.receives_inbox, true);
    assert.equal(byName.Wanjiku.receives_ops, true);
    assert.equal(byName.Peter.receives_escalation, true);
    assert.equal(byName.Peter.receives_inbox, false);
    assert.equal(byName.Desk.receives_inbox, true);
  });

  it('matches owner phone to inbox when the role is not ownerish', () => {
    const team = normalizeNotifyTeam(
      [{ name: 'Lynn', role: 'Accounts', phone: '+254711000000' }],
      { ownerPhone: '0711000000' }
    );
    assert.equal(team[0].receives_inbox, true);
  });

  it('once any row has flags, missing flags are false', () => {
    const team = normalizeNotifyTeam([
      { ...desk, receives_escalation: true, receives_inbox: true, receives_ops: true },
      sales,
    ]);
    const peter = team.find((m) => m.name === 'Peter');
    assert.equal(peter.receives_escalation, false);
    assert.equal(peter.receives_inbox, false);
  });

  it('does not invent a catch-all from team[0]', () => {
    assert.equal(findNotifyCatchAll(normalizeNotifyTeam([sales])), null);
    const withDesk = findNotifyCatchAll(normalizeNotifyTeam([sales, desk]));
    assert.equal(withDesk.name, 'Desk');
  });

  it('staff inbox uses legacy owner only when flags are absent', () => {
    const inferred = staffRecipients('inbox', {
      teamDirectory: [sales],
      ownerPhone: '+254790381872',
      ownerEmail: 'owner@shop.co.ke',
    });
    assert.equal(inferred.source, 'legacy_owner');
    assert.equal(inferred.recipients.length, 1);
    assert.equal(inferred.recipients[0].phone, '+254790381872');

    const explicit = staffRecipients('inbox', {
      teamDirectory: [{ ...sales, receives_escalation: false, receives_inbox: false }],
      ownerPhone: '+254790381872',
      ownerEmail: 'owner@shop.co.ke',
    });
    assert.equal(explicit.source, 'none');
    assert.equal(explicit.recipients.length, 0);
  });

  it('sends inbox to every unique permissioned destination', () => {
    const picked = staffRecipients('inbox', {
      teamDirectory: [
        { ...desk, receives_escalation: true, receives_inbox: true, receives_ops: true },
        {
          name: 'Amina',
          role: 'Owner',
          phone: '0711333333',
          receives_escalation: true,
          receives_inbox: true,
          receives_ops: true,
        },
        {
          name: 'Finance',
          role: 'Accounts',
          phone: '0711444444',
          email: 'accounts@shop.co.ke',
          receives_escalation: false,
          receives_inbox: true,
          receives_ops: false,
        },
      ],
    });
    assert.equal(picked.source, 'team');
    assert.equal(picked.recipients.length, 2);
    assert.deepEqual(
      picked.recipients.map((r) => r.name),
      ['Desk', 'Finance']
    );
  });

  it('collapses duplicate phones in uniqueDestinations', () => {
    const dests = uniqueDestinations([
      { name: 'A', phone: '0711000000', email: '' },
      { name: 'B', phone: '+254711000000', email: 'b@x.com' },
    ]);
    assert.equal(dests.length, 1);
    assert.equal(dests[0].name, 'A');
  });
});

describe('escalation respects notify permissions', () => {
  it('still falls back to CEO on unmigrated one-person directories', () => {
    const r = resolveEscalation([ceo], 'the sales guy');
    assert.equal(r.match, 'fallback');
    assert.equal(r.teammate.name, 'Wanjiku');
  });

  it('does not route unmatched asks to a sales-only row once flags exist', () => {
    const r = resolveEscalation(
      [
        {
          ...sales,
          receives_escalation: false,
          receives_inbox: false,
          receives_ops: false,
        },
      ],
      'sales'
    );
    assert.equal(r.teammate, null);
    assert.equal(r.match, null);
  });

  it('matches a permissioned sales row and falls unmatched asks to general', () => {
    const team = [
      {
        ...sales,
        receives_escalation: true,
        receives_inbox: false,
        receives_ops: false,
      },
      {
        ...desk,
        receives_escalation: true,
        receives_inbox: true,
        receives_ops: true,
      },
    ];
    const salesAsk = resolveEscalation(team, 'sales');
    assert.equal(salesAsk.match, 'exact_role');
    assert.equal(salesAsk.teammate.name, 'Peter');
    const other = resolveEscalation(team, 'billing');
    assert.equal(other.match, 'fallback');
    assert.equal(other.teammate.name, 'Desk');
  });
});
