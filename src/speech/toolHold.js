// Talk-while-waiting. A hold plays only after a tool call has started.
// The next line is the tool result, or the empty-file line when a bound
// read comes back empty. Barge-in cancels the follow-up.

const { nothingStillOpenLine } = require('../conversation/fileRead');

const TOOL_HOLD_PACKS = {
  en: ['One moment.', 'Let me check.', 'Checking now.', 'Just a second.'],
  sw: ['Sekunde moja.', 'Ngoja kidogo.', 'Naangalia.', 'Nipe sekunde.'],
};

function holdLanguage(language) {
  const lang = String(language || 'en').toLowerCase();
  if (lang === 'sw' || lang === 'sheng') return 'sw';
  return 'en';
}

function hashSeed(seed) {
  const text = String(seed ?? '0');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pickToolHoldLine({ language = 'en', seed = '', index = 0 } = {}) {
  const pack = TOOL_HOLD_PACKS[holdLanguage(language)];
  const start = hashSeed(seed) % pack.length;
  const at = (start + (Number(index) || 0)) % pack.length;
  return pack[at];
}

function planToolHold({
  toolInFlight = false,
  barge = false,
  language = 'en',
  seed = '',
  index = 0,
} = {}) {
  if (!toolInFlight || barge) {
    return { speak: false, line: '', kind: 'hold', reason: barge ? 'barge' : 'no_tool' };
  }
  return {
    speak: true,
    line: pickToolHoldLine({ language, seed, index }),
    kind: 'hold',
    reason: 'tool',
  };
}

function fileReadFollowUp(results) {
  const row = (Array.isArray(results) ? results : []).find(
    (result) =>
      result && ['open_items', 'file_lookup', 'get_enquiry'].includes(result.action)
  );
  if (!row) return null;
  return {
    fileFacts: true,
    resultLine: String(row.spoken || row.line || '').trim(),
  };
}

function turnRequestsTool(parsed) {
  if (!parsed || typeof parsed !== 'object') return false;
  if (parsed.appointment) return true;
  if (parsed.appointmentUpdate) return true;
  if (parsed.serviceRequest) return true;
  if (parsed.escalate) return true;
  if (parsed.openItems) return true;
  if (parsed.fileLookup) return true;
  if (parsed.getEnquiry) return true;
  return false;
}

function createToolHoldSession({ language = 'en', seed = '' } = {}) {
  let phase = 'idle';
  const lang = holdLanguage(language);

  return {
    get phase() {
      return phase;
    },
    begin() {
      if (phase === 'cancelled') {
        return { speak: false, line: '', kind: 'hold', reason: 'barge' };
      }
      phase = 'holding';
      return {
        speak: true,
        line: pickToolHoldLine({ language: lang, seed, index: 0 }),
        kind: 'hold',
        reason: 'tool',
      };
    },
    cancel() {
      phase = 'cancelled';
      return { speak: false, line: '', kind: 'hold', reason: 'barge' };
    },
    finish(opts = {}) {
      if (phase === 'cancelled' || opts.barge === true) {
        phase = 'cancelled';
        return { speak: false, line: '', kind: 'result', reason: 'barge' };
      }
      if (phase !== 'holding') {
        return { speak: false, line: '', kind: 'result', reason: 'no_tool' };
      }
      phase = 'done';
      const fileFacts = opts.fileFacts === true;
      const bound = opts.bound === true;
      const resultLine = String(opts.resultLine || '').trim();
      if (fileFacts && !bound) {
        return { speak: false, line: '', kind: 'result', reason: 'unbound' };
      }
      if (fileFacts && bound && !resultLine) {
        return {
          speak: true,
          line: nothingStillOpenLine({}, lang === 'sw' ? 'sw' : 'en'),
          kind: 'result',
          reason: 'empty_file',
        };
      }
      if (!resultLine) {
        return { speak: false, line: '', kind: 'result', reason: 'empty_result' };
      }
      return { speak: true, line: resultLine, kind: 'result', reason: 'result' };
    },
  };
}

module.exports = {
  TOOL_HOLD_PACKS,
  pickToolHoldLine,
  planToolHold,
  turnRequestsTool,
  fileReadFollowUp,
  createToolHoldSession,
};
