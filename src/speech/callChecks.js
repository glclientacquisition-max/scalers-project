// Call-level checks the per-turn scorer cannot see on one turn:
//   visitMissed  a caller asked what visits they have and the reply did not
//                read one (or said "nothing open" while open visits exist).
//   dateWrong    a spoken day, date, or time-of-day greeting disagrees with the
//                Africa/Nairobi calendar at that turn.
//   nameLock     after the caller's name is locked (confirmed or given), the
//                agent asks for it again, calls the caller something else, or
//                saves a different name.
//   ignoredFile  the caller has a file (name, open visits or holds) and the
//                agent says it has no record, or never confirms the name and
//                never mentions the file (HD_23445a4f780c).
// Inputs are trace turns (src/speech/voiceTrace.js) or turns built from stored
// transcripts (turnsFromTranscriptRows). ctx is optional:
//   { callAt, openVisits: [{ service_name, when_text, window_start }], agentName,
//     businessName, extraNonNames: [],
//     callerFile: { name, openVisits: [...], openRequests: [{ item, request_type, notes }] } }

const {
  looksLikeOpenVisitLookup,
  looksLikeVisitReviewMore,
  looksLikeHistoryReview,
} = require('../conversation/openLineSpeech');

const TZ = 'Africa/Nairobi';

const WEEKDAYS_EN = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
// Kenyan Kiswahili day names, Sunday first to match Date#getDay.
const WEEKDAYS_SW = ['jumapili', 'jumatatu', 'jumanne', 'jumatano', 'alhamisi', 'ijumaa', 'jumamosi'];
const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];
const WEEKDAY_EN_RE = `(${WEEKDAYS_EN.join('|')})`;
const WEEKDAY_SW_RE = `(${WEEKDAYS_SW.join('|')})`;
const MONTH_RE = `(${MONTHS.join('|')})`;

function stagesOf(turn, name) {
  return (turn?.stages || []).filter((row) => row.stage === name);
}

function spokenOf(turn) {
  return stagesOf(turn, 'tts')
    .filter((row) => row.filler !== true)
    .map((row) => String(row.text || '').trim())
    .filter(Boolean)
    .join(' ');
}

function callerOf(turn) {
  return String(turn?.caller?.text || '').trim();
}

function modelOutputOf(turn) {
  const rows = (turn?.stages || []).filter((row) => row.stage === 'model' && row.phase === 'output');
  return rows.length ? String(rows[rows.length - 1].outputText || '') : '';
}

// ---------- Nairobi calendar ----------

function nairobiParts(at) {
  const date = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  );
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour) % 24;
  // Weekday of the Nairobi calendar date (noon UTC avoids any edge).
  const weekday = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
  return { year, month, day, hour, weekday };
}

function shiftDay(parts, days) {
  const base = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 12));
  return {
    year: base.getUTCFullYear(),
    month: base.getUTCMonth() + 1,
    day: base.getUTCDate(),
    weekday: base.getUTCDay(),
    hour: parts.hour,
  };
}

function weekdayOfDate(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
}

// Same rule as src/conversation/businessAssistantIntro.js eatTimeOfDay.
function timeOfDay(hour) {
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

function turnInstant(turn, ctx) {
  return turn?.at || ctx?.callAt || null;
}

function dateClaims(text) {
  const out = [];
  const lower = String(text || '').toLowerCase();
  if (!lower) return out;
  const offsets = { today: 0, tomorrow: 1, yesterday: -1, leo: 0, kesho: 1, jana: -1 };
  const relEn = new RegExp(`\\b(today|tomorrow|yesterday)(?:\\s+is|\\s+will be|\\s+was|,)?\\s+(?:a\\s+)?${WEEKDAY_EN_RE}\\b`, 'g');
  for (const m of lower.matchAll(relEn)) {
    out.push({ kind: 'relative-weekday', offset: offsets[m[1]], weekday: WEEKDAYS_EN.indexOf(m[2]), said: m[0] });
  }
  const relSw = new RegExp(`\\b(leo|kesho|jana)(?:\\s+ni|\\s+ilikuwa|,)?\\s+${WEEKDAY_SW_RE}\\b`, 'g');
  for (const m of lower.matchAll(relSw)) {
    out.push({ kind: 'relative-weekday', offset: offsets[m[1]], weekday: WEEKDAYS_SW.indexOf(m[2]), said: m[0] });
  }
  // today is (Friday,) the 9th of October / today is 9 October
  const relDate = new RegExp(
    `\\b(today|tomorrow|yesterday)(?:\\s+is|\\s+will be|\\s+was|,)?\\s+(?:${WEEKDAY_EN_RE},?\\s+)?(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+${MONTH_RE}\\b`,
    'g'
  );
  for (const m of lower.matchAll(relDate)) {
    out.push({ kind: 'relative-date', offset: offsets[m[1]], day: Number(m[3]), month: MONTHS.indexOf(m[4]) + 1, said: m[0] });
  }
  // Friday, the 9th of October / Friday 9 October / Friday, October 9th
  const dated = new RegExp(
    `\\b${WEEKDAY_EN_RE},?\\s+(?:the\\s+)?(?:(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+${MONTH_RE}|${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?)\\b`,
    'g'
  );
  for (const m of lower.matchAll(dated)) {
    const day = Number(m[2] || m[5]);
    const month = MONTHS.indexOf(m[3] || m[4]) + 1;
    out.push({ kind: 'weekday-date', weekday: WEEKDAYS_EN.indexOf(m[1]), day, month, said: m[0] });
  }
  const greetEn = /\bgood (morning|afternoon|evening)\b/g;
  for (const m of lower.matchAll(greetEn)) out.push({ kind: 'greeting', tod: m[1], said: m[0] });
  const greetSw = /\b(?:habari za|habari ya|za)\s+(asubuhi|mchana|jioni)\b/g;
  const swTod = { asubuhi: 'morning', mchana: 'afternoon', jioni: 'evening' };
  for (const m of lower.matchAll(greetSw)) out.push({ kind: 'greeting', tod: swTod[m[1]], said: m[0] });
  return out;
}

function yearFor(month, ref) {
  // A month far behind the call month is next year (December call, "January 3").
  if (month < ref.month - 6) return ref.year + 1;
  if (month > ref.month + 6) return ref.year - 1;
  return ref.year;
}

function judgeClaim(claim, ref) {
  if (claim.kind === 'greeting') {
    const want = timeOfDay(ref.hour);
    return claim.tod === want ? null : `"${claim.said}" at ${String(ref.hour).padStart(2, '0')}h EAT (${want})`;
  }
  if (claim.kind === 'relative-weekday') {
    const target = shiftDay(ref, claim.offset);
    if (target.weekday === claim.weekday) return null;
    return `"${claim.said}" but that day is ${WEEKDAYS_EN[target.weekday]} in Nairobi`;
  }
  if (claim.kind === 'relative-date') {
    const target = shiftDay(ref, claim.offset);
    if (target.day === claim.day && target.month === claim.month) return null;
    return `"${claim.said}" but that day is ${target.day} ${MONTHS[target.month - 1]} in Nairobi`;
  }
  if (claim.kind === 'weekday-date') {
    if (claim.month < 1 || claim.day < 1 || claim.day > 31) return null;
    const year = yearFor(claim.month, ref);
    const actual = weekdayOfDate(year, claim.month, claim.day);
    if (actual === claim.weekday) return null;
    return `"${claim.said}" but ${claim.day} ${MONTHS[claim.month - 1]} ${year} is a ${WEEKDAYS_EN[actual]}`;
  }
  return null;
}

function nairobiDateChecks(turns = [], ctx = {}) {
  const perTurn = [];
  for (const turn of turns) {
    const at = turnInstant(turn, ctx);
    const ref = at ? nairobiParts(at) : null;
    if (!ref) continue;
    for (const claim of dateClaims(spokenOf(turn))) {
      const why = judgeClaim(claim, ref);
      if (why) perTurn.push({ turnIndex: turn.turnIndex ?? null, note: `wrong Nairobi date: ${why}` });
    }
  }
  return perTurn;
}

// ---------- visit read ----------

const VISIT_ASK_EXTRA =
  /\b(?:when (?:are|will) you (?:coming|come)|my (?:visits?|appointments?|bookings?)|(?:the|my) visit|is my (?:visit|booking|appointment)|(?:ziara|miadi|booking) yangu|lini mtakuja|mtakuja lini|mnakuja lini)\b/i;
const VISIT_READ =
  /\b(?:you have|una|uko na|you(?:'re| are) (?:booked|scheduled)|is (?:booked|scheduled|set) for|we(?:'ll| will) (?:come|be there))\b/i;
const VISIT_WHEN = new RegExp(
  `\\b(?:today|tomorrow|tonight|leo|kesho|${WEEKDAYS_EN.join('|')}|${WEEKDAYS_SW.join('|')}|${MONTHS.join('|')}|\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)|saa\\s+\\w+)\\b`,
  'i'
);
const VISIT_NONE =
  /\b(?:nothing is (?:still )?open|no (?:open |upcoming )?(?:visits?|bookings?|appointments?)|(?:don't|do not) (?:have|see) any (?:open |upcoming )?(?:visits?|bookings?|appointments?)|hakuna (?:kilicho wazi|ziara|miadi|booking)|hakuna kitu iko open)\b/i;

function asksForVisits(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  if (looksLikeOpenVisitLookup(raw) || looksLikeVisitReviewMore(raw) || looksLikeHistoryReview(raw)) return true;
  if (/\b(?:cancel|reschedul\w*|book (?:a|an|me)|want to book)\b/i.test(raw)) return false;
  return VISIT_ASK_EXTRA.test(raw);
}

function visitReadChecks(turns = [], ctx = {}) {
  const open = Array.isArray(ctx.openVisits) ? ctx.openVisits : null;
  const out = [];
  for (let i = 0; i < turns.length; i += 1) {
    const turn = turns[i];
    if (!asksForVisits(callerOf(turn))) continue;
    // A hold or filler turn can carry the read on the next agent turn.
    let reply = spokenOf(turn);
    if (!reply.trim() && turns[i + 1] && !callerOf(turns[i + 1])) reply = spokenOf(turns[i + 1]);
    const saidNone = VISIT_NONE.test(reply);
    const read = !saidNone && VISIT_READ.test(reply) && VISIT_WHEN.test(reply);
    if (saidNone && open && open.length) {
      out.push({ turnIndex: turn.turnIndex ?? null, note: `visit ask answered "none" but ${open.length} open visit(s) on file` });
      continue;
    }
    if (read || saidNone) continue;
    out.push({ turnIndex: turn.turnIndex ?? null, note: 'visit ask not read out' });
  }
  return out;
}

// ---------- name lock ----------

const YES = /^(?:yes|yeah|yep|yup|sure|correct|that's (?:me|right|correct)|it's me|speaking|ndio|ndiyo|ni mimi|eeh|eh|ehe|sawa)\b/i;
const NO = /^(?:no|nope|not really|hapana|si mimi|la)\b/i;
const FILE_NAME_ASK = /\b(?:am i speaking with|is this|naongea na|ninaongea na|ni wewe)\s+([A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+){0,2})\s*\?/u;
// "Ni Alvin ninaongea naye?"
const FILE_NAME_ASK_SW = /\bni\s+([A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+)?)\s+(?:ninaongea|naongea)\s+naye\s*\?/u;

function fileNameAsk(text) {
  const m = String(text || '').match(FILE_NAME_ASK) || String(text || '').match(FILE_NAME_ASK_SW);
  return m ? m[1] : null;
}
const NAME_ASK =
  /\b(jina lako|niambie jina|may i have your name|can i (?:get|have) your name|what(?:'s| is) your name|who am i (?:speaking|talking) (?:with|to))\b/i;

const ADDRESS_LEAD =
  /(?:^|[.?!]\s+)(?:thanks|thank you|asante|okay|ok|sawa|hello|hi|habari|karibu|alright|great|sure|yes|ndio|poa|welcome back),?\s+([A-Z][\p{L}'-]+)\b/gu;
const ADDRESS_TAIL = /,\s+([A-Z][\p{L}'-]+)\s*[?.!]/gu;
const NOT_NAMES = new Set([
  ...WEEKDAYS_EN, ...WEEKDAYS_SW, ...MONTHS,
  'sir', 'madam', 'maam', 'boss', 'please', 'there', 'thanks', 'today', 'tomorrow', 'tonight',
  'kenya', 'nairobi', 'mpesa', 'm-pesa', 'whatsapp', 'english', 'kiswahili', 'swahili', 'sheng',
  'i', 'we', 'you', 'what', 'how', 'when', 'where', 'which', 'is', 'can', 'do', 'would', 'will',
  'ni', 'na', 'una', 'je', 'karibu', 'asante', 'sawa', 'okay', 'right', 'yes', 'no',
]);

const GIVEN_STRONG = /\b(?:my name is|my name's|naitwa|jina langu ni|ni mimi|unaongea na|unazungumza na)\s+([A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+)?)/iu;
// "I'm X" / "this is X" only when the name ends the clause ("I'm Looking for" is not a name).
const GIVEN_WEAK = /\b(?:i am|i'm|this is|it's)\s+([A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+)?)\s*(?:[.,!?]|$)/u;

function givenName(text) {
  const m = String(text || '').match(GIVEN_STRONG) || String(text || '').match(GIVEN_WEAK);
  if (!m) return null;
  const name = m[1].replace(/\s+(?:and|na|from|here)$/i, '');
  return NOT_NAMES.has(name.toLowerCase()) ? null : name;
}

function nameTokens(name) {
  return String(name || '')
    .toLowerCase()
    .split(/\s+/)
    .map((part) => part.replace(/[^\p{L}'-]/gu, ''))
    .filter(Boolean);
}

function sameName(a, b) {
  const left = nameTokens(a);
  const right = nameTokens(b);
  return left.some((token) => right.includes(token));
}

function savedNames(turn) {
  const names = [];
  const text = modelOutputOf(turn);
  for (const m of text.matchAll(/###TOOL###([\s\S]*?)###ENDTOOL###/gi)) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const name = parsed?.save_caller_info?.name;
      if (name) names.push(String(name));
    } catch {
      /* not JSON */
    }
  }
  for (const row of stagesOf(turn, 'tool')) {
    const m = String(row.args || '').match(/"?name"?\s*[:=]\s*"([^"]+)"/);
    if (m && /caller|save|capture|lead/i.test(String(row.name || ''))) names.push(m[1]);
  }
  return names;
}

function nameLockChecks(turns = [], ctx = {}) {
  const out = [];
  const skip = new Set([
    ...nameTokens(ctx.agentName),
    ...nameTokens(ctx.businessName),
    ...(ctx.extraNonNames || []).flatMap(nameTokens),
  ]);
  let locked = null;
  let pendingFileName = null;
  for (const turn of turns) {
    const caller = callerOf(turn);
    // 1. The caller answers the previous agent turn.
    if (caller) {
      const given = givenName(caller);
      if (pendingFileName && NO.test(caller)) {
        locked = given || null;
      } else if (given) {
        locked = given;
      } else if (pendingFileName && YES.test(caller)) {
        locked = pendingFileName;
      }
      pendingFileName = null;
    }
    const spoken = spokenOf(turn);
    if (!spoken) continue;
    const at = turn.turnIndex ?? null;
    // 2. Agent asks again after the lock.
    const fileAsk = fileNameAsk(spoken);
    if (locked) {
      if (fileAsk && !sameName(fileAsk, locked)) {
        out.push({ turnIndex: at, note: `name lock: asked "${fileAsk}" after the caller was locked as "${locked}"` });
      } else if (fileAsk || NAME_ASK.test(spoken)) {
        out.push({ turnIndex: at, note: `name lock: name asked again after "${locked}" was locked` });
      }
      // 3. Agent calls the caller something else.
      const addressed = [
        ...[...spoken.matchAll(ADDRESS_LEAD)].map((m) => m[1]),
        ...[...spoken.matchAll(ADDRESS_TAIL)].map((m) => m[1]),
      ];
      for (const name of addressed) {
        const key = name.toLowerCase();
        if (NOT_NAMES.has(key) || skip.has(key)) continue;
        if (!sameName(name, locked)) {
          out.push({ turnIndex: at, note: `name lock: called the caller "${name}", locked as "${locked}"` });
        }
      }
      // 4. A different name is saved.
      for (const name of savedNames(turn)) {
        if (!sameName(name, locked)) {
          out.push({ turnIndex: at, note: `name lock: saved "${name}", locked as "${locked}"` });
        }
      }
    }
    pendingFileName = fileAsk || null;
  }
  return out;
}

// ---------- ignored caller file ----------

const NO_RECORD =
  /\b(?:(?:i |we )?(?:don't|do not) have (?:any |a )?(?:record|records|history|file|details|notes)|no (?:record|records|history|file) of|(?:i |we )?(?:can't|cannot) (?:find|see) (?:any |a )?(?:record|records|history|file|booking)|(?:you(?:'re| are) )?(?:a )?new (?:caller|customer) here|first time (?:calling|you call)|sina (?:kumbukumbu|rekodi|historia|record)|hatuna (?:kumbukumbu|rekodi|historia|record)|haina (?:kumbukumbu|rekodi)|sioni (?:rekodi|kumbukumbu|record))\b/i;
const FILE_TALK =
  /\b(?:your (?:visit|booking|appointment|hold|order|file|quote)|last time|yesterday(?:'s)? (?:call|quote|request)|we spoke|on file|ziara yako|booking yako|hold yako|oda yako|jana tuli(?:ongea|zungumza)|mara ya mwisho)\b/i;

const FILE_STOP = new Set(['visit', 'request', 'hold', 'callback', 'message', 'open', 'requested', 'confirmed', 'cleaning', 'service', 'the', 'and', 'for', 'at']);

function tokensOf(raw) {
  return String(raw || '')
    .toLowerCase()
    .split(/[^\p{L}0-9]+/u)
    .filter((w) => w && (w.length >= 3 || /\d/.test(w)) && !FILE_STOP.has(w));
}

// A catalogue list naming "carpet" is not the file. A file mention pairs the
// job with its time ("carpet ... 9 AM today"), or the hold item with hold talk.
function fileMatchers(file) {
  const rows = [];
  for (const v of file.openVisits || []) {
    const job = typeof v === 'string' ? v.split('|')[0] : v?.service_name || v?.serviceName;
    const when = typeof v === 'string' ? v.split('|').slice(1).join(' ') : v?.when_text || v?.whenText;
    const jobT = tokensOf(job);
    const whenT = tokensOf(when);
    if (jobT.length && whenT.length) rows.push((t) => jobT.some((w) => t.has(w)) && whenT.some((w) => t.has(w)));
  }
  for (const r of file.openRequests || []) {
    const itemT = tokensOf(typeof r === 'string' ? r : r?.item);
    if (itemT.length) {
      rows.push((t, raw) => itemT.some((w) => t.has(w)) && /\b(?:hold|request|quote|order|callback|ombi|oda)\b/i.test(raw));
    }
  }
  return rows;
}

// "I've saved your visit request" is this call's new write, not the file.
const SAVE_LINE = /\b(?:i've|i have|we've|we have) (?:saved|updated|moved|cancelled|noted)\b|\bnime(?:hifadhi|-save|sasisha|hamisha|ghairi)\b/i;

function mentionsFile(spoken, matchers) {
  return String(spoken)
    .split(/(?<=[.?!])\s+/)
    .filter((sentence) => !SAVE_LINE.test(sentence))
    .some((sentence) => {
      if (FILE_TALK.test(sentence)) return true;
      const t = new Set(tokensOf(sentence));
      return matchers.some((fn) => fn(t, sentence));
    });
}

function callerFileOf(ctx = {}) {
  const file = ctx.callerFile && typeof ctx.callerFile === 'object' ? ctx.callerFile : {};
  const name = String(file.name || '').trim() || null;
  const openVisits = Array.isArray(file.openVisits) ? file.openVisits : Array.isArray(ctx.openVisits) ? ctx.openVisits : [];
  const openRequests = Array.isArray(file.openRequests) ? file.openRequests : [];
  if (!name && !openVisits.length && !openRequests.length) return null;
  return { name, openVisits, openRequests };
}

function ignoredFileChecks(turns = [], ctx = {}) {
  const file = callerFileOf(ctx);
  if (!file) return [];
  const out = [];
  const nameKeys = nameTokens(file.name).filter((t) => t.length >= 3);
  const matchers = fileMatchers(file);
  let confirmedName = false;
  let mentionedFile = false;
  let firstAgentTurn = null;
  let noRecordAt = null;
  for (const turn of turns) {
    const spoken = spokenOf(turn);
    if (!spoken) continue;
    if (firstAgentTurn == null) firstAgentTurn = turn.turnIndex ?? null;
    const lower = spoken.toLowerCase();
    const ask = fileNameAsk(spoken);
    if (nameKeys.length && ((ask && sameName(ask, file.name)) || nameKeys.some((k) => new RegExp(`\\b${k}\\b`, 'i').test(lower)))) {
      confirmedName = true;
    }
    if (mentionsFile(spoken, matchers)) mentionedFile = true;
    if (noRecordAt == null && NO_RECORD.test(spoken)) noRecordAt = turn.turnIndex ?? null;
  }
  const facts = [
    file.name ? `name ${file.name}` : null,
    file.openVisits.length ? `${file.openVisits.length} open visit(s)` : null,
    file.openRequests.length ? `${file.openRequests.length} open hold(s)` : null,
  ].filter(Boolean).join(', ');
  if (noRecordAt != null) {
    out.push({ turnIndex: noRecordAt, note: `ignored caller file: said there is no record, file has ${facts}` });
  }
  if (!confirmedName && !mentionedFile) {
    out.push({ turnIndex: firstAgentTurn, note: `ignored caller file: never confirmed the name or mentioned the file (${facts})` });
  }
  return out;
}

// ---------- combined ----------

const CALL_CHECK_WEIGHT = { visitMissed: 20, dateWrong: 20, nameLock: 15, ignoredFile: 25 };
const CALL_CHECK_CAP = 60;

function callChecks(turns = [], ctx = {}) {
  const found = {
    visitMissed: visitReadChecks(turns, ctx),
    dateWrong: nairobiDateChecks(turns, ctx),
    nameLock: nameLockChecks(turns, ctx),
    ignoredFile: ignoredFileChecks(turns, ctx),
  };
  const counts = {};
  let penalty = 0;
  for (const [key, rows] of Object.entries(found)) {
    counts[key] = rows.length;
    penalty += rows.length * CALL_CHECK_WEIGHT[key];
  }
  return {
    counts,
    findings: found,
    penalty: Math.min(CALL_CHECK_CAP, penalty),
  };
}

// ---------- stored transcripts (prod has no voice_turn_traces) ----------

/**
 * Build scorer turns from transcript rows ({ speaker, text_content, created_at }).
 * Consecutive caller rows are one caller turn; the agent rows after it are the
 * reply. An agent row before any caller row is turn 1 (the greeting).
 * Rows carry only text, so latency, language tags, and model output are absent.
 */
function turnsFromTranscriptRows(rows = [], { callId = null, callAt = null } = {}) {
  const turns = [];
  let current = null;
  const open = (callerText, at) => {
    current = {
      recordKind: 'turn',
      source: 'transcripts',
      callId,
      turnIndex: turns.length + 1,
      at: at || callAt,
      caller: { text: callerText },
      stages: [],
    };
    turns.push(current);
  };
  for (const row of rows) {
    const speaker = String(row.speaker || '').toLowerCase();
    const text = String(row.text_content ?? row.text ?? '').trim();
    if (!text) continue;
    const at = row.created_at || row.at || callAt;
    if (speaker === 'caller' || speaker === 'user' || speaker === 'customer') {
      if (current && !current.stages.length) {
        current.caller.text = `${current.caller.text} ${text}`.trim();
      } else {
        open(text, at);
      }
    } else {
      if (!current) open('', at);
      current.stages.push({ stage: 'tts', text, before: text, language: null });
    }
  }
  for (const turn of turns) turn.stages.push({ stage: 'outcome', value: 'transcript' });
  return turns;
}

module.exports = {
  CALL_CHECK_WEIGHT,
  callChecks,
  visitReadChecks,
  nairobiDateChecks,
  nameLockChecks,
  ignoredFileChecks,
  nairobiParts,
  dateClaims,
  asksForVisits,
  turnsFromTranscriptRows,
};
