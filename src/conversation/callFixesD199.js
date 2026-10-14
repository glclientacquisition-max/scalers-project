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
  /\b(?:reschedule|move (?:it|that|the visit|my visit)|(?:move|change|shift) (?:the |my )?(?:time|date|day)|push it|make it|change it to|shift it|instead of|tuieke|tuiweke|iweke|ikuwe|iwe (?:kesho|leo)|tuisogeze|isogeze|sogeza|hamisha|tuihamishe|ibadilishe|badilisha)\b/i;

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

/** visit_open / request_open for a file row; past_row for a past-dated one. */
function fileRowLine(row, lang = 'en') {
  // HD_1677e57f73f9 (3): a named row whose time has passed is never read as
  // open or upcoming.
  if (rowIsPast(row)) {
    return factLine(
      'past_row',
      {
        kind: row.kind === 'visit' ? 'visit' : String(row.type || 'enquiry').toLowerCase(),
        job: row.job,
        when: row.kind === 'visit' ? whenSlot(row.windowStart, row.when) : whenSlot(null, row.when),
        place: row.place,
      },
      { lang, gate: { [row.kind === 'visit' ? 'appointment_id' : 'request_id']: row.id || null, past: true } }
    );
  }
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

const OPEN_READ_REQUESTS = 4;

function rowIsPast(row) {
  return row.past === true || /^past\b/i.test(String(row.when || ''));
}

/**
 * Open-file read: every current open visit (today's included), then the
 * newest open requests and holds (up to OPEN_READ_REQUESTS), then more_open
 * with the count of older open rows left out (past-dated or over the cap).
 */
function openFileRead(state, language = 'en', { now = new Date() } = {}) {
  const rows = Array.isArray(state?.returning?.openRows) ? state.returning.openRows : [];
  if (!rows.length) return null;
  const visits = rows.filter((row) => row.kind === 'visit' && !rowIsPast(row));
  const requests = rows
    .filter((row) => row.kind === 'request' && !rowIsPast(row))
    .slice()
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const spoken = [...visits, ...requests.slice(0, OPEN_READ_REQUESTS)];
  const lines = spoken.map((row) => fileRowLine(row, language));
  // HD_1677e57f73f9 (3): past-dated rows still 'requested' are their own
  // bucket, never read as open or upcoming; only a count.
  const past = rows.filter(rowIsPast).length;
  const more = requests.length - Math.min(requests.length, OPEN_READ_REQUESTS);
  if (more > 0) {
    lines.push(factLine('more_open', { count: more }, { lang: language, gate: { open_rows: rows.length, spoken: spoken.length } }));
  }
  if (past > 0) {
    lines.push(factLine('past_open', { count: past }, { lang: language, gate: { past_rows: past, now: now.toISOString() } }));
  }
  const rendered = renderLines(lines, { now });
  return rendered.line && spoken.length ? rendered : rendered.line && past ? rendered : null;
}

/**
 * move_ok / visit_updated for a succeeded update_appointment (fact-lines.md).
 * move_ok only when the row moved is the filed visit the reschedule named.
 */
function updateResultLines(results = [], language = 'en', { newTimeLabel = null } = {}) {
  const lines = [];
  for (const r of Array.isArray(results) ? results : []) {
    if (r?.action !== 'update_appointment' || r.status !== 'succeeded') continue;
    const st = String(r.appointmentStatus || '').toLowerCase();
    if (st === 'cancelled') continue;
    const val = r.value || {};
    const rec = r.record || {};
    const instant = r.hours?.resolved?.instant;
    const iso = instant instanceof Date && !Number.isNaN(instant.getTime()) ? instant.toISOString() : null;
    const label = typeof newTimeLabel === 'function' ? newTimeLabel(r) : '';
    const toWhen = whenSlot(iso || val.windowStart || rec.window_start, label || val.whenText || rec.when_text);
    const id = r.id || val.appointmentId || null;
    const moved = typeof newTimeLabel === 'function' ? Boolean(label) : Boolean(toWhen);
    if (moved && toWhen) {
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

// ------------------------------------------- HD_1b3a67ea7ee9 (6)(7)(8): masked file

/** The caller file has open visits or requests (rows loaded at call start). */
function fileHasRows(state) {
  const returning = state?.returning;
  if (!returning) return false;
  if (returning.hasOpenRows === true) return true;
  const rows = returning.openRows;
  return Array.isArray(rows) && rows.length > 0;
}

/** Masked: the file has rows and the speaker is not confirmed yet. Never empty. */
function fileMasked(state) {
  return state?.caller?.nameConfirmed !== true && fileHasRows(state);
}

const NO_RECORD_CLAIM =
  /\b(?:no|zero)\s+(?:open\s+|saved\s+|existing\s+|current\s+|other\s+)?(?:bookings?|records?|visits?|appointments?|reservations?|requests?)\b|\b(?:don'?t|do not|can'?t|cannot|couldn'?t|could not)\s+(?:see|find|have|locate)\s+(?:any(?:thing)?\s+)?(?:bookings?|records?|visits?|appointments?|on file|under)\b|\bnothing\s+(?:saved|booked|on file|under (?:this|your) number)\b|\b(?:isn'?t|is not|aren'?t|are not)\s+(?:a |any )?(?:bookings?|records?|visits?|appointments?)\b|\bhakuna\s+(?:booking|bookings|ziara|rekodi|miadi|oda|ombi)\b|\bsina\s+(?:rekodi|booking|ziara)\b|\bhujaweka\s+(?:booking|ziara)\b/i;

/** A sentence that says there is no booking, record or visit on file. */
function claimsNoRecord(sentence) {
  return NO_RECORD_CLAIM.test(String(sentence || ''));
}

const FILE_ASK =
  /\b(?:(?:about|for|on|check|with)\s+)?my\s+(?:book|booking|bookings|visit|visits|appointment|appointments|order|hold|request)\b|\b(?:booking|ziara|oda|miadi)\s+yangu\b/i;

/** The caller asks about what is on their file ("About my book."). */
function looksLikeFileAsk(text) {
  const raw = String(text || '');
  if (FILE_ASK.test(raw) || looksLikeFileCatchUp(raw)) return true;
  try {
    // eslint-disable-next-line global-require
    return require('./openLineSpeech').looksLikeOpenVisitLookup(raw);
  } catch {
    return false;
  }
}

/**
 * First substantive turn: not a pure greeting or small talk, not a held
 * fragment ("I was asking—"). "About my book." is substantive.
 */
function substantiveCallerTurn(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return false;
  if (/(?:[—–-]|,|\.\.\.|…)\s*$/.test(raw)) return false;
  // eslint-disable-next-line global-require
  const { looksLikePhaticCallerTurn } = require('./dynamicSpeech');
  if (looksLikePhaticCallerTurn(raw)) return false;
  const words = raw.toLowerCase().split(/[^\p{L}\p{N}']+/u).filter(Boolean);
  const content = words.filter((w) => !/^(?:i|i'm|was|is|am|a|the|uh|um|eh|so|and|ah|oh|ok|okay|yes|yeah|no|hi|hello|hey|habari|yako|sasa|mambo|nzuri|sawa|asking|nilikuwa|nauliza)$/.test(w));
  return content.length >= 1 && words.length >= 2;
}

const IDENTITY_ASK_SPOKEN =
  /\b(?:am i speaking with|is this|naongea na|ninaongea na|unaongea na|ni wewe)\s+(\p{L}[\p{L}'-]*)/iu;

/** The agent line asked "Am I speaking with {pending}?" (any mouth). */
function agentAskedFileName(agentText, pendingName) {
  const name = String(pendingName || '').trim().toLowerCase();
  if (!name) return false;
  const m = IDENTITY_ASK_SPOKEN.exec(String(agentText || ''));
  return Boolean(m && m[1].toLowerCase() === name.split(/\s+/)[0]);
}

/**
 * confirm_identity_first (docs/specs/fact-lines.md): replaces a dropped
 * no-record claim while the file is masked. ask: the name ask is still due
 * (never asked on this call); it is then marked asked (code-held flag).
 */
function confirmIdentityFirst(state, language = 'en', { askAllowed = true } = {}) {
  const name = String(state?.caller?.fileNameAsked || state?.returning?.fileOwnerName || '').trim();
  const ask = askAllowed && state?.caller?.fileNameAskSpoken !== true && Boolean(name);
  const line = factLine(
    'confirm_identity_first',
    { name: name || undefined, ask },
    { lang: language, gate: { file_masked: true, open_rows: (state?.returning?.openRows || []).length } }
  );
  const rendered = renderLines([line]);
  if (ask && rendered.line && state?.caller) {
    state.caller.fileNameAskSpoken = true;
    if (state.conversation) state.conversation.fileNameAskTurn = Number(state.conversation.turnCount || 0);
  }
  return rendered;
}

/**
 * (8) On the name-confirm turn, a file ask made before the confirm ("About my
 * booking") is answered first: visit_open lines (then requests), before any
 * other content. Clears the pending ask.
 */
function planConfirmFileRead(state, { language = 'en', now = new Date() } = {}) {
  if (!callFixesD199Enabled()) return null;
  if (state?.caller?.nameJustConfirmed !== true) return null;
  if (state?.conversation?.fileAskPending !== true) return null;
  const read = openFileRead(state, language, { now });
  if (!read) return null;
  state.conversation.fileAskPending = false;
  return { ...read, kind: 'confirm_read' };
}

// ------------------------------------------- HD_1677e57f73f9 (2, 4) closings

const CLOSING_PART =
  /^(?:(?:ok(?:ay)?|alright|sawa|haya|yeah|yes|no|um+|uh+) )?(?:ok(?:ay)?(?: then)?|alright(?: then)?|all right|sawa(?: sawa| basi)?|haya(?: basi| sawa)?|sure|cool|noted|got it|mhm+|aha|i appreciate it(?: then)?|appreciate it|much appreciated|shukran(?:i)?|poa|fine|great|yes|yeah|no|hapana|eeh|ehe|ndio|basi|thank you(?: so much| very much)?|thanks(?: a lot)?|asante(?: sana)?|nashukuru|that'?s all|that is all|that'?s it|that is it|that'?s everything|nothing else|no(?:,)? thanks?|no thank you|hiyo tu|ni hiyo tu|ni hayo tu|hayo tu|hakuna kingine|bas(?:i)? hivyo|baadaye(?: basi)?|tutaonana|kwaheri|bye(?: bye)?|goodbye|good bye|see you|have a (?:good|nice|great) day|siku njema)$/i;

/**
 * "Okay, thank you", "asante", "that's all", "hiyo tu", "Sawa, ni hayo tu.
 * Baadaye basi." are closings, not questions, and never a goal. Every
 * clause must be a closing word; a bare "okay" or "sawa" alone is an ack,
 * not a closing.
 */
function isClosingCue(text) {
  const raw = String(text || '')
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[—–]/g, ',')
    .trim();
  if (!raw || /\?/.test(raw)) return false;
  const parts = raw
    .split(/[,.!;]+/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (!parts.length) return false;
  if (!parts.every((part) => CLOSING_PART.test(part))) return false;
  // At least one real closing word: not only "okay" / "sawa" / "yes".
  return parts.some((part) => !/^(?:ok(?:ay)?(?: then)?|alright(?: then)?|all right|sawa(?: sawa| basi)?|haya(?: basi| sawa)?|sure|cool|noted|got it|mhm+|aha|poa|fine|great|yes|yeah|no|hapana|eeh|ehe|ndio|basi)$/.test(part));
}

const THINKING_FILLER =
  /^(?:natafakari|nafikiria|ngoja(?: kidogo)?|subiri(?: kidogo)?|let me think|hold on|one (?:sec|second|moment)|wait|um+|uh+|hmm+|mm+|m-m|a-a|eh+|ah+)$/i;

/** A closing or a thinking filler ("Natafakari.") is never a goal. */
function notAGoal(text) {
  const raw = String(text || '').trim().replace(/[.!,]+$/g, '').trim();
  if (!raw) return true;
  if (isClosingCue(raw)) return true;
  if (THINKING_FILLER.test(raw)) return true;
  // HD_b82fbfef7649 (3): "Haya.", "Sawa.", "Okay then", "Uh, I appreciate it
  // then": every clause an ack, a thanks, or a filler. Never a goal.
  if (/\?/.test(raw)) return false;
  const parts = raw
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[—–]/g, ',')
    .split(/[,.!;]+/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return parts.length > 0 && parts.every((part) => CLOSING_PART.test(part) || THINKING_FILLER.test(part));
}

// ------------------------------------- HD_ceba9d9b3f37 (8) review topics

// A done/next line naming one of these topics stays only when the intent or
// the caller's own words raised it ("Hours were answered." on a booking call
// that never mentioned hours is dropped).
const REVIEW_TOPICS = [
  {
    topic: 'hours',
    line: /\b(?:hours?|opening times?|open(?:ing)? (?:days|time)|saa za kazi)\b/i,
    caller: /\b(?:hours?|open|opening|close|closing|closed|what time do you|saa za kazi|mnafungua|mnafunga|mko wazi|wazi saa)\b/i,
    intents: ['hours', 'hours_open', 'opening_hours'],
  },
  {
    topic: 'price',
    line: /\b(?:price[sd]?|pricing|cost|quote|rates?|bei|gharama)\b/i,
    caller: /\b(?:price|prices|pricing|cost|costs|how much|charge|quote|rates?|bei|gharama|ni ngapi|pesa ngapi|shillings?|ksh|bob)\b/i,
    intents: ['price', 'pricing', 'quote', 'price_enquiry'],
  },
  {
    topic: 'directions',
    line: /\b(?:directions?|how to get|route|maelekezo)\b/i,
    caller: /\b(?:directions?|where are you|located|location|find you|get there|mko wapi|wapi|maelekezo|map)\b/i,
    intents: ['directions', 'location'],
  },
  {
    topic: 'coverage',
    line: /\b(?:coverage|covers?|covered|service areas?|areas? (?:we|you) serve)\b/i,
    caller: /\b(?:cover|covers|coverage|come to|reach|serve|area|mnafika|mnafikia|mnakuja|mnapatikana|mnafanya kazi)\b/i,
    intents: ['coverage', 'service_area'],
  },
  {
    topic: 'payments',
    line: /\b(?:payments?|paid|m-?pesa|paybill|till number|deposit|malipo)\b/i,
    caller: /\b(?:pay|paying|payment|paid|m-?pesa|paybill|till|deposit|cash|card|lipa|kulipa|malipo)\b/i,
    intents: ['payment', 'payments'],
  },
];

/**
 * Keep only the sentences of an owner-review done/next line whose topic came
 * up. Returns { text, dropped: [topic...] }.
 */
function keepRaisedTopics(text, { intent = '', callerTurns = [] } = {}) {
  const raw = String(text || '').trim();
  if (!raw) return { text: '', dropped: [] };
  const said = (Array.isArray(callerTurns) ? callerTurns : [callerTurns]).join(' ');
  const intentKeys = (Array.isArray(intent) ? intent : [intent]).map((i) => String(i || '').toLowerCase());
  const dropped = [];
  const sentences = raw.match(/[^.!?]+[.!?]*/g) || [raw];
  const kept = sentences.filter((sentence) => {
    for (const row of REVIEW_TOPICS) {
      if (!row.line.test(sentence)) continue;
      if (row.intents.some((i) => intentKeys.includes(i)) || row.caller.test(said)) continue;
      dropped.push(row.topic);
      return false;
    }
    return true;
  });
  return { text: kept.join(' ').replace(/\s+/g, ' ').trim(), dropped };
}

// ------------------------------------- HD_1677e57f73f9 (1b) rejected create

/**
 * A create the guard rejected ("Visit has a day but no time.") is held on
 * state.conversation.rejectedCreate until it is saved, re-asked once and
 * answered, or saved as a callback. A turn never ends with it silent.
 */
// HD_1677e57f73f9 (follow-up 2): intent stayed general_enquiry for a whole
// booking call. Only these soft intents are moved to booking.
const SOFT_INTENTS = new Set(['unknown', 'general_enquiry', 'location', 'availability', 'price', 'product_inquiry', '']);

function slotValue(entity) {
  if (!entity) return '';
  if (typeof entity === 'string') return entity.trim();
  return String(entity.value || '').trim();
}

/**
 * Move a soft intent to booking once a visit is being collected (a day or
 * time plus a service or place on a home-services call) or a create was
 * attempted. Returns true when it moved.
 */
function promoteBookingIntent(state, { profile = {}, createAttempted = false } = {}) {
  if (!callFixesD199Enabled() || !state) return false;
  const intent = String(state.intent || '');
  if (intent === 'booking' || !SOFT_INTENTS.has(intent)) return false;
  const vertical = String(profile?.vertical || state.vertical || '').toLowerCase();
  const attempted = createAttempted || Boolean(state.conversation?.rejectedCreate);
  let collecting = false;
  if (vertical === 'home_services') {
    const e = state.entities || {};
    const when = slotValue(e.when);
    const job = slotValue(e.service) || slotValue(e.requestedItem);
    const place = slotValue(e.location) || slotValue(e.landmark);
    collecting = Boolean(when && (job || place));
  }
  if (!attempted && !collecting) return false;
  state.intent = 'booking';
  if (state.goal && typeof state.goal === 'object') {
    state.goal.primary = 'make_booking_request';
    if (state.goal.status !== 'completed') state.goal.status = 'active';
  }
  return true;
}

function noteRejectedCreate(state, { slot = 'when', whenText = '', appointment = null, now = new Date() } = {}) {
  if (!callFixesD199Enabled() || !state) return null;
  if (!state.conversation) state.conversation = {};
  promoteBookingIntent(state, { createAttempted: true });
  const prev = state.conversation.rejectedCreate;
  state.conversation.rejectedCreate = {
    slot,
    whenText: String(whenText || ''),
    appointment: appointment && typeof appointment === 'object' ? { ...appointment } : prev?.appointment || null,
    reasks: prev?.reasks || 0,
    at: now.toISOString(),
    turn: Number(state.conversation.turnCount || 0),
  };
  return state.conversation.rejectedCreate;
}

function callerPendingHour(state) {
  const { swahiliPendingHourOf } = require('./visitTime');
  const answers = state?.conversation?.answersReceived || [];
  for (let i = answers.length - 1; i >= 0; i -= 1) {
    const hour = swahiliPendingHourOf(answers[i]);
    if (hour) return hour;
  }
  return state?.conversation?.pendingHour ?? null;
}

/** reask_slot for the held rejected create (the AM/PM ask when "saa 8" was said). */
function reaskSlotLine(state, language = 'en') {
  const pending = state?.conversation?.rejectedCreate;
  if (!pending) return null;
  const { dayCue, whenValue } = require('./visitTime');
  const day = dayCue(pending.whenText) || dayCue(whenValue(state)) || '';
  const hour = pending.slot === 'when' ? callerPendingHour(state) : null;
  return renderLines([
    factLine(
      'reask_slot',
      { slot: pending.slot, day: day || undefined, pending_hour: hour ?? undefined, ask_count: (pending.reasks || 0) + 1 },
      { lang: language, gate: { rejected: 'create_appointment', reason: 'Visit has a day but no time.' } }
    ),
  ]);
}

const TIME_ASK_SPOKEN =
  /\b(?:saa ngapi|what time|which time|morning or|asubuhi au|mchana au|usiku au|jioni au|in the morning or|am or pm)\b|\bsaa \p{L}+(?: na \p{L}+)? (?:asubuhi|mchana|jioni|usiku) au\b/iu;

/** Caller turn bookkeeping: count a spoken re-ask; note a time that came in. */
function observeRejectedCreate(state, { lastAgentText = '' } = {}) {
  const pending = state?.conversation?.rejectedCreate;
  if (!callFixesD199Enabled() || !pending) return;
  if (pending.slot === 'when' && TIME_ASK_SPOKEN.test(String(lastAgentText || ''))) {
    pending.reasks = (pending.reasks || 0) + 1;
    if (!(state.conversation.questionsAsked || []).slice(-1).includes('time')) {
      state.conversation.questionsAsked = [...(state.conversation.questionsAsked || []), 'time'];
    }
  }
}

function rejectedSlotFilled(state) {
  const pending = state?.conversation?.rejectedCreate;
  if (!pending) return false;
  if (pending.slot !== 'when') return false;
  const { whenValue, whenHasClockTime } = require('./visitTime');
  const when = whenValue(state);
  return Boolean(when) && whenHasClockTime(when);
}

function rejectedCallback(state) {
  const pending = state?.conversation?.rejectedCreate || {};
  const appt = pending.appointment || {};
  const { whenValue, dayCue } = require('./visitTime');
  const service = String(appt.serviceName || appt.service_name || entityText(state?.entities?.service) || 'visit');
  const place = String(appt.landmark || appt.location || entityText(state?.entities?.location) || '');
  const said = (state?.conversation?.answersReceived || []).slice(-4).join(' ');
  const day = dayCue(pending.whenText) || dayCue(whenValue(state)) || '';
  return {
    type: 'callback',
    name: String(state?.caller?.name || appt.name || ''),
    item: service,
    whenText: day,
    notes: [
      'Visit time to confirm.',
      place ? `Place: ${place}.` : '',
      said ? `Caller said: ${said}`.slice(0, 240) : '',
    ]
      .filter(Boolean)
      .join(' '),
  };
}

function entityText(value) {
  if (value && typeof value === 'object') return String(value.value || '');
  return String(value || '');
}

/**
 * Before the model, while a rejected create is held:
 *  - the slot came in: retry the create with it (kind 'retry');
 *  - the re-ask was spoken once and not answered, or the caller is closing:
 *    save a callback request so the call is never lost (kind 'callback');
 *  - the re-ask never reached the caller (barge-in, model spoke over it):
 *    speak reask_slot now (kind 'reask').
 */
function planRejectedCreate(state, { language = 'en', text = '' } = {}) {
  if (!callFixesD199Enabled()) return null;
  const pending = state?.conversation?.rejectedCreate;
  if (!pending) return null;
  const latest = String(text || (state?.conversation?.answersReceived || []).slice(-1)[0] || '');
  if (rejectedSlotFilled(state) && pending.appointment) {
    const { whenValue, dayCue } = require('./visitTime');
    const said = whenValue(state);
    const day = dayCue(said) ? '' : dayCue(pending.whenText);
    const when = `${day} ${said}`.trim();
    return {
      kind: 'retry',
      parsed: { appointment: { ...pending.appointment, whenText: when, when_text: when }, brainRescue: true },
    };
  }
  if ((pending.reasks || 0) >= 1 || isClosingCue(latest)) {
    return { kind: 'callback', parsed: { serviceRequest: rejectedCallback(state), brainRescue: true } };
  }
  const reask = reaskSlotLine(state, language);
  if (!reask?.line) return { kind: 'callback', parsed: { serviceRequest: rejectedCallback(state), brainRescue: true } };
  return { kind: 'reask', line: reask.line, lines: reask.lines };
}

/** The code re-ask was spoken: count it and hold the hour for the AM/PM answer. */
function markReaskSpoken(state) {
  const pending = state?.conversation?.rejectedCreate;
  if (!pending) return;
  pending.reaskSpokenTurn = Number(state.conversation.turnCount || 0);
  const hour = callerPendingHour(state);
  if (hour != null && state.conversation.pendingHour == null) state.conversation.pendingHour = hour;
}

/** Results of a tool turn settle the held create (saved, callback, or still rejected). */
function settleRejectedCreate(state, results = []) {
  if (!callFixesD199Enabled() || !state?.conversation?.rejectedCreate) return;
  const saved = (results || []).some(
    (r) =>
      ['create_appointment', 'create_service_request', 'update_appointment'].includes(r?.action) &&
      ['succeeded', 'updated', 'duplicate'].includes(r?.status)
  );
  if (saved) state.conversation.rejectedCreate = null;
}

/**
 * Hard check (HD_1677e57f73f9 1b): a turn with a rejected create must speak
 * the re-ask or save a callback. True when this turn broke that.
 */
function rejectedCreateUnhandled(state, { spoken = '', results = [] } = {}) {
  if (!callFixesD199Enabled()) return false;
  const rejected = (results || []).some((r) => r?.action === 'create_appointment' && r?.status === 'invalid');
  const pending = state?.conversation?.rejectedCreate;
  if (!rejected && !pending) return false;
  const callback = (results || []).some(
    (r) => r?.action === 'create_service_request' && ['succeeded', 'duplicate'].includes(r?.status)
  );
  if (callback || (!pending && !rejected)) return false;
  return !TIME_ASK_SPOKEN.test(String(spoken || '')) && !/\b(?:tuje wapi|where should we come)\b/i.test(String(spoken || ''));
}

// ------------------------------------------- HD_1677e57f73f9 (5) shared line

const ROLE_WORDS = new Set([
  'mteja', 'wateja', 'customer', 'client', 'caller', 'mpigaji', 'mgeni', 'guest',
  'boss', 'madam', 'madame', 'sir', 'mama', 'baba', 'mzee', 'dada', 'kaka', 'rafiki',
  'friend', 'owner', 'tenant', 'landlord', 'manager', 'someone', 'somebody', 'mtu',
]);

/**
 * Leftover words of a saved alternate name (after crumbs and the owner's own
 * words) name another person: each word is capitalised as the name extractor
 * saves names, none is a role word, and it is not a cut-off of the owner's
 * name. "so disappointed", "impressed by your", "Mteja" and "Chr" (for
 * Chris) are not people.
 */
function alternateNamesAPerson(words = [], owner = '') {
  const list = (Array.isArray(words) ? words : String(words || '').split(/\s+/)).filter(Boolean);
  if (!list.length) return false;
  if (list.some((w) => ROLE_WORDS.has(w.toLowerCase()))) return false;
  // A cut-off of the owner's own name ("Chr" for Chris) is the owner.
  const ownerWords = String(owner || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (list.every((w) => ownerWords.some((o) => o.startsWith(w.toLowerCase()) && w.length < o.length))) return false;
  return list.every((w) => /^\p{Lu}/u.test(w));
}

const ALT_CRUMB =
  /^(?:speaking|speak|speaks|bwana|mr|mrs|ms|miss|the|a|an|my|your|by|of|to|for|and|with|from|aje|nauliza|jina|name|uh|um|yes|yeah|this|is|am|i|im|it's|its|here|ni|mimi|naitwa)$/i;

/**
 * A saved alternate name is another person on the line. Flag off: always
 * true (the caller's existing check decides). On: crumbs and the owner's own
 * words are removed, then alternateNamesAPerson decides.
 */
function alternateIsAPerson(primary, alternate) {
  if (!callFixesD199Enabled()) return true;
  const owner = new Set(String(primary || '').toLowerCase().split(/\s+/).filter(Boolean));
  const leftover = String(alternate || '')
    .replace(/[.,!?]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !ALT_CRUMB.test(w) && !owner.has(w.toLowerCase()));
  return alternateNamesAPerson(leftover, primary);
}

// ------------------------------------------- HD_1677e57f73f9 (6) ask_area

const COVER_VERB =
  /\b(?:do you|can you|d'you|you guys)\s+(?:cover|serve|service|come to|go to|reach|work in)\s+(.+)$|^(?:mnafika|mnaja|mnafanya kazi)\s+(.+)$/i;

/**
 * "Do you cover the shops?": a coverage question with no real place in it.
 * Ask which area (ask_area); no coverage claim either way. A service word
 * ("do you cover carpets") or a file row is not this.
 */
function coverageAskWithoutPlace(text, profile = {}) {
  if (!callFixesD199Enabled()) return null;
  const value = String(text || '').replace(/[?!.]+/g, ' ').replace(/\s+/g, ' ').trim();
  const m = COVER_VERB.exec(value);
  if (!m) return null;
  const target = String(m[1] || m[2] || '').replace(/^(?:the|in|at|to)\s+/i, '').trim();
  if (!target) return null;
  if (/\b(clean|cleaning|carpet|couch|sofa|mattress|fumigation|plumb|electric|price|hours|window|kitchen)\w*/i.test(target)) return null;
  const service = serviceWordsOf(profile);
  if (target.toLowerCase().split(/[^\p{L}]+/u).some((w) => service.has(w))) return null;
  if (coverageRealPlace(target, profile)) return null;
  return target;
}

function askAreaLine(language = 'en', { asked = '' } = {}) {
  return renderLines([factLine('ask_area', {}, { lang: language, gate: { coverage_target: asked, real_place: false } })]);
}

// ------------------------------------------------ HD_b82fbfef7649 round 4 (1)
// Slot values. A sentence is never a time; a non-place word is never a place.

const DAY_OR_PART =
  /\b(?:today|tomorrow|tonight|weekend|week|month|morning|afternoon|evening|night|noon|midday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|leo|kesho|keshokutwa|juzi|jana|wiki|asubuhi|mchana|jioni|usiku|jumatatu|jumanne|jumatano|alhamisi|ijumaa|jumamosi|jumapili|saa|now|asap|sasa hivi)\b/i;

/**
 * A when slot parses to a day or a time, or stays empty: "Oh, so it's done
 * per room" is a question about the price, not the visit time.
 */
function isWhenSlotValue(value, { now = new Date() } = {}) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  // A clock or date number, not a size token ("a8", "A4").
  if (/(?:^|[^\p{L}\d])\d/u.test(raw)) return true;
  if (DAY_OR_PART.test(raw)) return true;
  // eslint-disable-next-line global-require
  const { resolveAppointmentWhen } = require('./appointmentHours');
  try {
    return resolveAppointmentWhen(raw, now)?.ok === true;
  } catch {
    return false;
  }
}

const LANDMARK_NOUN =
  /\b(?:apartments?|apts?|estate|court|road|rd|street|st|avenue|ave|drive|lane|close|crescent|way|plaza|mall|centre|center|tower|towers|flats?|gardens?|heights|park|villas?|residence|residency|block|phase|stage|junction|roundabout|hospital|school|church|mosque|market|hotel|house\s+no|plot|gate|building|bldg|near|opposite|behind|next to|karibu|nyuma ya|mbele ya|mtaa)\b/i;

const COMMON_LOWER = new Set([
  'line', 'queue', 'there', 'here', 'home', 'town', 'place', 'it', 'that', 'this', 'mind',
  'time', 'touch', 'person', 'general', 'fact', 'case', 'total', 'advance', 'person',
  'time', 'detail', 'details', 'stock', 'charge', 'question', 'order', 'person', 'room',
  'rooms', 'progress', 'process', 'future', 'line', 'bed', 'office', 'house',
]);

/**
 * A location slot is a place: the Phase 0 real-place test (countiesForPlace),
 * a landmark noun ("Grace Apartments", "near Naivas"), a tenant area, or a
 * proper name the caller said. "line" in "visits in line" is none of these.
 */
function isPlaceSlotValue(value, { profile = {} } = {}) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  if (isFillerPhrase(raw) || looksLikeTimeFragment(raw) || notAGoal(raw) || isFragmentTurn(raw)) return false;
  // eslint-disable-next-line global-require
  const { countiesForPlace } = require('./kenyaPlaces');
  if (countiesForPlace(raw).length > 0) return true;
  if (LANDMARK_NOUN.test(raw)) return true;
  const lower = raw.toLowerCase();
  const areas = [];
  for (const row of Array.isArray(profile?.businessLocations) ? profile.businessLocations : []) {
    areas.push(row?.name, row?.area, row?.town);
  }
  if (areas.filter(Boolean).some((a) => String(a).toLowerCase() === lower)) return true;
  const words = raw.split(/[\s,]+/).filter(Boolean);
  if (words.length === 1 && COMMON_LOWER.has(lower)) return false;
  // A proper name as said ("Ketengela", "Two Rivers"); a lower-case common word is not.
  return words.some((w) => /^\p{Lu}[\p{L}'’-]{2,}$/u.test(w) && !COMMON_LOWER.has(w.toLowerCase()));
}

/** Drop a junk when/location from one turn's entities (flag on only). */
function dropJunkSlots(entities, { profile = {}, now = new Date() } = {}) {
  if (!callFixesD199Enabled() || !entities) return entities;
  const val = (e) => (e && typeof e === 'object' ? String(e.value || '') : String(e || ''));
  if (entities.when && !isWhenSlotValue(val(entities.when), { now })) delete entities.when;
  if (entities.location && !isPlaceSlotValue(val(entities.location), { profile })) delete entities.location;
  return entities;
}

/**
 * The name an owner alert or notify payload carries: the code-held confirmed
 * name, never a saved row's name or an older alternate. Unconfirmed: a row
 * name only when it passes the name checks, else none.
 */
function alertCallerName({ state = null, rowName = '' } = {}) {
  const held = String(state?.caller?.name || '').trim();
  // eslint-disable-next-line global-require
  const { isPlausibleCallerName } = require('./entityExtraction');
  if (held && state?.caller?.nameConfirmed === true && isPlausibleCallerName(held)) return held;
  const row = String(rowName || '').trim();
  if (row && isPlausibleCallerName(row) && !isFillerPhrase(row)) return held && held === row ? held : row;
  return '';
}

// ------------------------------------------------ HD_b82fbfef7649 round 4 (2)

/**
 * The coverage gate is for a new create in a new place. A move or update of a
 * visit on file keeps that visit's place unless the caller names a new real
 * place, so it never meets the gate.
 */
function skipCoverageGateForMove(state, { incomingPlace = '', profile = {} } = {}) {
  if (!callFixesD199Enabled()) return false;
  if (state?.conversation?.rescheduleAsked !== true) return false;
  if (looksLikeNewJobAsk((state?.conversation?.answersReceived || []).slice(-1)[0] || '')) return false;
  const fresh = String(incomingPlace || '').trim();
  if (!fresh) return true;
  const lower = fresh.toLowerCase();
  const visits = (state?.returning?.openRows || []).filter((row) => row && row.kind === 'visit');
  if (visits.some((row) => String(row.place || '').toLowerCase().includes(lower))) return true;
  return !isPlaceSlotValue(fresh, { profile });
}

// ------------------------------------------------ HD_b82fbfef7649 round 4 (3)

/**
 * The resolution note from what was written this call: "Moved Carpet
 * Cleaning visit to Sat 10 Oct, 1 PM". Null when nothing was written.
 */
function outcomeNote(results = [], { now = new Date() } = {}) {
  const rows = (Array.isArray(results) ? results : []).filter(
    (r) => r && (r.status === 'succeeded' || r.status === 'updated')
  );
  const last = (action) => [...rows].reverse().find((r) => r.action === action) || null;
  const update = last('update_appointment');
  if (update) {
    const job = String(update.record?.service_name || update.value?.serviceName || '').trim() || 'the';
    const status = String(update.value?.status || update.record?.status || '').toLowerCase();
    if (status === 'cancelled') return `Cancelled ${job} visit`.replace(/\s+/g, ' ');
    const when = shortWhen(update.record?.window_start, update.value?.whenText || update.record?.when_text, now);
    if (when) return `Moved ${job} visit to ${when}`.replace(/\s+/g, ' ');
    return `Updated ${job} visit`.replace(/\s+/g, ' ');
  }
  const create = last('create_appointment');
  if (create) {
    const job = String(create.record?.service_name || create.value?.serviceName || 'visit').trim();
    const when = shortWhen(create.record?.window_start, create.value?.whenText || create.record?.when_text, now);
    return `Visit requested: ${job}${when ? `, ${when}` : ''}`;
  }
  const request = last('create_service_request');
  if (request) {
    const type = String(request.requestType || request.value?.type || request.record?.request_type || 'request').toLowerCase();
    const item = String(request.value?.item || request.record?.item || '').trim();
    const label = type === 'hold' || type === 'hold_or_pickup' ? 'Hold' : type.charAt(0).toUpperCase() + type.slice(1);
    return `${label} saved${item ? `: ${item}` : ''}`;
  }
  return null;
}

function shortWhen(windowStart, whenText, now = new Date()) {
  const iso = windowStart ? new Date(windowStart) : null;
  if (iso && !Number.isNaN(iso.getTime())) {
    const day = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(iso);
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(iso);
    const hour = parts.find((p) => p.type === 'hour')?.value;
    const minute = parts.find((p) => p.type === 'minute')?.value;
    const period = String(parts.find((p) => p.type === 'dayPeriod')?.value || '').toUpperCase();
    return `${day.replace(',', '')}, ${hour}${minute && minute !== '00' ? `:${minute}` : ''} ${period}`.trim();
  }
  return String(whenText || '').trim();
}

/** "Answered: price." when nothing was written and a question was answered. */
function answeredTopicNote(state) {
  const intent = String(state?.intent || '').toLowerCase();
  const topics = {
    location: 'location', directions: 'directions', hours: 'hours', hours_open: 'hours',
    price: 'price', pricing: 'price', product_inquiry: 'product', order_enquiry: 'product',
    services: 'services', coverage: 'coverage', visit_lookup: 'visit on file',
  };
  const goal = String(state?.goal?.description || '').trim();
  if (topics[intent]) return `Answered: ${topics[intent]}${goal && !notAGoal(goal) ? ` (${goal.slice(0, 80)})` : ''}.`;
  if (goal && !notAGoal(goal)) return `Answered: ${goal.slice(0, 120)}.`;
  return null;
}

// ------------------------------------------------ HD_b82fbfef7649 round 4 (4)

/**
 * Brain's prompt lines never put Okay and Sawa side by side: the model read
 * "Okay, Sawa, or leave it" and said "Okay, Sawa." on an English turn.
 */
function ackPromptText(text) {
  if (!callFixesD199Enabled()) return text;
  return String(text || '')
    .replace(/\(Then, Okay, Sawa, or leave it\)/g, '(a bare acknowledgment, or leave it)')
    .replace(/Okay, Sawa, or leave it/g, 'A bare acknowledgment or leave it');
}

const ACK_LANGUAGE_LINE =
  '- Acknowledge in the call language only: English Okay, Kiswahili Sawa. Never both in one reply.';

// ------------------------------------------------ Aris HD_d3900cbf2b2d (6)

const DANGLING_END =
  /\b(?:for|a|an|the|about|of|to|with|on|at|in|and|or|but|my|your|some|any|like|kuhusu|ya|wa|la|za|cha|kwa|na)\s*[.,]*$/i;
const NEED_VERB_NO_OBJECT =
  /^(?:(?:uh+|um+|er+|so|yes|yeah|okay|ok|hi|hello|well|sawa|eeh|ah+)[\s,]+)*(?:i\s+(?:was|am|'m)\s+(?:inquiring|enquiring|asking|wondering|calling|looking|trying)|i\s+(?:wanted|want|would like|need|wish)(?:\s+to\s+(?:ask|know|inquire|enquire|find out|check|get|order|buy|book))?|i(?:'m| am| was) calling(?:\s+(?:about|to|for|regarding))?|i\s+have\s+a\s+question|nilikuwa\s+(?:nauliza|nataka|naulizia|napiga)|nataka\s+(?:kuuliza|kujua)|nilitaka(?:\s+kuuliza|\s+kujua)?|ninauliza|naulizia|nilikuwa)\s*[.,!]*$/i;

/**
 * A cut-off turn: trailing dash or ellipsis, a dangling word ("how much for
 * a"), an ask verb with no object ("I was inquiring"), or Voice marked it
 * unfinished / barged. Nothing is saved on it.
 */
function isFragmentTurn(text, { unfinished = false, bargeIn = false } = {}) {
  if (unfinished === true || bargeIn === true) return true;
  const raw = String(text || '').trim();
  if (!raw) return true;
  if (/(?:[—–-]|\.{3}|…)\s*$/.test(raw)) return true;
  const body = raw.replace(/[?!.]+$/g, '').trim();
  if (!body) return true;
  // "What do you guys deal with?" is a whole question that ends on a preposition.
  const wholeQuestion =
    /\?\s*$/.test(raw) && /\b(?:what|who|which|where|how|nini|gani|wapi)\b/i.test(body) && body.split(/\s+/).length >= 4;
  if (!wholeQuestion && DANGLING_END.test(body)) return true;
  return NEED_VERB_NO_OBJECT.test(body);
}

/** The ask_need line (Voice owns wording; Brain's fallback in factLine.js). */
function askNeedLine(language = 'en') {
  return renderLines([factLine('ask_need', {}, { lang: language, gate: { fragment: true, write: 'none' } })]);
}

// ------------------------------------------------ Aris HD_d3900cbf2b2d (7, 8)

const SIZE_TOKEN = /^(?:a[0-9]|b[0-9]|[0-9]+x[0-9]+|[0-9]+(?:pg|pgs|pages|ml|l|g|kg|cm|mm)|[0-9]+)$/i;

/**
 * A product named without its size token ("mood diary" for "Mood diary
 * a8"). The base name must belong to exactly one product.
 */
function sizelessProductTerms(products = []) {
  // eslint-disable-next-line global-require
  const { normalizeText } = require('./entityExtraction');
  const bases = new Map();
  for (const product of products) {
    const name = normalizeText(product?.name || '');
    const words = name.split(' ').filter(Boolean);
    const kept = words.filter((w) => !SIZE_TOKEN.test(w));
    if (kept.length < 2 || kept.length === words.length) continue;
    const base = kept.join(' ');
    bases.set(base, bases.has(base) ? null : product.name);
  }
  return [...bases.entries()].filter(([, name]) => name).map(([term, canonical]) => ({ term, canonical }));
}

/** "A mood. Diary" → "a mood diary": STT stops inside a product name. */
function joinBrokenPhrase(text) {
  return String(text || '').replace(/\s*\.\s+(?=\p{Ll}|\p{Lu}\p{Ll})/gu, ' ').trim();
}

/**
 * The goal text: the canonical product name when the caller named a
 * catalogue product, else the cleaned words.
 */
function cleanGoalText(goal, profile = {}) {
  if (!callFixesD199Enabled()) return goal;
  const joined = joinBrokenPhrase(goal).replace(/[?]+$/, '').trim();
  // eslint-disable-next-line global-require
  const { findCatalogMatch } = require('./entityExtraction');
  const match = profile && (profile.productCatalog || profile.servicesCatalog) ? findCatalogMatch(joined, profile) : null;
  if (match?.kind === 'product' && match.canonical) return match.canonical;
  return goal;
}

module.exports = {
  FLAG,
  isWhenSlotValue,
  isPlaceSlotValue,
  dropJunkSlots,
  alertCallerName,
  skipCoverageGateForMove,
  outcomeNote,
  answeredTopicNote,
  ackPromptText,
  ACK_LANGUAGE_LINE,
  isFragmentTurn,
  askNeedLine,
  sizelessProductTerms,
  joinBrokenPhrase,
  cleanGoalText,
  isClosingCue,
  notAGoal,
  noteRejectedCreate,
  observeRejectedCreate,
  planRejectedCreate,
  markReaskSpoken,
  settleRejectedCreate,
  rejectedCreateUnhandled,
  reaskSlotLine,
  coverageAskWithoutPlace,
  askAreaLine,
  alternateNamesAPerson,
  promoteBookingIntent,
  alternateIsAPerson,
  keepRaisedTopics,
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
  fileHasRows,
  fileMasked,
  claimsNoRecord,
  looksLikeFileAsk,
  substantiveCallerTurn,
  agentAskedFileName,
  confirmIdentityFirst,
  planConfirmFileRead,
};
