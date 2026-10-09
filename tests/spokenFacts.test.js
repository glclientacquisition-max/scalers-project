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
  it('has exactly Brain\'s templates (fact-lines daebc5d9)', () => {
    assert.deepEqual([...TEMPLATES].sort(), ['ask_area', 'ask_need', 'confirm_identity_first', 'more_open', 'move_ok', 'past_open', 'past_row', 'reask_slot', 'request_open', 'requested_at', 'saved_item', 'saved_none', 'team_will_confirm', 'visit_open', 'visit_updated']);
    // Every Brain template has Voice wording (no silent fallback).
    const brain = Object.keys(require('../src/conversation/factLine').TEMPLATES).sort();
    assert.deepEqual(brain, [...TEMPLATES].sort());
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
    assert.equal(line('request_open', 'en', { kind: 'enquiry', item: 'Mansion Cleaning Custom Quote' }), 'You have an open enquiry about Mansion Cleaning Custom Quote.');
    assert.equal(line('request_open', 'sw', { kind: 'enquiry', item: 'Mansion Cleaning Custom Quote' }), 'Una ombi kuhusu Mansion Cleaning Custom Quote.');
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
  it('more_open: current open requests only; count 1 is singular; Kiswahili counts agree with maombi', () => {
    assert.equal(line('more_open', 'en', { count: 1 }), 'There is one more open request on file.');
    assert.equal(line('more_open', 'en', { count: 3 }), 'There are 3 more open requests on file.');
    assert.equal(line('more_open', 'sw', { count: 1 }), 'Kuna ombi lingine moja kwenye faili.');
    assert.equal(line('more_open', 'sw', { count: 2 }), 'Kuna maombi mengine mawili kwenye faili.');
    assert.equal(line('more_open', 'sw', { count: 5 }), 'Kuna maombi mengine matano kwenye faili.');
    assert.equal(line('more_open', 'sw', { count: 6 }), 'Kuna maombi mengine sita kwenye faili.');
    assert.equal(line('more_open', 'sw', { count: 8 }), 'Kuna maombi mengine manane kwenye faili.');
    assert.equal(line('more_open', 'sw', { count: 12 }), 'Kuna maombi mengine kumi na mawili kwenye faili.');
    assert.equal(line('more_open', 'sheng', { count: 4 }), 'Kuna requests zingine 4 kwa file.');
    assert.equal(line('more_open', 'sheng', { count: 1 }), 'Kuna request ingine moja kwa file.');
  });
  it('request_open says the kind once (HD_ceba9d9b3f37: "open enquiry for Water bowl enquiry")', () => {
    assert.equal(line('request_open', 'en', { kind: 'enquiry', item: 'Water bowl enquiry' }), 'You have an open enquiry about water bowl.');
    assert.equal(line('request_open', 'en', { kind: 'callback', item: 'Dishwashing enquiry' }), 'You have a callback request about dishwashing.');
    assert.equal(line('request_open', 'en', { kind: 'callback', item: 'Carpet cleaning outside coverage' }), 'You have a callback request about carpet cleaning outside coverage.');
    assert.equal(line('request_open', 'en', { kind: 'enquiry', item: 'Enquiry about dog food' }), 'You have an open enquiry about dog food.');
    assert.equal(line('request_open', 'en', { kind: 'callback', item: 'Callback request' }), 'You have a callback request.');
    assert.equal(line('request_open', 'sw', { kind: 'enquiry', item: 'Water bowl enquiry' }), 'Una ombi kuhusu water bowl.');
    assert.equal(line('request_open', 'sheng', { kind: 'enquiry', item: 'Water bowl enquiry' }), 'Uko na enquiry kuhusu water bowl.');
    for (const lang of ['en', 'sw', 'sheng']) {
      for (const kind of ['enquiry', 'callback', 'hold', 'order']) {
        const said = line('request_open', lang, { kind, item: 'Water bowl enquiry' });
        assert.doesNotMatch(said, /enquiry.*enquiry|bowl enquiry/i, `${lang}/${kind}: ${said}`);
      }
    }
  });
  it('more_open with no, zero or bad count returns null (Brain falls back)', () => {
    assert.equal(line('more_open', 'en', {}), null);
    assert.equal(line('more_open', 'en', { count: 0 }), null);
    assert.equal(line('more_open', 'sw', { count: 'many' }), null);
    assert.equal(line('more_open', 'sw', { count: 2.5 }), null);
  });
});

describe('fact-lines 3808c04e: past_open, past_row, reask_slot, ask_area (HD_1677e57f73f9)', () => {
  const withD199 = (fn) => {
    const prev = process.env.BRAIN_CALL_FIXES_D199;
    process.env.BRAIN_CALL_FIXES_D199 = 'on';
    try {
      return fn();
    } finally {
      if (prev == null) delete process.env.BRAIN_CALL_FIXES_D199;
      else process.env.BRAIN_CALL_FIXES_D199 = prev;
    }
  };
  it('past_open is a count only, never "open" or "upcoming"', () => {
    assert.equal(line('past_open', 'en', { count: 1 }), 'There is one past-dated request the team still has to confirm.');
    assert.equal(line('past_open', 'en', { count: 19 }), 'There are 19 past-dated requests the team still has to confirm.');
    assert.equal(line('past_open', 'sw', { count: 1 }), 'Kuna ombi moja la tarehe iliyopita ambalo timu bado haijathibitisha.');
    assert.equal(line('past_open', 'sw', { count: 3 }), 'Kuna maombi matatu ya tarehe zilizopita ambayo timu bado haijathibitisha.');
    assert.equal(line('past_open', 'sheng', { count: 3 }), 'Kuna requests 3 za date zimepita ambazo team bado haija-confirm.');
    for (const bad of [{}, { count: 0 }, { count: 'x' }]) assert.equal(line('past_open', 'en', bad), null);
  });
  it('past_row says the row has passed and was not confirmed', () => {
    const FRI_9_TEXT = at('2026-10-09T06:00:00Z');
    assert.equal(
      line('past_row', 'en', { kind: 'visit', job: 'Carpet Cleaning', when: FRI_9_TEXT, place: 'Kitengela' }),
      'The Carpet Cleaning visit request for today, Friday, at 9 AM, Kitengela, has passed and was not confirmed.'
    );
    assert.equal(
      line('past_row', 'sw', { kind: 'visit', job: 'Carpet Cleaning', when: FRI_9_TEXT, place: 'Kitengela' }),
      'Ombi la ziara ya Carpet Cleaning, leo Ijumaa, saa tatu asubuhi, Kitengela limepita na halikuthibitishwa.'
    );
    assert.equal(line('past_row', 'en', { kind: 'visit', job: 'Carpet Cleaning' }), 'The Carpet Cleaning visit request has passed and was not confirmed.');
    // Brain sends a request row's type as kind; the item is said once.
    assert.equal(line('past_row', 'en', { kind: 'enquiry', job: 'Water bowl enquiry' }), 'The request about water bowl has passed and was not confirmed.');
    assert.equal(line('past_row', 'sw', { kind: 'callback', job: 'Water bowl enquiry' }), 'Ombi kuhusu water bowl limepita na halikuthibitishwa.');
    assert.equal(line('past_row', 'sheng', { kind: 'visit', job: 'Carpet Cleaning' }), 'Carpet Cleaning visit request imepita na haikuconfirmiwa.');
    for (const lang of ['en', 'sw', 'sheng']) {
      const said = line('past_row', lang, { kind: 'visit', job: 'Carpet Cleaning', when: FRI_9_TEXT });
      assert.doesNotMatch(said, /\b(open|upcoming|booked|iko open)\b/i, said);
    }
    assert.equal(line('past_row', 'en', { kind: 'visit' }), null);
  });
  it('reask_slot when: the visit time ask; AM/PM in Swahili clock words for a pending hour', () =>
    withD199(() => {
      assert.equal(line('reask_slot', 'en', { slot: 'when', day: 'today' }), 'What time today?');
      assert.equal(line('reask_slot', 'sw', { slot: 'when', day: 'leo' }), 'Saa ngapi leo?');
      assert.equal(line('reask_slot', 'sheng', { slot: 'when', day: 'leo' }), 'Ni time gani leo?');
      assert.equal(line('reask_slot', 'en', { slot: 'when', day: 'today', ask_count: 2 }), 'Morning or afternoon?');
      assert.equal(line('reask_slot', 'sw', { slot: 'when', ask_count: 2 }), 'Asubuhi au mchana?');
      assert.equal(line('reask_slot', 'sheng', { slot: 'when', ask_count: 2 }), 'Asubuhi ama mchana?');
      assert.equal(line('reask_slot', 'en', { slot: 'when', pending_hour: 8 }), '8 in the morning or in the afternoon?');
      const sw8 = line('reask_slot', 'sw', { slot: 'when', day: 'leo', pending_hour: 8 });
      assert.match(sw8, /^Saa \p{L}+/u);
      assert.doesNotMatch(sw8, /\d/, 'Swahili clock in words');
      assert.equal(line('reask_slot', 'sheng', { slot: 'when', pending_hour: 8 }), sw8);
      assert.equal(line('reask_slot', 'en', { slot: 'location' }), 'Where should we come?');
      assert.equal(line('reask_slot', 'sw', { slot: 'location' }), 'Tuje wapi?');
      assert.equal(line('reask_slot', 'sheng', { slot: 'location' }), 'Tukuje wapi?');
      assert.equal(line('reask_slot', 'en', { slot: 'price' }), null);
      assert.equal(line('reask_slot', 'en', {}), null);
    }));
  it('ask_area makes no coverage claim', () => {
    assert.equal(line('ask_area', 'en', {}), 'Which area are you in?');
    assert.equal(line('ask_area', 'sw', {}), 'Uko eneo gani?');
    assert.equal(line('ask_area', 'sheng', {}), 'Uko area gani?');
  });
});

describe('fact-lines daebc5d9: ask_need (Aris HD_d3900cbf2b2d)', () => {
  it('asks what the caller needs, en/sw/sheng, one question, nothing saved or promised', () => {
    assert.equal(line('ask_need', 'en', {}), 'Sure, what would you like to know?');
    assert.equal(line('ask_need', 'sw', {}), 'Sawa, ungependa kujua nini?');
    assert.equal(line('ask_need', 'sheng', {}), 'Poa, unataka kujua nini?');
    for (const lang of ['en', 'sw', 'sheng']) {
      const text = line('ask_need', lang, {});
      assert.equal((text.match(/\?/g) || []).length, 1, text);
      assert.doesNotMatch(text, /saved|hifadhi|save|request|ombi/i, text);
    }
  });
  it('Voice wording wins over Brain\'s fallback (no silent fallback)', () => {
    const { fallbackLine } = require('../src/conversation/factLine');
    if (typeof fallbackLine === 'function') {
      assert.ok(fallbackLine({ template: 'ask_need', lang: 'en', slots: {} }));
    }
    assert.ok(renderFactLine({ template: 'ask_need', lang: 'sw', slots: {} }));
  });
});
