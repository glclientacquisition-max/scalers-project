'use strict';
// v2 edge-case generator: combinatorial templates x seeded CheckList-style perturbations,
// with optional cached Gemini paraphrases (synthetic text only; never call data).
//   const { generate } = require('./gen'); generate({ seed: 7, paraphrases })
// Each case: fixed fake clock (now), persona language, exact STT opening + 3-5 variants,
// expected booking row OR expected clarifying question (mustSay), and a `cat` tag.
// Templates are inspired by Duckling (BSD) / SUTime (GPL; patterns only, no code or data
// copied) temporal test themes and CheckList (MIT) MFT/INV/DIR test types.
const { rngFor } = require('../lib/rng');
const { langOf: langOfLine } = require('../lib/score');

const CLK = {
  WED0800: '2026-10-14T05:00:00Z', WED1500: '2026-10-14T12:00:00Z', THU0030: '2026-10-14T21:30:00Z',
  THU0530: '2026-10-15T02:30:00Z', FRI0100: '2026-10-15T22:00:00Z', SAT1730: '2026-10-17T14:30:00Z',
};
const NAMES = ['Alvin', 'Wanjiru', 'Otieno', 'Achieng', 'Kamau', 'Njeri'];
const PLACES = ['Kitengela', 'Ruiru', 'Syokimau', 'Juja', 'Kasarani', 'Kilimani'];
const SVC = [['sofa cleaning', 'sofa', 'sofa'], ['carpet cleaning', 'carpet', 'carpet'], ['mattress cleaning', 'godoro', 'mattress'], ['window cleaning', 'madirisha', 'window']];

// ---- CheckList INV perturbations of one exact STT line -> 3-5 variants (index 0 = exact)
const TYPO = [[/tomorrow/i, 'tommorow'], [/\bkesho\b/i, 'keshoo'], [/cleaning/i, 'cleanin'], [/\bbook\b/i, 'bukk'], [/Friday/i, 'friday'], [/\bnataka\b/i, 'natakaa']];
function perturb(line, lang, r, extra = []) {
  const out = [line];
  out.push(line.toLowerCase().replace(/[,.!?]/g, '')); // ASR style: no case, no punctuation
  out.push((lang === 'en' ? 'Uh, ' : 'Eeh, ') + line.charAt(0).toLowerCase() + line.slice(1)); // disfluency
  const ty = TYPO.find(([re]) => re.test(line)); if (ty) out.push(line.replace(ty[0], ty[1]));
  if (lang !== 'en') out.push(`Sasa, ${line.charAt(0).toLowerCase()}${line.slice(1)}`); else out.push(`Hi, ${line.charAt(0).toLowerCase()}${line.slice(1)}`); // code-switch greeting
  for (const e of extra) out.push(e);
  return [...new Set(out)].slice(0, 5 + extra.length).filter(Boolean);
}
const pick = (xs, r) => xs[Math.floor(r() * xs.length)];
const SW = (l) => l !== 'en';

function generate({ seed = 7, paraphrases = {}, perTemplateCap = 40 } = {}) {
  const r = rngFor('edge-gen', seed);
  const cases = [];
  let n = 0;
  const add = (cat, rootHint, c) => {
    const id = `E${String(++n).padStart(3, '0')}_${cat}_${c.lang}`;
    // paraphrases that switch language are kept as code-switch variants, except where the case asserts exact wording
    const para = (t) => (paraphrases[t] || []).filter((p) => !(c.mustSay || []).length || (langOfLine(p) === (c.lang === 'en' ? 'en' : 'sw')));
    const turns = (c.turns || []).map((t, i) => (Array.isArray(t) ? t : i === 0 && !c.noPerturb ? perturb(t, c.lang, r, para(t)) : t));
    cases.push({ tenant: 'done_and_dusted', commitment: !!(c.expect && (c.expect.appointment || c.expect.appointments > 0 || c.expect.rowStatus)), ...c, id, area: cat, cat, rootHint, turns });
  };
  const fac = (lang, o = {}) => ({ name: o.name || pick(NAMES, r), place: o.place || pick(PLACES, r), when: o.when, ...o.facts });

  // ===== A. dates / times =====
  // A1 kesho/tomorrow small hours (00:00-05:59): confirm once, with weekday AND date
  for (const [clk, today, tom, tdN, tmN] of [['THU0030', 'Thursday', 'Friday', '15', '16'], ['THU0530', 'Thursday', 'Friday', '15', '16'], ['FRI0100', 'Friday', 'Saturday', '16', '17']]) {
    const dd = { Thursday: '2026-10-15', Friday: '2026-10-16', Saturday: '2026-10-17' };
    const swd = { Thursday: 'Alhamisi', Friday: 'Ijumaa', Saturday: 'Jumamosi' };
    for (const lang of ['en', 'sw', 'sheng']) for (const ans of ['today', 'tomorrow']) {
      const [svcEn, svcSw, key] = pick(SVC, r);
      const open = lang === 'en' ? `I want to book ${svcEn} tomorrow at 2pm.` : lang === 'sw' ? `Nataka kubook ${svcEn} kesho saa nane mchana.` : `Niaje, nataka ku-book ${svcEn} kesho saa nane mchana.`;
      const kAns = ans === 'today' ? (SW(lang) ? [`Leo ${swd[today]}.`, 'Leo mchana.'] : [`Later today, ${today}.`, 'Today.']) : (SW(lang) ? [`${swd[tom]}.`, `Kesho ${swd[tom]}.`] : [`${tom}.`, `${tom}, the ${tmN}th.`]);
      add('kesho_small_hours', 'date.kesho_small_hours', { lang, now: CLK[clk], turns: [open], facts: { ...fac(lang), kesho: kAns, when: SW(lang) ? 'saa nane mchana' : '2pm' },
        mustSay: [SW(lang) ? `(Unamaanisha|${swd[today]}).*${tdN}` : `(Do you mean|${today}).*${tdN}`],
        expect: { appointments: 1, appointment: { service: key, startEAT: `${dd[ans === 'today' ? today : tom]} 14:00` } } });
    }
  }
  // A2 keshokutwa / day after tomorrow (Wed 08:00 -> Fri 16)
  for (const lang of ['en', 'sw', 'sheng']) for (const t of ['10am', 'saa nne asubuhi']) {
    if (lang === 'en' && t !== '10am') continue;
    const [svcEn, , key] = pick(SVC, r);
    const open = lang === 'en' ? `Can I book ${svcEn} the day after tomorrow at 10am?` : `${lang === 'sheng' ? 'Maze, ' : ''}Naomba kubook ${svcEn} keshokutwa saa nne asubuhi.`;
    add('keshokutwa', 'date.relative', { lang, now: CLK.WED0800, turns: [open], facts: fac(lang), expect: { appointments: 1, appointment: { service: key, startEAT: '2026-10-16 10:00' } } });
  }
  // A3 weekday names EN/SW, this vs next
  const WD = [['Friday', 'Ijumaa', '2026-10-16'], ['Saturday', 'Jumamosi', '2026-10-17'], ['Monday', 'Jumatatu', '2026-10-19'], ['Thursday', 'Alhamisi', '2026-10-15']];
  for (const [en, sw, date] of WD) for (const lang of ['en', 'sw']) {
    const [svcEn, , key] = pick(SVC, r);
    add('weekday', 'date.weekday', { lang, now: CLK.WED0800, turns: [lang === 'en' ? `I'd like ${svcEn} on ${en} at 11am.` : `Nataka ${svcEn} ${sw} saa tano asubuhi.`], facts: fac(lang), expect: { appointments: 1, appointment: { service: key, startEAT: `${date} 11:00` } } });
  }
  for (const lang of ['en', 'sw']) {
    add('this_friday', 'date.this_next', { lang, now: CLK.WED0800, turns: [lang === 'en' ? 'Book carpet cleaning this Friday at 10am.' : 'Nataka kubook carpet cleaning Ijumaa hii saa nne asubuhi.'], facts: fac(lang), expect: { appointments: 1, appointment: { service: 'carpet', startEAT: '2026-10-16 10:00' } } });
    // "next Friday" said on Wednesday is ambiguous (16th or 23rd): the read-back must name the date
    add('next_friday', 'date.this_next', { lang, now: CLK.WED0800, turns: [lang === 'en' ? 'Book carpet cleaning next Friday at 10am.' : 'Nataka kubook carpet cleaning Ijumaa ijayo saa nne asubuhi.'], facts: fac(lang), mustSay: [lang === 'en' ? 'Friday (16|23) October' : 'Ijumaa (16|23) Oktoba'], expect: { appointments: 1, appointment: { service: 'carpet', startEATAny: ['2026-10-16 10:00', '2026-10-23 10:00'] } } });
    add('next_week', 'date.next_week', { lang, now: CLK.WED0800, turns: [lang === 'en' ? 'I need sofa cleaning sometime next week.' : 'Nataka sofa cleaning wiki ijayo.'], facts: { ...fac(lang), when: lang === 'en' ? 'Monday at 10am' : 'Jumatatu saa nne asubuhi' }, mustSay: [lang === 'en' ? 'What day' : 'Siku gani'], expect: { appointments: 1, appointment: { service: 'sofa', startEAT: '2026-10-19 10:00' } } });
  }
  // A4 Swahili clock (saa N from 06:00), bare saa mbili (08:00 vs 20:00), periods
  const SWC = [['saa nane mchana', '14:00'], ['saa tatu asubuhi', '09:00'], ['saa kumi jioni', '16:00'], ['saa tano', '11:00'], ['saa nne na nusu asubuhi', '10:30'], ['saa mbili asubuhi', '08:00'], ['saa saba mchana', '13:00'], ['saa 4', '10:00']];
  for (const [phr, hh] of SWC) for (const lang of ['sw', 'sheng']) {
    const [svcEn, , key] = pick(SVC, r);
    add('sw_clock', 'time.sw_clock', { lang, now: CLK.WED0800, turns: [`${lang === 'sheng' ? 'Niaje, nimekam ku-book' : 'Nataka kubook'} ${svcEn} Ijumaa ${phr}.`], facts: fac(lang), expect: { appointments: 1, appointment: { service: key, startEAT: `2026-10-16 ${hh}` } } });
  }
  for (const lang of ['sw', 'sheng']) {
    // bare "saa mbili": 08:00 is the only open-hours reading; the read-back must say "asubuhi"
    add('saa_mbili_bare', 'time.sw_period_readback', { lang, now: CLK.WED0800, turns: ['Nataka kubook sofa cleaning Ijumaa saa mbili.'], facts: fac(lang), mustSay: ['saa mbili asubuhi'], expect: { appointments: 1, appointment: { service: 'sofa', startEAT: '2026-10-16 08:00' } } });
    // evening/night readings fall outside 08:00-18:00: say the hours, ask again
    for (const phr of ['saa mbili usiku', 'saa moja jioni', 'saa tatu usiku']) add('sw_after_hours', 'time.outside_hours', { lang, now: CLK.WED0800, turns: [`Nataka kubook sofa cleaning Ijumaa ${phr}.`], facts: { ...fac(lang), when: 'saa tatu asubuhi' }, mustSay: ['(saa mbili asubuhi|wazi|tunafunga)'], expect: { appointments: 1, appointment: { service: 'sofa', startEAT: '2026-10-16 09:00' } } });
  }
  // A5 English clock / AM-PM
  const ENC = [['at 10am', '10:00'], ['at 2pm', '14:00'], ['at 2', '14:00'], ['at half past ten', '10:30'], ['at noon', '12:00'], ['at 10:30', '10:30'], ['at 3 in the afternoon', '15:00'], ['at 9 a.m.', '09:00']];
  for (const [phr, hh] of ENC) { const [svcEn, , key] = pick(SVC, r); add('en_clock', 'time.en_clock', { lang: 'en', now: CLK.WED0800, turns: [`Book ${svcEn} on Friday ${phr}.`], facts: fac('en'), expect: { appointments: 1, appointment: { service: key, startEAT: `2026-10-16 ${hh}` } } }); }
  for (const phr of ['at 7am', 'at 8 in the evening', 'at 6pm', 'at 11pm']) add('en_after_hours', 'time.outside_hours', { lang: 'en', now: CLK.WED0800, turns: [`Book sofa cleaning on Friday ${phr}.`], facts: { ...fac('en'), when: '10am' }, mustSay: ["(open|we're open|08:00)"], expect: { appointments: 1, appointment: { service: 'sofa', startEAT: '2026-10-16 10:00' } } });
  // A6 past times today, near-close, closed day, holiday
  for (const lang of ['en', 'sw']) {
    add('past_time', 'time.past', { lang, now: CLK.WED1500, turns: [lang === 'en' ? 'Can you come today at 10am for sofa cleaning?' : 'Mnaweza kuja leo saa nne asubuhi kwa sofa cleaning?'], facts: { ...fac(lang), when: lang === 'en' ? 'tomorrow at 10am' : 'kesho saa nne asubuhi' }, mustSay: [lang === 'en' ? '(already passed|has passed|later time)' : '(imeshapita|imepita)'], expect: { appointments: 1, appointment: { service: 'sofa', startEAT: '2026-10-15 10:00' } } });
    add('closed_day', 'time.closed_day', { lang, tenant: 'dd_sun_closed', now: CLK.WED0800, turns: [lang === 'en' ? 'Book carpet cleaning on Sunday at 10am.' : 'Nataka carpet cleaning Jumapili saa nne asubuhi.'], facts: { ...fac(lang), when: lang === 'en' ? 'Monday at 10am' : 'Jumatatu saa nne asubuhi' }, mustSay: [lang === 'en' ? 'closed on Sunday' : 'Jumapili tumefunga'], expect: { appointments: 1, appointment: { service: 'carpet', startEAT: '2026-10-19 10:00' } } });
    add('holiday', 'date.holiday', { lang, now: CLK.WED0800, turns: [lang === 'en' ? 'Can you come on Mashujaa Day for carpet cleaning?' : 'Mnaweza kuja siku ya Mashujaa kwa carpet cleaning?'], facts: { ...fac(lang), when: lang === 'en' ? 'Monday at 10am' : 'Jumatatu saa nne asubuhi' }, expect: { appointments: 1, appointment: { service: 'carpet', startEAT: '2026-10-19 10:00' } } });
    add('today_late', 'time.near_close', { lang, now: CLK.SAT1730, turns: [lang === 'en' ? 'Can someone come today for sofa cleaning, like now?' : 'Mtu anaweza kuja leo sasa hivi kwa sofa cleaning?'], facts: { ...fac(lang), when: lang === 'en' ? 'Monday at 10am' : 'Jumatatu saa nne asubuhi' }, expect: { appointments: 1, appointment: { service: 'sofa', startEAT: '2026-10-19 10:00' } } });
  }

  // A7 dates by number, weekday/date conflicts, period-only times, numerals in Swahili
  for (const [line, lang, at, extra] of [
    ['Book sofa cleaning on the 16th at 10am.', 'en', '2026-10-16 10:00'], ['Book sofa cleaning on 16th October at 10am.', 'en', '2026-10-16 10:00'],
    ['Nataka sofa cleaning tarehe 16 saa nne asubuhi.', 'sw', '2026-10-16 10:00'], ['Nataka sofa cleaning tarehe kumi na sita saa nne asubuhi.', 'sw', '2026-10-16 10:00'],
    ['Book sofa cleaning Friday at two pm.', 'en', '2026-10-16 14:00'], ['Book sofa cleaning Friday at ten o\'clock.', 'en', '2026-10-16 10:00'],
    ['Nataka sofa cleaning Ijumaa saa 10 jioni.', 'sw', '2026-10-16 16:00'], ['Nataka sofa cleaning Ijumaa saa 8 mchana.', 'sw', '2026-10-16 14:00'],
    ['Book sofa cleaning Friday morning.', 'en', '2026-10-16 09:00', { when: '9am' }], ['Nataka sofa cleaning Ijumaa asubuhi.', 'sw', '2026-10-16 09:00', { when: 'saa tatu asubuhi' }],
    ['Book sofa cleaning Friday after lunch.', 'en', '2026-10-16 14:00', { when: '2pm' }], ['Nataka sofa cleaning kesho jioni.', 'sw', '2026-10-15 16:00', { when: 'saa kumi jioni' }],
  ]) add('date_time_forms', 'date.forms', { lang, now: CLK.WED0800, turns: [line], facts: { ...fac(lang), ...(extra || {}) }, expect: { appointments: 1, appointment: { service: 'sofa', startEAT: at } } });
  for (const lang of ['en', 'sw']) {
    // weekday and date disagree (Friday is the 16th): ask which, never pick silently
    add('weekday_date_conflict', 'date.conflict', { lang, now: CLK.WED0800, turns: [lang === 'en' ? 'Book sofa cleaning Friday the 17th at 10am.' : 'Nataka sofa cleaning Ijumaa tarehe 17 saa nne asubuhi.'], facts: { ...fac(lang), when: lang === 'en' ? 'Friday at 10am' : 'Ijumaa saa nne asubuhi', kesho: lang === 'en' ? ['Friday.'] : ['Ijumaa.'] }, mustSay: [lang === 'en' ? '(16th|17th|Saturday)' : '(tarehe 16|tarehe 17|Jumamosi)'], expect: { appointments: 1, appointment: { service: 'sofa', startEAT: '2026-10-16 10:00' } } });
    add('tonight', 'time.outside_hours', { lang, now: CLK.WED0800, turns: [lang === 'en' ? 'Can you come tonight for sofa cleaning?' : 'Mnaweza kuja leo usiku kwa sofa cleaning?'], facts: { ...fac(lang), when: lang === 'en' ? 'tomorrow at 10am' : 'kesho saa nne asubuhi' }, expect: { appointments: 1, appointment: { service: 'sofa', startEAT: '2026-10-15 10:00' } } });
    add('decline_then_yes', 'flow.decline_then_yes', { lang, now: CLK.WED0800, turns: [lang === 'en' ? 'Book sofa cleaning Friday at 10am.' : 'Nataka sofa cleaning Ijumaa saa nne asubuhi.'], facts: { ...fac(lang), onReadback: lang === 'en' ? ['No wait, actually yes, book it.'] : ['Hapana, ngoja, ndio, weka.'] }, expect: { appointments: 1, appointment: { service: 'sofa', startEAT: '2026-10-16 10:00' } } });
  }

  // ===== B. names vs places, nicknames, spelling, numbers, landmarks =====
  for (const lang of ['en', 'sw']) for (const pl of ['Kisumu', 'Ngong', 'Ruaka', 'Kitengela', 'Thika']) {
    const real = pick(NAMES, r);
    add('place_as_name', 'name.place_guard', { lang, now: CLK.WED0800, forbiddenNames: [], mustNotSay: [`(for|kwa) ${pl}\\.`], turns: [lang === 'en' ? 'Book sofa cleaning Friday at 10am.' : 'Nataka sofa cleaning Ijumaa saa nne asubuhi.'], facts: { place: 'Kitengela', name: { seq: [`${pl}.`, `${real}.`] } }, expect: { appointments: 1, appointment: { service: 'sofa', callerName: real } } });
  }
  for (const [say, nm, lang] of [['It\'s Wanjiru, W-A-N-J-I-R-U.', 'Wanjiru', 'en'], ['My name is Otieno, O T I E N O.', 'Otieno', 'en'], ['Naitwa Achieng, A-C-H-I-E-N-G.', 'Achieng', 'sw'], ['Call me Kevo.', 'Kevo', 'en'], ['Just call me Shiro.', 'Shiro', 'en'], ['Niite Mwas.', 'Mwas', 'sw'], ['Ni Kamau, lakini wananiita Kim.', 'Kamau', 'sw'], ['Wambui.', 'Wambui', 'sw']]) {
    add('name_form', 'name.forms', { lang, now: CLK.WED0800, turns: [lang === 'en' ? 'Book carpet cleaning Friday at 10am.' : 'Nataka carpet cleaning Ijumaa saa nne asubuhi.'], facts: { place: 'Ruiru', name: [say] }, mustNotSay: ['W-a-n', 'O T I', 'A-c-h', 'for Just', 'kwa Niite'], expect: { appointments: 1, appointment: { service: 'carpet', callerName: nm } } });
  }
  for (const [say, area, note, lang] of [['Ruiru, behind Spur Mall.', 'Ruiru', 'behind', 'en'], ['Kilimani, opposite Yaya Centre.', 'Kilimani', 'opposite', 'en'], ['Syokimau, next to the SGR station.', 'Syokimau', 'SGR', 'en'], ['Kitengela karibu na Naivas.', 'Kitengela', 'Naivas', 'sw'], ['Juja, mkabala na JKUAT gate.', 'Juja', 'JKUAT', 'sw'], ['Kasarani, nyuma ya stadium.', 'Kasarani', 'stadium', 'sw']]) {
    add('landmark', 'place.landmark', { lang, now: CLK.WED0800, turns: [lang === 'en' ? 'Book sofa cleaning Friday at 10am.' : 'Nataka sofa cleaning Ijumaa saa nne asubuhi.'], facts: { name: pick(NAMES, r), place: [say] }, expect: { appointments: 1, appointment: { service: 'sofa', place: area, note } } });
  }
  for (const lang of ['en', 'sw']) for (const num of ['0712 345 678', '0722-123-456', 'plus two five four seven one two three four five six seven eight']) {
    add('phone_number', 'numbers.phone', { lang, now: CLK.WED0800, turns: [lang === 'en' ? 'Book sofa cleaning Friday at 10am.' : 'Nataka sofa cleaning Ijumaa saa nne asubuhi.', lang === 'en' ? `Also, my other number is ${num}.` : `Pia namba yangu nyingine ni ${num}.`], facts: fac(lang), expect: { appointments: 1, appointment: { service: 'sofa', startEAT: '2026-10-16 10:00' } } });
  }
  for (const lang of ['en', 'sw']) add('quantity_words', 'numbers.quantity', { lang, now: CLK.WED0800, turns: [lang === 'en' ? 'I need sofa cleaning for five seats on Friday at 10am.' : 'Nataka sofa cleaning viti tano Ijumaa saa nne asubuhi.'], facts: fac(lang), expect: { appointments: 1, appointment: { service: 'sofa', startEAT: '2026-10-16 10:00' } } });

  // ===== C. ASR fragments / noise / silence / hold / barge-in =====
  const NOISE = ['[inaudible]', 'Hello? Hello?', 'Uh uh uh', '', '...', 'Mm.'];
  for (const lang of ['en', 'sw']) for (const nz of NOISE) {
    add('asr_noise', 'asr.noise', { lang, now: CLK.WED0800, turns: [lang === 'en' ? 'I want to book sofa cleaning on Friday at 10am.' : 'Nataka kubook sofa cleaning Ijumaa saa nne asubuhi.', [nz]], facts: fac(lang), mustNotSay: ["haven't saved", 'sijahifadhi', 'in \\[', 'in Hello', 'Uh uh'], expect: { appointments: 1, appointment: { service: 'sofa', startEAT: '2026-10-16 10:00' } } });
  }
  for (const lang of ['en', 'sw']) for (const hold of (lang === 'en' ? ['Hold on a sec.', 'One moment please.', 'Wait, let me check.'] : ['Ngoja kidogo.', 'Subiri kidogo nicheck.', 'Ngoja.'])) {
    add('hold', 'asr.hold', { lang, now: CLK.WED0800, turns: [lang === 'en' ? 'I want to book carpet cleaning on Friday at 10am.' : 'Nataka kubook carpet cleaning Ijumaa saa nne asubuhi.', [hold]], facts: fac(lang), mustNotSay: ["haven't saved", 'sijahifadhi', 'How can I help you today', 'tukusaidie vipi', 'in Hold', 'in One moment', 'in Wait', 'Ngoja\\.? Nithibitishe', ', Ngoja', ', Subiri'], expect: { appointments: 1, appointment: { service: 'carpet', startEAT: '2026-10-16 10:00' } } });
  }
  // barge-in during the read-back: the caller cuts in with a correction / a clipped yes
  for (const lang of ['en', 'sw']) {
    add('barge_in_correction', 'barge.readback_correction', { lang, now: CLK.WED0800, turns: [lang === 'en' ? 'Book sofa cleaning Friday at 10am.' : 'Nataka sofa cleaning Ijumaa saa nne asubuhi.'], facts: { ...fac(lang), onReadback: lang === 'en' ? ['Wait, wait, no, Saturday.', 'Sorry, no, make it Saturday.'] : ['Ngoja, hapana, Jumamosi.', 'Subiri, iwe Jumamosi.'] }, expect: { appointments: 1, appointment: { service: 'sofa', startEAT: '2026-10-17 10:00' } } });
    add('barge_in_clipped_yes', 'barge.clipped_yes', { lang, now: CLK.WED0800, turns: [lang === 'en' ? 'Book sofa cleaning Friday at 10am.' : 'Nataka sofa cleaning Ijumaa saa nne asubuhi.'], facts: { ...fac(lang), onReadback: lang === 'en' ? ['Ye-', 'Y'] : ['Nd-', 'N'] }, expect: { appointments: 1, appointment: { service: 'sofa', startEAT: '2026-10-16 10:00' } } });
  }

  // ===== D. self-corrections, change of mind, multi-intent, cancel/update =====
  const SC = [['Book sofa cleaning Friday, no, Saturday at 10am.', 'en', '2026-10-17 10:00'], ['Book sofa cleaning Saturday, sorry, Friday at 10am.', 'en', '2026-10-16 10:00'], ['Book sofa cleaning Friday at 10am, no, 11am.', 'en', '2026-10-16 11:00'], ['Book sofa cleaning on Monday, actually make it Friday, at 2pm.', 'en', '2026-10-16 14:00'], ['Nataka sofa cleaning Ijumaa, hapana, Jumamosi saa nne asubuhi.', 'sw', '2026-10-17 10:00'], ['Nataka sofa cleaning Jumamosi, samahani, Ijumaa saa nne asubuhi.', 'sw', '2026-10-16 10:00'], ['Nataka sofa cleaning Ijumaa saa nne, hapana, saa tano asubuhi.', 'sw', '2026-10-16 11:00']];
  for (const [line, lang, at] of SC) add('self_correction', 'nlu.self_correction', { lang, now: CLK.WED0800, turns: [line], facts: fac(lang), expect: { appointments: 1, appointment: { service: 'sofa', startEAT: at } } });
  const CM = [['en', ['No, make it Saturday.', 'Actually, Saturday instead.'], '2026-10-17 10:00'], ['en', ['No, 2pm instead.', 'Can we do 2pm instead?'], '2026-10-16 14:00'], ['sw', ['Hapana, badilisha iwe Jumamosi.', 'Hapana, Jumamosi badala yake.'], '2026-10-17 10:00'], ['sw', ['Hapana, saa nane mchana.', 'Iwe saa nane mchana badala yake.'], '2026-10-16 14:00']];
  for (const [lang, rb, at] of CM) add('change_after_readback', 'flow.change_after_readback', { lang, now: CLK.WED0800, turns: [lang === 'en' ? 'Book sofa cleaning Friday at 10am.' : 'Nataka sofa cleaning Ijumaa saa nne asubuhi.'], facts: { ...fac(lang), onReadback: rb }, expect: { appointments: 1, appointment: { service: 'sofa', startEAT: at } } });
  for (const lang of ['en', 'sw']) {
    add('multi_intent_price', 'flow.multi_intent', { lang, now: CLK.WED0800, turns: [lang === 'en' ? 'Book sofa cleaning Friday at 10am, and how much is it?' : 'Nataka sofa cleaning Ijumaa saa nne asubuhi, na bei ni ngapi?'], facts: fac(lang), mustSay: ['800'], expect: { appointments: 1, appointment: { service: 'sofa', startEAT: '2026-10-16 10:00' } } });
    add('multi_intent_cancel_book', 'flow.multi_intent', { lang, now: CLK.WED0800, seed: { appointments: [{ id: 'apt_fri', caller_phone: '+254700000001', service_name: 'Carpet Cleaning (per room)', status: 'requested', when_text: 'Friday 10am', window_start: '2026-10-16T07:00:00Z', address_landmark: 'Kitengela', caller_name: 'Alvin' }], contactName: 'Alvin' },
      turns: [lang === 'en' ? 'Cancel my Friday carpet cleaning and book sofa cleaning on Saturday at 10am instead.' : 'Futa booking yangu ya carpet Ijumaa, nataka sofa cleaning Jumamosi saa nne asubuhi badala yake.'], facts: { name: 'Alvin', place: 'Kitengela', which: 'The Friday carpet one.' }, expect: { rowStatus: { apt_fri: 'cancelled' }, appointments: 1, appointment: { service: 'sofa', startEAT: '2026-10-17 10:00' } } });
    const seedRow = { appointments: [{ id: 'apt_fri', caller_phone: '+254700000001', service_name: 'Carpet Cleaning (per room)', status: 'requested', when_text: 'Friday 10am', window_start: '2026-10-16T07:00:00Z', address_landmark: 'Kitengela', caller_name: 'Alvin' }], contactName: 'Alvin' };
    for (const line of lang === 'en' ? ['I need to cancel my Friday booking.', 'Please cancel the carpet cleaning.', "I won't be home Friday, cancel it."] : ['Nataka kufuta booking yangu ya Ijumaa.', 'Futa ile carpet cleaning tafadhali.', 'Sitakuwa nyumbani Ijumaa, futa booking.'])
      add('cancel', 'flow.cancel', { lang, now: CLK.WED0800, seed: seedRow, turns: [[line]], facts: { name: 'Alvin', which: 'The Friday one.' }, expect: { rowStatus: { apt_fri: 'cancelled' }, appointments: 0 } });
    for (const line of lang === 'en' ? ['Can you move my Friday booking to Saturday at 10am?', 'Reschedule the carpet cleaning to Saturday at 10am.'] : ['Songesha booking yangu ya Ijumaa hadi Jumamosi saa nne asubuhi.', 'Badilisha siku ya carpet cleaning iwe Jumamosi saa nne asubuhi.'])
      add('update', 'flow.update', { lang, now: CLK.WED0800, seed: seedRow, turns: [[line]], facts: { name: 'Alvin', which: 'The Friday one.', when: lang === 'en' ? 'Saturday at 10am' : 'Jumamosi saa nne asubuhi' }, expect: { rowStatus: { apt_fri: 'requested' }, appointments: 0, movedTo: { apt_fri: '2026-10-17 10:00' } } });
  }

  // ===== E. coverage (in-county estates, out of area) and catalogue gaps =====
  for (const [pl, county] of [['Ruaka', 'Kiambu'], ['Kikuyu', 'Kiambu'], ['Limuru', 'Kiambu'], ['Thika', 'Kiambu'], ['Westlands', 'Nairobi'], ['Embakasi', 'Nairobi'], ['Kahawa Sukari', 'Nairobi']]) for (const lang of ['en', 'sw']) {
    add('in_county_book', 'coverage.in_county', { lang, now: CLK.WED0800, turns: [lang === 'en' ? 'Book sofa cleaning Friday at 10am.' : 'Nataka sofa cleaning Ijumaa saa nne asubuhi.'], facts: { name: pick(NAMES, r), place: [`${pl}.`] }, mustNotSay: ["isn't on our list", 'haiko kwenye orodha'], expect: { appointments: 1, appointment: { service: 'sofa', place: pl } } });
    add('in_county_ask', 'coverage.in_county', { lang, now: CLK.WED0800, noPerturb: true, turns: [lang === 'en' ? [`Do you come to ${pl}?`, `Do you cover ${pl}?`, `Can you come to ${pl}?`] : [`Mnafika ${pl}?`, `Mnakuja ${pl}?`, `Mnahudumia ${pl}?`]], facts: {}, mustNotSay: ["isn't on our list", 'haiko kwenye orodha'], mustSay: [pl], expect: { appointments: 0 } });
  }
  for (const pl of ['Mombasa', 'Nakuru', 'Kisumu', 'Eldoret']) for (const lang of ['en', 'sw']) add('out_of_area', 'coverage.out_of_area', { lang, now: CLK.WED0800, noPerturb: true, turns: [lang === 'en' ? [`Do you come to ${pl}?`, `I'm in ${pl}, can you come?`, `Can you come to ${pl}?`] : [`Mnafika ${pl}?`, `Niko ${pl}, mnakuja?`, `Mnakuja ${pl}?`]], facts: {}, mustSay: [lang === 'en' ? "isn't on our list" : 'haiko kwenye orodha'], expect: { appointments: 0 } });
  for (const [item, lang] of [['pest control', 'en'], ['car wash', 'en'], ['gutter cleaning', 'en'], ['laundry', 'en'], ['fumigation', 'sw'], ['kuosha gari', 'sw'], ['pest control', 'sw']]) {
    add('off_catalogue_price', 'catalogue.off_catalogue', { lang, now: CLK.WED0800, noPerturb: true, turns: [lang === 'en' ? [`How much is ${item}?`, `What do you charge for ${item}?`, `Price for ${item}?`] : [`Bei ya ${item} ni ngapi?`, `${item} ni pesa ngapi?`, `Mnachaji ngapi kwa ${item}?`]], facts: {}, mustNotSay: ['KSh', 'shilingi'], expect: { appointments: 0 } });
    add('off_catalogue_book', 'catalogue.off_catalogue', { lang, now: CLK.WED0800, noPerturb: true, turns: [lang === 'en' ? [`I want to book ${item} on Friday at 10am.`, `Can you do ${item} Friday at 10am?`] : [`Nataka kubook ${item} Ijumaa saa nne asubuhi.`, `Mnaweza kufanya ${item} Ijumaa saa nne?`]], facts: { name: 'Alvin', place: 'Kitengela' }, expect: { appointments: 0 } });
  }

  // ===== F. are-you-a-bot, rude callers =====
  for (const [lines, lang] of [[['Are you a bot?', 'Am I talking to a robot?', 'Is this a real person?', 'Are you AI?'], 'en'], [['Wewe ni robot?', 'Naongea na mtu kweli?', 'Wewe ni binadamu?', 'Hii ni AI?'], 'sw']]) {
    add('are_you_bot', 'meta.bot_disclosure', { lang, now: CLK.WED0800, noPerturb: true, turns: [lines], facts: {}, mustSay: [lang === 'en' ? '(virtual|digital|AI) assistant' : 'msaidizi wa (kidijitali|AI)'], expect: { noWrites: true } });
    add('are_you_bot_mid_booking', 'meta.bot_disclosure', { lang, now: CLK.WED0800, turns: [lang === 'en' ? 'Book sofa cleaning Friday at 10am.' : 'Nataka sofa cleaning Ijumaa saa nne asubuhi.', lines], facts: fac(lang), mustSay: [lang === 'en' ? '(virtual|digital|AI) assistant' : 'msaidizi wa (kidijitali|AI)'], expect: { appointments: 1, appointment: { service: 'sofa', startEAT: '2026-10-16 10:00' } } });
  }
  for (const [line, lang] of [['This is useless, just book sofa cleaning Friday at 10am.', 'en'], ['Stop wasting my time and book carpet cleaning Friday at 10am.', 'en'], ['Wewe ni mjinga, nataka sofa cleaning Ijumaa saa nne asubuhi.', 'sw'], ['Maze acha upuss, book carpet cleaning Ijumaa saa nne.', 'sheng']]) {
    const key = /sofa/.test(line) ? 'sofa' : 'carpet';
    add('rude', 'meta.rude', { lang, now: CLK.WED0800, turns: [line], facts: fac(lang), expect: { appointments: 1, appointment: { service: key, startEAT: '2026-10-16 10:00' } } });
  }
  for (const [line, lang] of [['You people are thieves!', 'en'], ['Nyinyi ni wezi!', 'sw']]) add('rude_no_intent', 'meta.rude', { lang, now: CLK.WED0800, noPerturb: true, turns: [[line], lang === 'en' ? ["No, that's all."] : ['Hapana, ni hayo tu.']], facts: {}, expect: { appointments: 0 } });

  return cases;
}
module.exports = { generate, perturb, CLK };
