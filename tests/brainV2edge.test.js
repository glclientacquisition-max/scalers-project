'use strict';
// BA v2 edge-case sweep fixes (evals/v2/edge): one test per root-cause cluster fixed.
const test = require('node:test');
const assert = require('node:assert');
const V2 = require('../src/conversation/v2');
const DD = require('../evals/v2/fixtures/tenants/done_and_dusted.json');
const WED = new Date('2026-10-14T05:00:00Z'); // Wed 08:00 EAT
const WED15 = new Date('2026-10-14T12:00:00Z');
const THU0530 = new Date('2026-10-15T02:30:00Z');
const SUN_CLOSED = JSON.parse(JSON.stringify(DD)); SUN_CLOSED.hoursSchedule.days.sun = { open: null, close: null, closed: true };
async function talk(lines, { now = WED, profile = DD, seed = {} } = {}) {
  const st = V2.createState({ profile, callerPhone: '+254700000001', contactName: seed.contactName || null, openRows: seed.rows || [], pendingTasks: [] });
  const h = V2.createDryRunHandlers(); const out = [];
  for (const text of lines) out.push(await V2.runTurn(st, { text, profile, now, handlers: h }));
  return { st, out, lines: out.map((o) => o.line) };
}
const W = (t, now = WED) => V2.lexicon.parseWhen(t, now);

test('dates: self-corrections take the last day/time; half past, noon, the 16th, tarehe kumi na sita, typos', () => {
  assert.deepEqual([W('Friday, no, Saturday at 10am').date, W('Saturday, sorry, Friday at 10am').date], ['2026-10-17', '2026-10-16']);
  assert.equal(W('Friday at 10am, no, 11am').time, '11:00');
  assert.equal(W('Ijumaa saa nne, hapana, saa tano asubuhi').time, '11:00');
  assert.equal(W('Ijumaa saa nne, sema saa tano asubuhi').time, '11:00');
  assert.equal(W('Friday at half past ten').time, '10:30');
  assert.equal(W('Friday at noon').time, '12:00');
  assert.equal(W('on the 16th at 10am').date, '2026-10-16');
  assert.equal(W('tarehe kumi na sita saa nne asubuhi').date, '2026-10-16');
  assert.equal(W('tommorow at 2pm').date, '2026-10-15');
  assert.equal(W('the day after tommorow at 10am').date, '2026-10-16');
  assert.ok(W('Friday the 17th at 10am').conflict, 'weekday/date disagreement is flagged');
});

test('small hours run to 05:59 and the question names weekday + date', async () => {
  const { lines } = await talk(['I want to book sofa cleaning tomorrow at 2pm.'], { now: THU0530 });
  assert.match(lines[0], /^Do you mean later today, Thursday the 15th, or Friday the 16th\?$/);
});

test('hours: outside hours, closed day and past time are refused with the hours, then re-asked', async () => {
  const a = await talk(['Nataka kubook sofa cleaning Ijumaa saa mbili usiku.', 'saa tatu asubuhi', 'Ruiru', 'Otieno']);
  assert.match(a.lines[0], /^Tuko wazi kuanzia saa mbili asubuhi hadi saa kumi na mbili jioni\. Saa ngapi Ijumaa\?$/);
  assert.match(a.lines[3], /saa tatu asubuhi, Ruiru/);
  const b = await talk(['Book carpet cleaning on Sunday at 10am.'], { profile: SUN_CLOSED });
  assert.match(b.lines[0], /^We're closed on Sunday\. What other day would you like\?$/);
  const c = await talk(['Can you come today at 10am for sofa cleaning?'], { now: WED15 });
  assert.match(c.lines[0], /already passed/);
  const d = await talk(['Book sofa cleaning on Friday at 6pm.']);
  assert.match(d.lines[0], /We're open from 08:00 to 18:00/);
});

test('Swahili read-back names the period (saa mbili asubuhi)', async () => {
  const { lines } = await talk(['Nataka kubook sofa cleaning Ijumaa saa mbili.', 'Kitengela', 'Alvin']);
  assert.match(lines[2], /saa mbili asubuhi/);
});

test('service + day/time without "book" is a booking; multi-intent price + booking; cancel + book', async () => {
  const a = await talk(['Nataka sofa cleaning Ijumaa saa nne asubuhi.']);
  assert.match(a.lines[0], /^Tuje wapi\?$/);
  const b = await talk(['Book sofa cleaning Friday at 10am, and how much is it?']);
  assert.match(b.lines[0], /800.*Where should we come\?/);
  const row = { id: 'apt_fri', caller_phone: '+254700000001', service_name: 'Carpet Cleaning (per room)', status: 'requested', window_start: '2026-10-16T07:00:00Z', address_landmark: 'Kitengela' };
  const c = await talk(['Cancel my Friday carpet cleaning and book sofa cleaning on Saturday at 10am instead.', 'Yes.'], { seed: { rows: [row], contactName: 'Alvin' } });
  assert.match(c.lines[1], /cancelled\. .*Where should we come\?$/);
  const d = await talk(['Drop my Friday carpet cleaning.'], { seed: { rows: [row] } });
  assert.match(d.lines[0], /^Cancel your carpet cleaning/);
});

test('coverage: estates inside a listed county are served (Ruaka, Kiambu); Nakuru is not', async () => {
  assert.match((await talk(['Do you come to Ruaka?'])).lines[0], /Ruaka is on our list/);
  assert.match((await talk(['Mnahudumia Kikuyu?'])).lines[0], /Kikuyu iko kwenye orodha/);
  assert.match((await talk(['Do you come to Nakuru?'])).lines[0], /Nakuru isn't on our list/);
});

test('names: spelled out, nicknames, towns never taken as names', () => {
  const n = (t) => V2.nlu.extractName(t, { prompted: true });
  assert.equal(n("It's Wanjiru, W-A-N-J-I-R-U."), 'Wanjiru');
  assert.equal(n('Just call me Shiro.'), 'Shiro');
  assert.equal(n('Niite Mwas.'), 'Mwas');
  assert.equal(n('Ni Kamau, lakini wananiita Kim.'), 'Kamau');
  assert.equal(n('Kisumu.'), null);
});

test('noise, hold and "are you a bot?" keep every slot and re-ask the open question', async () => {
  const a = await talk(['I want to book sofa cleaning on Friday at 10am.', '[inaudible]', 'Hold on a sec.', 'Are you a bot?', 'Kitengela']);
  assert.match(a.lines[1], /^Sorry, I didn't catch that\. Where should we come\?$/);
  assert.match(a.lines[2], /take your time\. Where should we come\?$/i);
  assert.match(a.lines[3], /virtual assistant.*Where should we come\?$/);
  assert.equal(a.st.slots.place, 'Kitengela');
  assert.match((await talk(['Wewe ni robot?'])).lines[0], /msaidizi wa kidijitali/);
});

test('read-back: "No wait, actually yes" books; a barge-in correction re-reads', async () => {
  const a = await talk(['Book sofa cleaning Friday at 10am.', 'Kitengela', 'Alvin', 'No wait, actually yes, book it.']);
  assert.match(a.lines[3], /^Done, your sofa cleaning is booked/);
  const b = await talk(['Book sofa cleaning Friday at 10am.', 'Kitengela', 'Alvin', 'Wait, wait, no, Saturday.']);
  assert.match(b.lines[3], /Saturday 17 October.*Shall I book it\?$/);
});
