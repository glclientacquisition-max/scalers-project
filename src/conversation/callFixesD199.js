// BRAIN_CALL_FIXES_D199 (staging re-dial HD_d199dbbf6b79, 2026-10-09).
// On only when the env value is exactly 'on'. Flag off: every caller of these
// helpers keeps its old path.
//
// (a) a reschedule of an open visit moves that row (update), never a second visit
// (b) the caller-file read covers open requests and holds, not only visits
// (c) the coverage check runs on real place names only; a service word is not a place
// (d) slots: no time fragment as location, quantity only with a countable unit,
//     filler is never a name or a service
// (e) code answers "when did I request that?" and "what have you saved?" from the
//     file; a visit earlier today is today's visit, not a past one

const FLAG = 'BRAIN_CALL_FIXES_D199';

function callFixesD199Enabled() {
  return String(process.env[FLAG] || '').trim() === 'on';
}

const TZ = 'Africa/Nairobi';

// ---------------------------------------------------------------- (d) filler

const FILLER_WORDS = new Set([
  'like', 'um', 'umm', 'uh', 'uhm', 'er', 'erm', 'eh', 'eeh', 'ah', 'oh', 'hmm', 'mm',
  'so', 'well', 'just', 'actually', 'basically', 'literally', 'okay', 'ok', 'yeah',
  'yaani', 'sasa', 'ati', 'kama', 'aki', 'wueh', 'manze', 'si', 'na', 'for', 'the',
  'something', 'thing', 'stuff', 'whatever', 'anything',
]);

/** Every word is filler ("like", "for like", "um so"). */
function isFillerPhrase(value) {
  const words = String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\s'’-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return true;
  return words.every((word) => FILLER_WORDS.has(word));
}

// ------------------------------------------------------------- (d) time bits

const TIME_FRAGMENT =
  /\b(?:\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|o'?clock)|(?:at|by|around|saa)\s+\d{1,2}(?::\d{2})?|\d{1,2}(?::\d{2})?\s+(?:works?|is\s+(?:fine|okay|ok|good|best)|would\s+work|best|sharp|asubuhi|mchana|jioni|usiku)|works?\s+best|morning|afternoon|evening|asubuhi|mchana|jioni|usiku|today|tomorrow|kesho|leo)\b/i;

/** A time answer ("9 works best", "at 9", "kesho asubuhi") is not a place. */
function looksLikeTimeFragment(text) {
  return TIME_FRAGMENT.test(String(text || ''));
}

/** "So that I can confirm?" is a clause, not a place answer. */
function looksLikeClauseNotPlace(text) {
  const value = String(text || '').trim();
  if (/\?\s*$/.test(value)) return true;
  return /\b(?:i|you|we|can|could|would|will|so that|confirm|want|need|please|what|how|why|when|tell me|nataka|naomba|unaweza)\b/i.test(value);
}

const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  moja: 1, mbili: 2, tatu: 3, nne: 4, tano: 5, sita: 6, saba: 7, nane: 8, tisa: 9, kumi: 10,
};

// Words after a number that make it a time, not a count.
const TIME_FOLLOW = new Set([
  'works', 'work', 'is', 'would', 'best', 'sharp', 'am', 'pm', 'a', 'p', "o'clock", 'oclock',
  'asubuhi', 'mchana', 'jioni', 'usiku', 'ni', 'iko', 'inafaa', 'tomorrow', 'today', 'kesho',
  'leo', 'or', 'and', 'na', 'then', 'please', 'thanks', 'okay', 'ok', 'fine', 'good',
]);
const BEFORE_TIME = new Set(['at', 'by', 'around', 'saa', 'before', 'after', 'from', 'till', 'until']);
const PRONOUN_LEAD = new Set(['the', 'that', 'this', 'which', 'ile', 'hiyo', 'hii', 'my', 'your']);

/**
 * Quantity only from a number tied to a countable thing ("3 rooms", "two
 * sofas", "2 diaries", "viti mbili"). A clock, "9 works best", and the pronoun
 * in "the mansion one" are not counts. When the agent just asked how many, a
 * bare number is the answer.
 */
function quantityWithUnit(text, { quantityAsked = false } = {}) {
  const raw = String(text || '');
  const words = raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    const digit = /^\d{1,3}$/.test(word);
    const n = digit ? Number(word) : NUMBER_WORDS[word];
    if (!n) continue;
    const before = words[i - 1] || '';
    const after = words[i + 1] || '';
    if (BEFORE_TIME.has(before)) continue;
    // "the mansion one", "that one": a pronoun, not a count.
    if (word === 'one' && (!after || PRONOUN_LEAD.has(words[i - 2] || '') || PRONOUN_LEAD.has(before))) continue;
    if (after && !TIME_FOLLOW.has(after) && !FILLER_WORDS.has(after) && /^\p{L}{2,}$/u.test(after)) {
      return String(n);
    }
    // Kiswahili puts the count after the noun: "viti mbili", "vyumba tatu".
    if (!digit && word !== 'one' && before && /^\p{L}{3,}$/u.test(before) && !FILLER_WORDS.has(before) && !BEFORE_TIME.has(before)) {
      return String(n);
    }
  }
  if (quantityAsked) {
    const bare = /^\s*(?:\p{L}+\s*,?\s*)?(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|moja|mbili|tatu|nne|tano)\s*[.!?]?\s*$/iu.exec(raw);
    if (bare) return String(/^\d/.test(bare[1]) ? Number(bare[1]) : NUMBER_WORDS[bare[1].toLowerCase()]);
  }
  return null;
}

// --------------------------------------------------- (c) real place for coverage

function serviceWordsOf(profile = {}) {
  const words = new Set([
    'mansion', 'house', 'home', 'apartment', 'office', 'carpet', 'couch', 'sofa',
    'mattress', 'window', 'windows', 'clean', 'cleaning', 'quote', 'booking', 'visit',
    'request', 'one', 'job', 'deep', 'move', 'airbnb', 'fumigation', 'laundry',
  ]);
  for (const row of Array.isArray(profile?.servicesCatalog) ? profile.servicesCatalog : []) {
    for (const word of String(row?.name || '').toLowerCase().split(/[^\p{L}]+/u)) {
      if (word.length >= 4) words.add(word);
    }
  }
  return words;
}

/**
 * Coverage runs only on a real place name: the Phase 0 real-place test
 * (countiesForPlace) and no service word in it ("the mansion one").
 */
function coverageRealPlace(place, profile = {}) {
  const value = String(place || '').trim();
  if (!value) return false;
  const service = serviceWordsOf(profile);
  const words = value.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
  if (words.some((word) => service.has(word))) return false;
  const { countiesForPlace } = require('./kenyaPlaces');
  return countiesForPlace(value).length > 0;
}

// ------------------------------------------------------------- (a) reschedule

const RESCHEDULE_ASK =
  /\b(?:reschedule|move (?:it|that|the visit|my visit)|push it|make it|change it to|shift it|instead of|tuieke|tuiweke|iweke|ikuwe|iwe (?:kesho|leo)|tuisogeze|isogeze|sogeza|hamisha|tuihamishe|ibadilishe|badilisha)\b/i;

function looksLikeRescheduleAsk(text) {
  return RESCHEDULE_ASK.test(String(text || ''));
}

const NEW_JOB_ASK = /\b(?:another|a new|new (?:visit|booking)|second visit|pia|also book|ingine|nyingine)\b/i;

function looksLikeNewJobAsk(text) {
  return NEW_JOB_ASK.test(String(text || ''));
}

function serviceKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !['the', 'and', 'per', 'room', 'visit', 'service'].includes(word))
    .slice(0, 2)
    .join(' ');
}

/**
 * The open visit a reschedule moves: same service family, prefer a matching
 * place, then the one that is today or ahead, then the newest. Null when the
 * file has none.
 */
function rescheduleTarget(appointment, rows = [], { now = new Date() } = {}) {
  const wantService = serviceKey(appointment?.serviceName || appointment?.service_name || appointment?.service);
  const place = String(
    appointment?.landmark || appointment?.location || appointment?.address || appointment?.address_landmark || ''
  ).toLowerCase();
  const open = (Array.isArray(rows) ? rows : []).filter(
    (row) => row && row.kind === 'visit' && row.id && /^(?:requested|confirmed|)$/i.test(String(row.status || ''))
  );
  const sameService = wantService
    ? open.filter((row) => {
        const have = serviceKey(row.job);
        return have && (have === wantService || have.split(' ')[0] === wantService.split(' ')[0]);
      })
    : open;
  if (!sameService.length) return null;
  const score = (row) => {
    const rowPlace = String(row.place || '').toLowerCase().split(',')[0].trim();
    let s = 0;
    if (rowPlace && place.includes(rowPlace)) s += 4;
    if (!row.past) s += 2;
    return s;
  };
  const sorted = [...sameService].sort((a, b) => {
    const d = score(b) - score(a);
    if (d) return d;
    return Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0);
  });
  return sorted[0] || null;
}

/**
 * Brain guard: a create_appointment while the caller is moving an open visit
 * becomes update_appointment on that visit. Returns the new parsed plan.
 */
function rescheduleCreateAsUpdate(parsed, state = {}) {
  if (state?.conversation?.rescheduleAsked !== true) return parsed;
  const rows = state?.returning?.openRows;
  // A bare update while moving a filed visit: pin it to that visit, so the
  // backend does not pick the newest open row.
  const upd = parsed?.appointmentUpdate;
  if (upd && !upd.appointmentId && !upd.id && !upd.appointment_id && !parsed.appointment) {
    const status = String(upd.status || '').toLowerCase();
    if (status === 'cancelled') return parsed;
    const target = rescheduleTarget(upd, rows);
    if (!target) return parsed;
    return { ...parsed, appointmentUpdate: { ...upd, appointmentId: target.id }, rescheduledFrom: target.id };
  }
  if (!parsed?.appointment || parsed.appointmentUpdate) return parsed;
  const target = rescheduleTarget(parsed.appointment, rows);
  if (!target) return parsed;
  const appt = parsed.appointment;
  const whenText = String(appt.whenText || appt.when_text || appt.when || '').trim();
  const landmark = String(appt.landmark || appt.location || appt.address || '').trim();
  const next = { ...parsed };
  delete next.appointment;
  next.appointmentUpdate = {
    appointmentId: target.id,
    whenText,
    ...(landmark ? { landmark, location: landmark } : {}),
    ...(appt.notes ? { notes: appt.notes } : {}),
  };
  next.rescheduledFrom = target.id;
  return next;
}

// ---------------------------------------------------------- (e) file answers
// Every spoken line is a fact line (docs/specs/fact-lines.md): Brain picks the
// template and slots; Voice renders the wording (factLine.js falls back).

const { factLine, renderLines } = require('./factLine');

function nairobiDateTime(iso, language = 'en', now = new Date()) {
  const { renderDatetime } = require('./factLine');
  return renderDatetime({ iso, precision: 'relative' }, language, now);
}

const REQUESTED_WHEN_ASK =
  /\b(?:when did i (?:request|ask|book|order|make|call)|when was (?:that|it|this) (?:requested|made|booked|saved)|what (?:day|date|time) did i (?:request|ask|book)|niliomba (?:lini|saa ngapi)|nilibook lini|niliitisha lini|lini niliomba)\b/i;

function looksLikeRequestedWhenAsk(text) {
  return REQUESTED_WHEN_ASK.test(String(text || ''));
}

const SAVED_READBACK_ASK =
  /\b(?:what (?:exactly )?(?:have you|did you|you(?:'ve| have)?) (?:saved|save|noted|booked|written|put down)|what(?:'s| is) saved|read (?:it|that|them) back|umesave nini|umeandika nini|umehifadhi nini|umeweka nini)\b/i;

function looksLikeSavedReadbackAsk(text) {
  return SAVED_READBACK_ASK.test(String(text || ''));
}

const CATCH_UP_ASK =
  /\b(?:tulifika wapi|tuliachia wapi|mambo yetu ya jana|ile mambo (?:yetu|ya jana)|where did we (?:get|leave|stop)|where are we with|what we (?:talked|spoke) about)\b/i;

/** "Tulifika wapi na ile mambo yetu ya jana?" asks for the file. */
function looksLikeFileCatchUp(text) {
  return CATCH_UP_ASK.test(String(text || ''));
}

const ROW_STOP = new Set([
  'what', 'about', 'the', 'one', 'that', 'this', 'like', 'no', 'gave', 'you', 'told', 'mine',
  'my', 'ile', 'hiyo', 'yangu', 'your', 'have', 'did', 'request', 'requested', 'enquiry',
  'cleaning', 'visit', 'booking', 'callback', 'message', 'and', 'with', 'for',
]);

/**
 * Open rows (visits, requests, holds) a caller turn names by a word ("the
 * mansion one", "ile carpet cleaning ya Kitengela"). Only the rows that match
 * the most named words; a past-dated visit only when nothing current matches.
 */
function namedFileRows(text, rows = []) {
  const raw = String(text || '');
  const words = raw
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter((word) => word.length >= 4 && !ROW_STOP.has(word));
  if (!words.length) return [];
  if (!/\b(?:one|ile|hiyo|request|enquiry|quote|booking|visit|hold|what about|gave you)\b/i.test(raw)) {
    return [];
  }
  const scored = (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const hay = `${row.job || ''} ${row.place || ''}`.toLowerCase();
      const hits = words.filter((word) => new RegExp(`\\b${word}`).test(hay)).length;
      return { row, hits };
    })
    .filter((item) => item.hits > 0);
  if (!scored.length) return [];
  const best = Math.max(...scored.map((item) => item.hits));
  const top = scored.filter((item) => item.hits === best).map((item) => item.row);
  const current = top.filter((row) => !row.past);
  return current.length ? current : top;
}

function whenSlot(iso, text, precision = 'time') {
  if (iso) return { iso, precision };
  if (text) return { text };
  return null;
}

/** visit_open / request_open for a file row. */
function fileRowLine(row, lang = 'en') {
  if (row.kind === 'visit') {
    return factLine(
      'visit_open',
      {
        job: row.job,
        status: row.status || 'requested',
        when: whenSlot(row.windowStart, row.when),
        place: row.place,
      },
      { lang, gate: { appointment_id: row.id || null } }
    );
  }
  return factLine(
    'request_open',
    { kind: String(row.type || 'enquiry').toLowerCase(), item: row.job, when: whenSlot(null, row.when) },
    { lang, gate: { request_id: row.id || null } }
  );
}

function savedResultRows(state) {
  const rows = [];
  for (const r of Array.isArray(state?.actions?.savedWork) ? state.actions.savedWork : []) {
    if (!r || !['succeeded', 'updated'].includes(r.status)) continue;
    const rec = r.record || {};
    const val = r.value || {};
    if (r.action === 'create_appointment' || r.action === 'update_appointment') {
      rows.push({
        action: r.action,
        id: r.id || val.appointmentId || null,
        kind: 'visit',
        job: rec.service_name || val.serviceName || 'visit',
        when: whenSlot(val.windowStart, val.whenText),
        place: val.landmark || '',
        status: rec.status || r.appointmentStatus || 'requested',
      });
    } else if (r.action === 'create_service_request') {
      rows.push({
        action: r.action,
        id: r.id || null,
        kind: 'request',
        job: val.item || 'request',
        when: whenSlot(null, val.whenText),
        status: 'open',
      });
    }
  }
  return rows;
}

/** saved_item lines + team_will_confirm, or saved_none (+ the next open visit). */
function savedReadbackLines(state, lang = 'en') {
  const saved = savedResultRows(state);
  if (saved.length) {
    const lines = saved.map((row) =>
      factLine(
        'saved_item',
        { kind: row.kind, job: row.job, when: row.when, place: row.place },
        { lang, gate: { action: row.action, id: row.id } }
      )
    );
    if (saved.some((row) => row.kind === 'visit' && row.status === 'requested')) {
      lines.push(factLine('team_will_confirm', {}, { lang }));
    }
    return lines;
  }
  const rows = Array.isArray(state?.returning?.openRows) ? state.returning.openRows : [];
  const next = rows.find((row) => row.kind === 'visit' && !row.past);
  const lines = [factLine('saved_none', {}, { lang })];
  if (next) lines.push(fileRowLine(next, lang));
  return lines;
}

function savedReadbackLine(state, language = 'en', opts = {}) {
  return renderLines(savedReadbackLines(state, language), opts).line;
}

/**
 * Code answer for a file question, or null: { kind, line, lines, rowId }.
 * lines are fact lines with their rendered text (trace: brain.lines[]).
 */
function planFileAnswer({ text = '', state = {}, language = 'en', now = new Date() } = {}) {
  const rows = Array.isArray(state?.returning?.openRows) ? state.returning.openRows : [];
  const done = (kind, lines, rowId = null) => {
    const rendered = renderLines(lines, { now });
    return rendered.line ? { kind, line: rendered.line, lines: rendered.lines, rowId } : null;
  };
  if (looksLikeSavedReadbackAsk(text)) return done('saved_readback', savedReadbackLines(state, language));
  if (looksLikeRequestedWhenAsk(text)) {
    const named = namedFileRows(text, rows);
    const lastId = state?.conversation?.lastFileRowId;
    const row =
      named[0] ||
      rows.find((r) => r.id && r.id === lastId) ||
      rows.find((r) => r.kind === 'visit' && !r.past) ||
      rows[0];
    if (!row || !row.createdAt) return null;
    const line = factLine(
      'requested_at',
      { kind: row.kind === 'visit' ? 'visit' : 'request', job: row.job, requested_at: { iso: row.createdAt, precision: 'relative' } },
      { lang: language, gate: row.kind === 'visit' ? { appointment_id: row.id } : { request_id: row.id } }
    );
    return done('requested_when', [line], row.id);
  }
  const named = namedFileRows(text, rows);
  if (named.length) return done('named_row', named.map((row) => fileRowLine(row, language)), named[0].id);
  return null;
}

/** Open-file read: every open visit (today's included), then requests and holds. */
function openFileRead(state, language = 'en', { now = new Date() } = {}) {
  const rows = Array.isArray(state?.returning?.openRows) ? state.returning.openRows : [];
  if (!rows.length) return null;
  const visits = rows.filter((row) => row.kind === 'visit');
  const requests = rows.filter((row) => row.kind === 'request');
  const rendered = renderLines([...visits, ...requests].map((row) => fileRowLine(row, language)), { now });
  return rendered.line ? rendered : null;
}

/**
 * move_ok / visit_updated for a succeeded update_appointment (fact-lines.md).
 * move_ok only when the row moved is the filed visit the reschedule named.
 */
function updateResultLines(results = [], language = 'en') {
  const lines = [];
  for (const r of Array.isArray(results) ? results : []) {
    if (r?.action !== 'update_appointment' || r.status !== 'succeeded') continue;
    const st = String(r.appointmentStatus || '').toLowerCase();
    if (st === 'cancelled') continue;
    const val = r.value || {};
    const rec = r.record || {};
    const toWhen = whenSlot(val.windowStart || rec.window_start, val.whenText || rec.when_text);
    const id = r.id || val.appointmentId || null;
    if (toWhen) {
      // The same row got a new time: that is a move. A reschedule of a filed
      // visit is pinned to that row (rescheduleCreateAsUpdate), never a create.
      lines.push(
        factLine(
          'move_ok',
          { job: rec.service_name || val.serviceName, to_when: toWhen, place: val.landmark || rec.address_landmark },
          { lang: language, gate: { appointment_id: id, to_when: toWhen, filed_visit: r.movedFiledVisit === true } }
        )
      );
    } else {
      lines.push(factLine('visit_updated', { place: val.landmark }, { lang: language, gate: { appointment_id: id } }));
    }
  }
  return lines.filter(Boolean);
}

module.exports = {
  FLAG,
  callFixesD199Enabled,
  isFillerPhrase,
  looksLikeTimeFragment,
  looksLikeClauseNotPlace,
  quantityWithUnit,
  coverageRealPlace,
  looksLikeRescheduleAsk,
  looksLikeNewJobAsk,
  rescheduleTarget,
  rescheduleCreateAsUpdate,
  nairobiDateTime,
  looksLikeRequestedWhenAsk,
  looksLikeSavedReadbackAsk,
  looksLikeFileCatchUp,
  namedFileRows,
  planFileAnswer,
  openFileRead,
  savedReadbackLine,
  updateResultLines,
};
