// Run: node --test tests/notifyEvents.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  EVENTS,
  renderEventText,
  renderEventSubject,
  renderCallerText,
  leadEvent,
  ownerLeadEvent,
} = require('../src/notifications/events');

describe('notify events', () => {
  it('renders a lead as ordered label rows', () => {
    const event = leadEvent({
      businessName: 'Done and Dusted Cleaning Services',
      name: 'Jane',
      callerNumber: '+254790381872',
      reason: 'Book carpet cleaning',
      recordingUrl: 'https://example.com/rec.mp3',
    });
    const text = renderEventText(event);
    assert.equal(
      text,
      [
        'New missed-call lead — Done and Dusted Cleaning Services',
        'Name: Jane',
        'Phone: +254790381872',
        'Reason: Book carpet cleaning',
        'Recording: https://example.com/rec.mp3',
      ].join('\n')
    );
    assert.equal(
      renderEventSubject(event),
      'New missed-call lead — Done and Dusted Cleaning Services'
    );
  });

  it('skips empty fields and keeps title generic without business', () => {
    const text = renderEventText({
      kind: EVENTS.SERVICE_REQUEST,
      title: 'HOLD / PICKUP',
      fields: [
        ['Item', 'charger'],
        ['Qty', ''],
        ['When', null],
      ],
      action: 'Open Requests in Scalers desk to mark fulfilled.',
    });
    assert.equal(
      text,
      ['HOLD / PICKUP', 'Item: charger', 'Open Requests in Scalers desk to mark fulfilled.'].join('\n')
    );
  });

  it('has a title for every event kind', () => {
    for (const kind of Object.values(EVENTS)) {
      const text = renderEventText({ kind, fields: [] });
      assert.ok(text.length > 0, `missing title for ${kind}`);
    }
  });

  it('renders caller confirmations with business, name, and the specific ask', () => {    const appt = renderCallerText({
      kind: EVENTS.CALLER_APPOINTMENT,
      businessName: 'Done and Dusted Cleaning Services',
      caller: { name: 'Jane' },
      item: 'carpet cleaning',
      when: 'tomorrow at 10 AM',
    });
    assert.equal(
      appt,
      'Hi Jane, Done and Dusted Cleaning Services here. We have your carpet cleaning visit for tomorrow at 10 AM. We will confirm shortly.'
    );

    const hold = renderCallerText({
      kind: EVENTS.CALLER_HOLD,
      businessName: 'ChapterOne Bookstore',
      caller: { name: 'Soony' },
      item: 'two chargers',
    });
    assert.equal(
      hold,
      'Hi Soony, ChapterOne Bookstore here. we have held two chargers for you. We will confirm shortly.'
    );

    const callback = renderCallerText({
      kind: EVENTS.CALLER_CALLBACK,
      businessName: 'Aris Kenya',
      caller: { name: 'Lynn' },
    });
    assert.equal(
      callback,
      'Hi Lynn, Aris Kenya here. The team will call you back.'
    );
  });

  it('caller text is not generic when the item is missing', () => {
    const text = renderCallerText({
      kind: EVENTS.CALLER_APPOINTMENT,
      businessName: 'Done and Dusted',
      caller: { name: 'Jane' },
      when: 'Tuesday',
    });
    assert.match(text, /your visit for Tuesday/);
    assert.doesNotMatch(text, /your call was important/i);
  });

  it('owner lead event carries intent, summary, and outcome when present', () => {
    const event = ownerLeadEvent(
      {
        name: 'Jane',
        from_number: '+254790381872',
        reason: 'Book carpet cleaning',
        primary_intent: 'book_visit',
        brain_summary: 'Intent: book_visit. Caller: Jane. Goal: carpet cleaning tomorrow.',
        resolution_note: 'Visit request saved',
        recording_url: 'https://example.com/rec.mp3',
      },
      'Done and Dusted Cleaning Services'
    );
    const text = renderEventText(event);
    assert.match(text, /New missed-call lead — Done and Dusted Cleaning Services/);
    assert.match(text, /Intent: book_visit/);
    assert.match(text, /Summary: Intent: book_visit/);
    assert.match(text, /Outcome: Visit request saved/);
    assert.match(text, /Recording: https:\/\/example\.com\/rec\.mp3/);
  });

  it('drops greeting summaries, stuck general_enquiry, and internal outcomes', () => {
    const {
      displayOwnerCallerName,
      shouldSendOwnerLead,
    } = require('../src/notifications/events');
    const event = ownerLeadEvent(
      {
        name: 'Alvin.',
        from_number: '+254790381872',
        reason: 'Alvin called to ask about roof cleaning services.',
        primary_intent: 'general_enquiry',
        brain_summary: 'Intent: general_enquiry. Goal: How are you doing, Shy?',
        resolution_note: 'The response included a permitted end-call action.',
        owner_review: { primary_intent: 'order_enquiry' },
      },
      'Done and Dusted Cleaning Services'
    );
    const text = renderEventText(event);
    assert.match(text, /Name: Alvin\n/);
    assert.match(text, /Intent: order_enquiry/);
    assert.doesNotMatch(text, /How are you doing/);
    assert.doesNotMatch(text, /permitted end-call/);
    assert.equal(displayOwnerCallerName('Haijawekwa'), null);
    assert.equal(displayOwnerCallerName('Calling'), null);
    assert.equal(shouldSendOwnerLead({ name: 'Callings', reason: 'human' }), false);
    assert.equal(
      shouldSendOwnerLead({
        name: 'Alvin',
        reason: 'Book couch cleaning',
      }),
      true
    );
  });

  it('owner lead event falls back to name and reason when no summary', () => {
    const event = ownerLeadEvent(
      {
        name: 'Jane',
        from_number: '+254790381872',
        reason: 'Book carpet cleaning',
      },
      'Done and Dusted'
    );
    const text = renderEventText(event);
    assert.match(text, /Name: Jane/);
    assert.match(text, /Reason: Book carpet cleaning/);
    assert.doesNotMatch(text, /Intent:/);
  });

  it('owner lead event includes a deep link to the call when present', () => {
    const event = ownerLeadEvent(
      {
        id: 'call-uuid-1',
        name: 'Jane',
        from_number: '+254790381872',
        reason: 'Book carpet cleaning',
        callUrl: 'https://scalers-project.vercel.app/calls/call-uuid-1',
      },
      'Done and Dusted'
    );
    const text = renderEventText(event);
    assert.match(
      text,
      /Open call: https:\/\/scalers-project\.vercel\.app\/calls\/call-uuid-1/
    );
  });
});
