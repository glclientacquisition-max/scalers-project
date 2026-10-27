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
  assert.match(b.lines[0], /(?:800|eight hundred).*Where should we come\?/i);
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

test('read-back: an exact repeat of the time is a yes (Alvin, option b); another time is a change; a day alone gets one yes/no re-ask', async () => {
  const a = await talk(['Book sofa cleaning Friday at 10am.', 'Kitengela', 'Alvin', 'Uh, 10am.']);
  assert.match(a.lines[3], /^Done, your sofa cleaning is booked for Friday 16 October at 10:00/);
  const b = await talk(['Nataka sofa cleaning Ijumaa saa nne asubuhi.', 'Ruiru', 'Otieno', 'Eeh, saa 4.']);
  assert.match(b.lines[3], /nimeweka Sofa Cleaning/);
  const c = await talk(['Book sofa cleaning Friday at 10am.', 'Kitengela', 'Alvin', '11am.']);
  assert.match(c.lines[3], /at 11:00 in Kitengela.*Shall I book it\?$/); assert.ok(!c.out[3].toolResults.length, 'a different time never writes');
  const d = await talk(['Book sofa cleaning Friday at 10am.', 'Kitengela', 'Alvin', 'Friday.', 'Yes.']);
  assert.match(d.lines[3], /^Please say yes or no: shall I book it\?$/); assert.match(d.lines[4], /^Done/);
  const e = await talk(['Nataka sofa cleaning Ijumaa saa nne asubuhi.', 'Ruiru', 'Otieno', 'Hmm, sijui.', 'Poa.']);
  assert.match(e.lines[3], /^Tafadhali sema ndio au hapana: nithibitishe\?$/); assert.match(e.lines[4], /nimeweka/);
});

test('"next Friday" while this Friday is ahead: asked once naming both dates; on a Friday it is not asked', async () => {
  const a = await talk(['Book carpet cleaning next Friday at 10am.', 'The 23rd.', 'Kitengela', 'Alvin']);
  assert.match(a.lines[0], /^Do you mean this Friday the 16th, or Friday the 23rd\?$/);
  assert.match(a.lines[3], /Friday 23 October at 10:00/);
  const b = await talk(['Nataka carpet cleaning Ijumaa ijayo saa nne asubuhi.', 'Tarehe 16.', 'Ruiru', 'Otieno']);
  assert.match(b.lines[0], /^Unamaanisha Ijumaa hii tarehe 16, au Ijumaa ijayo tarehe 23\?$/);
  assert.match(b.lines[3], /Ijumaa 16 Oktoba/);
  const c = await talk(['Book carpet cleaning next Friday at 10am.'], { now: new Date('2026-10-16T05:00:00Z') });
  assert.doesNotMatch(c.lines[0], /Do you mean/);
});

test('"right now" near closing gets the closing time and another day', async () => {
  const sat1730 = new Date('2026-10-17T14:30:00Z');
  assert.match((await talk(['Can someone come right now for sofa cleaning?'], { now: sat1730 })).lines[0], /^We close at 18:00 today, so we can't come right now\. What other day would you like\?$/);
  assert.match((await talk(['Mtu anaweza kuja sasa hivi kwa sofa cleaning?'], { now: sat1730 })).lines[0], /^Leo tunafunga saa kumi na mbili jioni/);
  assert.match((await talk(['Can someone come right now for sofa cleaning?'])).lines[0], /^Where should we come\?$/, 'at 08:00 now is within hours');
});

test('HD_89aa48bf657f: plain service categories, explain without push, no early name ask, close on thanks', async () => {
  const r = await talk(['Nilikuwa nataka ku- make something like a booking.', 'Uniambie usasi gani mnafanya.']);
  assert.match(r.lines[1], /^Tunafanya usafi wa magodoro, sofa, mazulia.*usafi wa nyumba kulingana na ukubwa.*usafi wa kina.*maofisi\. Ungependa ipi\?$/);
  assert.doesNotMatch(r.lines.join(' '), /jina|1-Bedroom|move-in move-out/i);
  const e = await talk(['What services do you offer?']);
  assert.match(e.lines[0], /^We do mattresses, sofas, carpets, windows, house cleaning by size, deep cleaning.*offices\. Which would you like\?$/);
  const x = await talk(["I don't understand what you're saying by 1-Bedroom."]);
  assert.equal(x.lines[0], 'It means cleaning a one-bedroom home: dusting, mopping, the bathroom and the kitchen.');
  const s = await talk(['Maana ya post-construction ni nini?']);
  assert.match(s.lines[0], /^Ni usafi baada ya ujenzi/);
  const c = await talk(['Nataka booking.', 'Sofa', 'Okay, thank you.']);
  assert.match(c.lines[2], /Goodbye|Kwaheri/i);
});

test('topic context: "what exactly... which" right after a services answer is a services follow-up', async () => {
  const r = await talk(['What services do you offer?', 'What exactly do you clean, which ones?']);
  assert.match(r.lines[1], /^Mattresses, sofas, carpets.*homes with one, two or three bedrooms.*offices\. Which would you like\?$/);
  const s = await talk(['Mnafanya huduma gani?', 'Zipi hasa?']);
  assert.match(s.lines[1], /^Usafi wa magodoro.*nyumba ya vyumba kimoja, viwili, vitatu.*Ungependa ipi\?$/);
  const e = await talk(['What services do you offer?', 'Which one is the deep cleaning?']);
  assert.match(e.lines[1], /^It means a more thorough clean/);
  const n = await talk(['Which day are you open?']);
  assert.doesNotMatch(n.lines[0], /Mattresses|Which would you like/, 'no topic, no follow-up');
});

test('area clarify: only ambiguity groups that touch the tenant places', async () => {
  const N = require('../src/conversation/v2/nlu');
  const g = N.areaAmbiguity('in Rongai', DD);
  assert.deepEqual(g.options.map((o) => `${o.name}/${o.county}/${o.listed}`), ['Ongata Rongai/Kajiado/true', 'Rongai/Nakuru/false']);
  assert.equal(N.areaAmbiguity('in Ongata Rongai', DD), null, 'full name said');
  assert.equal(N.areaAmbiguity('Rongai, Nakuru', DD), null, 'county said');
  assert.equal(N.areaAmbiguity('in Kiambu', DD), null, 'same county, not ambiguous');
  const far = { ...DD, serviceAreas: { areas: [{ id: 'county:mombasa' }] } };
  assert.equal(N.areaAmbiguity('in Rongai', far), null, 'group does not touch our places');
  const r = await talk(['Book sofa cleaning tomorrow at 10am in Rongai.', 'Kajiado', 'Alvin']);
  assert.equal(r.lines[0], 'Is that Ongata Rongai in Kajiado or Rongai in Nakuru?');
  assert.match(r.lines[2], /in Ongata Rongai, for Alvin\. Shall I book it\?$/);
  const s = await talk(['Mnafika Rongai?', 'Nakuru']);
  assert.match(s.lines[1], /^Nakuru haiko kwenye orodha/);
});
