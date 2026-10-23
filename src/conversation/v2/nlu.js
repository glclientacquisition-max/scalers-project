'use strict';
// Deterministic caller-turn understanding for BA v2. Produces intent hints and
// normalised slot candidates; the state machine decides what to do with them.
const FS = require('../../knowledge/factStore');
const L = require('./lexicon');
const { listedAreaIds } = require('../listedAreas');

const YES = /^\W*(yes|yeah|yep|yup|ok|okay|sure|correct|right|exactly|please do|go ahead|do it|ndio|ndiyo|eeh ndio|sawa|poa|fiti|kabisa|haya|yes please|iko sawa|iko poa|bila shaka|weka|book it|yap|sure thing)\b/i;
const NO = /^\W*(no|nope|not really|hapana|la|sitaki)\b|\b(that'?s wrong|si sawa|not correct)\b/i;
const DONE = /\b(kwa sasa hakuna|hakuna kitu|not now|nitawapigia|nitawaita|let me get back to you|i'?ll call (you )?back|that'?s all|nothing else|no thanks|hapana,? ni hayo tu|ni hayo tu|that is all|bye|goodbye|kwaheri)\b/i;
const NEG = /\b(not|no|wrong|hapana|si|sio|badala)\b/i;

const INTENT_RULES = [
  ['payment_change', /\b(m-?pesa number|payment details|pay to a different|different (m-?pesa|number to pay)|change (my )?payment|lipa kwa namba nyingine|badilisha (namba ya )?malipo)\b/i],
  ['address_change', /\b(come to .+ instead|change (the |my )?(address|location)|different (address|location)|new address|badilisha (anwani|mahali)|mje .+ badala)\b/i],
  ['policy_cancel', /\b(cancellation policy|cancel(lation)? policy|what.{0,24}cancell|how.{0,24}cancell|reschedule policy)\b|^\W*cancell?ation\W*$/i],
  ['cancel', /\b(cancel|cancell?ation|(ku)?futa (booking|appointment|ile)|(drop|remove|call off) (my|the) (\w+ )?(\w+ )?(booking|appointment|cleaning|visit)|sitaki tena|ondoa booking)\b/i],
  ['change', /\b(move my|reschedule|postpone|change my (booking|appointment|visit)|change (the )?(time|date)|badilisha (booking|siku|saa)|songesha)\b/i],
  ['complaint', /\b(not happy|unhappy|bad service|complain\w*|disappointed|left .{0,20}dirty|damaged|ruined|sijaridhika|mmeniharibia|mmeharibu|malalamiko|huduma mbaya)\b/i],
  ['handoff', /\b(manager|the owner|speak to (a |someone|somebody|the)|talk to (a |someone|the)|human|real person|mwenye biashara|meneja|call me back|call me later|callback|someone (to )?call me|nipigie( simu)?|mnipigie|anipigie|wanipigie)\b/i],
  ['explain', /\b((hebu |naomba )?(niambie|nieleze|tueleze|nielezee) (zaidi |kiasi |kidogo )?(kuhusu|juu ya)|tell me (a bit |a little |more )?about (the |your |that |this )?\w+|what does (the |your )?.{1,30} (include|involve|cover)|what('?s| is) included in|maelezo ya|what do you mean by|what('?s| is| does) (a |the )?.{1,30} mean|don'?t understand what you('?re| are) saying by|what is (a |the )?\d|maana ya|inamaanisha nini|ni nini hiyo|sielewi (hiyo|hio|unasema|maana)|sijaelewa)\b/i],
  ['services', /\b(\w+ gani mnafanya|mnafanya (usafi|usasi|huduma|kazi) gani|services? gani|huduma gani|mnaofa\w*|mna-?offer\w*|mnauza\w* nini|which (exact )?services|what services|services (do )?you (do )?offer|mnafanya nini|mnatoa nini|gani (uko|mko) nayo|(uko|mko) nayo|saizi gani|sizes? (do you|gani)|mnawash\w*|mnasafisha|do you (clean|wash|do)\b)/i],
  ['coverage', /\b(where do you serve|which areas|do you serve|you (even )?serve outside|mnahudumia wapi|mnafika wapi|maeneo gani|do you cover|do you deliver|do you come|travel fee|delivery fee|fee to|fare|ada ya|usafiri|transport|you( guys)? cover|uko wapi|mnahudumia \w+|outside (nairobi|the county|town|the city)|out of (nairobi|town)|beyond nairobi|nje ya (nairobi|kaunti|mji|town)|do you (come|go|travel|reach) (to|up to|as far as)|can you come to|mnaenda|mnafanya kazi nje|mnafanya (kazi )?(huko|maeneo)|niko outside|siishi \w+|sikai \w+|mfike huko|mtafika huko|mnafika huko|mnafika|nafika|mnakuja|mnafikana|mtafika|mko wapi|where are you( located)?|your location|location yenu|mnapatikana wapi|kama mnakuja)\b|\bfair\b.{0,24}\b(kuja|come|to)\b/i],
  ['recall', /\b(remember me|last time|what did i (book|order)|my last (visit|booking|order)|mara ya mwisho|mnanikumbuka|unanikumbuka|unakumbuka|do you remember|previous(ly)? (thing|dealing|call|order|booking)|in another call|before this call|i (had )?(spoke|spoken|talked) to you|tulifika wapi|tumeachia wapi|tulikuwa tumeachia|tumeongea|tulikuwa tumeongea|nilikuwa nimeitisha|nimekuongelesha|ile (mambo|kitu) (yetu )?ya jana|a while back)\b/i],
  ['want_know', /\b(nataka kujua|nilikuwa nataka kujua|nataka jua|nilitaka kujua|i wanted to (know|ask)|just inquiring|nataka kuuliza|nataka unisaidie|unisaidie|msaidia|hamwezi (ku)?nisaidia|nisaidie|maybe you tell me|you tell me|i don'?t know)\b/i],
  ['bot_q', /\b(are you (a |an )?(bot|robot|machine|ai|human|real)|(is this|am i (talking|speaking) (to|with)) (a )?(real person|human|robot|bot|machine|ai)|wewe ni (robot|roboti|binadamu|mtu kweli|mashine|ai)|naongea na (mtu kweli|robot|mashine)|hii ni (ai|robot|mashine)|uko binadamu)\b/i],
  ['hold', /^\W*(hold on|hang on|one (moment|minute|sec(ond)?)|just a (moment|minute|sec(ond)?)|wait,? let me|give me a (moment|minute|sec)|ngoja|subiri|nipe (dakika|sekunde))\b[^?]*$/i],
  ['who_are_you', /^\W*(nani|ni nani|who is this|who am i (speaking|talking) (to|with)|tunaitwaje( tena)?|unaitwa nani|wewe ni nani|unaitwaje|what'?s your name)\W*\??\W*$/i],
  ['payment_how', /\b(naweza (ku)?lipa|how (do|can) i pay|do i pay|pay before|when do i (pay|lipa)|payment (method|options)|mnapokea (m-?pesa|pesa)|nilipe aje|nilipe kabla|malipo ni aje|lipa vipi|lipa kabla)\b/i],
  ['policy_returns', /\b(refunds?|returns?|exchange|rejesha|rudisha pesa)\b/i],
  ['policy_deposit', /\b(deposit|depo|down payment|malipo ya awali)\b/i],
  ['policy_warranty', /\b(warranty|guarantee|dhamana|garanti)\b/i],
  ['greeting', /^\W*(oh,?\s*)?(habari( yako| zenu)?|niaje|mambo|sasa|hujambo|how are you|hello|hi)\W*(shy\W*)?(,?\s*(ni namna gani|mnaendelea aje|mko aje|how are you)\W*)?$/i],
  ['order', /\b(order|kuagiza|agiza|niwekee|buy|nunua|reserve|hold (one|two|\d))\b/i],
  ['book', /\b(book|booking|make a booking|ku-?book|kubook|schedule|appointment|to be (washed|cleaned)|(wash|clean) my|someone to come|mtu aje|mkuje|utume (hao )?watu|mtume (mtu|watu)|wakuje|waje kufanya|come (today|tomorrow|kesho|leo)|come (and|to) clean|kusafisha|kusafishiwa|nisafishiwe|usafi|tuieke|tuweke|niwekee booking|weka booking)\b/i],
  ['availability', /\b(in stock|available|do you have|mna\b|iko stock|ipo|mnayo|una\b)/i],
  ['price', /\b(how much|price|pricing|cost|charge|bei|pesa ngapi|shilingi ngapi|ni ngapi|ndio ngapi|ni bei gani|ngapi pesa|kiasi gani|ni kiasi)\b/i],
  ['hours', /\b(open|opening|close|closing|hours|fungua|mnafungua|unafungua|mnafunga|unafunga|funga|mnafanya kazi(?! nje| huko| maeneo)|mko wazi|working (days|hours)|operate until|until what time|mnafunga saa ngapi|saa za kazi)\b/i],
];
// "No wait, actually yes, book it" / "Hapana, ngoja, ndio, weka": the caller's last word wins
const REVERSE_YES = /\b(no|hapana)\b.{0,20}\b(actually|wait|ngoja|subiri)\b.{0,10}\b(yes|yeah|ndio|ndiyo)\b(?!.*\b(no|hapana)\b)/i;
function cancelAskIsPolicy(text) {
  const t = String(text || '');
  if (/\b(my (booking|visit|appointment|clean)|cancel my|futa (booking|appointment)|sitaki tena|ondoa booking)\b/i.test(t)) {
    return false;
  }
  if (/^\W*cancell?ation\W*$/i.test(t)) return true;
  if (/\b(cancellation policy|cancel(?:lation)? policy|reschedule policy)\b/i.test(t)) return true;
  if (/\b(what|how|handle|gani|vipi|niacha)\b/i.test(t) && /\bcancel/i.test(t)) return true;
  if (/\b(kama niacha|niacha)\b/i.test(t)) return true;
  return false;
}

function detectIntents(text) {
  const intents = INTENT_RULES.filter(([, re]) => re.test(text)).map(([n]) => n);
  if (intents.includes('cancel') && cancelAskIsPolicy(text)) {
    return ['policy_cancel', ...intents.filter((i) => i !== 'cancel' && i !== 'policy_cancel')];
  }
  if (cancelAskIsPolicy(text) && !intents.includes('policy_cancel')) {
    return ['policy_cancel', ...intents];
  }
  return intents;
}

const STOP_NAME = new Set(['calling', 'speaking', 'here', 'fine', 'good', 'using', 'looking', 'trying', 'not', 'just', 'the', 'a', 'an', 'interested', 'okay', 'ok', 'sure', 'yes', 'no', 'in', 'at', 'from', 'with', 'sorry', 'well', 'mimi', 'ni', 'going', 'calling', 'wondering', 'happy', 'unhappy', 'new', 'old', 'so', 'like', 'can', 'what', 'uh', 'um', 'eeh', 'basically']);
const nameCase = (s) => s.split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
function cleanName(raw) {
  if (!raw) return null;
  raw = String(raw).replace(/\b(?:[A-Za-z][- ]){2,}[A-Za-z]\b/g, ' ').replace(/,.*$/, ''); // spelled-out letters and trailing clauses dropped
  const words = raw.replace(/[^A-Za-z' -]/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 3);
  const keep = [];
  for (const w of words) { if (STOP_NAME.has(w.toLowerCase())) break; keep.push(w); }
  if (!keep.length || keep.join('').length < 2) return null;
  return nameCase(keep.join(' '));
}
// A cut-off caller turn ("Hapana, n", "Uh, n") is never a slot answer: after the filler words
// nothing of 2+ letters is left, or it ends on a dangling single letter.
const FRAG_FILL = /^(uh|um|eh|eeh|ah|aa|hmm|mm|hapana|no|yes|ndio|sawa|okay|ok|so|na|ni|and|the)$/i;
function cutOff(text) {
  const ws = String(text || '').replace(/[^A-Za-z' ]/g, ' ').split(/\s+/).filter(Boolean);
  const content = ws.filter((w) => !FRAG_FILL.test(w));
  if (!content.length) return ws.length > 0 && /\b[a-z]$/i.test(String(text).trim()) ? true : false;
  return content.every((w) => w.length < 2) || (/\b[b-hj-z]$/i.test(String(text).trim()) && content[content.length - 1].length === 1);
}
// A bare known area ("Kitengela") given to a name question is not a name. Karen is also a first name.
function isBareArea(t) { const s = String(t || '').replace(/^\W*(uh|um|eeh|ni|in|at)\W+/i, '').replace(/[.!?,]+$/, '').trim(); const m = s.match(KNOWN_AREAS) || s.match(OTHER_TOWNS); return !!m && m[0] === s && s !== 'Karen'; }
// non-answers that must never fill a slot: ASR tags, line checks, holds, questions back
function nonAnswer(t) { const s = String(t || '').trim(); return !s || /^\W*$/.test(s) || /^\W*\[[^\]]*\]\W*$/.test(s) || /^\W*((hello|halo|hallo)\W*)+$/i.test(s) || /^\W*((uh|um|mm|hmm|eh)\W*)+$/i.test(s) || /^\W*(hold on|hang on|one (moment|minute|sec)|just a (moment|minute|sec)|wait|ngoja|subiri)\b/i.test(s); }
function extractName(text, { prompted = false } = {}) {
  const t = String(text || '');
  const pats = [/\b(?:just )?call me\s+([A-Za-z']+)/i, /\bniite\s+([A-Za-z']+)/i, /\bmy name is\s+([A-Za-z' ]+?)(?:[,.!?]| not | and |$)/i, /\b(?:jina langu ni|naitwa|ni mimi)\s+([A-Za-z' ]+?)(?:[,.!?]|$)/i,
    /\bi'?m speaking (?:with|to)?\s*([A-Za-z']+)/i, /\b(?:you'?re speaking (?:with|to)|unaongea na|naongea na|unazungumza na)\s+([A-Z][a-z']+)/i, /\b[Nn]i\s+([A-Z][a-z']+)\s*,?\s*(?:anapiga|napiga|hapa)/, /\b(?:this is|it'?s)\s+([A-Z][a-z']+(?: [A-Z][a-z']+)?)/, /\b[Ii]'?m\s+([A-Z][a-z']+)\b/, /\b[Ii] am\s+([A-Z][a-z']+)\b/, /\b([A-Z][a-z']+)\s+here\b/];
  for (const p of pats) { const m = t.match(p); if (m) { const n = cleanName(m[1]); if (n) return n; } }
  if (prompted && !cutOff(t) && !isBareArea(t) && !nonAnswer(t) && !/\d|\bsaa\b/i.test(t) && !L.parseWhen(t, new Date())) {
    const s = t.replace(/^\W*(it'?s|i'?m|ni|mimi ni|my name is|jina ni|yes|ndio)\W+/i, '').split(/,|\b(?:lakini|but)\b/i)[0].trim();
    const ws = s.split(/\s+/);
    // an estate/town ("Riverside, Westlands") answered to the name question is a place, not a name
    if (!/^karen\b/i.test(s) && Object.values(COUNTY_OF).some((ps) => ps.includes(s.toLowerCase().replace(/[.!?]+$/, '')))) return null;
    if (ws.length <= 3 && /^[A-Za-z]/.test(s)) return cleanName(s);
  }
  return null;
}
function extractCorrection(text) { const m = String(text || '').match(/\bnot\s+([A-Z][a-z']+)/); return m ? m[1] : null; }

const AREA_HINT = /\b(?:around|near|in|at|karibu na|pale|area ya|kwa)\s+([A-Z][A-Za-z]+(?:[ ,]+(?:near|karibu na)?\s*[A-Z][A-Za-z]+(?: [A-Z][a-z]+)*)?)/;
const COUNTY_OF = { kiambu: ['ruaka', 'ruiru', 'thika', 'juja', 'kikuyu', 'limuru', 'kiambu', 'banana', 'githunguri', 'kabete', 'wangige', 'kahawa wendani', 'membley', 'tatu city', 'karuri', 'gatundu', 'kiambaa', 'ndenderu'],
  nairobi: ['westlands', 'kilimani', 'karen', 'lavington', 'kileleshwa', 'kasarani', 'embakasi', 'langata', 'roysambu', 'donholm', 'umoja', 'parklands', 'south b', 'south c', 'kahawa sukari', 'kahawa west', 'githurai', 'zimmerman', 'kayole', 'buruburu', 'eastleigh', 'runda', 'gigiri', 'muthaiga', 'hurlingham', 'kawangware', 'kibera', 'dagoretti', 'utawala', 'ruai', 'pipeline', 'imara daima', 'kitisuru', 'riverside', 'upper hill', 'madaraka'],
  kajiado: ['kitengela', 'ongata rongai', 'rongai', 'ngong', 'kiserian', 'isinya'], machakos: ['syokimau', 'athi river', 'mlolongo'] };
const OTHER_TOWNS = /\b(Kisumu|Mombasa|Nakuru|Eldoret|Nyeri|Meru|Embu|Kakamega|Kisii|Malindi|Naivasha|Nanyuki|Machakos|Kericho|Bungoma|Garissa|Kitale|Ruaka|Ngong|Limuru|Thika|Kikuyu)\b/;
const KNOWN_AREAS = /\b(Kahawa Sukari|Kahawa West|Kitengela|Ruiru|Kasarani|Kilimani|Karen|Westlands|Lavington|Kileleshwa|Rongai|Syokimau|Thika|Juja|Embakasi|Langata|Ngong|Kahawa|Roysambu|Donholm|Umoja|Kikuyu|Parklands|South B|South C|Athi River|Kiambu)\b/;
// "Kitengela, near Naivas" / "Kitengela karibu na Naivas" / "Ruiru pale Total" / "Juja opposite the mall":
// the area before the marker is the place; the landmark after it is a note.
const LANDMARK = /(?:^|,\s*|\s+)(near|next to|opposite|opp\.?|across from|behind|karibu na|karibu ya|pale|mkabala na|mkabala ya|nyuma ya|mbele ya)\s+(.+?)\s*[.!?]*$/i;
function splitLandmark(text) {
  const t = String(text || ''); const m = t.match(LANDMARK);
  if (!m) return { before: t, landmark: null };
  const before = t.slice(0, m.index).replace(/[,\s]+$/, '');
  const rest = m[2].trim();
  if (!rest || rest.split(/\s+/).length > 6) return { before: t, landmark: null };
  const word = m[1].toLowerCase();
  return { before, landmark: `${word === 'opp' || word === 'opp.' ? 'opposite' : word} ${rest}` };
}
function extractLandmark(text) { const { before, landmark } = splitLandmark(text); return landmark && extractPlace(before, { prompted: true }) ? landmark : null; }
function extractPlace(text, { prompted = false } = {}) {
  const sp = splitLandmark(text);
  if (sp.landmark) { const area = extractPlaceCore(sp.before, { prompted: true }); if (area) return area; }
  return extractPlaceCore(text, { prompted });
}
function extractPlaceCore(text, { prompted = false } = {}) {
  const t = String(text || '');
  const known = t.match(KNOWN_AREAS);
  const m = t.match(AREA_HINT);
  if (m && !/^(Friday|Monday|Tuesday|Wednesday|Thursday|Saturday|Sunday|The)$/.test(m[1])) return m[1].replace(/\s+/g, ' ').trim();
  if (known) return known[1];
  if (prompted && !cutOff(t) && !nonAnswer(t)) { const s = t.replace(/^\W*(uh|um|eeh|it'?s|we are|i'?m|in|at|around|ni|tuko)\W+/i, '').replace(/[.!?]+$/, '').trim(); if (s && s.split(/\s+/).length <= 8) return s; }
  return null;
}

const GENERIC = new Set(['cleaning', 'clean', 'internal', 'standard', 'package', 'service', 'services', 'per', 'room', 'seat', 'add-on', 'the', 'and', 'up', 'to', 'sq', 'ft', 'interior', 'house', 'apartment']);
const SYN = { fridge: 'refrigerator', friji: 'refrigerator', viti: 'sofa', kiti: 'sofa', couch: 'sofa', couches: 'sofa', kochi: 'sofa', godoro: 'mattress', magodoro: 'mattress', zulia: 'carpet', dirisha: 'window', madirisha: 'window', windows: 'window', carpets: 'carpet', sofas: 'sofa', mattresses: 'mattress', ovens: 'oven', office: 'office', contract: 'contract' };
const WEAK = new Set(['deep', 'office', 'commercial', 'large', 'small', 'medium']);
function tokens(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9- ]/g, ' ').split(/\s+/).filter(Boolean).map((w) => (SYN[w] || w).replace(/s$/, '')); }
function matchService(text, catalog = []) {
  const tt = new Set(tokens(text));
  let best = null;
  for (const s of catalog) {
    const nt = tokens(s.name).filter((w) => !GENERIC.has(w) && w.length >= 3);
    let score = 0;
    for (const w of nt) if (tt.has(w)) score += WEAK.has(w) ? 0.5 : 1;
    if (score > 0 && (!best || score > best.score)) best = { score, s };
  }
  return best && best.score >= 0.5 ? best.s : null;
}
// C2 fact store (BRAIN_V2_FACT_STORE): bind from the typed store. Family words pick the rows, the
// caller's size words (EN/SW rooms, 1BR, studio, bedsitter, seaters, small/large) pick the variant;
// an unclear size or a tie is a choice to ask about, never the first row (A7).
const VARIANT_WORD = new Set(['bedroom', 'bed', 'br', 'seater', 'small', 'medium', 'large', 'mini', 'xl', 'studio', 'bedsitter', 'kg', 'litre']);
function famTokens(name) { return tokens(name).filter((w) => !GENERIC.has(w) && !VARIANT_WORD.has(w) && w.length >= 3 && !/^\d+$/.test(w)); }
function bindService(text, facts) {
  const svcs = facts?.services || [];
  if (!svcs.length) return { service: null, choice: null };
  const tt = new Set(tokens(text));
  const cv = FS.callerVariant(text);
  // score = family words heard; on a tie, the rows whose distinctive words were ALL heard beat rows
  // with unheard ones ("deep cleaning": Deep Cleaning Package over Oven Internal Deep Clean)
  const scored = svcs.map((s) => { const ft = [...new Set(famTokens(s.family))]; let score = 0; const heard = []; for (const w of ft) if (tt.has(w)) { score += WEAK.has(w) ? 0.5 : 1; heard.push(w); } return { s, score, heard: heard.sort().join(' '), cover: ft.length ? heard.length / ft.length : 0 }; });
  const max = Math.max(0, ...scored.map((x) => x.score));
  const top = scored.filter((x) => x.score === max);
  const best = Math.max(0, ...top.map((x) => x.cover));
  const topC = top.filter((x) => x.cover === best);
  // two services each named by their own words ("cancel the carpet, book the sofa") is two mentions,
  // not one unclear one: keep the old first-row reading (the machine splits the intents)
  if (max >= 0.5 && topC.length > 1 && new Set(topC.map((x) => x.heard)).size > 1) { const f = topC[0].s; return { service: { ...f.row, name: f.row.name || f.name, factId: f.id }, choice: null }; }
  let C = max >= 0.5 ? topC.map((x) => x.s) : (cv ? svcs.filter((s) => s.variant && s.variant.kind === cv.kind) : []);
  if (!C.length) return { service: null, choice: null };
  const svcOf = (f) => ({ ...f.row, name: f.row.name || f.name, factId: f.id });
  if (cv) {
    const exact = C.filter((s) => s.variant && s.variant.kind === cv.kind && s.variant.value === cv.value);
    if (exact.length === 1) return { service: svcOf(exact[0]), choice: null };
    if (exact.length > 1) C = exact;
    else if (C.length === 1) return { service: svcOf(C[0]), choice: null };
  } else if (C.length === 1) return { service: svcOf(C[0]), choice: null };
  if (C.length > 4) return { service: null, choice: null };
  const fams = new Set(C.map((s) => s.family));
  const axis = fams.size === 1 && C.every((s) => s.variant && s.variant.kind === C[0].variant.kind) ? 'size' : 'which';
  return { service: null, choice: { kind: 'service', axis, options: C.map((s) => s.id), asked: cv } };
}
function qtyNear(t, start, end) {
  if (start < 0) return null;
  const before = t.slice(Math.max(0, start - 14), start).match(/(?:^|\s)(\d+|one|two|three|four|five|six|seven|eight|nine|ten|a|an|moja|mbili|tatu|nne|tano)\s+(?:of\s+)?(?:\w+\s+)?$/);
  const after = t.slice(end, end + 14).match(/^\s+(moja|mbili|tatu|nne|tano|sita|\d+)\b/);
  return before ? L.toNum(before[1]) : after ? L.toNum(after[1]) : null;
}
// Items from the store: whole normalized tokens only; an ambiguous mention ("protractor" with two
// protractor rows) is a choice to ask about.
function factProducts(text, facts) {
  const t = String(text || '').toLowerCase();
  const brands = (t.match(BRANDS) || []).map((b) => b.toLowerCase());
  const { found, ambiguous } = FS.matchItems(text, facts);
  const products = found.filter(({ fact }) => !brands.some((b) => !fact.name.toLowerCase().includes(b))).map(({ fact, heard }) => {
    const want = new Set(heard.split(' '));
    const spans = []; const wre = /[a-z0-9]+/g; let wm; // caller words whose normalized form is a heard token ("diaries" -> diary)
    while ((wm = wre.exec(t))) if (FS.normTokens(wm[0]).some((x) => want.has(x))) spans.push([wm.index, wm.index + wm[0].length]);
    const start = spans.length ? Math.min(...spans.map((x) => x[0])) : -1; const end = spans.length ? Math.max(...spans.map((x) => x[1])) : -1;
    return { product_id: fact.id, name: fact.name, qty: qtyNear(t, start, end), in_stock: fact.row.in_stock, price: fact.row.price };
  });
  const amb = ambiguous[0];
  return { products, choice: amb ? { kind: 'item', axis: 'which', options: amb.options.map((p) => p.id) } : null };
}
const BRANDS = /\b(canon|hp|epson|samsung|lenovo|dell|brother|kyocera|xerox|ricoh)\b/gi;
function matchProducts(text, catalog = []) {
  const t = String(text || '').toLowerCase();
  const found = [];
  const brands = (t.match(BRANDS) || []).map((b) => b.toLowerCase());
  catalog.forEach((p, i) => {
    const names = [p.name, ...(p.aliases || [])].map((x) => x.toLowerCase());
    const pname = p.name.toLowerCase();
    const nameToks = pname.split(/\s+/).filter((w) => w.length >= 3);
    const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const hit = names.find((n) => new RegExp(`\\b${esc(n)}\\b`).test(t)) || nameToks.map((w) => w.replace(/[^a-z0-9-]/g, '')).filter((w) => w.length >= 3).find((w) => new RegExp(`\\b${esc(w)}s?\\b`).test(t));
    if (!hit) return;
    if (brands.some((b) => !pname.includes(b))) return; // asked for another brand: not ours
    const idx = t.indexOf(hit);
    const before = t.slice(Math.max(0, idx - 14), idx).match(/(\d+|one|two|three|four|five|six|seven|eight|nine|ten|a|an|moja|mbili|tatu|nne|tano)\s+(?:of\s+)?(?:\w+\s+)?$/);
    const after = t.slice(idx + hit.length, idx + hit.length + 14).match(/^\s+(moja|mbili|tatu|nne|tano|sita|\d+)\b/);
    const q = before ? L.toNum(before[1]) : after ? L.toNum(after[1]) : null;
    found.push({ product_id: p.id || `prd_${i}`, name: p.name, qty: q, in_stock: p.in_stock, price: p.price });
  });
  return found;
}
function lev(a, b) { const m = a.length, n = b.length; const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]); for (let j = 1; j <= n; j++) d[0][j] = j; for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[m][n]; }
// Tenant service areas only (serviceAreas.areas ids like place:kitengela, county:nairobi).
// Area clarify: a heard place that names two different places (Rongai: Ongata Rongai in Kajiado, or Rongai in Nakuru).
// Only groups that touch the tenant's own places are used; anything else is not our question to ask.
let PLACE_IDX = null;
const placeIdx = () => (PLACE_IDX ||= (() => { try { return require('../data/kenyaPlaceCounties.json').places || {}; } catch { return {}; } })());
const capW = (s) => String(s).replace(/\b\w/g, (c) => c.toUpperCase());
function areaAmbiguity(text, profile = {}) {
  const P = placeIdx(); const low = ` ${String(text || '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ')} `;
  const own = (profile.serviceAreas?.areas || []).map((a) => String(a.id || '').toLowerCase()); const ownPlaces = own.map((a) => a.split(':').pop());
  const ownCounties = own.filter((a) => a.startsWith('county:')).map((a) => a.slice(7));
  const counties = new Set(Object.values(P).flat());
  for (const k of Object.keys(P)) {
    if (k.length < 4 || counties.has(k) || !low.includes(` ${k} `)) continue;
    const longer = Object.keys(P).filter((x) => x !== k && x.endsWith(` ${k}`) && !/^(\w+ )?(cbd|town)$/.test(x.slice(0, -k.length - 1)) && x !== `${k} ${k}`);
    if (longer.some((x) => low.includes(` ${x} `))) continue; // caller already said the full name
    const opts = longer.map((x) => ({ name: capW(x), county: P[x][0] }));
    for (const c of P[k]) if (!opts.some((o) => o.county === c)) opts.push({ name: capW(k), county: c });
    if (opts.some((o) => low.includes(` ${o.county} `))) continue; // the county settles it
    if (new Set(opts.map((o) => o.county)).size < 2) continue;
    for (const o of opts) o.listed = ownPlaces.includes(o.name.toLowerCase()) || ownCounties.includes(o.county);
    if (!opts.some((o) => o.listed)) continue; // the group does not touch our places
    return { heard: capW(k), options: opts.slice(0, 3).map((o) => ({ ...o, county: capW(o.county) })) };
  }
  return null;
}
function matchArea(text, profile = {}) {
  // "outside Nairobi" names the base, not the caller's area: drop that phrase, keep the rest ("... I'm in Thika")
  text = String(text || '').replace(/\b(?:outside|out of|beyond|nje ya)\s+(?:the\s+)?[A-Za-z]+/gi, ' ');
  if (/\b(outside|siishi|sikai|not in|si wa)\b/i.test(text)) return null;
  const areas = listedAreaIds(profile);
  const toks = String(text || '').toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter((w) => w.length >= 4);
  for (const a of areas) { const parts = a.split(' '); const key = parts[parts.length - 1]; if (toks.some((w) => w === key || (key.length >= 6 && lev(w, key) <= 2))) return { listed: true, name: a.replace(/\b\w/g, (c) => c.toUpperCase()) }; }
  const low = ` ${String(text || '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ')} `;
  for (const [county, places] of Object.entries(COUNTY_OF)) {
    if (!areas.includes(county)) continue;
    const hit = places.filter((p) => low.includes(` ${p} `)).sort((a, b) => b.length - a.length)[0];
    if (hit) return { listed: true, name: hit.replace(/\b\w/g, (c) => c.toUpperCase()), county: county.replace(/\b\w/g, (c) => c.toUpperCase()) };
  }
  const tx = String(text || '').replace(/\b(Of|In|Like|Kama|Mnafika|Nafika|Mnakuja|Mtafika|Hadi|Cover|Niko|Nipo|Kwa|Na)\b/g, (m) => m.toLowerCase());
  const asked = tx.match(/\b(?:cover|niko|nipo|nafika|in|of|like|kama|na|kwa|si|fika|kuja|mnafika|mnakuja|mtafika|hadi|to)\s+([A-Z][a-z]{3,})/) || tx.match(KNOWN_AREAS);
  return asked ? { listed: false, name: asked[1] } : null;
}
function extractQuantity(text) { const m = String(text || '').toLowerCase().match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|moja|mbili|tatu|nne|tano|sita)\b/); return m ? L.toNum(m[1]) : null; }

function bareHour(t) { const n = Number(t.match(/(\d{1,2})/)[1]); if (n < 1 || n > 12) return null; const h = n <= 6 ? n + 12 : n; return { date: null, time: `${String(h).padStart(2, '0')}:00`, raw: String(n) }; }
const ACK = /^\W*(okay|ok|sawa|ni sawa|iko sawa|ndiyo|ndio|eeh|eh|yeah|yes|naam|mm-?hm|mmh|alright|fine|poa|haya|sure|for sure|i see|ah|oh|uh|a|aa)([\s,.!]+(okay|ok|sawa|ni sawa|tu|ndiyo|ndio|yeah|yes|shy|basi|kabisa|iko sawa|sawa sawa|nijulishe|asante|thanks|thank you|great|nice|that's nice))*\W*$/i;
const ASK_ITEM = /\b(?:mko na|mna|mnauza\w*|mnauzanga|do you (?:have|sell)|una(?:yo)?|na)\s+([a-z][a-z0-9 -]{2,30}?)(?:\s+(?:ni ngapi|ndio ngapi|zinakuja|inakuja|kwa|ya|in)\b.*)?\s*\??\s*$/i;
function askedItem(t) { const m = String(t || '').match(ASK_ITEM); if (!m) return null; const w = m[1].trim().replace(/\s+(like|tu|pia|also)$/i, ''); if (/^(wewe|mimi|issue|shida|nini|hiyo|hii|ile|kitu|vitu|any)\b/i.test(w) || w.split(/\s+/).length > 4) return null; return w; }
// Topic context (b401 T5): right after a services answer, "what exactly... which?" is a follow-up on that list
const TOPIC_FOLLOWUP = /\b(what exactly|which (ones?|services?|kind|type)|which\b|what (kind|type)s?|specifically|like what|such as|zipi|gani hasa|ipi hasa|aina gani|kama nini|nini hasa)\b/i;
// ---------------------------------------------------------------------------
// BRAIN_V2_NLU_GAPS (default off): nlu-gap-spec.md sections 0-6. Off: understand() reads
// exactly as before; only the additive confidence/clear/reason/kind fields are new.
const gapsOn = (o = {}) => (o.gaps != null ? !!o.gaps : /^(1|true|on|yes)$/i.test(String(process.env.BRAIN_V2_NLU_GAPS || '').trim()));
// §0 ASR pre-normaliser: intent and service reads only; slots keep the caller's original text.
const FILLER = /(?:^|\s)(?:(?<!\b(?:i'?d|would|i|we|you'?d|they'?d)\s)like|uh|um|eeh|you know|guys)(?=[\s,.!?]|$)[,]?/gi;
function normaliseAsr(text) {
  let s = String(text || '');
  s = s.replace(/\b(?:(?:one )?back room joining|joining services?)\b/gi, 'cleaning services')
    .replace(/\bservice is you offer\b/gi, 'services you offer')
    .replace(/\busasi\b/gi, 'usafi')
    .replace(/\b(mnawashangaa|mnaoshanga|mnadhanioshea|mnaziosha)\b/gi, 'mnaosha');
  s = s.replace(FILLER, ' ').replace(/\s+([,.!?])/g, '$1').replace(/\s{2,}/g, ' ').trim();
  return s;
}
// §1 which-services phrasings
const SERVICES_X = /\b(what else (can|do) you (do|offer)|what (else )?can you do|anything else you (do|offer)|which \w+ services|what \w+ services|services? (is |are |do )?you (do )?offer|which services?\b|(services|huduma|usafi) gani|gani mnap\w+|mnafanya nini (tena|zingine)|mnafanya (nini )?(ingine|zingine|tena)|nini (ingine|zingine) mnafanya|mko na \w+ gani|mna \w+ gani)\b/i;
// §3 explain phrasings
const EXPLAIN_X = /\b(remind me|tell me (more )?about|(more )?details (of|about|on|for)|what('?s| is) included|what does .{1,30} (include|involve)|niambie (zaidi )?kuhusu|nieleze|maelezo ya|inahusisha nini|inajumuisha nini)\b/i;
// §4 "do you do X?" service check (needs a catalogue hit)
const CHECK_X = /\b(do you (also )?(clean|wash|do|handle) \w+|mnaosha \w+|mnasafisha \w+|\w+ (mna|m)\w*osh\w*)\b|^\W*(mpaka|even|hata) [\w -]{2,30}\W*$/i;
// §5 "Wewe niambie" inside a services topic
const TELL_ME = /^\W*(wewe )?(niambie|tell me|you tell me|just tell me)\W*$/i;
// §2 Rule A / Rule B
const ELLIPTIC = /^\W*(for |like |ya |kwa )?(a |an |the )?[\w -]{2,40}?\W*(je|cleaning)?\W*$/i;
const AMOUNT = /\b\d{2,6}\s*(shillings?|bob|ksh|kes|\/=)?\b|\bpeke yake\b|\b(only|tu)\b\W*\??\W*$|\belfu\b/i;
// §3 GENERIC binding: "usafi wa apartment" binds when exactly one catalogue item carries the token.
function bindGeneric(text, catalog = []) {
  const m = String(text || '').toLowerCase().match(/\b(?:usafi|cleaning|clean)\s+(?:wa|ya|of|for)?\s*(?:the |a |an |hiyo |ile )?([a-z-]+)\b/);
  if (!m || !GENERIC.has(m[1])) return { service: null, candidates: [] };
  const c = catalog.filter((s) => tokens(s.name).includes(m[1]));
  return { service: c.length === 1 ? c[0] : null, candidates: c };
}
// §6c bare name: one capitalised token that is no service, place, lexicon or filler word
const NOT_NAME = /^(okay|ok|sawa|asante|karibu|thanks|hello|halo|hallo|hi|yes|no|ndio|ndiyo|hapana|like|mmh|eeh|haya|poa|fine|good|great|sure|right|yeah|nani|wewe|mimi|leo|kesho|jana|today|tomorrow|bye|kwaheri|pardon|sorry|what|why|when|where|who|how|stop|wait|ngoja|subiri|basi|tena|sasa|niulize|anduna|shy)$/i;
function bareName(t, profile) {
  // "Chris." / "Ni Wanjiru." / "Mimi ni Achieng." (§6c, EN + SW)
  const m = String(t || '').trim().match(/^\W*(?:(?:mimi\s+)?ni\s+)?([A-Z][a-z']{2,15})\W*$/i);
  if (m && !/^[A-Z]/.test(m[1])) return null;
  if (!m || NOT_NAME.test(m[1])) return null;
  if (matchService(m[1], profile.servicesCatalog || []) || matchProducts(m[1], profile.productCatalog || []).length) return null;
  if (isBareArea(m[1]) || Object.values(COUNTY_OF).some((ps) => ps.includes(m[1].toLowerCase())) || L.parseWhen(m[1], new Date())) return null;
  return nameCase(m[1]);
}
const CAT_KIND = { explain: 'explain_service', price: 'price_service', services: 'list_services', check: 'check_service', availability: 'check_availability' };
// Confidence per kind (0-1), clear (safe to act on without the model) and reason.
function scoreTurn(u, { rule = null, topic = null } = {}) {
  const has = (k) => u.intents.includes(k);
  const svc = !!u.service;
  if (rule) return { kind: rule.kind, confidence: rule.confidence, clear: rule.confidence >= 0.8, reason: rule.reason };
  if (has('check')) return svc ? { kind: 'check_service', confidence: 0.9, clear: true, reason: 'service_check' } : { kind: 'check_service', confidence: 0.4, clear: false, reason: 'no_service_id' };
  if (has('explain') || has('price')) {
    const kind = has('price') ? 'price_service' : 'explain_service';
    return svc ? { kind, confidence: 0.9, clear: true, reason: 'service_bound' } : { kind, confidence: 0.4, clear: false, reason: u.serviceCandidates?.length > 1 ? 'service_ambiguous' : 'no_service_id' };
  }
  if (has('services')) return has('book') ? { kind: 'list_services', confidence: 0.4, clear: false, reason: 'conflict_book' } : { kind: 'list_services', confidence: 0.9, clear: true, reason: u.followup ? 'services_followup' : 'services' };
  const tx = u.intents.find((i) => ['payment_change', 'address_change', 'cancel', 'change', 'complaint', 'handoff', 'order', 'book'].includes(i));
  if (tx) { const others = u.intents.filter((i) => i !== tx && i !== 'want_know'); return { kind: tx, confidence: others.length ? 0.6 : 0.8, clear: !others.length, reason: others.length ? 'mixed_intents' : 'rule' }; }
  if (u.intents.length) { const k = u.intents.find((i) => i !== 'want_know') || u.intents[0]; return { kind: CAT_KIND[k] || k, confidence: u.intents.length === 1 ? 0.8 : 0.6, clear: u.intents.length === 1, reason: u.intents.length === 1 ? 'rule' : 'mixed_intents' }; }
  if (u.yes && !u.no) return { kind: 'yes', confidence: 0.9, clear: true, reason: 'yes' };
  if (u.no) return { kind: 'no', confidence: 0.9, clear: true, reason: 'no' };
  if (u.done) return { kind: 'done', confidence: 0.85, clear: true, reason: 'done' };
  if (u.name) return { kind: 'give_name', confidence: 0.8, clear: true, reason: 'name' };
  if (u.when) return { kind: 'give_time', confidence: 0.8, clear: true, reason: 'when' };
  if (u.place || u.area) return { kind: 'give_place', confidence: 0.75, clear: true, reason: 'place' };
  if (u.ack) return { kind: 'ack', confidence: 0.85, clear: true, reason: 'ack' };
  return { kind: 'other', confidence: 0.2, clear: false, reason: topic ? 'empty_in_topic' : 'no_intent' };
}
function understand(text, { profile = {}, now, expecting = null, topic = null, prev = null, opening = false, gaps } = {}) {
  const t = String(text || '').trim();
  const G = gapsOn({ gaps });
  const norm = G ? normaliseAsr(t) : t;
  const intents = detectIntents(t);
  if (G && norm !== t) for (const i of detectIntents(norm)) if (!intents.includes(i)) intents.push(i);
  const catalog = profile.servicesCatalog || [];
  const FSON = FS.factStoreEnabled();
  const facts = FSON ? FS.factsFor(profile) : null;
  const bound = FSON ? bindService(G ? norm : t, facts) : null;
  let service = FSON ? bound.service : matchService(G ? norm : t, catalog);
  let serviceCandidates = [];
  let rule = null;
  if (G) {
    if (SERVICES_X.test(norm) && !intents.includes('services')) intents.push('services');
    if (EXPLAIN_X.test(norm) && !intents.includes('explain')) intents.push('explain');
    // §6b (HD_2847152f6c1e): "Mko na X?" / "Mnauza X?" is a stock question, answered before any order
    if (!intents.length && /^\W*(mko na|mnauza\w*|mnayo)\b/i.test(norm) && askedItem(norm)) intents.push('availability');
    if (!service && (intents.includes('explain') || intents.includes('price'))) { const b = bindGeneric(norm, catalog); service = b.service; serviceCandidates = b.candidates; }
    // §4: a named catalogue service in a "do you do X / mnaosha X / mpaka X?" turn is a service check, not a list
    if (service && CHECK_X.test(norm) && !intents.includes('price') && !intents.includes('book')) {
      for (const k of ['services', 'availability', 'want_know']) { const j = intents.indexOf(k); if (j >= 0) intents.splice(j, 1); }
      if (!intents.includes('explain')) intents.push('check');
    }
  }
  // "Hebu niambie kuhusu hiyo usafi wa apartment": a describe-me ask, not a booking ("usafi" alone is not book)
  if (intents.includes('explain') && intents.includes('book') && !/\b(book|booking|ku-?book|kubook|schedule|appointment|niwekee|weka booking|tuweke|tuieke)\b/i.test(t)) intents.splice(intents.indexOf('book'), 1);
  let followup = false;
  if (topic === 'services' && TOPIC_FOLLOWUP.test(t) && !intents.some((i) => ['book', 'cancel', 'change', 'price', 'hours', 'coverage', 'recall'].includes(i))) {
    const svc = matchService(t, profile.servicesCatalog || []);
    for (const i of ['want_know', 'bot_q']) { const k = intents.indexOf(i); if (k >= 0) intents.splice(k, 1); }
    if (svc && !intents.includes('explain')) intents.push('explain'); else if (!svc && !intents.includes('services')) intents.push('services');
    followup = true;
  }
  const isYes = YES.test(t) && !NEG.test(t.replace(/^\W*(yes|ndio)\W*/i, '').slice(0, 0));
  let name = extractName(t, { prompted: expecting === 'name' });
  const when0 = L.parseWhen(t, now);
  if (G) {
    const area0 = matchArea(t, profile); const place0 = extractPlace(t, { prompted: false });
    const words = norm.replace(/[^A-Za-z0-9 -]/g, ' ').split(/\s+/).filter(Boolean).length;
    const quiet = !intents.some((i) => !['want_know'].includes(i));
    const pk = prev && (prev.kind || (prev.intents || []).find((i) => ['price', 'explain', 'services'].includes(i)));
    const prevSvc = prev && (prev.service || null);
    // §2 Rule A: right after a price ask, a short "for (a) <service>?" is the price of that service
    if (!rule && /price/.test(pk || '') && service && quiet && words <= 8 && ELLIPTIC.test(norm.replace(/[—–]/g, ' '))) { intents.push('price'); rule = { kind: 'price_service', confidence: 0.85, reason: 'rule_a_pending_price' }; }
    // §2 Rule B: price topic on S and the caller echoes an amount ("ni 200 peke yake?") with no other service
    else if (!rule && /price/.test(pk || '') && prevSvc && (!service || service.name === prevSvc.name) && quiet && AMOUNT.test(t)) { intents.push('price'); service = prevSvc; rule = { kind: 'price_service', confidence: 0.85, reason: 'rule_b_price_echo' }; }
    // §5 "Wewe niambie" inside a services topic
    if (!rule && topic === 'services' && TELL_ME.test(t)) { for (const k of ['want_know']) { const j = intents.indexOf(k); if (j >= 0) intents.splice(j, 1); } if (!intents.includes('services')) intents.push('services'); rule = { kind: 'list_services', confidence: 0.85, reason: 'tell_me_in_topic' }; }
    // §6a a named service plus a date or a place is a booking; it outranks "which services do you offer?"
    if (!rule && service && (when0?.date || when0?.time || area0 || place0) && intents.includes('services') && !intents.includes('price') && !intents.includes('explain')) {
      intents.splice(intents.indexOf('services'), 1); if (!intents.includes('book')) intents.push('book');
      rule = { kind: 'book_service', confidence: 0.9, reason: 'book_outranks_list' };
    }
    // §6c a bare capitalised name at the opening or when a name is pending is the caller's name
    if (!rule && !name && !intents.length && (opening || expecting === 'name')) { const bn = bareName(t, profile); if (bn) { name = bn; rule = { kind: 'give_name', confidence: 0.6, reason: opening ? 'bare_name_opening' : 'bare_name_pending' }; } }
  }
  const itemsFs = FSON ? factProducts(t, facts) : null;
  const base = {
    text: t,
    intents,
    yes: YES.test(t) || REVERSE_YES.test(t),
    no: NO.test(t) && !YES.test(t) && !REVERSE_YES.test(t),
    done: DONE.test(t),
    negation: NEG.test(t),
    name,
    correctionOf: extractCorrection(t),
    place: extractPlace(t, { prompted: expecting === 'place' && !name && !L.parseWhen(t, now) && !intents.length }),
    landmark: extractLandmark(t),
    when: when0 || (expecting === 'time' && /^\W*(?:uh|um|ah|eh)?\W*(\d{1,2})\b/i.test(t) ? bareHour(t) : null),
    service,
    products: FSON ? itemsFs.products : matchProducts(t, profile.productCatalog || []),
    quantity: extractQuantity(t),
    area: matchArea(t, profile),
    ack: ACK.test(t),
    askedItem: askedItem(t),
    fragment: t.replace(/[^A-Za-z ]/g, ' ').trim().split(/\s+/).filter(Boolean).length <= 2 && !ACK.test(t),
    followup,
    _yes: isYes,
  };
  if (FSON) { const ch = (!service && bound.choice) || (!base.products.length && itemsFs.choice) || null; if (ch) base.choice = ch; }
  if (G) { base.serviceCandidates = serviceCandidates; base.normText = norm; if (!base.name && !rule && !intents.length) { const bn = bareName(t, profile); if (bn) base.nameCandidate = bn; } }
  const sc = scoreTurn(base, { rule, topic });
  base.kind = sc.kind; base.confidence = sc.confidence; base.clear = sc.clear; base.reason = sc.reason;
  return base;
}
module.exports = { normaliseAsr, scoreTurn, gapsOn, areaAmbiguity, nonAnswer, cutOff, splitLandmark, extractLandmark, matchArea, understand, detectIntents, cancelAskIsPolicy, extractName, extractPlace, matchService, matchProducts, bindService, factProducts, YES, NO };
