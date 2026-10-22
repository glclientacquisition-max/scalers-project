// BRAIN_CALL_FIXES_D199 (prod HD_e75a669780d4, 20 Oct): a call that saved a
// request or a visit is never "abandoned".
//
// That call ran 259 s and saved order be519ced ("Mg zipper bag-a4"), but the
// live Brain state that reached the hangup writer had no turns and no tool
// results, and the transcripts table held only the greeting (rows lost; Voice
// is investigating). deriveCallResolution fell through to "Very short call",
// the summary said "Call completed.", and the review stopped at "thin", so
// nothing upgraded the label even though summary.service_request_id was set.
//
// The stored call summary is the durable record of what was written
// (db.createServiceRequest / db.createAppointment set the ids on it), and
// voice_turn_traces keep the caller's turns when transcript rows are lost.
// This module reads both. Everything here is used only with the flag on.

const STORED_SOURCE = 'stored_summary';

function parseStoredSummary(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function clean(value, max = 160) {
  return String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** What the stored summary says was saved on this call. */
function storedSavedWork(raw) {
  const meta = parseStoredSummary(raw);
  const requestId = clean(meta.service_request_id, 80);
  const requestType = clean(meta.service_request_type, 40).toLowerCase();
  const appointmentId = clean(meta.appointment_id, 80);
  return {
    requestId: requestId || null,
    requestType: requestId || requestType ? requestType || null : null,
    requestItem: clean(meta.service_request_item) || null,
    appointmentId: appointmentId || null,
    appointmentService: clean(meta.appointment_service) || null,
    callerName: clean(meta.name, 80) || null,
  };
}

function hasSavedWork(raw) {
  const work = storedSavedWork(raw);
  return Boolean(work.requestId || work.requestType || work.appointmentId);
}

function okRow(row, actions) {
  return (
    row &&
    actions.includes(row.action) &&
    (row.status === 'succeeded' || row.status === 'updated')
  );
}

/**
 * Tool-result rows for the work the stored summary records, in the shape
 * deriveCallResolution / deriveCallSummary already read. A row the live
 * results already carry is not added twice.
 */
function storedWorkResults(raw, liveResults = []) {
  const work = storedSavedWork(raw);
  const live = Array.isArray(liveResults) ? liveResults : [];
  const out = [];
  const liveRequest = live.some((row) => okRow(row, ['create_service_request']));
  if ((work.requestId || work.requestType) && !liveRequest) {
    out.push({
      action: 'create_service_request',
      status: 'succeeded',
      requestType: work.requestType || 'hold',
      requestStatus: 'open',
      value: {
        type: work.requestType || 'hold',
        ...(work.requestItem ? { item: work.requestItem } : {}),
      },
      record: work.requestId ? { id: work.requestId } : {},
      source: STORED_SOURCE,
    });
  }
  const liveVisit = live.some((row) => okRow(row, ['create_appointment', 'update_appointment']));
  if (work.appointmentId && !liveVisit) {
    out.push({
      action: 'create_appointment',
      status: 'succeeded',
      appointmentStatus: 'requested',
      value: work.appointmentService ? { service: work.appointmentService } : {},
      record: { id: work.appointmentId },
      source: STORED_SOURCE,
    });
  }
  return out;
}

/** Live results plus the stored work they are missing. */
function withStoredWork(liveResults, raw) {
  const live = Array.isArray(liveResults) ? liveResults : [];
  const extra = storedWorkResults(raw, live);
  return extra.length ? [...live, ...extra] : live;
}

const FLOOR_RESOLUTIONS = new Set(['abandoned', 'unknown', 'unresolved', '']);
const VERY_SHORT_RE = /^very short call\b/i;

/** A label that a saved request contradicts. */
function labelNeedsFloor(derived = {}) {
  const resolution = String(derived?.resolution || '').toLowerCase();
  if (FLOOR_RESOLUTIONS.has(resolution)) return true;
  if (!derived?.primaryIntent) return true;
  return VERY_SHORT_RE.test(String(derived?.resolutionNote || ''));
}

/**
 * The label a call with saved work gets when the label it has says nothing
 * happened. Same rules as #732: a hold, order or visit is resolved; an
 * enquiry or callback row (the owner still has to answer) is needs_human.
 * Intent comes from the saved row. Returns null when no floor applies.
 */
function savedWorkFloor(derived = {}, raw, opts = {}) {
  if (!hasSavedWork(raw)) return null;
  if (!labelNeedsFloor(derived)) return null;
  const { deriveCallResolution } = require('./callResolution');
  const fromRows = deriveCallResolution({
    brainState: {},
    toolResults: storedWorkResults(raw),
    callId: opts.callId || null,
    now: opts.now,
  });
  const keepResolution =
    !FLOOR_RESOLUTIONS.has(String(derived?.resolution || '').toLowerCase()) &&
    derived?.resolution;
  const resolution = keepResolution || fromRows.resolution;
  const note =
    keepResolution && derived?.resolutionNote && !VERY_SHORT_RE.test(derived.resolutionNote)
      ? derived.resolutionNote
      : fromRows.resolutionNote;
  return {
    ...derived,
    resolution,
    primaryIntent: derived?.primaryIntent || fromRows.primaryIntent || null,
    resolutionNote: note || null,
  };
}

const KIND_WORDS = Object.freeze({
  order: 'an order for',
  hold: 'a hold for',
  hold_or_pickup: 'a hold for',
  enquiry: 'an enquiry about',
  callback: 'a callback request',
});

/** "Chris left an order for Mg zipper bag-a4." from the stored row. */
function savedWorkReason(raw) {
  const work = storedSavedWork(raw);
  const who = work.callerName || 'Caller';
  if (work.requestId || work.requestType) {
    const kind = KIND_WORDS[work.requestType || 'hold'] || 'a request for';
    if (kind === KIND_WORDS.callback) return `${who} left a callback request.`;
    return work.requestItem ? `${who} left ${kind} ${work.requestItem}.` : `${who} left ${kind.replace(/ (for|about)$/, '')}.`;
  }
  if (work.appointmentId) {
    return work.appointmentService
      ? `${who} asked for a ${work.appointmentService} visit.`
      : `${who} asked for a visit.`;
  }
  return '';
}

const THIN_TEXT_RE = /^(call completed\.?|caller called\.?|very short call\b.*)?$/i;

function isThinSummaryText(text) {
  return THIN_TEXT_RE.test(clean(text, 400));
}

/**
 * Summary patch for a call whose stored text says nothing ("Call
 * completed.") while a row was saved. Only fills thin fields.
 */
function savedWorkSummaryPatch(raw, floored = {}) {
  const meta = parseStoredSummary(raw);
  const reason = savedWorkReason(raw);
  if (!reason) return null;
  const patch = {};
  const intent = floored?.primaryIntent || null;
  if (intent && !meta.primary_intent) patch.primary_intent = intent;
  if (isThinSummaryText(meta.text) || isThinSummaryText(meta.brain_summary)) {
    const text = [intent ? `Intent: ${intent}` : '', reason.replace(/\.$/, '')]
      .filter(Boolean)
      .join('. ')
      .concat('.');
    patch.text = text;
    patch.brain_summary = text;
  }
  if (isThinSummaryText(meta.reason)) patch.reason = reason;
  return Object.keys(patch).length ? patch : null;
}

/**
 * Caller and receptionist turns from voice_turn_traces payloads (turn
 * records), in turn order, in the shape the review reads. Fillers are not
 * receptionist words; the spoken (tts) text is.
 */
function traceTurnsForReview(payloads) {
  const rows = (Array.isArray(payloads) ? payloads : [])
    .filter((p) => p && typeof p === 'object' && (p.recordKind || 'turn') === 'turn')
    .slice()
    .sort((a, b) => Number(a.turnIndex || 0) - Number(b.turnIndex || 0));
  const turns = [];
  for (const p of rows) {
    const at = p.at || null;
    const callerText = clean(p.caller?.text, 2000);
    if (callerText) turns.push({ speaker: 'caller', text: callerText, created_at: at, source: 'trace' });
    const spoken = (Array.isArray(p.stages) ? p.stages : [])
      .filter((s) => s && (s.stage === 'tts' || s.stage === 'canned'))
      .map((s) => clean(s.text, 2000))
      .filter(Boolean);
    const agentText = clean([...new Set(spoken)].join(' '), 4000);
    if (agentText) turns.push({ speaker: 'agent', text: agentText, created_at: at, source: 'trace' });
  }
  return turns;
}

function callerTurnCount(turns) {
  return (Array.isArray(turns) ? turns : []).filter(
    (t) => String(t?.speaker || '').toLowerCase() === 'caller' && clean(t?.text || t?.text_content)
  ).length;
}

module.exports = {
  STORED_SOURCE,
  parseStoredSummary,
  storedSavedWork,
  hasSavedWork,
  storedWorkResults,
  withStoredWork,
  labelNeedsFloor,
  savedWorkFloor,
  savedWorkReason,
  isThinSummaryText,
  savedWorkSummaryPatch,
  traceTurnsForReview,
  callerTurnCount,
};
