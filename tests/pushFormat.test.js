const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const f = require('../src/notifications/pushFormat');
const { buildPayload } = require('../src/notifications/push');

const AT = '2026-10-25T08:42:00Z'; // 11:42 EAT

test('Kenyan numbers format as +254 7xx xxx xxx', () => {
  assert.equal(f.formatKenyanNumber('0712345678'), '+254 712 345 678');
  assert.equal(f.formatKenyanNumber('+254712345678'), '+254 712 345 678');
  assert.equal(f.formatKenyanNumber('254110345678'), '+254 110 345 678');
  assert.equal(f.formatKenyanNumber('+14155550100'), '+14155550100');
});

test('missed call: title, body, url, tag, icon, badge, timestamp, renotify', () => {
  const p = f.formatMissedCallPush({ callId: 'c_1', callerNumber: '0712345678', at: AT, reason: 'Wants a quote' });
  assert.deepEqual(p, {
    title: 'Missed call',
    body: '+254 712 345 678 · 11:42 EAT · Wants a quote',
    url: '/calls/c_1',
    tag: 'call-c_1',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    timestamp: Date.parse(AT),
    renotify: false,
  });
  assert.equal(f.formatMissedCallPush({ callerName: 'Wanjiku', at: AT }).body, 'Wanjiku · 11:42 EAT');
});

test('booking: service · day time EAT · caller, deep link /bookings/<id>', () => {
  const p = f.formatBookingPush({ bookingId: 'b9', service: 'Haircut', startsAt: '2026-10-27T11:30:00Z', callerName: 'Otieno', at: AT });
  assert.equal(p.title, 'New booking');
  assert.equal(p.body, 'Haircut · Tue 27 Oct 14:30 EAT · Otieno');
  assert.equal(p.url, '/bookings/b9');
  assert.equal(p.tag, 'booking-b9');
  assert.equal(p.renotify, false);
});

test('Kiswahili when tenant language is sw', () => {
  assert.equal(f.formatMissedCallPush({ lang: 'sw', at: AT }).title, 'Simu uliyokosa');
  assert.equal(f.formatMissedCallPush({ lang: 'sw', at: AT }).body, 'Mpigaji asiyejulikana · 11:42 EAT');
  const b = f.formatBookingPush({ lang: 'sw', service: 'Kunyoa', startsAt: '2026-10-27T11:30:00Z', callerName: 'Otieno' });
  assert.equal(b.title, 'Miadi mpya');
  assert.equal(b.body, 'Kunyoa · Jumanne 27 Okt 14:30 EAT · Otieno');
});

test('body ≤ 110 chars, cut on whole words, vendor names scrubbed', () => {
  const reason = 'Twilio dropped it, wants to know about the deluxe package pricing for weekend bookings and group discounts at the Westlands branch';
  const p = f.formatMissedCallPush({ callerName: 'Achieng', at: AT, reason });
  assert.ok(p.body.length <= 110, p.body.length);
  assert.ok(p.body.endsWith('…'));
  assert.doesNotMatch(p.body, /twilio/i);
  const words = reason.replace('Twilio ', '').split(' ');
  const last = p.body.slice(0, -1).split(' ').pop();
  assert.ok(words.includes(last) || words.includes(last + ','), `cut mid-word: ${last}`);
});

test('buildPayload keeps icon, badge, timestamp, renotify and rejects foreign assets', () => {
  const j = JSON.parse(buildPayload(f.formatMissedCallPush({ callId: 'x', at: AT })));
  assert.equal(j.icon, '/icons/icon-192.png');
  assert.equal(j.badge, '/icons/badge-96.png');
  assert.equal(j.timestamp, Date.parse(AT));
  assert.equal(j.renotify, false);
  const bad = JSON.parse(buildPayload({ title: 't', icon: 'https://evil.example/x.png' }));
  assert.equal(bad.icon, undefined);
});

test('sw.js renders icon, badge, timestamp and opens/focuses the url', () => {
  const sw = fs.readFileSync(path.join(__dirname, '../dashboard/public/sw.js'), 'utf8');
  assert.match(sw, /badge: asset\(data\.badge, "\/icons\/badge-96\.png"\)/);
  assert.match(sw, /timestamp:/);
  assert.match(sw, /data\.renotify === true/);
  assert.match(sw, /openWindow\(target\)/);
  assert.match(sw, /tab\.focus\(\)/);
});

test('badge is a 96px icon on transparent', () => {
  const buf = fs.readFileSync(path.join(__dirname, '../dashboard/public/icons/badge-96.png'));
  assert.equal(buf.readUInt32BE(16), 96);
  assert.equal(buf.readUInt32BE(20), 96);
});
