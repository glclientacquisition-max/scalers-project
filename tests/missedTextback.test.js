// Missed-call text-back: toggle parsing, eligibility, copy, wiring.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const { parseNotifyChannels } = require('../src/notifications/notifyChannels');
const {
  missedTextbackEnabled,
  missedTextbackBody,
  missedCallEligible,
  recentlyTexted,
} = require('../src/notifications/missedTextback');

test('missed_textback defaults off and parses as a boolean', () => {
  assert.equal(parseNotifyChannels(null).missed_textback, false);
  assert.equal(parseNotifyChannels({}).missed_textback, false);
  assert.equal(parseNotifyChannels({ missed_textback: true }).missed_textback, true);
  assert.equal(parseNotifyChannels({ missed_textback: 'yes' }).missed_textback, false);
  assert.equal(missedTextbackEnabled({ missed_textback: true }), true);
  assert.equal(missedTextbackEnabled({ caller_sms: true }), false);
});

test('text-back copy names the business and promises only the callback', () => {
  const body = missedTextbackBody('Zawadi Designs');
  assert.ok(body.includes('Zawadi Designs'));
  assert.match(body, /call you back/);
  // No inbound SMS route exists, so the text must never invite a reply.
  assert.doesNotMatch(body, /reply/i);
  assert.ok(!body.includes('—') && !body.includes('–'));
  assert.ok(body.length <= 160, `one SMS segment, got ${body.length}`);
  assert.ok(missedTextbackBody('').includes('the business you called'));
});

test('only failed or no_answer calls with no service are eligible', () => {
  const base = { from_number: '0722000111', summary: '{}' };
  assert.equal(missedCallEligible({ ...base, status: 'failed' }).ok, true);
  assert.equal(missedCallEligible({ ...base, status: 'no_answer' }).ok, true);
  assert.equal(missedCallEligible({ ...base, status: 'complete' }).reason, 'served');
  assert.equal(missedCallEligible({ ...base, status: 'in_progress' }).reason, 'served');
  assert.equal(missedCallEligible(null).reason, 'no_call');
  assert.equal(
    missedCallEligible({ ...base, status: 'failed', summary: '{"kind":"live_transfer"}' }).reason,
    'transfer_leg'
  );
  assert.equal(
    missedCallEligible({
      ...base,
      status: 'failed',
      summary: '{"missed_textback_at":"2026-09-14T10:00:00Z"}',
    }).reason,
    'already_sent'
  );
  assert.equal(
    missedCallEligible({ status: 'failed', from_number: '', summary: '{}' }).reason,
    'no_caller_phone'
  );
  assert.equal(
    missedCallEligible({ ...base, status: 'failed', name: 'Mary', reason: 'wants a quote' }).reason,
    'lead_captured'
  );
});

test('repeat failures to one caller text once per window', () => {
  const now = Date.parse('2026-09-14T15:00:00Z');
  const texted = (iso) => ({ summary: JSON.stringify({ missed_textback_at: iso }) });
  assert.equal(recentlyTexted([texted('2026-09-14T11:00:00Z')], now), true);
  assert.equal(recentlyTexted([texted('2026-09-14T06:00:00Z')], now), false);
  assert.equal(recentlyTexted([{ summary: '{}' }], now), false);
  assert.equal(recentlyTexted([], now), false);
  assert.equal(recentlyTexted(null, now), false);
});

test('server hooks text-back into the terminal webhook path', () => {
  const server = read('server.js');
  assert.match(server, /require\('\.\/src\/notifications\/missedTextback'\)/);
  assert.match(server, /maybeSendMissedTextback\(\{ callSid, call: updated \}\)/);
  assert.match(server, /textbackInProgress/);
  assert.match(server, /missedTextbackEnabled\(notifyChannels\)/);
  assert.match(server, /listRecentCallsFromNumber\(\{/);
  assert.match(server, /mergeCallSummaryMeta\(\{[\s\S]*?TEXTBACK_META_KEY/);
});

test('db exposes the same-caller suppression query', () => {
  const db = read('src/db.js');
  assert.match(db, /async function listRecentCallsFromNumber\(/);
  assert.match(db, /listRecentCallsFromNumber,/);
});

test('dashboard parses and saves the toggle', () => {
  const ts = read('dashboard/src/lib/notifyChannels.ts');
  assert.match(ts, /missed_textback: boolean/);
  assert.match(ts, /missed_textback: false/);
  assert.match(ts, /obj\.missed_textback/);
  const form = read('dashboard/src/components/TenantForm.tsx');
  assert.match(form, /Text back missed calls/);
  assert.match(form, /notifyChannels\.missed_textback/);
});
