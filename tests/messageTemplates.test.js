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
    assertNoDashes(hold, 'caller hold');
    assertNoDashes(pickup, 'caller hold update');
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
