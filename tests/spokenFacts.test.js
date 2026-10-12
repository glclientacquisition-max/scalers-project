// Spoken-facts contract with Brain (docs/specs/fact-lines.md, 58f31fb3 on
// brain/call-fixes-d199): renderFactLine / renderFact. HD_d199dbbf6b79.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { renderFactLine, renderFact, spokenFactsEnabled, TEMPLATES } = require('../src/speech/spokenFacts');

const NOW = '2026-10-09T08:43:00Z'; // Friday 11:43 EAT
const at = (iso, precision = 'time') => ({ iso, precision }); // Brain's slot shape (no type)
const SAT_9 = at('2026-10-10T06:00:00Z');
const FRI_9 = at('2026-10-09T06:00:00Z');
const ASKED = at('2026-10-08T13:47:30Z'); // Thursday 16:47 EAT
const line = (template, lang, slots) => renderFactLine({ template, lang, slots }, { now: NOW });

describe('renderFact', () => {
  it('datetime time: relative day + weekday + clock', () => {
    assert.equal(renderFact(SAT_9, 'sw', { now: NOW }), 'kesho Jumamosi, saa tatu asubuhi');
    assert.equal(renderFact(SAT_9, 'en', { now: NOW }), 'tomorrow, Saturday, at 9 AM');
    assert.equal(renderFact(SAT_9, 'sheng', { now: NOW }), 'kesho Saturday, 9 AM');
    assert.equal(renderFact(FRI_9, 'sw', { now: NOW }), 'leo Ijumaa, saa tatu asubuhi');
    assert.equal(renderFact(at('2026-10-13T06:30:00Z'), 'sw', { now: NOW }), 'Jumanne, saa tatu na nusu asubuhi');
    assert.equal(renderFact(at('2026-10-20T13:00:00Z'), 'en', { now: NOW }), 'Tuesday, 20 October, at 4 PM');
    assert.equal(renderFact(at('2026-10-20T13:00:00Z'), 'sw', { now: NOW }), 'Jumanne tarehe 20 Oktoba, saa kumi jioni');
  });
  it('datetime day precision', () => {
    assert.equal(renderFact(at('2026-10-10T06:00:00Z', 'day'), 'en', { now: NOW }), 'tomorrow, Saturday');
    assert.equal(renderFact(at('2026-10-10T06:00:00Z', 'day'), 'sw', { now: NOW }), 'kesho Jumamosi');
  });
  it('a legacy typed slot still renders', () => {
    assert.equal(renderFact({ type: 'datetime', iso: '2026-10-10T06:00:00Z', precision: 'time' }, 'sw', { now: NOW }), 'kesho Jumamosi, saa tatu asubuhi');
  });
  it('when_text without an iso is read as is; Kiswahili gets the Kiswahili clock', () => {
    const when = { text: 'Friday 9 October 2026, 9 AM' };
    assert.equal(renderFact(when, 'en'), 'Friday 9 October 2026, 9 AM');
    assert.equal(renderFact(when, 'sw'), 'Ijumaa 9 Oktoba 2026, saa tatu asubuhi');
    assert.equal(renderFact({ iso: 'bad' }, 'en'), null);
  });
  it('requested_at is relative (precision relative, or the requested_at slot)', () => {
    assert.equal(renderFact(at('2026-10-08T13:47:30Z', 'relative'), 'sw', { now: NOW }), 'jana jioni');
    assert.equal(renderFact(at('2026-10-08T13:47:30Z', 'relative'), 'en', { now: NOW }), 'yesterday at 4:47 PM');
    assert.equal(renderFact(ASKED, 'sw', { now: NOW, role: 'requested_at' }), 'jana jioni');
    assert.equal(renderFact(ASKED, 'en', { now: NOW, role: 'requested_at' }), 'yesterday at 4:47 PM');
  });
  it('KES money: fixed, from, range', () => {
    assert.equal(renderFact({ type: 'money', minor: 20000, currency: 'KES' }, 'en'), '200 shillings');
    assert.equal(renderFact({ type: 'money', minor: 20000, currency: 'KES' }, 'sw'), 'shilingi mia mbili');
    assert.equal(renderFact({ type: 'money', minor: 600000, currency: 'KES', mode: 'from' }, 'sw'), 'kuanzia shilingi elfu sita');
    assert.equal(renderFact({ type: 'money', minor: 150000, max_minor: 250000, currency: 'KES', mode: 'range' }, 'en'), '1,500 to 2,500 shillings');
    assert.equal(renderFact({ type: 'money', minor: 100, currency: 'USD' }, 'en'), null);
    // Brain's shape: no type, mode exact/from/range.
    assert.equal(renderFact({ minor: 20000, currency: 'KES', mode: 'exact' }, 'sw'), 'shilingi mia mbili');
    assert.equal(renderFact({ minor: 150000, max_minor: 250000, currency: 'KES', mode: 'range' }, 'sw'), 'shilingi elfu moja na mia tano hadi elfu mbili na mia tano');
  });
  it('count and plain strings', () => {
    assert.equal(renderFact({ type: 'count', n: 3, unit: 'room' }, 'en'), '3 rooms');
    assert.equal(renderFact({ type: 'count', n: 1, unit: 'room' }, 'en'), '1 room');
    assert.equal(renderFact({ type: 'count', n: 3, unit: 'vyumba' }, 'sw'), 'vyumba tatu');
    assert.equal(renderFact('Kitengela', 'sw'), 'Kitengela');
  });
});

describe('renderFactLine templates (fact-lines.md)', () => {
  it('has exactly Brain\'s 8 templates', () => {
    assert.deepEqual([...TEMPLATES].sort(), ['confirm_identity_first', 'more_open', 'move_ok', 'request_open', 'requested_at', 'saved_item', 'saved_none', 'team_will_confirm', 'visit_open', 'visit_updated']);
  });
  it('move_ok needs only to_when; job and from_when are optional', () => {
    assert.equal(line('move_ok', 'sw', { to_when: SAT_9 }), 'Sawa, nimehamisha ziara hadi kesho Jumamosi, saa tatu asubuhi.');
    assert.equal(line('move_ok', 'en', { to_when: SAT_9, job: 'Carpet Cleaning' }), "Done, I've moved your Carpet Cleaning visit to tomorrow, Saturday, at 9 AM.");
    assert.equal(
      line('move_ok', 'sw', { to_when: SAT_9, job: 'Carpet Cleaning', from_when: FRI_9 }),
      'Sawa, nimehamisha ziara ya Carpet Cleaning kutoka leo Ijumaa, saa tatu asubuhi hadi kesho Jumamosi, saa tatu asubuhi.'
    );
    assert.equal(line('move_ok', 'sheng', { to_when: SAT_9 }), 'Poa, nime-move visit hadi kesho Saturday, 9 AM.');
  });
  it('visit_updated never says moved', () => {
    for (const lang of ['en', 'sw', 'sheng']) {
      for (const slots of [{}, { place: 'Kitengela' }, { to_when: SAT_9 }]) {
        const text = line('visit_updated', lang, slots);
        assert.ok(text, `${lang} ${JSON.stringify(slots)}`);
        assert.doesNotMatch(text, /\bmov|hamish|songez/i, text);
      }
    }
    assert.equal(line('visit_updated', 'en', { place: 'Kitengela' }), "Okay, I've updated that visit to Kitengela.");
  });
  it('saved_item never says moved, even with moved: true (only move_ok does)', () => {
    for (const lang of ['en', 'sw', 'sheng']) {
      for (const moved of [true, false, undefined]) {
        const text = line('saved_item', lang, { kind: 'visit', job: 'Carpet Cleaning', when: SAT_9, place: 'Kitengela', moved });
        assert.ok(text, `${lang} ${moved}`);
        assert.doesNotMatch(text, /\bmov|hamish|songez/i, text);
        assert.match(text, /saved|hifadhi|save/i, text);
      }
    }
    assert.equal(line('saved_item', 'sw', { kind: 'visit', job: 'Carpet Cleaning', when: SAT_9, moved: true }), 'Nimehifadhi ombi la ziara ya Carpet Cleaning, kesho Jumamosi, saa tatu asubuhi.');
    assert.equal(line('saved_item', 'sheng', { kind: 'visit', job: 'Carpet Cleaning', when: SAT_9, moved: true }), 'Nime-save Carpet Cleaning visit request, kesho Saturday, 9 AM.');
  });
  it('visit_open and request_open (HD_d199: the mansion quote)', () => {
    assert.equal(
      line('visit_open', 'sw', { job: 'Carpet Cleaning', status: 'requested', when: FRI_9, place: 'Kitengela' }),
      'Una ombi la ziara ya Carpet Cleaning, leo Ijumaa, saa tatu asubuhi, Kitengela.'
    );
    assert.equal(
      line('visit_open', 'en', { job: 'Carpet Cleaning', status: 'confirmed', when: SAT_9 }),
      'You have a Carpet Cleaning visit confirmed for tomorrow, Saturday, at 9 AM.'
    );
    assert.equal(line('request_open', 'en', { kind: 'enquiry', item: 'Mansion Cleaning Custom Quote' }), 'You have an open enquiry for Mansion Cleaning Custom Quote.');
    assert.equal(line('request_open', 'sw', { kind: 'enquiry', item: 'Mansion Cleaning Custom Quote' }), 'Una ombi la Mansion Cleaning Custom Quote.');
    assert.equal(line('visit_open', 'en', { job: 'x', status: 'cancelled' }), null);
    assert.equal(line('request_open', 'en', { kind: 'quote', item: 'x' }), null);
  });
  it('requested_at, saved_item, saved_none, team_will_confirm', () => {
    assert.equal(line('requested_at', 'sw', { kind: 'visit', job: 'Carpet Cleaning', requested_at: at('2026-10-08T13:47:30Z', 'relative') }), 'Uliomba ziara ya Carpet Cleaning jana jioni.');
    assert.equal(
      line('requested_at', 'en', { kind: 'request', job: 'Mansion Cleaning Custom Quote', requested_at: at('2026-10-08T20:15:04Z', 'relative') }),
      'You sent the Mansion Cleaning Custom Quote request yesterday at 11:15 PM.'
    );
    assert.equal(line('saved_item', 'sw', { kind: 'visit', job: 'Carpet Cleaning', when: SAT_9 }), 'Nimehifadhi ombi la ziara ya Carpet Cleaning, kesho Jumamosi, saa tatu asubuhi.');
    assert.equal(line('saved_item', 'en', { kind: 'visit', job: 'Carpet Cleaning', when: SAT_9, moved: true }), "I've saved a Carpet Cleaning visit request for tomorrow, Saturday, at 9 AM.");
    assert.equal(line('saved_item', 'en', { kind: 'request', job: 'Mansion Cleaning Custom Quote' }), "I've saved a request for Mansion Cleaning Custom Quote.");
    assert.equal(line('saved_none', 'sw', {}), 'Bado sijahifadhi kitu kipya kwenye simu hii.');
    assert.equal(line('team_will_confirm', 'en', {}), 'The team will confirm the time with you.');
  });
  it('unknown template or missing required slot returns null', () => {
    assert.equal(line('nope', 'en', {}), null);
    assert.equal(line('toString', 'en', {}), null);
    assert.equal(line('move_ok', 'en', { job: 'x' }), null);
    assert.equal(line('move_ok', 'en', { to_when: { iso: 'not a date' } }), null);
    assert.equal(line('saved_item', 'en', { kind: 'thing', job: 'x' }), null);
    assert.equal(line('requested_at', 'en', { kind: 'visit', job: 'x' }), null);
    assert.equal(renderFactLine(null), null);
  });
  it('flag is on only for exactly "on"', () => {
    assert.equal(spokenFactsEnabled({ VOICE_SPOKEN_FACTS: 'on' }), true);
    assert.equal(spokenFactsEnabled({ VOICE_SPOKEN_FACTS: 'true' }), false);
    assert.equal(spokenFactsEnabled({}), false);
  });
});

// 5397e87c: confirm_identity_first and more_open (HD_1b3a67ea7ee9).
describe('confirm_identity_first and more_open', () => {
  it('confirm_identity_first carries the name ask only with ask: true and a name', () => {
    assert.equal(line('confirm_identity_first', 'en', { name: 'Wanjiku', ask: true }), "Let me just confirm who I'm speaking with, is this Wanjiku?");
    assert.equal(line('confirm_identity_first', 'sw', { name: 'Wanjiku', ask: true }), 'Wacha nithibitishe kwanza, naongea na Wanjiku?');
    assert.equal(line('confirm_identity_first', 'sheng', { name: 'Wanjiku', ask: true }), 'Wacha ni-confirm kwanza, naongea na Wanjiku?');
    // Ask already spoken on this call: never asked twice.
    assert.equal(line('confirm_identity_first', 'en', { name: 'Wanjiku', ask: false }), "Let me just confirm who I'm speaking with first.");
    assert.equal(line('confirm_identity_first', 'sw', { name: 'Wanjiku', ask: false }), 'Wacha nithibitishe kwanza naongea na nani.');
    assert.equal(line('confirm_identity_first', 'sheng', {}), 'Wacha ni-confirm kwanza naongea na nani.');
    // ask without a name has nothing to ask.
    assert.equal(line('confirm_identity_first', 'en', { ask: true }), "Let me just confirm who I'm speaking with first.");
    for (const lang of ['en', 'sw', 'sheng']) {
      const out = line('confirm_identity_first', lang, { name: 'Wanjiku', ask: true });
      assert.doesNotMatch(out, /no (bookings?|records?|visits?)|hakuna/i);
      assert.equal(out.split(/[.?!]\s/).length, 1, out);
    }
  });
  it('more_open: count 1 is singular; Kiswahili counts agree with maombi', () => {
    assert.equal(line('more_open', 'en', { count: 1 }), 'There is one older open item on file too.');
    assert.equal(line('more_open', 'en', { count: 3 }), 'There are 3 older open items on file too.');
    assert.equal(line('more_open', 'sw', { count: 1 }), 'Pia kuna ombi lingine moja la zamani lililo wazi kwenye faili.');
    assert.equal(line('more_open', 'sw', { count: 2 }), 'Pia kuna maombi mengine mawili ya zamani yaliyo wazi kwenye faili.');
    assert.equal(line('more_open', 'sw', { count: 5 }), 'Pia kuna maombi mengine matano ya zamani yaliyo wazi kwenye faili.');
    assert.equal(line('more_open', 'sw', { count: 6 }), 'Pia kuna maombi mengine sita ya zamani yaliyo wazi kwenye faili.');
    assert.equal(line('more_open', 'sw', { count: 8 }), 'Pia kuna maombi mengine manane ya zamani yaliyo wazi kwenye faili.');
    assert.equal(line('more_open', 'sw', { count: 12 }), 'Pia kuna maombi mengine kumi na mawili ya zamani yaliyo wazi kwenye faili.');
    assert.equal(line('more_open', 'sheng', { count: 4 }), 'Pia kuna vitu zingine 4 za zamani ziko open kwa file.');
  });
  it('more_open with no, zero or bad count returns null (Brain falls back)', () => {
    assert.equal(line('more_open', 'en', {}), null);
    assert.equal(line('more_open', 'en', { count: 0 }), null);
    assert.equal(line('more_open', 'sw', { count: 'many' }), null);
    assert.equal(line('more_open', 'sw', { count: 2.5 }), null);
  });
});
