// BRAIN_TRUST_P1 — Phase 1 trust fixes (/workspace/briefs/phase1-trust-brief.md).
// On only when the env value is exactly 'on'. Flag off: every hook returns the
// input unchanged / null, so calls behave as on main (flag-off parity).
//
// T1 receipt gate + readback, address/payment → owner callback
// T2 recall guard, relevance/recency, caller correction
// T3 resume pointer TTL (4 turns or topic change)
// T4 once-per-caller notes notice
// T5 one shared name-ask counter (max 2, never after refused/bound)
// T6 catalogue-family slot words, hours anchor
// T8 staff-name redaction, ~30-word trim, call-language lines
// Returning-caller identity tiers (new / known / bound; shared line stays known).

const FLAG = 'BRAIN_TRUST_P1';
const RESUME_TTL_TURNS = 4;
const CLOSED_TTL_DAYS = 30;
const TOPIC_TTL_DAYS = 60;
const MAX_NAME_ASKS = 2;
const MAX_WORDS = 30;
const DAY = 86400000;

function trustP1Enabled() {
  return String(process.env[FLAG] || '').trim() === 'on';
}

function lang2(language) {
  const v = String(language || 'en').toLowerCase();
  return v === 'sw' || v.startsWith('swahili') || v === 'sheng' ? 'sw' : 'en';
}

function trustState(state) {
  if (!state || typeof state !== 'object') return {};
  state.trust ||= { nameAsks: 0, nameRefused: false, noticeSpoken: false, resume: null, blockedRows: [], reviewFlags: [], anchors: {} };
  return state.trust;
}

function splitSentences(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function words(text) {
  return String(text || '').split(/\s+/).filter(Boolean);
}

// ------------------------------------------------------------- T1 receipts

/** Success words a model may only say when the turn carries a tool receipt. */
const SUCCESS_WORDS =
  /\b(?:i(?:'ve| have)\s+(?:saved|booked|sent|recorded|noted|logged|updated|changed|reserved|scheduled)|(?:is|has been|have been|was|are)\s+(?:saved|booked|sent|recorded|logged|updated|changed|reserved|scheduled)|all\s+(?:set|saved|booked)|nimehifadhi|nimeweka|nimetuma|nimeandika|nimesasisha|nimebadilisha|imehifadhiwa|imetumwa|imewekwa|imebadilishwa|nime-?(?:save|book|update))\b/i;

const UPDATED_WORDS =
  /\b(?:updated|changed|has been (?:updated|changed)|nimesasisha|nimebadilisha|imebadilishwa|imesasishwa|nime-?update)\b/i;

const OK_STATUSES = new Set(['succeeded', 'updated', 'duplicate']);
const SAVE_ACTIONS = new Set(['create_appointment', 'update_appointment', 'create_service_request', 'escalate']);

function receiptsOf(results = []) {
  return (Array.isArray(results) ? results : []).filter(
    (r) => r && SAVE_ACTIONS.has(r.action) && OK_STATUSES.has(r.status) && (r.id || r.record || r.status === 'duplicate' || r.value)
  );
}

const FILLER_ONLY = /^(?:\s|um+|uh+|er+|eh+|ah+|hmm+|mm+|okay|ok|yeah|yes|no|sawa|ndio|eeh|aah|like|so|the|a|na|si)*$/i;

/** Empty, filler-only or garbled save content: no row, ask again. */
function isGarbledContent(value) {
  const v = String(value || '').trim();
  if (!v) return true;
  if (FILLER_ONLY.test(v)) return true;
  const letters = (v.match(/\p{L}/gu) || []).length;
  if (letters < 2) return true;
  // STT garbage: mostly non-letters or one char repeated.
  if (letters / v.length < 0.5) return true;
  if (/^(.)\1{3,}$/u.test(v.replace(/\s+/g, ''))) return true;
  return false;
}

/** v3: the readback for a save already read back this call (or a duplicate). */
function alreadySavedLine(language = 'en') {
  return lang2(language) === 'sw' ? 'Hiyo tayari imehifadhiwa.' : "That's already saved.";
}

/** Key of a receipt for per-call readback dedupe. */
function receiptKey(r) {
  const v = r?.value || r?.record || {};
  const item = String(v.item || v.summary_item || v.serviceName || v.service_name || '').trim().toLowerCase();
  return `${r?.action || ''}|${item}` || String(r?.id || '');
}

/**
 * v3 save gate: a booking-intent request (not a callback/hold) needs a when.
 * Returns the missing slot or ''.
 */
function saveMissingSlot(request = {}, state = {}) {
  if (!trustP1Enabled() || !request) return '';
  const type = String(request.type || 'enquiry').toLowerCase();
  if (['callback', 'hold', 'hold_or_pickup', 'address_change', 'payment_change'].includes(type)) return '';
  const goal = String(state?.goal?.primary || '');
  const booking = goal === 'make_booking_request' || /\b(?:book|booking|schedule|come)\b/i.test(String(request.notes || ''));
  if (!booking) return '';
  const when = String(request.whenText || '').trim();
  return when ? '' : 'when_text';
}

const PLACE_ASK = /\b(?:where (?:should|shall|do|can) we come|which (?:estate|building|area|place|apartment)|what(?:'s| is) the (?:address|location|building|estate)|tukuje wapi|mahali gani|uko wapi)\b/i;

/**
 * v3: an address answer that came out as broken fragments ("Hamil. Tone.")
 * is not saved; ask once to repeat it.
 */
function unclearPlaceAnswer(callerText, lastAgentText) {
  if (!trustP1Enabled() || !PLACE_ASK.test(String(lastAgentText || ''))) return false;
  const raw = String(callerText || '').trim();
  const parts = raw.split(/[.!?]+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return false;
  const tiny = parts.filter((p) => p.split(/\s+/).length === 1 && p.length <= 6).length;
  return tiny >= 2;
}

function placeRepairLine(language = 'en') {
  return lang2(language) === 'sw'
    ? 'Samahani, sikusikia jina la mahali vizuri. Tafadhali rudia jina la jengo au estate.'
    : "Sorry, I didn't catch the place clearly. Could you say the building or estate name again?";
}

function repairAskLine(language = 'en') {
  return lang2(language) === 'sw'
    ? 'Samahani, sikusikia vizuri. Unahitaji nini hasa, na ngapi?'
    : "Sorry, I didn't catch that clearly. What exactly do you need, and how many?";
}

const ROLE = {
  en: { owner: 'the owner', team: 'our team' },
  sw: { owner: 'mwenye duka', team: 'timu yetu' },
};

/**
 * Receipt readback: `Saved: {items/qty}, {when}. Next: {role} will {action} {by when}.`
 * Built only from tool results; '' when there is no receipt.
 */
function receiptReadback(results = [], language = 'en', { byWhen = '' } = {}) {
  const l = lang2(language);
  const rows = receiptsOf(results);
  if (!rows.length) return '';
  const r = rows[0];
  const v = r.value || r.record || {};
  const item = String(v.item || v.summary_item || v.serviceName || v.service_name || '').trim();
  const qty = v.quantity != null && String(v.quantity).trim() ? String(v.quantity).trim() : '';
  const when = String(v.whenText || v.when_text || '').trim();
  const type = String(v.type || r.requestType || (r.action === 'create_appointment' ? 'visit' : '')).toLowerCase();
  const what = [qty, item].filter(Boolean).join(' ') || (l === 'sw' ? 'ombi lako' : 'your request');
  const by = String(byWhen || '').trim();
  if (r.status === 'duplicate') {
    return l === 'sw' ? `Tayari iko kwenye rekodi: ${what}.` : `That's already on file: ${what}.`;
  }
  let next;
  if (l === 'sw') {
    next = type === 'callback' || type === 'address_change' || type === 'payment_change'
      ? `${cap(ROLE.sw.owner)} atakupigia${by ? ` ${by}` : ''}.`
      : `${cap(ROLE.sw.team)} itathibitisha${by ? ` ${by}` : ''}.`;
    return `Imehifadhiwa: ${what}${when ? `, ${when}` : ''}. Hatua inayofuata: ${next}`;
  }
  next = type === 'callback' || type === 'address_change' || type === 'payment_change'
    ? `${ROLE.en.owner} will call you back${by ? ` ${by}` : ''}.`
    : `${ROLE.en.team} will confirm${by ? ` ${by}` : ''}.`;
  return `Saved: ${what}${when ? `, ${when}` : ''}. Next: ${next}`;
}

function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

// ------------------------------------------------ T1 address / payment change

const ADDRESS_CHANGE =
  /\b(?:change|update|new|different|move|correct)\b[^.?!]{0,30}\b(?:address|location|delivery (?:place|point|address))\b|\b(?:ku)?(?:badilisha|badili)\b[^.?!]{0,30}\b(?:anwani|mahali pa delivery|location)\b|\banwani\b[^.?!]{0,20}\b(?:mpya|badilisha)\b/i;
const PAYMENT_CHANGE =
  /\b(?:change|update|new|different|switch)\b[^.?!]{0,30}\b(?:payment|pay(?:ing)? (?:method|number|details)|mpesa number|card|till)\b|\b(?:confirm|confirming)\b[^.?!]{0,20}\bpayment\b|\b(?:ku)?(?:badilisha|thibitisha)\b[^.?!]{0,30}\b(?:malipo|namba ya mpesa)\b/i;

function detectSensitiveChange(text) {
  const t = String(text || '');
  if (ADDRESS_CHANGE.test(t)) return 'address';
  if (PAYMENT_CHANGE.test(t)) return 'payment';
  return '';
}

function changeTaskType(kind) {
  return kind === 'payment' ? 'payment_change' : 'address_change';
}

function pendingChangeTask(tasks = [], kind) {
  const type = changeTaskType(kind);
  return (Array.isArray(tasks) ? tasks : []).find(
    (t) => t && (String(t.type) === type || new RegExp(type.replace('_', '.?'), 'i').test(String(t.summary_item || t.next_step || ''))) && !t.closed_at
  ) || null;
}

/** Words the caller gave for the new value (after "to" / "ni"), trimmed. */
function newValueOf(text) {
  const m = String(text || '').match(/\b(?:to|is now|iwe|ni|kwa)\s+(.{3,80})$/i);
  return m ? m[1].replace(/[.?!]+$/, '').trim() : '';
}

/**
 * Plan for an address/payment change ask. Never "updated":
 *  - an open change task already on file → 'still pending' line, no new task;
 *  - otherwise → owner callback task + honest line.
 */
function planSensitiveChange({ text = '', state = {}, tasks = [], language = 'en', byWhen = '' } = {}) {
  if (!trustP1Enabled()) return null;
  const kind = detectSensitiveChange(text);
  if (!kind) return null;
  const l = lang2(language);
  const pending = pendingChangeTask(tasks, kind) || (state?.trust?.changeTasks || []).find((t) => t.kind === kind);
  if (pending) {
    return {
      kind: 'pending',
      change: kind,
      line: l === 'sw'
        ? 'Mabadiliko hayo bado yanasubiri; mwenye duka atakupigia kuthibitisha.'
        : 'That change is still pending; the owner will call you to confirm.',
    };
  }
  const x = l === 'sw' ? (kind === 'payment' ? 'malipo' : 'anwani') : kind === 'payment' ? 'payment details' : 'address';
  const xNew = l === 'sw' ? (kind === 'payment' ? 'maelezo ya malipo' : 'anwani') : kind === 'payment' ? 'payment details' : 'address';
  const when = String(byWhen || '').trim() || (l === 'sw' ? 'leo' : 'today');
  const line = l === 'sw'
    ? `Siwezi kubadilisha ${x} kwa simu. Nimeandika ${xNew} mpya, na mwenye duka atakupigia kuthibitisha ${when}.`
    : `I can't change your ${x} on a call. I've noted the new ${xNew}, and the owner will call you back to confirm ${when}.`;
  const value = newValueOf(text);
  return {
    kind: 'callback',
    change: kind,
    line,
    parsed: {
      serviceRequest: {
        type: 'callback',
        name: String(state?.caller?.name || 'Caller'),
        item: changeTaskType(kind),
        whenText: when,
        notes: `Caller asked to change ${kind}${value ? ` to: ${value}` : ''}. Not changed on the call; owner to confirm.`.slice(0, 240),
      },
      brainRescue: true,
      trustChange: kind,
    },
  };
}

function noteChangeTask(state, kind) {
  const t = trustState(state);
  t.changeTasks = [...(t.changeTasks || []), { kind, at: Date.now() }];
}

// ------------------------------------------------------------ T2 recall guard

const PAST_CLAIM =
  /\b(?:you (?:asked|said|told|ordered|wanted|called|mentioned|booked|requested)|last time|(?:i|we) remember|as you (?:said|mentioned)|previously you|uliuliza|ulisema|uliagiza|uliomba|ulipiga|mara ya mwisho|nakumbuka|tunakumbuka)\b/i;

const HISTORY_REF =
  /\b(?:your (?:previous|last|past|earlier|old|other) (?:\w+ )?(?:inquiry|enquiry|request|booking|visit|order|call|callback)|previous (?:inquiry|enquiry|request|booking)|on (?:your|the) file|ombi lako la (?:awali|zamani)|booking yako ya (?:awali|zamani))\b/i;
const CLOSED_TALK = /\b(?:was|were|has been|have been|is|are)\s+(?:fulfilled|cancell?ed|completed|closed|done)\b|\b(?:fulfilled|cancell?ed)\b|\bilikamilika\b|\bilighairiwa\b/i;

const FILE_LINE_TEMPLATES = new Set(['visit_open', 'request_open', 'requested_at', 'past_open', 'past_row', 'more_open']);

function turnHasFileLine(state) {
  const conv = state?.conversation || {};
  const lines = Array.isArray(conv.pendingBrainLines) ? conv.pendingBrainLines : [];
  if (lines.some((l) => l && FILE_LINE_TEMPLATES.has(l.template))) return true;
  return Boolean(state?.trust?.fileReadTurn != null && state.trust.fileReadTurn === Number(conv.turnCount || 0));
}

function notOnFileLine(language = 'en') {
  return lang2(language) === 'sw' ? 'Sina hiyo kwenye rekodi.' : "I don't have that on file.";
}

// ---------------------------------------------- identity tiers + relevance

/**
 * 0 new number · 1 known number (no details) · 2 name confirmed (details ok).
 * A shared line never goes above 1.
 */
function identityTier(card, state) {
  if (!card || card.known === false) return 0;
  const shared = Boolean(card.sharedLine || card.shared_line);
  const bound = state?.caller?.nameConfirmed === true;
  if (bound && !shared) return 2;
  return 1;
}

function welcomeBackLine(language = 'en') {
  return lang2(language) === 'sw' ? 'Karibu tena.' : 'Welcome back.';
}

const SW_HINT = /\b(?:karibu|habari|tukusaidie|nikusaidie|naweza|vipi|leo|jina|lako|ninaongea|tunaweza|asante|sasa|tumefunga)\b/i;
const INVITE_HINT = /\?\s*$|\b(?:how can (?:i|we) help|what can (?:i|we) do|help you|may i have your name|am i speaking with|tukusaidie|nikusaidie|tukuhudumie|naomba jina|ninaongea na)\b/i;

function sentenceIsSwahili(sentence) {
  return SW_HINT.test(String(sentence || ''));
}

function inviteLine(language = 'en') {
  return lang2(language) === 'sw' ? 'Nikusaidie vipi?' : 'How can I help you today?';
}

/**
 * v2 opening (Alvin 13 Oct): ONE string, tenant greeting as is. A known
 * number gets a short "welcome back" clause placed right before the
 * tenant's closing invitation, so the invitation is always the last
 * sentence. No notice, no language invite, no name, no details.
 */
function tieredGreeting(greeting, { card = null } = {}) {
  let g = String(greeting || '').trim();
  if (!trustP1Enabled()) return g;
  let parts = splitSentences(g);
  if (parts.length && !INVITE_HINT.test(parts[parts.length - 1])) {
    parts.push(inviteLine(sentenceIsSwahili(parts[parts.length - 1]) ? 'sw' : 'en'));
  }
  if (card && identityTier(card, {}) >= 1) {
    const closing = parts[parts.length - 1] || '';
    const wb = welcomeBackLine(sentenceIsSwahili(closing) ? 'sw' : 'en');
    const already = parts.some((p) => /\b(?:welcome back|karibu tena)\b/i.test(p));
    if (!already) parts.splice(Math.max(parts.length - 1, 0), 0, wb);
  }
  return parts.join(' ').trim();
}

function taskDate(t) {
  const v = t?.closed_at || t?.updated_at || t?.created_at;
  const d = v ? Date.parse(v) : NaN;
  return Number.isNaN(d) ? null : d;
}

function isClosed(t) {
  const s = String(t?.status || '').toLowerCase();
  return Boolean(t?.closed_at) || ['fulfilled', 'cancelled', 'done', 'closed'].includes(s);
}

function topicWords(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map((w) => w.replace(/s$/, ''))
  );
}
const STOP = new Set(['the', 'and', 'for', 'you', 'have', 'want', 'need', 'about', 'with', 'that', 'this', 'what', 'call', 'calling', 'nataka', 'kuhusu', 'hiyo', 'yangu', 'wako', 'your', 'my', 'still', 'please', 'can', 'there', 'are', 'yes', 'yeah', 'speaking', 'name', 'jina', 'langu', 'mimi', 'ndio', 'ndiyo', 'here', 'its', 'it\'s', 'sawa', 'okay']);

/**
 * Relevance + recency: closed >30d and anything >60d never read; open rows
 * only when tied to the caller's topic (if one is given); rows the caller
 * corrected this call are never reused.
 */
function relevantTasks(tasks = [], { topic = '', now = Date.now(), state = null } = {}) {
  const blocked = new Set((state?.trust?.blockedRows || []).map(String));
  const want = topicWords(topic);
  return (Array.isArray(tasks) ? tasks : []).filter((t) => {
    if (!t) return false;
    if (blocked.has(String(t.task_id || t.id))) return false;
    if (taskDate(t) == null) return false;
    // v3: the one history policy decides open + recent.
    if (!require('./callerHistoryPolicy').rowAllowed(t, now)) return false;
    if (!want.size) return true;
    const have = topicWords(`${t.summary_item || ''} ${t.type || ''} ${t.next_step || ''}`);
    for (const w of want) if (have.has(w)) return true;
    return false;
  });
}

/** last_topic is only usable within 60 days. */
function usableLastTopic(file, now = Date.now()) {
  const topic = String(file?.last_topic || file?.lastTopic || '').trim();
  const at = Date.parse(file?.last_topic_at || file?.lastTopicAt || '');
  if (!topic || Number.isNaN(at)) return '';
  return (now - at) / DAY > TOPIC_TTL_DAYS ? '' : topic;
}

function whenPhrase(at, now, language) {
  const days = Math.max(0, Math.floor((now - at) / DAY));
  const sw = lang2(language) === 'sw';
  if (days < 1) return sw ? 'leo' : 'today';
  if (days < 2) return sw ? 'jana' : 'yesterday';
  if (days < 7) return sw ? 'wiki hii' : 'earlier this week';
  if (days < 14) return sw ? 'wiki iliyopita' : 'last week';
  if (days < 31) return sw ? 'mwezi huu' : 'a few weeks ago';
  return sw ? 'mwezi uliopita' : 'last month';
}

function newestFirst(rows) {
  return [...rows].sort((a, b) => (taskDate(b) || 0) - (taskDate(a) || 0));
}

/**
 * After the name is confirmed (tier 2), Alvin's rule (13 Oct):
 * - exactly one recent, open, relevant task: one short question about it;
 * - several: "is this about X, or something new?" (X = newest);
 * - none / unsure: null (the normal "how can I help").
 * A caller who already said a purpose that matches no task gets nothing.
 */
function planResumeOffer({ card = null, tasks = [], state = {}, topic = '', language = 'en', now = Date.now() } = {}) {
  if (!trustP1Enabled()) return null;
  if (identityTier(card, state) < 2) return null;
  const t = trustState(state);
  if (t.resumeOffered || t.resumeDropped) return null;
  // A bare name on the confirm turn is not a purpose; two content words are.
  const stated = topicWords(topic).size >= 2;
  let rows = relevantTasks(tasks, { topic, now, state });
  if (!rows.length && !stated) rows = relevantTasks(tasks, { now, state });
  if (!rows.length) return null;
  // One row per thing (real DB: several "Carpet cleaning" rows for one need).
  const seen = new Set();
  rows = newestFirst(rows).filter((r) => {
    const k = String(r.summary_item || r.type || '').trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (!rows.length) return null;
  const row = rows[0];
  const raw = String(row.summary_item || row.type || '').trim();
  const item = /^[A-Z][a-z]/.test(raw) ? raw[0].toLowerCase() + raw.slice(1) : raw;
  t.resumeOffered = true;
  setResumePointer(state, row);
  t.fileReadTurn = Number(state?.conversation?.turnCount || 0);
  const l = lang2(language);
  const when = whenPhrase(taskDate(row) || now, now, l);
  let line;
  if (rows.length === 1) {
    line = l === 'sw'
      ? `Bado unahitaji ${item} uliyoomba ${when}?`
      : `Are you still interested in the ${item} from ${when}?`;
  } else {
    line = l === 'sw' ? `Ni kuhusu ${item}, au ni jambo jipya?` : `Is this about the ${item}, or something new?`;
  }
  return { line, taskId: row.task_id || row.id, count: rows.length };
}

/** "do you remember me / my order?" with nothing usable on file: no yes, no past claim. */
const REMEMBER_ASK = /\b(?:do you (?:still )?(?:remember|recall|know (?:me|who))|(?:remember|recall)(?:ing)? (?:me|my|what|when|that|us)|you know me|know who (?:i am|this is)|what did i (?:order|ask|book|request)|my (?:last|previous) (?:order|request|call|booking|visit)|(?:have|did) i (?:call(?:ed)?|order(?:ed)?|book(?:ed)?|been|ask(?:ed)?) (?:you |here )?before|(?:any|my) (?:record|records|details|file)|on (?:your )?file|you have my (?:details|number|name)|(?:u|m)nanikumbuka|(?:u|m)nakumbuka|(?:u|m)nanijua|nilikuwa nimeagiza|niliagiza nini|nimewahi kupiga|kumbukumbu)\b/i;

function planRememberAsk({ text = '', card = null, tasks = [], state = {}, language = 'en', now = Date.now() } = {}) {
  if (!trustP1Enabled() || !REMEMBER_ASK.test(String(text || ''))) return null;
  const tier = identityTier(card, state);
  const rows = tier >= 2 ? relevantTasks(tasks, { now, state }) : [];
  if (rows.length) return null; // the file read path answers from fact lines
  const l = lang2(language);
  if (tier === 1) {
    return {
      line: l === 'sw'
        ? 'Ngoja kwanza nithibitishe ninaongea na nani. Naomba jina lako?'
        : "Let me just confirm who I'm speaking with first. May I have your name?",
      nameAsk: true,
    };
  }
  return { line: notOnFileLine(l) + (l === 'sw' ? ' Nikusaidie vipi leo?' : ' How can I help you today?') };
}

// ---------------------------------------------------------- T2 correction

const CORRECTION = /\b(?:that'?s (?:wrong|not right|not true|incorrect)|that is (?:wrong|not right)|no,? that'?s not (?:me|mine)|i never (?:ordered|asked)|si hivyo|sio hivyo|siyo hivyo|si kweli|sikuagiza|sikuomba)\b/i;

function planCorrection({ text = '', state = {}, language = 'en' } = {}) {
  if (!trustP1Enabled() || !CORRECTION.test(String(text || ''))) return null;
  const t = trustState(state);
  const ptr = t.resume;
  if (!ptr && t.fileReadTurn == null) return null;
  if (ptr?.taskId) t.blockedRows = [...new Set([...(t.blockedRows || []), String(ptr.taskId)])];
  t.reviewFlags = [...(t.reviewFlags || []), { taskId: ptr?.taskId || null, at: new Date().toISOString(), said: String(text).slice(0, 160) }];
  t.resume = null;
  const l = lang2(language);
  return {
    line: l === 'sw'
      ? 'Samahani kwa hilo. Sitatumia hiyo tena, na nitamwomba mwenye duka aiangalie. Nikusaidie vipi?'
      : "Sorry about that. I won't use that note, and I'll ask the owner to check it. How can I help?",
    reviewFlag: t.reviewFlags[t.reviewFlags.length - 1],
  };
}

// -------------------------------------------------------- T3 resume pointer

function setResumePointer(state, row) {
  const t = trustState(state);
  t.resume = {
    taskId: row?.task_id || row?.id || null,
    topic: [...topicWords(`${row?.summary_item || ''} ${row?.type || ''}`)],
    setTurn: Number(state?.conversation?.turnCount || 0),
  };
}

/** Call once per caller turn. Drops the pointer after 4 turns or a topic change. */
function tickResumePointer(state, callerText = '') {
  const t = state?.trust;
  if (!t?.resume) return null;
  const turn = Number(state?.conversation?.turnCount || 0);
  if (turn - t.resume.setTurn >= RESUME_TTL_TURNS) {
    t.resume = null;
    return 'ttl';
  }
  const said = topicWords(callerText);
  const topic = new Set(t.resume.topic || []);
  const newTopic = [...said].filter((w) => !topic.has(w) && TOPIC_NOUN.test(w));
  const overlaps = [...said].some((w) => topic.has(w));
  const affirm = /^\s*(?:yes|yeah|yep|sure|ok(?:ay)?|ndio|ndiyo|sawa|eeh|eh|right|correct)\b/i.test(callerText);
  const cue = /\b(?:also|another|instead|different|new|something else|pia|nyingine|badala|jambo jipya|kitu kingine)\b/i.test(callerText);
  if (topic.size && !overlaps && ((newTopic.length && cue) || (!affirm && newTopic.length >= 2))) {
    // v2 rule: the caller stated a new purpose (or said no) — drop the resume.
    t.resume = null;
    t.resumeDropped = true;
    return 'topic';
  }
  return null;
}
const TOPIC_NOUN = /\p{L}{3,}/u;

function resumedTaskId(state) {
  return state?.trust?.resume?.taskId || null;
}

function whichOneLine(language = 'en') {
  return lang2(language) === 'sw' ? 'Ni ombi lipi unalozungumzia?' : 'Which request do you mean?';
}

// ------------------------------------------------------------- T4 notice

function noticeLine(language = 'en') {
  return lang2(language) === 'sw'
    ? 'Tunaweka maelezo mafupi ya maombi yako ili tukusaidie wakati ujao.'
    : 'We keep short notes of your requests to help you next time.';
}

/** Once per caller: not yet stored on the file and not yet said this call. */
function shouldSpeakNotice({ file = null, card = null, state = {} } = {}) {
  if (!trustP1Enabled()) return false;
  if (state?.trust?.noticeSpoken) return false;
  const shown = file?.memory_notice_shown_at || card?.memory_notice_shown_at || card?.memoryNoticeShownAt;
  return !shown;
}

function markNoticeSpoken(state) {
  trustState(state).noticeSpoken = true;
}

// ------------------------------------------------------------ T5 name asks

const NAME_ASK =
  /\b(?:(?:may|can|could) i (?:have|get|know|take) your (?:full )?name|what(?:'s| is) your (?:full )?name|who am i speaking (?:to|with)|your name,? please|(?:am i speaking|is this) (?:with|to)?\s*[A-Z]\w+\??|naomba jina|(?:kwa|na) jina gani|jina gani|jina lako ni|jina lako (?:ni nani|tafadhali)|unaitwa nani|naongea na nani|ni nani anaongea)\b/i;

const NAME_REFUSAL = /\b(?:no name|i(?:'d| would) rather not|not giving (?:my|you) (?:my )?name|don'?t want to (?:give|say|share)|skip (?:the )?name|sitaki kusema jina|bila jina|sitaki kutoa jina|hapana,? jina)\b/i;

function sentenceAsksName(sentence) {
  return NAME_ASK.test(String(sentence || ''));
}

function noteCallerTurnForName(state, callerText) {
  const t = trustState(state);
  if (NAME_REFUSAL.test(String(callerText || ''))) {
    t.nameRefused = true;
    if (t.nameAsk) t.nameAsk = { ...t.nameAsk, pending: false };
  }
}

/**
 * v3 ONE identity / name-ask controller (D199 confirm-identity, trust
 * remember-ask, file-name ask, model asks, save_caller_info all go here).
 * state.trust.nameAsk = { pending, kind: 'open'|'file', fileName, turn }.
 * Max 2 asks per call; never after a refusal or a bind.
 */
function nameAskAllowed(state) {
  if (!trustP1Enabled()) return true;
  const t = trustState(state);
  if (state?.caller?.nameConfirmed === true || state?.caller?.nameBound === true) return false;
  if (t.nameRefused) return false;
  return (t.nameAsks || 0) < MAX_NAME_ASKS;
}

function noteNameAsk(state, { kind = 'open', fileName = '' } = {}) {
  const t = trustState(state);
  const turn = Number(state?.conversation?.turnCount || 0);
  t.nameAsk = { pending: true, kind, fileName: String(fileName || '').trim() || null, turn };
  if (t.lastNameAskTurn === turn) return; // streamed sentences of one reply count once
  t.lastNameAskTurn = turn;
  t.nameAsks = (t.nameAsks || 0) + 1;
}

/** Ask for the name through the controller. false = do not ask (cap / refused / bound / already pending this turn). */
function requestNameAsk(state, opts = {}) {
  if (!trustP1Enabled()) return true;
  const t = trustState(state);
  const turn = Number(state?.conversation?.turnCount || 0);
  // Idempotent within a turn: planner and guard both ask; it is one ask.
  if (t.nameAsk?.pending && t.nameAsk.turn === turn) return true;
  if (!nameAskAllowed(state)) return false;
  noteNameAsk(state, opts);
  return true;
}

function pendingNameAsk(state) {
  const a = state?.trust?.nameAsk;
  return trustP1Enabled() && a?.pending && state?.caller?.nameConfirmed !== true ? a : null;
}

const EXPLICIT_NAME_LEAD = /(?:^|\s)(?:my name is|my name's|i am|i'm|this is|jina langu ni|naitwa|mimi ni|ni mimi)\s+\S/i;
const NAME_LEAD = /^(?:(?:uh+|um+|er+|ah+|eh+|yes|yeah|ndio|ndiyo|eeh|ok(?:ay)?|sawa)[, ]+)*(?:(?:my name is|my name's|i am|i'm|it'?s|this is|it is|ni|mimi ni|jina langu ni|naitwa)\s+)?/i;
const NOT_A_NAME = /^(?:yes|no|yeah|okay|ok|sawa|ndio|hapana|hello|hi|sorry|what|why|who|because|i|me|the|a)$/i;

/**
 * The caller's answer to the pending ask → a name, or ''. Bare "Alvin.",
 * "It's Alvin", "Alvin is the name", "Jina langu ni Wanjiru".
 */
function nameFromAnswer(text) {
  let raw = String(text || '').trim().replace(/[.!?,]+$/g, '').trim();
  raw = raw.replace(/\s+(?:is (?:the|my) name|ndio jina(?: langu)?|here|speaking)$/i, '').trim();
  const beforeLead = raw;
  raw = raw.replace(NAME_LEAD, '').trim().replace(/[.!?,]+$/g, '');
  // "my name is …" / "naitwa …" / "jina langu ni …" / "is the name": trust the name.
  const explicit = EXPLICIT_NAME_LEAD.test(beforeLead) || /\b(?:is (?:the|my) name|ndio jina)/i.test(String(text || ''));
  const words = raw.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 3) return '';
  if (words.some((w) => !/^\p{L}[\p{L}'’-]*$/u.test(w))) return '';
  if (!explicit && words.some((w) => NOT_A_NAME.test(w))) return '';
  // eslint-disable-next-line global-require
  if (require('./callerNameQuality').isNonNameUtterance(raw, { explicit, bare: !explicit })) return '';
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

/** Close the pending ask once the name is bound (or refused). */
function settleNameAsk(state, { bound = false } = {}) {
  const t = state?.trust;
  if (!t?.nameAsk) return;
  if (bound || state?.caller?.nameConfirmed === true || t.nameRefused) t.nameAsk = { ...t.nameAsk, pending: false };
}

// --------------------------------------------- T6 catalogue family + hours

const FAMILY_SLOT = {
  book: { en: 'book title', sw: 'jina la kitabu' },
  pen: { en: 'which pen and how many', sw: 'kalamu ipi na ngapi' },
  stationery: { en: 'which item and how many', sw: 'bidhaa ipi na ngapi' },
  uniform: { en: 'size and quantity', sw: 'saizi na idadi' },
  default: { en: 'which item and how many', sw: 'bidhaa ipi na ngapi' },
};

function catalogueFamily(item, profile = {}) {
  const name = String(item || '').toLowerCase();
  const rows = Array.isArray(profile?.servicesCatalog?.items) ? profile.servicesCatalog.items : [];
  const row = rows.find((r) => name && String(r?.name || '').toLowerCase().includes(name));
  const fam = String(row?.family || row?.category || '').toLowerCase();
  const probe = `${fam} ${name}`;
  if (/\b(?:pen|pens|biro|marker|pencil|kalamu)\b/.test(probe)) return 'pen';
  if (/\b(?:book|novel|textbook|kitabu|vitabu)\b/.test(probe)) return 'book';
  if (/\b(?:uniform|shirt|sweater|tie)\b/.test(probe)) return 'uniform';
  if (/\b(?:stationery|exercise|ruler|eraser|rubber)\b/.test(probe)) return 'stationery';
  return 'default';
}

function slotWords(item, profile, language = 'en') {
  return FAMILY_SLOT[catalogueFamily(item, profile)][lang2(language)];
}

/** Rewrite a wrong-family slot noun ("book title" for pens). */
function fixSlotNoun(sentence, { item = '', profile = {}, language = 'en' } = {}) {
  if (!item) return sentence;
  const fam = catalogueFamily(item, profile);
  if (fam === 'book') return sentence;
  return String(sentence).replace(/\b(?:the )?(?:book )?title\b|\bjina la kitabu\b/gi, slotWords(item, profile, language));
}

const CLOCK = /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)/gi;
const HOURS_SENTENCE = /\b(?:open|close|closing|opening|hours|tunafungua|tunafunga|saa za kazi)\b/i;

function clocksIn(sentence) {
  const out = [];
  for (const m of String(sentence).matchAll(CLOCK)) {
    let h = Number(m[1]) % 12;
    if (/p/i.test(m[3])) h += 12;
    out.push(`${h}:${m[2] || '00'}`);
  }
  return out;
}

/** Remember the first hours sentence spoken; a later conflicting one is replaced by it. */
function anchorHours(sentence, state) {
  if (!HOURS_SENTENCE.test(sentence)) return sentence;
  const clocks = clocksIn(sentence);
  if (!clocks.length) return sentence;
  const t = trustState(state);
  const a = t.anchors?.hours;
  if (!a) {
    t.anchors = { ...(t.anchors || {}), hours: { clocks, sentence } };
    return sentence;
  }
  const same = clocks.every((c) => a.clocks.includes(c));
  return same ? sentence : a.sentence;
}

function missingHoursLine(language = 'en') {
  return lang2(language) === 'sw'
    ? 'Nitaangalia na mwenye duka kuhusu saa, na atakuthibitishia.'
    : "I'll check the hours with the owner, and they'll confirm.";
}

// --------------------------------------------------- T8 redaction + trim

function staffNamesOf(profile = {}) {
  const rows = Array.isArray(profile?.staffNames) ? profile.staffNames : [];
  const names = new Set();
  for (const r of rows) {
    const n = String(typeof r === 'string' ? r : r?.name || '').trim();
    if (n.length < 2) continue;
    names.add(n);
    for (const part of n.split(/\s+/)) if (part.length >= 3) names.add(part);
  }
  return [...names].sort((a, b) => b.length - a.length);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Every staff/owner name → a role word. No opt-in (is_public ignored). */
function redactStaffNames(text, profile = {}, language = 'en') {
  const names = staffNamesOf(profile);
  if (!names.length) return String(text || '');
  const role = ROLE[lang2(language)];
  let out = String(text || '');
  for (const n of names) {
    const re = new RegExp(`\\b${escapeRe(n)}\\b(?:'s)?`, 'gi');
    out = out.replace(re, (m, offset, whole) => {
      const before = whole.slice(Math.max(0, offset - 12), offset);
      const sentenceStart = offset === 0 || /[.!?]\s*$/.test(before);
      const r = /'s$/i.test(m) ? `${role.owner}'s` : role.owner;
      return sentenceStart ? cap(r) : r;
    });
  }
  // "the the owner" after a "the" before the name
  return out.replace(/\bthe the owner\b/gi, 'the owner').replace(/\b(our|my) the owner\b/gi, 'the owner');
}

const READBACK = /^(?:saved:|imehifadhiwa:|that's already on file:|tayari iko kwenye rekodi:)/i;

/**
 * ~30 words after assembly (2 sentences is the target, words are the cap).
 * Unchanged when already short. Readbacks and item lists are exempt; the
 * closing question is always kept so the caller knows what to answer.
 */
function trimLength(text, { exempt = false } = {}) {
  const t = String(text || '').trim();
  if (exempt || READBACK.test(t)) return t;
  const parts = splitSentences(t);
  const isList = (p) => (p.match(/,/g) || []).length >= 2;
  const fixed = parts.filter((p) => READBACK.test(p) || /^next:|^hatua inayofuata:/i.test(p) || isList(p));
  const budget = MAX_WORDS - fixed.reduce((n, p) => n + (isList(p) ? 0 : words(p).length), 0);
  const free = parts.filter((p) => !fixed.includes(p));
  const freeWords = free.reduce((n, p) => n + words(p).length, 0);
  if (freeWords <= budget) return t;
  const question = free.filter((p) => /\?$/.test(p)).slice(-1)[0];
  const qWords = question ? words(question).length : 0;
  const keep = new Set(fixed);
  let n = 0;
  for (const p of free) {
    if (p === question) continue;
    const w = words(p).length;
    if (n + w + qWords > budget && n > 0) break;
    keep.add(p);
    n += w;
  }
  if (question) keep.add(question);
  return parts.filter((p) => keep.has(p)).join(' ');
}

// --------------------------------------------------------- the last mouth

/**
 * Final pass on any spoken text (Gemini, local, tool confirmation).
 * ctx: { state, profile, toolResults, language, receiptLine }
 */
function shapeSpeech(text, ctx = {}) {
  const raw = String(text || '').trim();
  if (!trustP1Enabled() || !raw) return { text: raw, drops: [] };
  const drops = [];
  const state = ctx.state || null;
  const language = ctx.language || 'en';
  const hasReceipt = Boolean(ctx.receiptLine) || receiptsOf(ctx.toolResults).length > 0;
  const fileLine = turnHasFileLine(state);
  const lastItem = String(state?.entities?.item?.value || state?.entities?.item || state?.entities?.service?.value || '');
  const kept = [];
  let swappedPast = false;
  for (let s of splitSentences(raw)) {
    if (READBACK.test(s) && ctx.receiptLine) {
      kept.push(s);
      continue;
    }
    if (!hasReceipt && SUCCESS_WORDS.test(s) && !isHonestChangeLine(s)) {
      drops.push('trust_success_no_receipt');
      continue;
    }
    if (UPDATED_WORDS.test(s) && /\b(?:address|payment|anwani|malipo|mpesa)\b/i.test(s)) {
      drops.push('trust_updated_sensitive');
      continue;
    }
    // v3 history policy at the mouth: a closed row is never spoken; a
    // history reference needs a policy-approved file line this turn; a row
    // the policy blocks is never named with a history reference.
    if (ctx.historyGuard !== false && state) {
      const blocked = Array.isArray(ctx.blockedTerms) ? ctx.blockedTerms : [];
      const low = s.toLowerCase();
      const namesBlocked = blocked.some((term) => low.includes(term));
      const historyRef = HISTORY_REF.test(s) || PAST_CLAIM.test(s);
      if (CLOSED_TALK.test(s) && (historyRef || namesBlocked || /\byour\b/i.test(s))) {
        drops.push('trust_closed_row');
        if (!swappedPast) kept.push(notOnFileLine(language));
        swappedPast = true;
        continue;
      }
      // An identity check ("to check your inquiry, am I speaking with X?")
      // reads nothing from the file; it is the gate, not a leak.
      if (historyRef && (namesBlocked || !fileLine) && !sentenceAsksName(s)) {
        drops.push('trust_history_blocked');
        if (!swappedPast) kept.push(notOnFileLine(language));
        swappedPast = true;
        continue;
      }
    }
    if (PAST_CLAIM.test(s) && !fileLine) {
      drops.push('trust_past_claim');
      if (!swappedPast) kept.push(notOnFileLine(language));
      swappedPast = true;
      continue;
    }
    if (sentenceAsksName(s) && state) {
      const t = trustState(state);
      const turn = Number(state?.conversation?.turnCount || 0);
      const sameTurn = t.lastNameAskTurn === turn;
      if (!sameTurn && !nameAskAllowed(state)) {
        drops.push('trust_name_ask_cap');
        continue;
      }
      noteNameAsk(state, { kind: /speaking with|naongea na|ni wewe/i.test(s) ? 'file' : 'open' });
    }
    s = fixSlotNoun(s, { item: lastItem, profile: ctx.profile, language });
    if (state) s = anchorHours(s, state);
    kept.push(s);
  }
  // v3: guard replacement lines (not-on-file, confirm-identity fallback) are
  // said once per turn across streamed chunks. Model text is only deduped
  // inside one shaping pass: shapeSpeech can run more than once on the same
  // text, so remembering model sentences would delete real answers.
  let deduped = [...new Set(kept)];
  if (state) {
    const t = trustState(state);
    const turn = Number(state?.conversation?.turnCount || 0);
    if (t.spokenTurn !== turn) { t.spokenTurn = turn; t.spokenSentences = []; }
    const seen = new Set(t.spokenSentences || []);
    const replacement = new Set([notOnFileLine('en'), notOnFileLine('sw'), 'I need to confirm who I am speaking with.'].map((x) => x.toLowerCase()));
    const before = deduped;
    deduped = [];
    for (const k of before) {
      const key = k.toLowerCase().replace(/\s+/g, ' ').trim();
      if (replacement.has(key)) {
        if (seen.has(key)) { drops.push('trust_dup_sentence'); continue; }
        seen.add(key);
      }
      deduped.push(k);
    }
    t.spokenSentences = [...seen];
  }
  let out = [...new Set(deduped)].join(' ');
  out = redactStaffNames(out, ctx.profile || {}, language);
  out = trimLength(out);
  // Remember that the guard removed model text this turn, so an empty
  // reply is not repaired as if the caller went unheard (false hear_again).
  if (state && drops.length) trustState(state).guardDroppedTurn = Number(state?.conversation?.turnCount || 0);
  return { text: out, drops };
}

/** The trust guard removed model text this turn (so empty != unheard). */
function guardEmptiedTurn(state) {
  if (!trustP1Enabled() || !state?.trust) return false;
  return state.trust.guardDroppedTurn === Number(state?.conversation?.turnCount || 0);
}

function guardContinueLine(language = 'en') {
  return lang2(language) === 'sw' ? 'Nikusaidie aje?' : 'How can I help?';
}

function isHonestChangeLine(s) {
  return /^I can't change your|^Siwezi kubadilisha|I've noted the new|Nimeandika (?:anwani|maelezo)/i.test(String(s).trim());
}

// ------------------------------------------------ summary vs receipts (OSS)

/** Receipts win: a summary naming an item/qty absent from receipts is dropped. */
function validateSummary(summary, results = []) {
  const s = String(summary || '').trim();
  if (!s) return '';
  const rows = receiptsOf(results);
  const claims = SUCCESS_WORDS.test(s) || /\b(saved|booked|ordered|requested)\b/i.test(s);
  if (!claims) return s;
  if (!rows.length) return '';
  const blob = rows.map((r) => JSON.stringify(r.value || r.record || {})).join(' ').toLowerCase();
  const nums = s.match(/\b\d+\b/g) || [];
  for (const n of nums) if (!blob.includes(n)) return '';
  return s;
}

// --------------------------------------------------------- pre-model plan

/**
 * Code answers before the model, in order: correction, address/payment
 * change, "do you remember me", resume offer after bind. null = model runs.
 */
function planTrustTurn({ text = '', state = {}, card = null, tasks = [], language = 'en', byWhen = '', now = Date.now(), nameJustConfirmed = false, lastAgentText = '' } = {}) {
  if (!trustP1Enabled()) return null;
  noteCallerTurnForName(state, text);
  // v3 save pipeline: a broken address answer is repaired once, never saved.
  if (unclearPlaceAnswer(text, lastAgentText) && !trustState(state).placeRepairAsked) {
    trustState(state).placeRepairAsked = true;
    return { kind: 'place_repair', line: placeRepairLine(language) };
  }
  const ttl = tickResumePointer(state, text);
  const corr = planCorrection({ text, state, language });
  if (corr) return { kind: 'correction', ...corr };
  const change = planSensitiveChange({ text, state, tasks, language, byWhen });
  if (change) return change;
  const remember = planRememberAsk({ text, card, tasks, state, language, now });
  if (remember) {
    if (remember.nameAsk) {
      // Already asked (D199 "Am I speaking with…?" or a pending ask): do not ask again.
      // One controller: a pending ask (D199 "Am I speaking with…?" included)
      // or the cap means no second ask from this path.
      if (pendingNameAsk(state) || !requestNameAsk(state, { kind: 'open' })) return null;
    }
    return { kind: 'remember', line: remember.line };
  }
  if (nameJustConfirmed) {
    const offer = planResumeOffer({ card, tasks, state, topic: text, language, now });
    if (offer) return { kind: 'resume', ...offer };
  }
  if (ttl && /\b(?:that one|that order|it|hiyo|hilo)\b/i.test(text) && !resumedTaskId(state)) {
    return { kind: 'which', line: whichOneLine(language) };
  }
  return null;
}

/** v2 (bug 4): facts the model must know so it never contradicts the notice. */
function trustPromptFacts({ card = null, language = 'en' } = {}) {
  if (!trustP1Enabled()) return '';
  const known = Boolean(card && identityTier(card, {}) >= 1);
  return [
    'CALLER MEMORY POLICY (code-enforced):',
    '- This business keeps short notes of callers\' requests to help them next time. Never say you do not keep records, cannot remember callers, or that every call starts fresh.',
    '- Only mention a past request or detail when it appears in a fact line this turn. If none does, say you don\'t have that on file (Swahili: "Sina hiyo kwenye rekodi.").',
    known
      ? '- This phone number has called before. Do not read any past detail until the caller\'s name is confirmed.'
      : '- This phone number is new to this business. Do not claim to know or remember the caller.',
  ].join('\n');
}

module.exports = {
  guardEmptiedTurn,
  guardContinueLine,
  requestNameAsk,
  pendingNameAsk,
  nameFromAnswer,
  settleNameAsk,
  alreadySavedLine,
  receiptKey,
  saveMissingSlot,
  unclearPlaceAnswer,
  placeRepairLine,
  trustPromptFacts,
  inviteLine,
  whenPhrase,
  FLAG,
  RESUME_TTL_TURNS,
  MAX_NAME_ASKS,
  trustP1Enabled,
  isGarbledContent,
  repairAskLine,
  receiptReadback,
  receiptsOf,
  detectSensitiveChange,
  planSensitiveChange,
  noteChangeTask,
  notOnFileLine,
  identityTier,
  tieredGreeting,
  welcomeBackLine,
  relevantTasks,
  usableLastTopic,
  planResumeOffer,
  planRememberAsk,
  planCorrection,
  setResumePointer,
  tickResumePointer,
  resumedTaskId,
  noticeLine,
  shouldSpeakNotice,
  markNoticeSpoken,
  nameAskAllowed,
  noteNameAsk,
  noteCallerTurnForName,
  sentenceAsksName,
  catalogueFamily,
  slotWords,
  fixSlotNoun,
  anchorHours,
  missingHoursLine,
  redactStaffNames,
  trimLength,
  shapeSpeech,
  validateSummary,
  planTrustTurn,
};
