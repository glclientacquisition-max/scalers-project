// Run: node --test tests/notifyEvents.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  EVENTS,
  renderEventText,
  renderEventSubject,
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
});
