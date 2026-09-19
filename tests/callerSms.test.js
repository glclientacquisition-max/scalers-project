// Run: node --test tests/callerSms.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  callerSmsEnabled,
  appointmentCallerEvent,
  requestCallerEvent,
  requestStatusCallerEvent,
  holdStatusCallerSms,
} = require('../src/notifications/callerSms');
const { EVENTS, renderCallerText } = require('../src/notifications/events');

describe('caller SMS opt-in', () => {
  it('is off unless the tenant turns caller_sms on', () => {
    assert.equal(callerSmsEnabled(null), false);
    assert.equal(callerSmsEnabled({ sms: true, caller_sms: false }), false);
    assert.equal(callerSmsEnabled({ caller_sms: true }), true);
  });

  it('does not text the caller on enquiry', () => {
    assert.equal(
      requestCallerEvent({ request_type: 'enquiry', item: 'Roof cleaning' }),
      null
    );
  });

  it('builds hold and callback events', () => {
    assert.equal(
      requestCallerEvent({ request_type: 'hold', item: 'charger' }).kind,
      EVENTS.CALLER_HOLD
    );
    assert.equal(
      requestCallerEvent({ request_type: 'callback' }).kind,
      EVENTS.CALLER_CALLBACK
    );
  });

  it('maps desk confirm and cancel to distinct copy', () => {
    const confirmed = appointmentCallerEvent(
      {
        status: 'confirmed',
        service_name: 'mattress cleaning',
        when_text: 'tomorrow at 10 AM',
        caller_name: 'Alvin',
        businessName: 'Done and Dusted Cleaning Services',
      },
      'updated'
    );
    assert.equal(confirmed.kind, EVENTS.CALLER_APPOINTMENT_CONFIRMED);
    assert.match(
      renderCallerText(confirmed),
      /Your mattress cleaning visit for tomorrow at 10 AM is confirmed/
    );

    const cancelled = appointmentCallerEvent(
      {
        status: 'cancelled',
        service_name: 'mattress cleaning',
        caller_name: 'Haijawekwa',
        businessName: 'Done and Dusted Cleaning Services',
      },
      'updated'
    );
    assert.equal(cancelled.kind, EVENTS.CALLER_APPOINTMENT_CANCELLED);
    assert.match(renderCallerText(cancelled), /^Hi, Done and Dusted/);
    assert.doesNotMatch(renderCallerText(cancelled), /Haijawekwa/);
  });

  it('maps desk hold Done and Cancel to ready copy, and skips enquiry', () => {
    const ready = requestStatusCallerEvent(
      {
        request_type: 'hold',
        item: 'two chargers',
        caller_name: 'Soony',
        businessName: 'ChapterOne Bookstore',
      },
      'fulfilled'
    );
    assert.equal(ready.kind, EVENTS.CALLER_HOLD_READY);
    assert.equal(
      renderCallerText(ready),
      'Hi Soony, ChapterOne Bookstore here. two chargers is ready for pickup.'
    );

    const orderReady = requestStatusCallerEvent(
      { request_type: 'order', item: 'toner', businessName: 'Aris Kenya' },
      'fulfilled'
    );
    assert.equal(orderReady.kind, EVENTS.CALLER_HOLD_READY);

    const cancelled = requestStatusCallerEvent(
      {
        request_type: 'hold',
        item: 'two chargers',
        caller_name: 'Haijawekwa',
        businessName: 'ChapterOne Bookstore',
      },
      'cancelled'
    );
    assert.equal(cancelled.kind, EVENTS.CALLER_HOLD_CANCELLED);
    assert.equal(
      renderCallerText(cancelled),
      'Hi, ChapterOne Bookstore here. We cancelled the pickup for two chargers.'
    );

    assert.equal(requestStatusCallerEvent({ request_type: 'enquiry' }, 'fulfilled'), null);
    assert.equal(requestStatusCallerEvent({ request_type: 'callback' }, 'fulfilled'), null);
    assert.equal(requestStatusCallerEvent({ request_type: 'hold' }, 'open'), null);
    assert.equal(
      holdStatusCallerSms({
        channels: { caller_sms: false },
        status: 'fulfilled',
        requestType: 'hold',
      }),
      null
    );
    assert.equal(
      holdStatusCallerSms({
        channels: { caller_sms: true },
        status: 'fulfilled',
        requestType: 'hold',
      }).kind,
      EVENTS.CALLER_HOLD_READY
    );
  });
});
