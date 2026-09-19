// Run: node --test tests/messageTemplates.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  escalationBody,
  missedTextbackBody,
  outageBody,
  renderCallerText,
  renderStaffText,
  walletEmptyBody,
  walletLowBody,
} = require('../src/notifications/templates');
const {
  EVENTS,
  ownerLeadEvent,
  renderEventText,
  serviceRequestEvent,
  appointmentEvent,
} = require('../src/notifications/events');
const fs = require('fs');
const path = require('path');

function readDeskCallerTemplates() {
  return fs.readFileSync(
    path.join(__dirname, '..', 'dashboard/src/lib/messageTemplates.ts'),
    'utf8'
  );
}

function assertNoDashes(text, label) {
  assert.doesNotMatch(text, /[—–]/, `${label} has an em or en dash`);
}

describe('Scalers message catalog', () => {
  it('staff lead is name, phone, reason. No Summary. No Want card', () => {
    const event = ownerLeadEvent(
      {
        name: 'Alvin',
        from_number: '+254790381872',
        reason: 'Alvin called to ask about roof cleaning services.',
        primary_intent: 'order_enquiry',
        brain_summary: 'Goal: How are you doing, Shy?',
        resolution_note: 'Enquiry saved',
        owner_review: { want: 'Roof clean', done: 'Logged enquiry', mood: 'calm', next: 'Quote' },
      },
      'Done and Dusted Cleaning Services'
    );
    const text = renderEventText(event);
    assert.equal(
      text,
      [
        'New missed-call lead. Done and Dusted Cleaning Services',
        'Name: Alvin',
        'Phone: +254790381872',
        'Reason: Alvin called to ask about roof cleaning services.',
        'Intent: order_enquiry',
        'Outcome: Enquiry saved',
      ].join('\n')
    );
    assert.doesNotMatch(text, /Summary:/);
    assert.doesNotMatch(text, /Want:/);
    assert.doesNotMatch(text, /How are you doing/);
    assertNoDashes(text, 'lead');
  });

  it('hold and visit staff bodies come from the catalog', () => {
    const hold = renderEventText(
      serviceRequestEvent(
        {
          request_type: 'hold',
          item: 'charger',
          quantity: '2',
          when_text: 'tomorrow 5pm',
          caller_name: 'Soony',
          caller_phone: '+254711000000',
        },
        'ChapterOne Bookstore'
      )
    );
    assert.match(hold, /^HOLD \/ PICKUP\. ChapterOne Bookstore/);
    assert.match(hold, /Open Inbox Holds to mark fulfilled\./);
    assertNoDashes(hold, 'hold');

    const visit = renderEventText(
      appointmentEvent(
        {
          service_name: 'carpet cleaning',
          when_text: 'tomorrow at 10 AM',
          address_landmark: 'Runda',
          caller_name: 'Jane',
          caller_phone: '+254790381872',
          status: 'requested',
        },
        'Done and Dusted Cleaning Services',
        'created'
      )
    );
    assert.match(visit, /^VISIT REQUEST\. Done and Dusted Cleaning Services/);
    assert.match(visit, /Open Inbox Visits to confirm or cancel\./);
    assertNoDashes(visit, 'visit');
  });

  it('caller copy is specific and capitalized', () => {
    const hold = renderCallerText({
      kind: EVENTS.CALLER_HOLD,
      businessName: 'ChapterOne Bookstore',
      caller: { name: 'Soony' },
      item: 'two chargers',
    });
    assert.equal(
      hold,
      'Hi Soony, ChapterOne Bookstore here. We have held two chargers for you. We will confirm shortly.'
    );
    const pickup = renderCallerText({
      kind: EVENTS.CALLER_HOLD_UPDATED,
      businessName: 'ChapterOne Bookstore',
      caller: { name: 'Soony' },
      item: 'two chargers',
      when: 'Friday 4pm',
    });
    assert.equal(
      pickup,
      'Hi Soony, ChapterOne Bookstore here. Pickup for two chargers is now Friday 4pm.'
    );
    const ready = renderCallerText({
      kind: EVENTS.CALLER_HOLD_READY,
      businessName: 'ChapterOne Bookstore',
      caller: { name: 'Soony' },
      item: 'two chargers',
    });
    assert.equal(
      ready,
      'Hi Soony, ChapterOne Bookstore here. two chargers is ready for pickup.'
    );
    const cancelled = renderCallerText({
      kind: EVENTS.CALLER_HOLD_CANCELLED,
      businessName: 'ChapterOne Bookstore',
      caller: { name: 'Soony' },
      item: 'two chargers',
    });
    assert.equal(
      cancelled,
      'Hi Soony, ChapterOne Bookstore here. We cancelled the pickup for two chargers.'
    );
    const readyBare = renderCallerText({
      kind: EVENTS.CALLER_HOLD_READY,
      businessName: 'ChapterOne Bookstore',
    });
    assert.equal(
      readyBare,
      'Hi, ChapterOne Bookstore here. Your item is ready for pickup.'
    );
    assertNoDashes(hold, 'caller hold');
    assertNoDashes(pickup, 'caller hold update');
    assertNoDashes(ready, 'caller hold ready');
    assertNoDashes(cancelled, 'caller hold cancelled');

    const desk = readDeskCallerTemplates();
    assert.match(desk, /\$\{item\} is ready for pickup/);
    assert.match(desk, /We cancelled the pickup for \$\{item\}/);
    assert.match(desk, /Your item is ready for pickup/);
  });

  it('wallet staff copy is one tight line after the title', () => {
    assert.equal(
      walletLowBody({ businessName: 'Aris Kenya', balanceKes: 120, lowThresholdKes: 200 }),
      [
        'Scalers wallet running low. Aris Kenya',
        'Prepaid balance is about KES 120 (alert under KES 200). Top up soon so calls stay covered.',
      ].join('\n')
    );
    assert.equal(
      walletEmptyBody({ businessName: 'Aris Kenya', onDemandEnabled: false }),
      [
        'Scalers prepaid empty. Aris Kenya',
        'Prepaid balance is KES 0. On-demand is off. Top up or enable on-demand on Wallet.',
      ].join('\n')
    );
    assert.equal(
      walletEmptyBody({ businessName: 'Aris Kenya', onDemandEnabled: true }),
      [
        'Scalers prepaid empty. Aris Kenya',
        'Prepaid balance is KES 0. On-demand is on. Top up when you can.',
      ].join('\n')
    );
    assert.doesNotMatch(
      walletLowBody({ businessName: 'Aris Kenya', balanceKes: 80, lowThresholdKes: 200 }),
      /Enable it on Wallet if you want to continue/
    );
  });

  it('wallet, outage, missed textback, and escalate have no em dashes', () => {
    const samples = [
      walletLowBody({ businessName: 'Aris Kenya', balanceKes: 80, lowThresholdKes: 200 }),
      walletEmptyBody({ businessName: 'Aris Kenya', onDemandEnabled: false }),
      outageBody('Aris Kenya', 'speech'),
      outageBody('Aris Kenya', 'llm'),
      missedTextbackBody('Aris Kenya'),
      escalationBody({
        businessName: 'Aris Kenya',
        teammate: { name: 'Desk', role: 'General queries', phone: '0711333333' },
        callerName: 'James',
        callerNumber: '+254711000000',
        reason: 'Wants sales',
        requested: 'sales',
        match: 'fallback',
      }),
    ];
    for (const text of samples) {
      assert.ok(text.length > 20);
      assertNoDashes(text, text.slice(0, 40));
    }
  });
});
