'use strict';
// Speech for BA v2. Every fact line is rendered from a typed receipt or a fixed
// ask/ladder template per language. Model text is never spoken.
const L = require('./lexicon');
const sw = (lang) => L.isSw(lang);
const priceTxt = (p, S) => String(p || '').replace(/^From\s+/i, S ? 'kuanzia ' : 'from ');
const svcName = (s) => String(s || '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
const period = (hhmm) => { const h = Number(String(hhmm).slice(0, 2)); return h < 12 ? 'asubuhi' : h < 16 ? 'mchana' : h < 19 ? 'jioni' : 'usiku'; };
const at = (when, lang) => (when?.time ? (sw(lang) ? ` ${L.sayTime(when.time, lang)}` : ` at ${when.time}`) : '');
const items = (xs, lang) => xs.map((x) => (sw(lang) ? `${x.name} ${x.qty}` : `${x.qty} ${x.name}`)).join(sw(lang) ? ' na ' : ' and ');

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
  complaint_more: { en: ["I'm sorry to hear that. Is there anything else the owner should know?"], sw: ['Pole sana. Kuna kingine mwenye biashara anapaswa kujua?'] },
  intent: { en: ['How can I help you today?', 'Sorry, are you calling to book, or about something else?'], sw: ['Karibu, tukusaidie vipi?', 'Samahani, unapiga kubook, ama ni kuhusu kitu kingine?'] },
};
function ask(slot, n, lang, ctx = {}) {
  const set = ASK[slot][sw(lang) ? 'sw' : 'en'];
  const xs = typeof set === 'function' ? set(ctx) : set;
  return xs[Math.min(n, xs.length - 1)];
}
function rowLabel(r, lang) { const d = r.when?.date; return sw(lang) ? `${svcName(r.service)} ya ${L.sayDate(d, lang)}` : `${svcName(r.service).toLowerCase()} on ${L.sayDate(d, lang)}`; }

function readback(p, lang) {
  const S = sw(lang);
  const nm = p.name ? (S ? `, kwa ${p.name}` : `, for ${p.name}`) : '';
  switch (p.tool) {
    case 'create_booking': return S ? `${svcName(p.service)}, ${L.sayDate(p.when.date, lang)}${at(p.when, lang)}${p.place ? `, ${p.place}` : ''}${p.landmark ? ` ${swMark(p.landmark)}` : ''}${nm}. Nithibitishe?` : `${svcName(p.service)} on ${L.sayDate(p.when.date, lang)}${at(p.when, lang)}${p.place ? ` in ${p.place}` : ''}${p.landmark ? `, ${enMark(p.landmark)}` : ''}${nm}. Shall I book it?`;
    case 'create_order': return S ? `${items(p.items, lang)}, kuchukua ${L.sayDate(p.pickup.date, lang)}${nm}. Nithibitishe?` : `${items(p.items, lang)}, pickup ${L.sayDate(p.pickup.date, lang)}${nm}. Shall I place the order?`;
    case 'cancel_booking': return S ? `Nifute ${rowLabel(p.row, lang)}${at(p.row.when, lang)}. Niendelee?` : `Cancel your ${rowLabel(p.row, lang)}${at(p.row.when, lang)}. Shall I go ahead?`;
    case 'update_booking': return S ? `Nihamishe ${svcName(p.row.service)} hadi ${L.sayDate(p.when.date, lang)}${at(p.when, lang)}. Niendelee?` : `Move your ${svcName(p.row.service).toLowerCase()} to ${L.sayDate(p.when.date, lang)}${at(p.when, lang)}. Shall I go ahead?`;
    case 'create_handoff': {
      const k = p.kind;
      if (k === 'address') return S ? 'Siwezi kubadilisha mahali kwenye simu hii. Nimwombe mwenye biashara akupigie simu, ni sawa?' : `I can't change the address on this call. Shall I ask the owner to call you back about ${p.place ? `moving it to ${p.place}` : 'it'}?`;
      if (k === 'payment') return S ? 'Siwezi kubadilisha malipo kwenye simu hii. Nimwombe mwenye biashara akupigie simu, ni sawa?' : "I can't change payment details on this call. Shall I ask the owner to call you back about it?";
      if (k === 'manager') return S ? 'Mwenye biashara hayupo kwenye simu sasa. Nimwombe akupigie simu, ni sawa?' : `The manager isn't on the line now. Shall I ask them to call you back${p.topic ? ` about the ${svcName(p.topic).toLowerCase()}` : ''}?`;
      return S ? 'Nimwombe mwenye biashara akupigie simu kumaliza hili, ni sawa?' : "Shall I ask the team to call you back to finish this?";
    }
    default: return '';
  }
}

function receipt(r, lang) {
  const S = sw(lang);
  if (!r.ok) return S ? 'Samahani, sikuweza kuhifadhi hilo sasa. Timu itakupigia simu.' : "Sorry, I couldn't save that just now. The team will call you back.";
  const more = S ? ' Kuna kingine?' : ' Anything else?';
  switch (r.tool) {
    case 'create_booking': return (S ? `Sawa, nimeweka ${svcName(r.service)} yako, ${L.sayDate(r.when.date, lang)}${at(r.when, lang)}.` : `Done, your ${svcName(r.service).toLowerCase()} is booked for ${L.sayDate(r.when.date, lang)}${at(r.when, lang)}.`) + more;
    case 'create_order': return (S ? `Sawa, nimehifadhi oda yako: ${items(r.items, lang)}, kuchukua ${L.sayDate(r.pickup.date, lang)}.` : `Done, I've placed your order: ${items(r.items, lang)}, pickup ${L.sayDate(r.pickup.date, lang)}.`) + more;
    case 'cancel_booking': return (S ? `Sawa, nimefuta ${rowLabel(r.row, lang)}.` : `Done, your ${rowLabel(r.row, lang)} is cancelled.`) + more;
    case 'update_booking': return (S ? `Sawa, nimebadilisha ${svcName(r.row.service)} hadi ${L.sayDate(r.when.date, lang)}${at(r.when, lang)}.` : `Done, your ${svcName(r.row.service).toLowerCase()} is moved to ${L.sayDate(r.when.date, lang)}${at(r.when, lang)}.`) + more;
    case 'create_handoff':
      if (r.kind === 'address' || r.kind === 'payment') return S ? 'Sawa. Mwenye biashara atakupigia simu. Kwa sasa, mabadiliko bado yanasubiri.' : 'Okay. The owner will call you back on this number. Until then, the change is still pending.';
      return (S ? 'Sawa. Mwenye biashara atakupigia simu kwa namba hii.' : (r.kind === 'manager' ? 'Okay. The manager will call you back on this number.' : 'Okay. The team will call you back on this number.')) + more;
    case 'log_complaint': return S ? 'Asante. Nimepeleka malalamiko yako kwa mwenye biashara, atakupigia simu. Kuna kingine?' : 'Thank you. Your complaint is with the owner, who will call you back. Anything else?';
    default: return '';
  }
}

function info(r, lang, n = 0) {
  const S = sw(lang);
  switch (r.kind) {
    case 'price': return r.found ? (S ? `Bei ya ${svcName(r.label)} ni ${priceTxt(r.price, true)}.` : `${svcName(r.label)} is ${priceTxt(r.price)}.`) : (S ? 'Sina bei ya hiyo kwenye orodha yetu. Ungependa mwenye biashara akupigie na bei?' : "I don't have a price for that on our list. Would you like the owner to call you with a quote?");
    case 'stock':
      if (r.found && /^(yes|true|in)/i.test(String(r.in_stock || ''))) return S ? `Kwa orodha yetu, ${r.label} inapatikana.` : `Our list shows ${r.label} in stock.`;
      return [S ? 'Siwezi kuthibitisha hiyo kwenye simu hii. Ungependa timu ikupigie simu?' : "I can't confirm that on this call. Would you like the team to call you back?",
        S ? 'Sina taarifa hiyo sasa hivi. Timu inaweza kukupigia simu, ungependa?' : "I don't have that information right now. The team can call you back. Would you like that?"][Math.min(n, 1)];
    case 'service_slot': return S ? `Tunafanya ${svcName(r.label)}, lakini siwezi kuthibitisha nafasi bila timu. Ungependa niweke ombi la booking?` : `We do offer ${svcName(r.label).toLowerCase()}, but I can't confirm a slot without the team. Would you like to make a booking request?`;
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
    case 'services': return S ? `Tunafanya ${r.names.map(svcName).join(', ')}${r.more ? ' na zaidi' : ''}. Ungependa ipi?` : `We do ${r.names.map(svcName).join(', ')}${r.more ? ', and more' : ''}. Which one would you like?`;
    case 'offered': return S ? `Ndio, tunafanya ${svcName(r.label)}${r.price ? `, bei ni ${priceTxt(r.price, true)}` : ''}. Ungependa kubook?` : `Yes, we do ${svcName(r.label).toLowerCase()}${r.price ? `, ${/^From/i.test(r.price) ? priceTxt(r.price) : `at ${r.price}`}` : ''}. Would you like to book?`;
    case 'coverage':
      if (r.area?.listed) return S ? `${r.area.name} iko kwenye orodha ya maeneo yetu. Timu itathibitisha ukibook.` : `${r.area.name} is on our list of service areas. The team confirms when you book.`;
      if (r.area) return S ? `${r.area.name} haiko kwenye orodha ya maeneo yetu. Timu inaweza kuangalia na kukupigia simu.` : `${r.area.name} isn't on our list of service areas. The team can check and call you back.`;
      return r.general ? (S ? `Tunahudumia ${r.general}${r.more ? ' na maeneo mengine' : ''}. Uko wapi?` : `We serve ${r.general}${r.more ? ' and other listed areas' : ''}. Which place are you in?`) : (S ? 'Uko wapi? Nitaangalia orodha ya maeneo yetu.' : "Which place are you in? I'll check our service areas.");
    case 'want_know': return [S ? 'Sawa, ungependa kujua kuhusu bei, huduma au saa za kazi?' : 'Sure, would you like to know about prices, services or our hours?', S ? 'Uliza tu, mfano bei ya carpet au saa tunafungua.' : 'Go ahead, for example a price or our opening hours.'][Math.min(n, 1)];
    case 'which_price': return S ? 'Bei ya huduma gani ungependa kujua?' : 'Which service would you like the price for?';
    case 'ack': return r.service ? (S ? `Sawa. Ungependa kubook ${svcName(r.service)}?` : `Okay. Would you like to book ${svcName(r.service).toLowerCase()}?`) : (S ? 'Sawa. Kuna kingine ninaweza kukusaidia nacho?' : 'Okay. Is there anything else I can help with?');
    case 'who': return S ? `Unaongea na ${r.agent}, wa ${r.biz}. Tukusaidie na usafi gani?` : `You're speaking with ${r.agent} from ${r.biz}. What can we clean for you?`;
    case 'greet_name': return S ? `${r.name}, unahitaji huduma gani leo?` : `Thanks, ${r.name}. Which service do you need today?`;
    case 'off_catalogue': return S ? `Sina ${r.item} kwenye orodha yetu. ${r.hint ? `Tunafanya ${r.hint}.` : ''}`.trim() : `${r.item} isn't on our list. ${r.hint ? `We do ${r.hint}.` : ''}`.trim();
    case 'payment_how': return r.methods ? (S ? `Tunapokea ${r.methods}.` : `We accept ${r.methods}.`) : (S ? 'Sina maelezo ya malipo kwenye orodha yetu.' : "I don't have payment details on our list.");
    case 'greeting': return S ? 'Nzuri, asante. Ungependa huduma gani?' : "I'm well, thank you. Which service do you need?";
    case 'repair': return S ? 'Samahani, sijakusikia vizuri. Unaweza kurudia?' : "Sorry, I didn't catch that. Could you say it again?";
    case 'no_rows': return S ? 'Sioni booking iliyo wazi kwa namba hii.' : "I don't see an open booking on this number.";
    case 'not_offered': return S ? 'Hiyo haipo kwenye huduma zetu.' : "That isn't on our list of services.";
    case 'bye': return S ? 'Asante kwa kupiga simu. Kwaheri.' : 'Thank you for calling. Goodbye.';
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
  const m = plain ? null : String(line).match(/^Tunahudumia (.+?)(?: na maeneo mengine)?\. Uko wapi\?$/) || String(line).match(/^We serve (.+?)(?: and other listed areas)?\. Which place are you in\?$/);
  if (m) return S ? `Maeneo yetu ni ${m[1]}. Uko mtaa gani hasa?` : `Our areas are ${m[1]}. Which estate are you in exactly?`;
  // An ack-led repeat drops the ack instead of swapping it (Okay -> Alright was still an ack).
  const ack = String(line).match(/^(?:Okay|Sawa|Haya|Alright|Sure)[.,] (.+)$/);
  if (ack && n < 2) return ack[1].charAt(0).toUpperCase() + ack[1].slice(1);
  const lead = S ? ['Kama nilivyosema,', 'Narudia,'][n % 2] : ['As I said,', 'Just to repeat,'][n % 2];
  return `${lead} ${line.charAt(0).toLowerCase()}${line.slice(1)}`;
}
module.exports = { vary, ask, readback, receipt, info, svcName, rowLabel };
