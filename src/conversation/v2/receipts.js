'use strict';
// Speech for BA v2. Every fact line is rendered from a typed receipt or a fixed
// ask/ladder template per language. Model text is never spoken.
const L = require('./lexicon');
const CS = require('./commitSafety');
const { speakCatalogueName } = require('../spokenCatalogue');
const { speakMoney } = require('../../speech/spokenForms');
const sw = (lang) => L.isSw(lang);
function priceTxt(p, S) {
  const raw = String(p || '').trim();
  if (!raw) return '';
  const fromWord = (t) => t.replace(/^From\s+/i, S ? 'kuanzia ' : 'from ');
  // Already speech-ready (spoken catalogue: "2,200 shillings per square metre"): keep it.
  if (/\b(shillings?|shilingi|bob)\b/i.test(raw)) return fromWord(raw);
  // "KSh 2,200", "From KSh 2,500 per seat", "KSh 800-1,200": amount or range spoken as
  // words, unit kept. Never strip every non-digit (that read "800-1,200" as millions).
  const m = raw.match(/^(from\s+)?(?:ksh\.?|kes)?\s*([\d,]+(?:\.\d+)?)\s*(?:(?:-|–|to|hadi)\s*(?:ksh\.?|kes)?\s*([\d,]+(?:\.\d+)?))?\s*(.*)$/i);
  const num = (x) => Number(String(x).replace(/,/g, ''));
  if (m && Number.isFinite(num(m[2])) && num(m[2]) > 0) {
    const lang = S ? 'sw' : 'en';
    let money = speakMoney(num(m[2]), lang);
    if (m[3] && Number.isFinite(num(m[3])) && num(m[3]) > 0) money = `${money} ${S ? 'hadi' : 'to'} ${speakMoney(num(m[3]), lang)}`;
    let unit = String(m[4] || '').trim();
    // Units are spoken, not read as symbols: "per m²" -> "per square metre" / "kwa mita mraba".
    unit = unit.replace(/^(?:per|\/)\s*(?:m²|m2|sqm|sq\.?\s*m)(?![a-z])/i, S ? 'kwa mita mraba' : 'per square metre')
      .replace(/^per\s+seat\b/i, S ? 'kwa kiti' : 'per seat').replace(/^per\s+room\b/i, S ? 'kwa chumba' : 'per room');
    const said = unit ? `${money} ${unit}` : money;
    return m[1] ? `${S ? 'kuanzia' : 'from'} ${said}` : said;
  }
  return fromWord(raw);
}
const svcName = (s, lang) => speakCatalogueName(s, lang || 'en');
const period = (hhmm) => { const h = Number(String(hhmm).slice(0, 2)); return h < 12 ? 'asubuhi' : h < 16 ? 'mchana' : h < 19 ? 'jioni' : 'usiku'; };
const at = (when, lang) => (when?.time ? (sw(lang) ? ` ${L.sayTime(when.time, lang)} ${period(when.time)}` : ` at ${when.time}`) : '');
const items = (xs, lang) => xs.map((x) => (sw(lang) ? `${x.name} ${x.qty}` : `${x.qty} ${x.name}`)).join(sw(lang) ? ' na ' : ' and ');

const ord = (n) => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th')}`;
const ASK = {
  service: { en: ['Which service do you need?', 'Which service do you need? For example carpet or sofa cleaning.'], sw: ['Ungependa tufanye nini?', 'Ungependa tufanye nini? Kwa mfano usafi wa carpet au sofa.'] },
  date: { en: ['What day would you like?', 'What day would you like? For example tomorrow or Friday.'], sw: ['Siku gani ingekufaa?', 'Siku gani ingekufaa? Kwa mfano kesho au Ijumaa.'] },
  time: { en: (c) => [`What time on ${c.day}?`, `What time on ${c.day}? For example 10am or 2pm.`], sw: (c) => [`Saa ngapi ${c.day}?`, `Saa ngapi ${c.day}? Kwa mfano saa nne asubuhi.`] },
  place: { en: ['Where should we come?', 'Where should we come? The estate or a landmark is enough.'], sw: ['Tuje wapi?', 'Tuje wapi? Jina la mtaa au alama inatosha.'] },
  name: { en: ['May I have your name?', 'Sorry, may I have your name again?'], sw: ['Naomba jina lako?', 'Samahani, naomba jina lako tena?'] },
  items: { en: ['Which item would you like?', 'Which item would you like from our list?'], sw: ['Ungependa kitu gani?', 'Ungependa kitu gani kwenye orodha yetu?'] },
  qty: { en: (c) => [`How many ${c.item} would you like?`, `How many ${c.item}? For example one or two.`], sw: (c) => [`${c.item} ngapi?`, `${c.item} ngapi? Kwa mfano moja au mbili.`] },
  pickup: { en: ['What day will you pick it up?', 'What day will you pick it up? For example tomorrow.'], sw: ['Utakuja kuchukua siku gani?', 'Utakuja kuchukua siku gani? Kwa mfano kesho.'] },
  which: { en: (c) => [`Which one: ${c.list}?`, `Which one, ${c.list}?`], sw: (c) => [`Ipi: ${c.list}?`, `Ni ipi, ${c.list}?`] },
  change_what: { en: (c) => [`What would you like to change on your ${c.row}?`, `Is it the day and time you want to change on your ${c.row}?`], sw: (c) => [`Ungependa kubadilisha nini kwenye ${c.row}?`, `Ni siku na saa unataka kubadilisha kwenye ${c.row}?`] },
  new_when: { en: ['What new day and time would you like?', 'What new day and time? For example Saturday at 10am.'], sw: ['Siku gani na saa ngapi mpya?', 'Siku gani na saa ngapi mpya? Kwa mfano Jumamosi saa nne.'] },
  kesho: { en: (c) => [`Do you mean later today, ${c.today} the ${ord(c.todayD)}, or ${c.tomorrow} the ${ord(c.tomorrowD)}?`], sw: (c) => [`Unamaanisha leo ${c.today} tarehe ${c.todayD}, au ${c.tomorrow} tarehe ${c.tomorrowD}?`] },
  date_conflict: { en: (c) => [`${c.today} is the ${ord(c.todayD)}, and the ${ord(c.tomorrowD)} is a ${c.tomorrow}. Which do you mean?`], sw: (c) => [`${c.today} ni tarehe ${c.todayD}, na tarehe ${c.tomorrowD} ni ${c.tomorrow}. Unamaanisha ipi?`] },
  next_dow: { en: (c) => [`Do you mean this ${c.today} the ${ord(c.todayD)}, or ${c.tomorrow} the ${ord(c.tomorrowD)}?`], sw: (c) => [`Unamaanisha ${c.today} hii tarehe ${c.todayD}, au ${c.tomorrow} ijayo tarehe ${c.tomorrowD}?`] },
  yes_no: { en: (c) => [`Please say yes or no: ${c.q ? c.q.charAt(0).toLowerCase() + c.q.slice(1) : 'shall I go ahead?'}`], sw: (c) => [`Tafadhali sema ndio au hapana: ${c.q ? c.q.charAt(0).toLowerCase() + c.q.slice(1) : 'niendelee?'}`] },
  complaint_more: { en: ["I'm sorry to hear that. Is there anything else the owner should know?"], sw: ['Pole sana. Kuna kingine mwenye biashara anapaswa kujua?'] },
  intent: { en: ['How can I help you today?', 'Sorry, are you calling to book, or about something else?'], sw: ['Karibu, tukusaidie vipi?', 'Samahani, unapiga kubook, ama ni kuhusu kitu kingine?'] },
};
function ask(slot, n, lang, ctx = {}) {
  const set = ASK[slot][sw(lang) ? 'sw' : 'en'];
  const xs = typeof set === 'function' ? set(ctx) : set;
  return xs[Math.min(n, xs.length - 1)];
}
// Never speak an empty date: a row with no window uses the caller's own words ("kesho"),
// or no date at all.
function rowLabel(r, lang) {
  const d = r.when?.date ? L.sayDate(r.when.date, lang) : (r.whenText || '');
  if (sw(lang)) return d ? `${svcName(r.service, lang)} ya ${d}` : `${svcName(r.service, lang)}`;
  return d ? `${svcName(r.service, lang).toLowerCase()} on ${d}` : `${svcName(r.service, lang).toLowerCase()}`;
}

// HD_89aa48bf657f: plain service categories from the tenant catalogue (names never read raw)
const CATS = [
  ['items', /mattress|sofa|carpet|window|refrigerator|fridge|oven|couch/i],
  ['house', /bedroom|house|apartment|housekeeping|studio/i],
  ['deep', /deep|move-?in|move-?out|post-?construction|fumigat/i],
  ['office', /office|commercial|contract/i],
];
function serviceCategories(names) {
  const got = new Map(); const other = [];
  for (const n of names) { const c = CATS.find(([, re]) => re.test(n)); if (c) got.set(c[0], [...(got.get(c[0]) || []), n]); else other.push(n); }
  return [...CATS.map(([k]) => k).filter((k) => got.has(k)).map((k) => ({ k, names: got.get(k) })), ...other.slice(0, 2).map((n) => ({ k: 'raw', names: [n] }))];
}
const ITEM_WORDS = { mattress: ['mattresses', 'magodoro'], sofa: ['sofas', 'sofa'], carpet: ['carpets', 'mazulia'], window: ['windows', 'madirisha'], refrigerator: ['fridges', 'friji'], oven: ['ovens', 'oveni'] };
function catPhrase(c, S) {
  if (c.k === 'items') { const ws = Object.entries(ITEM_WORDS).filter(([k]) => c.names.some((n) => n.toLowerCase().includes(k))).map(([, v]) => v[S ? 1 : 0]).slice(0, 4); return S ? `usafi wa ${ws.join(', ')}` : ws.join(', '); }
  if (c.k === 'house') return S ? 'usafi wa nyumba kulingana na ukubwa' : 'house cleaning by size';
  if (c.k === 'deep') return S ? 'usafi wa kina, kama wa kuhamia au baada ya ujenzi' : 'deep cleaning, like move-in or after building work';
  if (c.k === 'office') return S ? 'usafi wa maofisi' : 'offices';
  return svcName(c.names[0]).toLowerCase();
}
function explain(name, notes, S) {
  const n = String(name || '');
  const bed = n.match(/(\d)-Bedroom/i);
  if (bed) return S ? `Ni usafi wa nyumba yenye vyumba ${['', 'kimoja', 'viwili', 'vitatu'][bed[1]] ? `${bed[1] === '1' ? 'cha kulala kimoja' : `vya kulala ${['', '', 'viwili', 'vitatu'][bed[1]]}`}` : bed[1]}: kufagia, kupiga deki, bafu na jikoni.` : `It means cleaning a ${['', 'one', 'two', 'three'][bed[1]] || bed[1]}-bedroom home: dusting, mopping, the bathroom and the kitchen.`;
  if (/move-?in|move-?out/i.test(n)) return S ? 'Ni usafi kamili wa nyumba unapohamia au kuhama.' : 'It means a full clean of a home when you move in or move out.';
  if (/post-?construction/i.test(n)) return S ? 'Ni usafi baada ya ujenzi au ukarabati, kuondoa vumbi na uchafu.' : 'It means cleaning up after building or renovation work: dust and debris.';
  if (/deep/i.test(n)) return S ? 'Ni usafi wa kina zaidi ya usafi wa kawaida.' : 'It means a more thorough clean than a standard one.';
  if (/hourly/i.test(n)) return S ? 'Ni msaidizi wa usafi anayelipwa kwa saa.' : 'It means a cleaner you book by the hour.';
  const first = String(notes || '').split(/[,.;]/).slice(0, 3).join(',').trim();
  return S ? `${svcName(n)}${first ? `: ${first}` : ''}.` : `${svcName(n)}${first ? ` covers ${first.toLowerCase()}` : ''}.`;
}
function readback(p, lang) {
  const S = sw(lang);
  const nm = p.name ? (S ? `, kwa ${p.name}` : `, for ${p.name}`) : '';
  switch (p.tool) {
    case 'create_booking': return S ? `${svcName(p.service, lang)}, ${L.sayDate(p.when.date, lang)}${at(p.when, lang)}${p.place ? `, ${p.place}` : ''}${p.landmark ? ` ${swMark(p.landmark)}` : ''}${nm}. Nithibitishe?` : `${svcName(p.service, lang)} on ${L.sayDate(p.when.date, lang)}${at(p.when, lang)}${p.place ? ` in ${p.place}` : ''}${p.landmark ? `, ${enMark(p.landmark)}` : ''}${nm}. Shall I book it?`;
    case 'create_order': return S ? `${items(p.items, lang)}, kuchukua ${L.sayDate(p.pickup.date, lang)}${nm}. Nithibitishe?` : `${items(p.items, lang)}, pickup ${L.sayDate(p.pickup.date, lang)}${nm}. Shall I place the order?`;
    case 'cancel_booking': return S ? `Nifute ${rowLabel(p.row, lang)}${at(p.row.when, lang)}. Niendelee?` : `Cancel your ${rowLabel(p.row, lang)}${at(p.row.when, lang)}. Shall I go ahead?`;
    case 'update_booking': return S ? `Nihamishe ${svcName(p.row.service, lang)} hadi ${L.sayDate(p.when.date, lang)}${at(p.when, lang)}. Niendelee?` : `Move your ${svcName(p.row.service, lang).toLowerCase()} to ${L.sayDate(p.when.date, lang)}${at(p.when, lang)}. Shall I go ahead?`;
    case 'create_handoff': {
      const k = p.kind;
      // BRAIN_V2_COMMIT_SAFETY: a callback reads back the number AND when, so the owner's promise is confirmed (A4).
      if (p.callbackWhen) {
        const num = p.phoneSaid ? (S ? ` kwa namba ${p.phoneSaid}` : ` on ${p.phoneSaid}`) : (S ? ' kwa namba hii' : ' on this number');
        const when = p.callbackWhen.say(lang);
        const who = k === 'manager' ? (S ? 'meneja' : 'the manager') : (S ? 'mwenye biashara' : 'the owner');
        const pre = k === 'address' ? (S ? 'Siwezi kubadilisha mahali kwenye simu hii. ' : "I can't change the address on this call. ") : k === 'payment' ? (S ? 'Siwezi kubadilisha malipo kwenye simu hii. ' : "I can't change payment details on this call. ") : k === 'manager' ? (S ? 'Meneja hayupo kwenye simu sasa. ' : "The manager isn't on the line now. ") : '';
        const about = k === 'address' && p.place ? (S ? `, kuhusu kuhamia ${p.place}` : `, about moving it to ${p.place}`) : k === 'quote' ? (S ? ', kukupa bei' : ', with a quote') : p.place && k === 'callback' ? (S ? `, kuhusu ${p.place}` : `, about ${p.place}`) : p.topic ? (S ? `, kuhusu ${svcName(p.topic, lang)}` : `, about the ${svcName(p.topic, lang).toLowerCase()}`) : '';
        return S ? `${pre}Nimwombe ${who} akupigie simu${num}, ${when}${about}. Ni sawa?` : `${pre}Shall I ask ${who} to call you back${num}, ${when}${about}?`;
      }
      if (k === 'address') return S ? 'Siwezi kubadilisha mahali kwenye simu hii. Nimwombe mwenye biashara akupigie simu, ni sawa?' : `I can't change the address on this call. Shall I ask the owner to call you back about ${p.place ? `moving it to ${p.place}` : 'it'}?`;
      if (k === 'payment') return S ? 'Siwezi kubadilisha malipo kwenye simu hii. Nimwombe mwenye biashara akupigie simu, ni sawa?' : "I can't change payment details on this call. Shall I ask the owner to call you back about it?";
      if (k === 'callback') return S ? 'Nimwombe mwenye biashara akupigie simu kwa namba hii, ni sawa?' : 'Shall I ask the team to call you back on this number?';
      if (k === 'manager') return S ? 'Mwenye biashara hayupo kwenye simu sasa. Nimwombe akupigie simu, ni sawa?' : `The manager isn't on the line now. Shall I ask them to call you back${p.topic ? ` about the ${svcName(p.topic, lang).toLowerCase()}` : ''}?`;
      return S ? 'Nimwombe mwenye biashara akupigie simu kumaliza hili, ni sawa?' : "Shall I ask the team to call you back to finish this?";
    }
    default: return '';
  }
}

// The yes/no question a re-ask ("okay wait", unclear) repeats: the read-back's own question sentence.
// EN's callback question carries the number and when, so the SW one does too ("Nimwombe ..., ni sawa?")
// rather than a bare "Ni sawa?"; the lead sentence ("I can't change ...", "The manager isn't ...") is not repeated.
function reaskQ(p, lang) {
  const rb = String(readback(p, lang) || '');
  if (sw(lang) && p && p.tool === 'create_handoff' && p.callbackWhen) {
    const m = rb.match(/(Nimwombe [^.?]*)\. Ni sawa\?\s*$/);
    if (m) return `${m[1]}, ni sawa?`;
  }
  return (rb.match(/[^.!?]+\?\s*$/) || [''])[0].trim();
}

function receipt(r, lang) {
  const S = sw(lang);
  // BRAIN_V2_COMMIT_SAFETY / R1: a failed write is never a promise we did not make; the outbox owner task is real.
  // Under C1, spoken booked/saved/callback-promised only with a real Desk write id (dryRun / escalate-without-row are hollow).
  // Flag off keeps Phase 1 dry-run mouth (tests + shadow).
  const hollow = Boolean(CS.commitSafetyEnabled() && r.ok && !r.id && !r.duplicate);
  if ((!r.ok || hollow) && r.outbox === 'queued') return S ? 'Samahani, sikuweza kuhifadhi hilo. Nimemwomba mwenye biashara akupigie simu.' : "Sorry, I couldn't save that. I've asked the owner to call you back.";
  if ((!r.ok || hollow) && r.outbox === 'failed') return S ? 'Samahani, sikuweza kuhifadhi hilo sasa hivi. Tafadhali piga simu tena baadaye kidogo.' : "Sorry, I couldn't save that just now. Please call us again a little later.";
  if (r.ok && r.duplicate) return S ? `Hilo tayari limehifadhiwa, sijaweka mara mbili. Kuna kingine?` : "That's already saved; I haven't added it twice. Anything else?";
  if (!r.ok || hollow) return S ? 'Samahani, sikuweza kuhifadhi hilo sasa. Timu itakupigia simu.' : "Sorry, I couldn't save that just now. The team will call you back.";
  const more = S ? ' Kuna kingine?' : ' Anything else?';
  switch (r.tool) {
    case 'create_booking': return (S ? `Sawa, nimeweka ${svcName(r.service, lang)} yako, ${L.sayDate(r.when.date, lang)}${at(r.when, lang)}.` : `Done, your ${svcName(r.service, lang).toLowerCase()} is booked for ${L.sayDate(r.when.date, lang)}${at(r.when, lang)}.`) + more;
    case 'create_order': return (S ? `Sawa, nimehifadhi oda yako: ${items(r.items, lang)}, kuchukua ${L.sayDate(r.pickup.date, lang)}.` : `Done, I've placed your order: ${items(r.items, lang)}, pickup ${L.sayDate(r.pickup.date, lang)}.`) + more;
    case 'cancel_booking': return (S ? `Sawa, nimefuta ${rowLabel(r.row, lang)}.` : `Done, your ${rowLabel(r.row, lang)} is cancelled.`) + more;
    case 'update_booking': return (S ? `Sawa, nimebadilisha ${svcName(r.row.service, lang)} hadi ${L.sayDate(r.when.date, lang)}${at(r.when, lang)}.` : `Done, your ${svcName(r.row.service, lang).toLowerCase()} is moved to ${L.sayDate(r.when.date, lang)}${at(r.when, lang)}.`) + more;
    case 'create_handoff':
      if (r.kind === 'address' || r.kind === 'payment') return S ? 'Sawa. Mwenye biashara atakupigia simu. Kwa sasa, mabadiliko bado yanasubiri.' : 'Okay. The owner will call you back on this number. Until then, the change is still pending.';
      if (r.callbackSay) return (S ? `Sawa. ${r.kind === 'manager' ? 'Meneja' : 'Mwenye biashara'} atakupigia simu ${r.callbackSay}.` : `Okay. ${r.kind === 'manager' ? 'The manager' : 'The owner'} will call you back ${r.callbackSay}.`) + more;
      return (S ? 'Sawa. Mwenye biashara atakupigia simu kwa namba hii.' : (r.kind === 'manager' ? 'Okay. The manager will call you back on this number.' : 'Okay. The team will call you back on this number.')) + more;
    case 'log_complaint': return S ? 'Asante. Nimepeleka malalamiko yako kwa mwenye biashara, atakupigia simu. Kuna kingine?' : 'Thank you. Your complaint is with the owner, who will call you back. Anything else?';
    default: return '';
  }
}

function info(r, lang, n = 0) {
  const S = sw(lang);
  switch (r.kind) {
    case 'price': return r.found ? (S ? `Bei ya ${svcName(r.label, lang)} ni ${priceTxt(r.price, true)}.` : `${L.cap(svcName(r.label, lang))} is ${priceTxt(r.price)}.`) : (S ? 'Sina bei ya hiyo kwenye orodha yetu. Ungependa mwenye biashara akupigie na bei?' : "I don't have a price for that on our list. Would you like the owner to call you with a quote?");
    case 'stock':
      if (r.found && /^(yes|true|in)/i.test(String(r.in_stock || ''))) return S ? `Kwa orodha yetu, ${r.label} inapatikana.` : `Our list shows ${r.label} in stock.`;
      return [S ? 'Siwezi kuthibitisha hiyo kwenye simu hii. Ungependa timu ikupigie simu?' : "I can't confirm that on this call. Would you like the team to call you back?",
        S ? 'Sina taarifa hiyo sasa hivi. Timu inaweza kukupigia simu, ungependa?' : "I don't have that information right now. The team can call you back. Would you like that?"][Math.min(n, 1)];
    case 'service_slot': return S ? `Tunafanya ${svcName(r.label, lang)}, lakini siwezi kuthibitisha nafasi bila timu. Ungependa niweke ombi la booking?` : `We do offer ${svcName(r.label, lang).toLowerCase()}, but I can't confirm a slot without the team. Would you like to make a booking request?`;
    case 'hours': {
      const o = (hh) => (S ? `${L.sayTime(hh, lang)} ${period(hh)}` : hh);
      if (r.closed) return S ? `${r.dayLabel} tumefunga.` : `We're closed on ${r.dayLabel}.`;
      if (r.dayLabel) return S ? `Ndio, ${r.dayLabel} tuko wazi kuanzia ${o(r.open)} hadi ${o(r.close)}.` : `Yes, on ${r.dayLabel} we're open from ${r.open} to ${r.close}.`;
      return S ? `Tuko wazi kila siku kuanzia ${o(r.open)} hadi ${o(r.close)}. Kuna kingine?` : `We're open ${r.everyDay ? 'every day' : 'today'} from ${r.open} to ${r.close}. Anything else?`;
    }
    case 'file':
      if (!r.rows.length) return [S ? 'Sioni booking yoyote ya awali kwa namba hii.' : "I don't see any earlier bookings on this number.", S ? 'Samahani, siipati. Ungependa timu iangalie na ikupigie simu?' : "Sorry, I can't find it. Would you like the team to check and call you back?"][Math.min(n, 1)];
      return S ? `Naona ${rowLabel(r.rows[0], lang)}.` : `I can see your ${rowLabel(r.rows[0], lang)}.`;
    case 'pending': return S ? `Ombi lako la kubadilisha ${r.what === 'payment' ? 'malipo' : 'mahali'} bado linasubiri. Mwenye biashara atakupigia simu.` : `Your ${r.what} change request is still pending. The owner will call you back.`;
    case 'explain_text': return r.text;
    case 'service_categories': { const ps = r.labels || r.cats.map((c) => catPhrase(c, S)); const list = ps.length > 1 ? `${ps.slice(0, -1).join(S ? ', ' : ', ')}${S ? ' na ' : ', and '}${ps[ps.length - 1]}` : ps[0]; if (r.examples) { const ex = r.examples.length > 1 ? `${r.examples.slice(0, -1).join(', ')}${S ? ' na ' : ', and '}${r.examples[r.examples.length - 1]}` : r.examples[0]; return S ? `Kwa mfano, ${ex}. Ungependa ipi?` : `For example, ${ex}. Which would you like?`; } if (r.again) return S ? `Ndio, tunafanya ${list}. Ungependa ipi kati ya hizo?` : `Yes, we do ${list}. Which of those would you like?`; return S ? `Tunafanya ${list}. Ungependa ipi?` : `We do ${list}. Which would you like?`; }
    case 'house_sizes': { const w = S ? { 1: 'kimoja', 2: 'viwili', 3: 'vitatu', 4: 'vinne' } : { 1: 'one', 2: 'two', 3: 'three', 4: 'four' }; const ws = [...new Set(r.sizes)].sort().map((d) => w[d] || d); const l = ws.length > 1 ? `${ws.slice(0, -1).join(', ')} ${S ? 'au' : 'or'} ${ws[ws.length - 1]}` : ws[0] || ''; return S ? `Usafi wa nyumba ni kulingana na ukubwa, vyumba vya kulala ${l}. Nyumba yako ina vyumba vingapi?` : `House cleaning goes by size: ${l} bedrooms. How many bedrooms is your home?`; }
    case 'service_detail': { // follow-up on the category list: one level deeper, still plain words, no raw catalogue names
      const parts = r.cats.map((c) => {
        if (c.k === 'items') return catPhrase(c, S);
        if (c.k === 'house') { const ds = [...new Set(c.names.map((x) => (x.match(/(\d)-Bedroom/i) || [])[1]).filter(Boolean))].sort(); const w = S ? { 1: 'kimoja', 2: 'viwili', 3: 'vitatu' } : { 1: 'one', 2: 'two', 3: 'three' }; const l = ds.map((d) => w[d] || d); if (!l.length) return S ? 'usafi wa nyumba' : 'house cleaning'; const hourly = c.names.some((x) => /hourly/i.test(x)); return S ? `nyumba ya vyumba ${l.join(', ')}${hourly ? ', au msaidizi kwa saa' : ''}` : `homes with ${l.slice(0, -1).join(', ')}${l.length > 1 ? ' or ' : ''}${l[l.length - 1]} bedrooms${hourly ? ', or a cleaner by the hour' : ''}`; }
        if (c.k === 'deep') { const ws = [[/move/i, S ? 'kuhamia' : 'moving'], [/construction/i, S ? 'baada ya ujenzi' : 'after building work'], [/fridge|refrigerator/i, S ? 'friji' : 'fridges'], [/oven/i, S ? 'oveni' : 'ovens']].filter(([re]) => c.names.some((x) => re.test(x))).map(([, w]) => w); return S ? `usafi wa kina${ws.length ? ` kama ${ws.join(', ')}` : ''}` : `deep cleans${ws.length ? ` like ${ws.join(', ')}` : ''}`; }
        if (c.k === 'office') { // sizes only when the catalogue lists them (HD_923e: one 'Office Cleaning' row)
          const sz = [[/small/i, S ? 'ndogo' : 'small'], [/medium/i, S ? 'za kati' : 'medium'], [/large|commercial/i, S ? 'kubwa' : 'large']].filter(([re]) => c.names.some((x) => re.test(x))).map(([, w]) => w);
          if (sz.length < 2) return S ? 'usafi wa maofisi' : 'offices';
          return S ? `ofisi ${sz.slice(0, -1).join(', ')} au ${sz[sz.length - 1]}` : `${sz.slice(0, -1).join(', ')} or ${sz[sz.length - 1]} offices`;
        }
        return catPhrase(c, S);
      });
      { const j = parts.join("; "); return `${j.charAt(0).toUpperCase()}${j.slice(1)}. ${S ? "Ungependa ipi?" : "Which would you like?"}`; }
    }
    case 'explain': return explain(r.name, r.notes, S);
    case 'services': return S ? `Tuna ${r.names.map((n) => svcName(n, lang)).join(', ')}${r.more ? ', na zingine' : ''}. Unahitaji gani?` : `We offer ${r.names.map((n) => svcName(n, lang)).join(', ')}${r.more ? ', and more' : ''}. Which one do you need?`;
    case 'offered': return S ? `Ndio, tunafanya ${svcName(r.label, lang)}${r.price ? `, bei ni ${priceTxt(r.price, true)}` : ''}. Ungependa kubook?` : `Yes, we do ${svcName(r.label, lang).toLowerCase()}${r.price ? `, ${/^From/i.test(r.price) ? priceTxt(r.price) : `at ${priceTxt(r.price)}`}` : ''}. Would you like to book?`;
    case 'coverage_outside': return S ? `Ndio, nje ya ${r.base} tunahudumia ${r.names}${r.more ? ' na maeneo mengine' : ''}. Uko wapi?` : `Yes, outside ${r.base} we serve ${r.names}${r.more ? ' and other listed areas' : ''}. Which place are you in?`;
    case 'coverage':
      if (r.area?.listed) return S ? `${r.area.name} iko kwenye orodha ya maeneo yetu. Timu itathibitisha ukibook.` : `${r.area.name} is on our list of service areas. The team confirms when you book.`;
      if (r.area) return S ? `${r.area.name} haiko kwenye orodha ya maeneo yetu. Timu inaweza kuangalia na kukupigia simu.` : `${r.area.name} isn't on our list of service areas. The team can check and call you back.`;
      return r.general ? (S ? `Tunahudumia ${r.general}${r.more ? '. Pia tuna maeneo mengine' : ''}. Uko wapi?` : `We serve ${r.general}${r.more ? '. We also cover other listed areas' : ''}. Which place are you in?`) : (S ? 'Uko wapi? Nitaangalia orodha ya maeneo yetu.' : "Which place are you in? I'll check our service areas.");
    case 'want_know': return [S ? 'Sawa, ungependa kujua kuhusu bei, huduma au saa za kazi?' : 'Sure, would you like to know about prices, services or our hours?', S ? 'Uliza tu, mfano bei ya carpet au saa tunafungua.' : 'Go ahead, for example a price or our opening hours.'][Math.min(n, 1)];
    case 'which_price': return S ? 'Bei ya huduma gani ungependa kujua?' : 'Which service would you like the price for?';
    case 'which_size': return r.sizes
      ? (S ? `${speakCatalogueName(r.head, lang)}. ${r.sizes}` : `${speakCatalogueName(r.head, lang)}. ${r.sizes}`)
      : (S ? 'Nyumba ya chumba ngapi?' : 'Which size do you need?');
    case 'ack': return r.service ? (S ? `Sawa. Ungependa kubook ${svcName(r.service, lang)}?` : `Okay. Would you like to book ${svcName(r.service, lang).toLowerCase()}?`) : (S ? 'Sawa. Kuna kingine ninaweza kukusaidia nacho?' : 'Okay. Is there anything else I can help with?');
    case 'who': return S ? `Unaongea na ${r.agent}, wa ${r.biz}. Tukusaidie na usafi gani?` : `You're speaking with ${r.agent} from ${r.biz}. What can we clean for you?`;
    case 'greet_name': return S ? `${r.name}, unahitaji huduma gani leo?` : `Thanks, ${r.name}. Which service do you need today?`;
    case 'off_catalogue': return S ? `Sina ${r.item} kwenye orodha yetu. ${r.hint ? `Tunafanya ${r.hint}.` : ''}`.trim() : `${r.item} isn't on our list. ${r.hint ? `We do ${r.hint}.` : ''}`.trim();
    case 'policy': return r.line || (S ? 'Sina hiyo kwenye rekodi.' : "I don't have that on file.");
    case 'payment_how': return r.methods ? (S ? `Tunapokea ${r.methods}.` : `We accept ${r.methods}.`) : (S ? 'Sina maelezo ya malipo kwenye orodha yetu.' : "I don't have payment details on our list.");
    case 'greeting': return S ? 'Nzuri, asante. Ungependa huduma gani?' : "I'm well, thank you. Which service do you need?";
    case 'closed_day': return S ? `${L.cap(L.DOW_SW[r.dow])} tumefunga. Siku gani nyingine ingekufaa?` : `We're closed on ${r.dayLabel}. What other day would you like?`;
    case 'time_outside': { const o = (hh) => (S ? `${L.sayTime(hh, lang)} ${period(hh)}` : hh); return S ? `Tuko wazi kuanzia ${o(r.open)} hadi ${o(r.close)}. Saa ngapi ${r.day}?` : `We're open from ${r.open} to ${r.close}. What time on ${r.day}?`; }
    case 'closing_today': return S ? `Leo tunafunga ${L.sayTime(r.close, lang)} ${period(r.close)}, hatuwezi kuja sasa hivi. Siku gani nyingine ingekufaa?` : `We close at ${r.close} today, so we can't come right now. What other day would you like?`;
    case 'time_past': return S ? `Saa hiyo imeshapita. Saa ngapi au siku gani nyingine ingekufaa?` : 'That time has already passed. What later day and time would you like?';
    case 'bot': return S ? `Mimi ni ${r.agent}, msaidizi wa kidijitali wa ${r.biz}. Timu halisi inapata ujumbe wako.` : `I'm ${r.agent}, a virtual assistant for ${r.biz}. The real team gets your request.`;
    case 'hold': return S ? 'Sawa, chukua muda wako.' : 'Sure, take your time.';
    case 'area_out': return S ? `Bado hatufiki ${r.place}${r.areas ? `. Tunafika ${r.areas}` : ''}.` : `We don't cover ${r.place} yet${r.areas ? `. We serve ${r.areas}` : ''}.`;
    case 'slot_taken': return S ? `Saa hiyo imeshachukuliwa${r.alt ? `. Naweza ${r.alt}` : ''}. Ungependa saa ngapi?` : `That time is already taken${r.alt ? `. I can do ${r.alt}` : ''}. What time would suit you?`;
    case 'already_booked': return S ? `Tayari una ${r.label} wakati huo. Ungependa saa nyingine?` : `You already have ${r.label} at that time. Would you like another time?`;
    case 'pickup_closed': return S ? `${r.dayLabel} tumefunga. Ungependa kuchukua siku gani?` : `We're closed on ${r.dayLabel}. Which day would you like to pick up?`;
    case 'repair': return S ? 'Samahani, sijakusikia vizuri. Unaweza kurudia?' : "Sorry, I didn't catch that. Could you say it again?";
    case 'no_rows': return S ? 'Sioni booking iliyo wazi kwa namba hii.' : "I don't see an open booking on this number.";
    case 'not_offered': return S ? 'Hiyo haipo kwenye huduma zetu.' : "That isn't on our list of services.";
    case 'bye': return S ? 'Asante kwa kupiga simu. Kwaheri.' : 'Thank you for calling. Goodbye.';
    case 'drop_intent': return S ? 'Tuache booking kwa sasa. Kuna kingine ninaweza kukusaidia nacho?' : "Let's leave the booking for now. Is there anything else I can help with?";
    case 'decline': return S ? 'Sawa, sijahifadhi chochote. Kuna kingine?' : "Okay, I haven't saved anything. Anything else?";
    default: return '';
  }
}
const SW2EN = { 'karibu na': 'near', 'karibu ya': 'near', pale: 'at', 'mkabala na': 'opposite', 'mkabala ya': 'opposite', 'nyuma ya': 'behind', 'mbele ya': 'in front of' };
const EN2SW = { near: 'karibu na', 'next to': 'karibu na', opposite: 'mkabala na', 'across from': 'mkabala na', behind: 'nyuma ya' };
function remark(l, map) { for (const [k, v] of Object.entries(map)) if (l.toLowerCase().startsWith(k + ' ')) return `${v} ${l.slice(k.length + 1)}`; return l; }
const enMark = (l) => remark(l, SW2EN); const swMark = (l) => remark(l, EN2SW);
// Never-repeat rule: the same line twice in a row is re-worded (same facts, no new claims).
function vary(line, lang, n = 1, plain = false) {
  const S = sw(lang);
  const m = plain ? null : String(line).match(/^Tunahudumia (.+?)(?:\. Pia tuna maeneo mengine)?\. Uko wapi\?$/) || String(line).match(/^We serve (.+?)(?:\. We also cover other listed areas)?\. Which place are you in\?$/);
  if (m) return S ? `Maeneo yetu ni ${m[1]}. Uko mtaa gani hasa?` : `Our areas are ${m[1]}. Which estate are you in exactly?`;
  // An ack-led repeat drops the ack instead of swapping it (Okay -> Alright was still an ack).
  // An ack-led repeat drops the ack instead of swapping it (Okay -> Alright was still an ack).
  const ack = String(line).match(/^(?:Okay|Sawa|Haya|Alright|Sure)[.,] (.+)$/);
  if (ack && n < 2) return ack[1].charAt(0).toUpperCase() + ack[1].slice(1);
  // No "As I said" / "Just to repeat" filler (Alvin, 14 Oct): a repeat is said plainly.
  return line;
}
module.exports = { serviceCategories, vary, ask, readback, reaskQ, receipt, info, svcName, rowLabel };
