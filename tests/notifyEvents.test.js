// Run: node --test tests/notifyEvents.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  EVENTS,
  renderEventText,
  renderEventSubject,
  renderCallerText,
  leadEvent,
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

  it('renders caller confirmations with business, name, and the specific ask', () => {
    const appt = renderCallerText({
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
});
