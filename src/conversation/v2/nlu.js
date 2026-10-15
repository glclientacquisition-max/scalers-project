'use strict';
// Deterministic caller-turn understanding for BA v2. Produces intent hints and
// normalised slot candidates; the state machine decides what to do with them.
const L = require('./lexicon');

const YES = /^\W*(yes|yeah|yep|yup|ok|okay|sure|correct|right|exactly|please do|go ahead|do it|ndio|ndiyo|eeh ndio|sawa|poa|fiti|kabisa|haya|yes please|iko sawa|iko poa|bila shaka|weka|book it|yap|sure thing)\b/i;
const NO = /^\W*(no|nope|not really|hapana|la|sitaki)\b|\b(that'?s wrong|si sawa|not correct)\b/i;
const DONE = /\b(kwa sasa hakuna|hakuna kitu|not now|nitawapigia|nitawaita|let me get back to you|i'?ll call (you )?back|that'?s all|nothing else|no thanks|hapana,? ni hayo tu|ni hayo tu|that is all|bye|goodbye|kwaheri)\b/i;
const NEG = /\b(not|no|wrong|hapana|si|sio|badala)\b/i;

const INTENT_RULES = [
  ['payment_change', /\b(m-?pesa number|payment details|pay to a different|different (m-?pesa|number to pay)|change (my )?payment|lipa kwa namba nyingine|badilisha (namba ya )?malipo)\b/i],
  ['address_change', /\b(come to .+ instead|change (the |my )?(address|location)|different (address|location)|new address|badilisha (anwani|mahali)|mje .+ badala)\b/i],
  ['cancel', /\b(cancel|cancell?ation|(ku)?futa (booking|appointment|ile)|(drop|remove|call off) (my|the) (\w+ )?(\w+ )?(booking|appointment|cleaning|visit)|sitaki tena|ondoa booking)\b/i],
  ['change', /\b(move my|reschedule|postpone|change my (booking|appointment|visit)|change (the )?(time|date)|badilisha (booking|siku|saa)|songesha)\b/i],
  ['complaint', /\b(not happy|unhappy|bad service|complain\w*|disappointed|left .{0,20}dirty|damaged|ruined|sijaridhika|mmeniharibia|mmeharibu|malalamiko|huduma mbaya)\b/i],
  ['handoff', /\b(manager|the owner|speak to (a |someone|somebody|the)|talk to (a |someone|the)|human|real person|mwenye biashara|meneja|call me back|call me later|callback|someone (to )?call me|nipigie( simu)?|mnipigie|anipigie|wanipigie)\b/i],
  ['explain', /\b(what do you mean by|what('?s| is| does) (a |the )?.{1,30} mean|don'?t understand what you('?re| are) saying by|what is (a |the )?\d|maana ya|inamaanisha nini|ni nini hiyo|sielewi (hiyo|hio|unasema|maana)|sijaelewa)\b/i],
  ['services', /\b(\w+ gani mnafanya|mnafanya (usafi|usasi|huduma|kazi) gani|services? gani|huduma gani|mnaofa\w*|mna-?offer\w*|mnauza\w* nini|which (exact )?services|what services|services (do )?you (do )?offer|mnafanya nini|mnatoa nini|gani (uko|mko) nayo|(uko|mko) nayo|saizi gani|sizes? (do you|gani)|mnawash\w*|mnasafisha|do you (clean|wash|do)\b)/i],
  ['coverage', /\b(where do you serve|which areas|do you serve|you (even )?serve outside|mnahudumia wapi|mnafika wapi|maeneo gani|do you cover|you( guys)? cover|uko wapi|mnahudumia \w+|outside (nairobi|the county|town|the city)|out of (nairobi|town)|beyond nairobi|nje ya (nairobi|kaunti|mji|town)|do you (come|go|travel|reach) (to|up to|as far as)|can you come to|mnaenda|mnafanya kazi nje|mnafanya (kazi )?(huko|maeneo)|niko outside|siishi \w+|sikai \w+|mfike huko|mtafika huko|mnafika huko|mnafika|mnakuja|mnafikana|mtafika|mko wapi|where are you( located)?|your location|location yenu|mnapatikana wapi|kama mnakuja)\b/i],
  ['recall', /\b(remember me|last time|what did i (book|order)|my last (visit|booking|order)|mara ya mwisho|mnanikumbuka|unanikumbuka|unakumbuka|do you remember|previous(ly)? (thing|dealing|call|order|booking)|in another call|before this call|i (had )?(spoke|spoken|talked) to you|tulifika wapi|tumeachia wapi|tulikuwa tumeachia|tumeongea|tulikuwa tumeongea|nilikuwa nimeitisha|nimekuongelesha|ile (mambo|kitu) (yetu )?ya jana|a while back)\b/i],
  ['want_know', /\b(nataka kujua|nilikuwa nataka kujua|nataka jua|nilitaka kujua|i wanted to (know|ask)|just inquiring|nataka kuuliza|nataka unisaidie|unisaidie|msaidia|hamwezi (ku)?nisaidia|nisaidie|maybe you tell me|you tell me|i don'?t know)\b/i],
  ['bot_q', /\b(are you (a |an )?(bot|robot|machine|ai|human|real)|(is this|am i (talking|speaking) (to|with)) (a )?(real person|human|robot|bot|machine|ai)|wewe ni (robot|roboti|binadamu|mtu kweli|mashine|ai)|naongea na (mtu kweli|robot|mashine)|hii ni (ai|robot|mashine)|uko binadamu)\b/i],
  ['hold', /^\W*(hold on|hang on|one (moment|minute|sec(ond)?)|just a (moment|minute|sec(ond)?)|wait,? let me|give me a (moment|minute|sec)|ngoja|subiri|nipe (dakika|sekunde))\b[^?]*$/i],
  ['who_are_you', /^\W*(nani|ni nani|who is this|who am i (speaking|talking) (to|with)|tunaitwaje( tena)?|unaitwa nani|wewe ni nani|unaitwaje|what'?s your name)\W*\??\W*$/i],
  ['payment_how', /\b(naweza (ku)?lipa|how (do|can) i pay|payment (method|options)|mnapokea (m-?pesa|pesa)|nilipe aje|malipo ni aje|lipa vipi)\b/i],
  ['greeting', /^\W*(oh,?\s*)?(habari( yako| zenu)?|niaje|mambo|sasa|hujambo|how are you|hello|hi)\W*(shy\W*)?(,?\s*(ni namna gani|mnaendelea aje|mko aje|how are you)\W*)?$/i],
  ['order', /\b(order|kuagiza|agiza|niwekee|buy|nunua|reserve|hold (one|two|\d))\b/i],
  ['book', /\b(book|booking|make a booking|ku-?book|kubook|schedule|appointment|to be (washed|cleaned)|(wash|clean) my|someone to come|mtu aje|mkuje|utume (hao )?watu|mtume (mtu|watu)|wakuje|waje kufanya|come (today|tomorrow|kesho|leo)|come (and|to) clean|kusafisha|kusafishiwa|nisafishiwe|usafi|tuieke|tuweke|niwekee booking|weka booking)\b/i],
  ['availability', /\b(in stock|available|do you have|mna\b|iko stock|ipo|mnayo|una\b)/i],
  ['price', /\b(how much|price|pricing|cost|charge|bei|pesa ngapi|shilingi ngapi|ni ngapi|ndio ngapi|ni bei gani|ngapi pesa|kiasi gani|ni kiasi)\b/i],
  ['hours', /\b(open|opening|close|closing|hours|fungua|mnafungua|unafungua|mnafunga|unafunga|funga|mnafanya kazi(?! nje| huko| maeneo)|mko wazi|working (days|hours)|operate until|until what time|mnafunga saa ngapi|saa za kazi)\b/i],
];
// "No wait, actually yes, book it" / "Hapana, ngoja, ndio, weka": the caller's last word wins
const REVERSE_YES = /\b(no|hapana)\b.{0,20}\b(actually|wait|ngoja|subiri)\b.{0,10}\b(yes|yeah|ndio|ndiyo)\b(?!.*\b(no|hapana)\b)/i;
function detectIntents(text) { return INTENT_RULES.filter(([, re]) => re.test(text)).map(([n]) => n); }

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
function tokens(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9- ]/g, ' ').split(/\s+/).filter(Boolean).map((w) => SYN[w] || w.replace(/s$/, '')); }
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
function matchArea(text, profile = {}) {
  // "outside Nairobi" names the base, not the caller's area: drop that phrase, keep the rest ("... I'm in Thika")
  text = String(text || '').replace(/\b(?:outside|out of|beyond|nje ya)\s+(?:the\s+)?[A-Za-z]+/gi, ' ');
  if (/\b(outside|siishi|sikai|not in|si wa)\b/i.test(text)) return null;
  const areas = (profile.serviceAreas?.areas || []).map((a) => String(a.id || '').split(':')[1]).filter(Boolean);
  const toks = String(text || '').toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter((w) => w.length >= 4);
  for (const a of areas) { const parts = a.split(' '); const key = parts[parts.length - 1]; if (toks.some((w) => w === key || (key.length >= 6 && lev(w, key) <= 2))) return { listed: true, name: a.replace(/\b\w/g, (c) => c.toUpperCase()) }; }
  const low = ` ${String(text || '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ')} `;
  for (const [county, places] of Object.entries(COUNTY_OF)) {
    if (!areas.includes(county)) continue;
    const hit = places.filter((p) => low.includes(` ${p} `)).sort((a, b) => b.length - a.length)[0];
    if (hit) return { listed: true, name: hit.replace(/\b\w/g, (c) => c.toUpperCase()), county: county.replace(/\b\w/g, (c) => c.toUpperCase()) };
  }
  const tx = String(text || '').replace(/\b(Of|In|Like|Kama|Mnafika|Mnakuja|Mtafika|Hadi|Cover|Niko|Nipo|Kwa|Na)\b/g, (m) => m.toLowerCase());
  const asked = tx.match(/\b(?:cover|niko|nipo|in|of|like|kama|na|kwa|si|fika|kuja|mnafika|mnakuja|mtafika|hadi|to)\s+([A-Z][a-z]{3,})/) || tx.match(KNOWN_AREAS);
  return asked ? { listed: false, name: asked[1] } : null;
}
function extractQuantity(text) { const m = String(text || '').toLowerCase().match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|moja|mbili|tatu|nne|tano|sita)\b/); return m ? L.toNum(m[1]) : null; }

function bareHour(t) { const n = Number(t.match(/(\d{1,2})/)[1]); if (n < 1 || n > 12) return null; const h = n <= 6 ? n + 12 : n; return { date: null, time: `${String(h).padStart(2, '0')}:00`, raw: String(n) }; }
const ACK = /^\W*(okay|ok|sawa|ni sawa|iko sawa|ndiyo|ndio|eeh|eh|yeah|yes|naam|mm-?hm|mmh|alright|fine|poa|haya|sure|for sure|i see|ah|oh|uh|a|aa)([\s,.!]+(okay|ok|sawa|ni sawa|tu|ndiyo|ndio|yeah|yes|shy|basi|kabisa|iko sawa|sawa sawa|nijulishe|asante|thanks|thank you|great|nice|that's nice))*\W*$/i;
const ASK_ITEM = /\b(?:mko na|mna|mnauza\w*|mnauzanga|do you (?:have|sell)|una(?:yo)?|na)\s+([a-z][a-z0-9 -]{2,30}?)(?:\s+(?:ni ngapi|ndio ngapi|zinakuja|inakuja|kwa|ya|in)\b.*)?\s*\??\s*$/i;
function askedItem(t) { const m = String(t || '').match(ASK_ITEM); if (!m) return null; const w = m[1].trim().replace(/\s+(like|tu|pia|also)$/i, ''); if (/^(wewe|mimi|issue|shida|nini|hiyo|hii|ile|kitu|vitu|any)\b/i.test(w) || w.split(/\s+/).length > 4) return null; return w; }
function understand(text, { profile = {}, now, expecting = null } = {}) {
  const t = String(text || '').trim();
  const intents = detectIntents(t);
  const isYes = YES.test(t) && !NEG.test(t.replace(/^\W*(yes|ndio)\W*/i, '').slice(0, 0));
  const name = extractName(t, { prompted: expecting === 'name' });
  return {
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
    when: L.parseWhen(t, now) || (expecting === 'time' && /^\W*(?:uh|um|ah|eh)?\W*(\d{1,2})\b/i.test(t) ? bareHour(t) : null),
    service: matchService(t, profile.servicesCatalog || []),
    products: matchProducts(t, profile.productCatalog || []),
    quantity: extractQuantity(t),
    area: matchArea(t, profile),
    ack: ACK.test(t),
    askedItem: askedItem(t),
    fragment: t.replace(/[^A-Za-z ]/g, ' ').trim().split(/\s+/).filter(Boolean).length <= 2 && !ACK.test(t),
    _yes: isYes,
  };
}
module.exports = { nonAnswer, cutOff, splitLandmark, extractLandmark, matchArea, understand, detectIntents, extractName, extractPlace, matchService, matchProducts, YES, NO };
