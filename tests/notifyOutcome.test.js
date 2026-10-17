const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { buildNotifyOutcome, ownerAlreadyNotified, channelOfError } = require('../src/notifications/notifyOutcome');

describe('per-channel owner notify outcome', () => {
  it('SMS 402 + WhatsApp 502, email delivered: notified, WhatsApp not sent', () => {
    const o = buildNotifyOutcome([
      { channel: 'email', errors: ['sms:402 Insufficient credits', 'whatsapp:502 Bad Gateway'] },
    ]);
    assert.equal(o.owner_notified, true);
    assert.equal(o.owner_notify_channel, 'email');
    assert.equal(o.whatsapp_delivered, false);
    assert.deepEqual(o.owner_notify_channels, { sms: 'failed', whatsapp: 'failed', email: 'sent' });
  });

  it('WhatsApp delivered: whatsapp_delivered true', () => {
    const o = buildNotifyOutcome([{ channel: 'whatsapp', errors: ['sms:sms_allowance_exhausted'] }]);
    assert.equal(o.whatsapp_delivered, true);
    assert.deepEqual(o.owner_notify_channels, { sms: 'failed', whatsapp: 'sent' });
  });

  it('staff-prefixed errors from dispatchToStaff are attributed', () => {
    assert.equal(channelOfError('Jane:whatsapp:502'), 'whatsapp');
    const o = buildNotifyOutcome([], ['Jane:send_failed', 'Jane:sms:402']);
    assert.equal(o.owner_notified, false);
    assert.deepEqual(o.owner_notify_channels, { sms: 'failed' });
  });

  it('dedupe honours owner_notified and legacy whatsapp_sent', () => {
    assert.equal(ownerAlreadyNotified({ owner_notified: true, whatsapp_sent: false }), true);
    assert.equal(ownerAlreadyNotified({ whatsapp_sent: true }), true);
    assert.equal(ownerAlreadyNotified({}), false);
  });
});

describe('notify wiring', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const db = fs.readFileSync(path.join(__dirname, '..', 'src', 'db.js'), 'utf8');
  const dispatch = fs.readFileSync(path.join(__dirname, '..', 'src', 'notifications', 'dispatch.js'), 'utf8');

  it('every markWhatsappSent call passes the real outcome', () => {
    const calls = server.match(/db\.markWhatsappSent\([^)]*\)/g) || [];
    assert.ok(calls.length >= 4);
    for (const c of calls) assert.match(c, /buildNotifyOutcome\(/);
  });

  it('markWhatsappSent writes owner_notified and only sets whatsapp_sent on WA delivery', () => {
    assert.match(db, /meta\.owner_notified = true;/);
    assert.match(db, /meta\.whatsapp_sent = outcome\.whatsapp_delivered === true;/);
    assert.match(db, /owner_notified: Boolean\(meta\.owner_notified \|\| meta\.whatsapp_sent\)/);
  });

  it('dispatchAlert returns earlier channel failures with the success', () => {
    assert.match(dispatch, /\{ \.\.\.result, errors: \[\.\.\.errors\] \}/);
  });

  it('lead dedupe uses ownerAlreadyNotified', () => {
    assert.match(server, /if \(ownerAlreadyNotified\(call\)\) return;/);
  });
});
