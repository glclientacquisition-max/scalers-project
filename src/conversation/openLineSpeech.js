// Backend speech for a name-confirm turn, and for a later turn where a
// caller who is already name-confirmed asks what is still open.
// The model must not speak on those turns. These lines use only fields present.

const STATUS = /^(requested|confirmed|open|pending|cancelled|canceled|done|completed)$/i;
const LEAD = /^(request|hold|enquiry|inquiry)$/i;

function languageOf(language) {
  const value = String(language || '').trim().toLowerCase();
  if (value === 'sw' || value === 'sheng') return value;
  return 'en';
}

function bitsOf(line) {
  return String(line || '')
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part && !STATUS.test(part));
}

function sentence(bits, language, kind) {
  const parts = bits[0] && LEAD.test(bits[0]) ? bits.slice(1) : bits;
  const job = parts[0] || '';
  const when = parts[1] || '';
  const place = parts[2] || '';
  if (!job) return '';
  const tail = [when, place].filter(Boolean);
  const detail = tail.length ? `, ${tail.join(', ')}` : '';
  if (language === 'sw') {
    const lead = kind === 'request' ? `Una ombi la ${job}` : `Una ${job}`;
    return `${lead}${detail}.`;
  }
  if (language === 'sheng') {
    const lead = kind === 'request' ? `Uko na request ya ${job}` : `Uko na ${job}`;
    return `${lead}${detail}.`;
  }
  const lead = kind === 'request' ? `You have a ${job} request` : `You have ${job}`;
  return `${lead}${detail}.`;
}

function question(language) {
  if (language === 'sw') return 'Ungependa nifanye nini?';
  if (language === 'sheng') return 'Unataka nifanye nini?';
  return 'What would you like to do?';
}

function nothingOpen(language) {
  if (language === 'sw') return 'Hakuna kilicho wazi.';
  if (language === 'sheng') return 'Hakuna kitu iko open.';
  return 'Nothing is still open.';
}


// Lookup of visits already on file. Caller text only.
// Not a new booking, a change, a cancel, hours, or a services menu.
const LOOKUP_BLOCK_RE =
  /\b(?:cancel(?:led|lation)?|reschedul\w*|change|move|badilisha|ahirisha|kughairi|kubadilisha|book(?:\s+(?:a|an|me|us))?|schedule(?:\s+(?:a|an))?|(?:want|need|like) to book|what time|when (?:do|are) you open|opening hours|business hours|which services|what services|services do you offer|what do you offer)\b/i;

const LOOKUP_RE =
  /\b(?:inquire about (?:my |our )?(?:bookings?|visits?|appointments?)|(?:my|our) bookings?|do i have (?:a |any )?(?:visits?|bookings?|appointments?)|what are my (?:bookings?|visits?|appointments?)|what (?:bookings?|visits?|appointments?) do i have|what do i have|check (?:on )?(?:my |our )?(?:bookings?|visits?|appointments?)|(?:just |please )?(?:list them|list my (?:bookings?|visits?|appointments?)|listed)|update me (?:about|on) what i have|tell me what i have|bookings zangu|booking yangu|ziara zangu|nini niko nayo|nilicho nacho|orodhesha|niambie (?:ziara|bookings))\b/i;

// A later page of the same file. Not a new booking and not the first list.
// "What else" alone is not a file ask: HD_015bae4a4af2 "What else can you do?"
// read eight old visits for 30 s. It pages the file only when it names the
// caller's own rows.
const REVIEW_MORE_RE =
  /\b(?:older ones?|the rest|previous ones?|the previous|show me more|what else (?:do i have|have i (?:got|booked)|is (?:there )?(?:on (?:my|the) file|open|booked))|more of them|and the rest|za zamani|zilizobaki|zingine|nyingine)\b/i;

const HISTORY_RE =
  /\b(?:my history|booking history|visit history|appointment history|past (?:bookings?|visits?|appointments?)|historia(?: yangu)?)\b/i;

function looksLikeOpenVisitLookup(text) {
  const raw = String(text || '').trim();
  if (!raw || LOOKUP_BLOCK_RE.test(raw)) return false;
  return LOOKUP_RE.test(raw);
}

function looksLikeVisitReviewMore(text) {
  const raw = String(text || '').trim();
  if (!raw || LOOKUP_BLOCK_RE.test(raw)) return false;
  return REVIEW_MORE_RE.test(raw);
}

function looksLikeHistoryReview(text) {
  const raw = String(text || '').trim();
  if (!raw || LOOKUP_BLOCK_RE.test(raw)) return false;
  return HISTORY_RE.test(raw);
}

function openLineHoldDecision({
  nameConfirmed = false,
  nameJustConfirmed = false,
  callerText = '',
} = {}) {
  const just = nameJustConfirmed === true;
  const asked =
    looksLikeOpenVisitLookup(callerText) ||
    looksLikeVisitReviewMore(callerText) ||
    looksLikeHistoryReview(callerText);
  const lookup = nameConfirmed === true && !just && asked;
  return {
    holdNameConfirm: just,
    holdVisitLookup: lookup,
    holdSpeech: just || lookup,
  };
}

function formatNameConfirmSpeech({
  openVisits = [],
  openRequests = [],
  language = 'en',
} = {}) {
  const lang = languageOf(language);
  const lines = [];
  for (const visit of Array.isArray(openVisits) ? openVisits : []) {
    const said = sentence(bitsOf(visit), lang, 'visit');
    if (said) lines.push(said);
  }
  for (const row of Array.isArray(openRequests) ? openRequests : []) {
    const said = sentence(bitsOf(row), lang, 'request');
    if (said) lines.push(said);
  }
  if (!lines.length) return `${nothingOpen(lang)} ${question(lang)}`;
  return `${lines.join(' ')} ${question(lang)}`;
}

// Name lock must not publish the open file. A later visit, booking, hold,
// callback, or order ask still can. The speech hold itself stays as it is.
function shouldPublishOpenFileSentence(hold = {}, fileReadAsk = false) {
  if (hold?.holdNameConfirm === true) return false;
  return Boolean(hold?.holdVisitLookup || fileReadAsk);
}

const { messageOnlyNoVisitLine } = require('./messageOnly');
const { pageCallerVisitReview } = require('./callerMemory');

const VISIT_REVIEW_PAGE = 8;

function pageSpokenLines(lines, page, pageSize) {
  const source = (Array.isArray(lines) ? lines : []).filter(Boolean);
  const size = pageSize;
  const index = Math.max(0, page);
  const start = index * size;
  return {
    lines: source.slice(start, start + size),
    total: source.length,
    hasMore: start + size < source.length,
  };
}

function speakVisitLines(lines, language, { more = false } = {}) {
  if (lines.length) {
    return formatNameConfirmSpeech({
      openVisits: lines,
      openRequests: [],
      language,
    });
  }
  if (more) {
    if (language === 'sw' || language === 'sheng') return 'Hakuna zaidi.';
    return 'Nothing further back.';
  }
  return formatNameConfirmSpeech({ openVisits: [], openRequests: [], language });
}

/**
 * Code speaks the file before the model. Open rows on a "what do I have" ask.
 * Older rows only when they ask for history or the next page. No fixed maximum.
 * Name lock and message-only do not read visits.
 */
function planVisitReadTurn({
  nameConfirmed = false,
  nameJustConfirmed = false,
  callerText = '',
  messageOnly = false,
  language = 'en',
  openVisits = [],
  appointments = [],
  cursor = null,
  now = new Date(),
  pageSize = VISIT_REVIEW_PAGE,
  openRequests = [],
  fileState = null,
} = {}) {
  const more = looksLikeVisitReviewMore(callerText);
  const history = looksLikeHistoryReview(callerText);
  const lookup = looksLikeOpenVisitLookup(callerText);
  const current =
    cursor && typeof cursor === 'object' ? cursor : { phase: 'open', page: 0 };
  const fixesD199 = require('./callFixesD199');
  const fixesOn = fixesD199.callFixesD199Enabled();
  if (
    fixesOn &&
    fileState &&
    nameConfirmed === true &&
    nameJustConfirmed !== true &&
    !messageOnly
  ) {
    // BRAIN_CALL_FIXES_D199 (b)(e): code answers "when did I request that?",
    // "what have you saved?", and "the mansion one" from the file.
    const answer = fixesD199.planFileAnswer({
      text: callerText,
      state: fileState,
      language: languageOf(language),
      now,
    });
    if (answer?.line) {
      if (answer.rowId && fileState.conversation && typeof fileState.conversation === 'object') {
        fileState.conversation.lastFileRowId = answer.rowId;
      }
      return { runModel: false, line: answer.line, lines: answer.lines, cursor: current, kind: answer.kind };
    }
    // (b) the first open read: every open visit, then requests and holds, as fact lines.
    if (lookup && !more && !history) {
      const read = fixesD199.openFileRead(fileState, languageOf(language), { now });
      if (read) {
        return { runModel: false, line: read.line, lines: read.lines, cursor: { phase: 'done', page: 0 }, kind: 'open_read' };
      }
    }
  }
  if (fixesOn && fileState && !messageOnly) {
    // HD_1b3a67ea7ee9 (8): the confirm turn answers the file ask made before it.
    const confirmRead = fixesD199.planConfirmFileRead(fileState, { language: languageOf(language), now });
    if (confirmRead) {
      return { runModel: false, line: confirmRead.line, lines: confirmRead.lines, cursor: { phase: 'done', page: 0 }, kind: 'confirm_read' };
    }
    // (6) Unconfirmed: the read result is masked, never empty.
    if (
      nameConfirmed !== true &&
      fixesD199.fileMasked(fileState) &&
      (lookup || more || history || fixesD199.looksLikeFileAsk(callerText))
    ) {
      return { runModel: true, line: '', cursor: current, masked: true, fileStatus: 'masked' };
    }
  }
  if (!lookup && !more && !history) return { runModel: true, line: '', cursor: current };
  if (nameJustConfirmed === true || nameConfirmed !== true) {
    return { runModel: true, line: '', cursor: current };
  }
  const lang = languageOf(language);
  if (messageOnly) {
    return { runModel: false, line: messageOnlyNoVisitLine(lang), cursor: current };
  }
  const size = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : VISIT_REVIEW_PAGE;
  const rows = Array.isArray(appointments) ? appointments : [];
  const hasRows = rows.length > 0;

  // BRAIN_CALL_FIXES_D199 (b): the first open read also says open requests and
  // holds ("Mansion Cleaning Custom Quote" was missed on HD_d199).
  const requestLines =
    fixesOn && Array.isArray(openRequests) ? openRequests.filter(Boolean) : [];
  const speakOpen = (lines) =>
    requestLines.length
      ? formatNameConfirmSpeech({ openVisits: lines, openRequests: requestLines, language: lang })
      : speakVisitLines(lines, lang);

  if (lookup && !more && !history) {
    if (hasRows) {
      const page = pageCallerVisitReview(rows, { page: 0, pageSize: size, now, scope: 'open' });
      const done = pageCallerVisitReview(rows, { page: 0, pageSize: size, now, scope: 'done' });
      const next = page.hasMore ? { phase: 'open', page: 1 } : { phase: 'done', page: 0 };
      return {
        runModel: false,
        line: speakOpen(page.lines),
        cursor: next,
        hasMore: page.hasMore || done.total > 0,
      };
    }
    const page = pageSpokenLines(openVisits, 0, size);
    return {
      runModel: false,
      line: speakOpen(page.lines),
      cursor: page.hasMore ? { phase: 'open', page: 1 } : { phase: 'done', page: 0 },
      hasMore: page.hasMore,
    };
  }

  if (history && !more) {
    if (hasRows) {
      const page = pageCallerVisitReview(rows, { page: 0, pageSize: size, now, scope: 'all' });
      return {
        runModel: false,
        line: speakVisitLines(page.lines, lang, { more: true }),
        cursor: page.hasMore ? { phase: 'all', page: 1 } : { phase: 'all', page: 0 },
        hasMore: page.hasMore,
      };
    }
    const page = pageSpokenLines(openVisits, 0, size);
    return {
      runModel: false,
      line: speakVisitLines(page.lines, lang, { more: true }),
      cursor: { phase: 'done', page: 0 },
      hasMore: page.hasMore,
    };
  }

  const phase = current.phase === 'open' || current.phase === 'all' ? current.phase : 'done';
  const pageIndex = Math.max(0, Number(current.page) || 0);
  if (hasRows) {
    const page = pageCallerVisitReview(rows, {
      page: pageIndex,
      pageSize: size,
      now,
      scope: phase,
    });
    let next = { phase, page: pageIndex };
    let hasMore = page.hasMore;
    if (page.hasMore) next = { phase, page: pageIndex + 1 };
    else if (phase === 'open') {
      next = { phase: 'done', page: 0 };
      const done = pageCallerVisitReview(rows, { page: 0, pageSize: size, now, scope: 'done' });
      hasMore = done.total > 0;
    }
    return {
      runModel: false,
      line: speakVisitLines(page.lines, lang, { more: true }),
      cursor: next,
      hasMore,
    };
  }
  if (phase === 'open') {
    const page = pageSpokenLines(openVisits, pageIndex, size);
    return {
      runModel: false,
      line: speakVisitLines(page.lines, lang, { more: true }),
      cursor: page.hasMore ? { phase: 'open', page: pageIndex + 1 } : { phase: 'done', page: 0 },
      hasMore: page.hasMore,
    };
  }
  return {
    runModel: false,
    line: speakVisitLines([], lang, { more: true }),
    cursor: { phase: 'done', page: pageIndex },
    hasMore: false,
  };
}

module.exports = {
  formatNameConfirmSpeech,
  looksLikeHistoryReview,
  looksLikeOpenVisitLookup,
  looksLikeVisitReviewMore,
  openLineHoldDecision,
  planVisitReadTurn,
  shouldPublishOpenFileSentence,
};
