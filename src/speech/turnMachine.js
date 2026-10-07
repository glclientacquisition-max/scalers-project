// Tool-driven name state for one call.
// A confirmed name is not asked again. An unknown name is asked at most once.
// A sentence that also carries the service or price answer is kept.
// Dropping the only sentence speaks a short ack, not a question and not silence.
// This does not invent a new name ask.

const { getLanguagePack } = require('./languages');
const { finishSentence } = require('./structuredReply');

const NAME_ASK =
  /\b(jina lako|niambie jina|may i have your name|what(?:'s| is) your name|naongea na|ninaongea naye|am i speaking with|speaking with)\b/i;
const NAME_CONFIRM = /\b(jina lako ni|your name is|najua jina|tayari najua)\b/i;
const CARRIES_ANSWER =
  /\b(clean(?:ing)?|usafi|fumig\w*|carpet|couch|sofa|mattress|upholstery|counter\s+books?|stationery|kitabu|vitabu|airbnb)\b|\d/i;

function callerOf(state) {
  if (!state || typeof state !== 'object') return null;
  if (!state.caller || typeof state.caller !== 'object') state.caller = {};
  return state.caller;
}

function seedAskCount(caller) {
  if (!caller || caller.nameAskCount != null) return;
  caller.nameAskCount = caller.fileNameAskSpoken === true ? 1 : 0;
}

function isNameAsk(sentence) {
  return NAME_ASK.test(String(sentence || '')) && !NAME_CONFIRM.test(String(sentence || ''));
}

function stripNameAsk(sentence) {
  const stripped = String(sentence || '')
    .replace(
      /\b(may i have your name|what(?:'s| is) your name|am i speaking with|niambie jina(?:\s+lako)?|jina lako|ninaongea naye|naongea na|speaking with)\b/gi,
      ' '
    )
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.?])/g, '$1')
    .trim();
  const line = finishSentence(stripped);
  if (!line || isNameAsk(line) || NAME_ASK.test(line)) return '';
  return line;
}

function createNameGate(state, language) {
  const caller = callerOf(state);
  seedAskCount(caller);
  const spoken = [];
  const stages = [];
  let suppressed = false;
  const pack = getLanguagePack(language);

  function rememberAsk() {
    if (!caller || caller.nameConfirmed === true) return;
    caller.nameAskCount += 1;
    caller.fileNameAskSpoken = true;
  }

  function consider(sentence) {
    let line = finishSentence(sentence);
    if (!line) return null;
    const name = String(caller?.name || '').trim();
    if (name && NAME_CONFIRM.test(line) && NAME_ASK.test(line)) {
      const rewritten = finishSentence(pack.nameAnswer(name));
      if (rewritten && rewritten !== line) {
        stages.push({
          stage: 'transform',
          name: 'name_state',
          reason: 'name_answer',
          before: line,
          after: rewritten,
          dropped: false,
        });
        line = rewritten;
      }
    }
    if (!isNameAsk(line)) {
      spoken.push(line);
      return line;
    }
    const confirmed = caller?.nameConfirmed === true && Boolean(name);
    const overBudget = confirmed || (caller && caller.nameAskCount >= 1);
    if (CARRIES_ANSWER.test(line)) {
      if (!overBudget) {
        rememberAsk();
        spoken.push(line);
        return line;
      }
      const kept = stripNameAsk(line);
      if (kept && CARRIES_ANSWER.test(kept)) {
        stages.push({
          stage: 'transform',
          name: 'name_state',
          reason: confirmed ? 'name_confirmed' : 'name_asked_once',
          before: line,
          after: kept,
          dropped: false,
        });
        spoken.push(kept);
        return kept;
      }
    }
    if (confirmed || (caller && caller.nameAskCount >= 1)) {
      suppressed = true;
      stages.push({
        stage: 'transform',
        name: 'name_state',
        reason: confirmed ? 'name_confirmed' : 'name_asked_once',
        before: line,
        after: '',
        dropped: false,
      });
      return null;
    }
    rememberAsk();
    spoken.push(line);
    return line;
  }

  function finish() {
    if (spoken.length || !suppressed) return null;
    const line = finishSentence(pack.ack);
    if (!line) return null;
    spoken.push(line);
    stages.push({
      stage: 'transform',
      name: 'name_state',
      reason: 'continue',
      before: '',
      after: line,
      dropped: false,
    });
    return line;
  }

  return { consider, finish, spoken, stages };
}

const CALL_STAGES = ['greeting', 'identity', 'serve', 'closing'];

const SERVICE_ASK =
  /\b(services?|huduma|mnafanya|mna\s*offer|mnaofa|mna\s*ofa|mnayofanya|unafanya|what do you offer|what do you do)\b/i;
const SERVICE_NOUN =
  /\b(clean(?:ing)?|usafi|fumig\w*|carpet|couch|sofa|mattress|upholstery|counter\s+books?|stationery|kitabu|vitabu|airbnb)\b/i;
const SHOP_GREETING =
  /\b(habari|hello|good\s+(?:morning|afternoon|evening)|karibu|nikusaidie|how can i help|this is)\b/i;

const KNOWN_SHORT = new Set([
  'yes',
  'no',
  'yeah',
  'yep',
  'ndiyo',
  'ndio',
  'sawa',
  'okay',
  'ok',
  'poa',
  'habari',
  'hello',
  'hi',
  'hey',
  'asante',
  'bye',
  'goodbye',
  'kwaheri',
]);

function voiceOf(state) {
  if (!state || typeof state !== 'object') return {};
  if (!state.voice || typeof state.voice !== 'object') state.voice = {};
  return state.voice;
}

function normalizeOpening(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[?!.,]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function meanTokenConfidence(tokens) {
  const nums = [];
  for (const token of Array.isArray(tokens) ? tokens : []) {
    const n = Number(token?.confidence);
    if (Number.isFinite(n)) nums.push(n);
  }
  if (!nums.length) return null;
  return nums.reduce((sum, n) => sum + n, 0) / nums.length;
}

/**
 * A short or low-confidence first final is not a goal and not an identity turn.
 * "Happy?" is the live case. A reply to a question, a known ack, or a name stays.
 */
function classifyOpeningStt(text, opts = {}) {
  const raw = String(text || '').trim();
  const norm = normalizeOpening(raw);
  if (!norm) return { weak: false, reason: 'empty' };
  if (opts.awaitingReply) return { weak: false, reason: 'awaiting_reply' };
  if (KNOWN_SHORT.has(norm)) return { weak: false, reason: 'known' };
  const opening =
    opts.firstCallerTurn === true ||
    (opts.firstCallerTurn !== false && (opts.turnCount == null || Number(opts.turnCount) === 0));
  if (!opening) return { weak: false, reason: 'later_turn' };
  if (!/\?/.test(raw) && /^[A-Z][a-z]{2,}$/.test(raw.replace(/[!.,]+$/g, ''))) {
    return { weak: false, reason: 'name' };
  }
  const words = norm.split(' ').filter(Boolean);
  const confidence = opts.confidence == null ? null : Number(opts.confidence);
  const low = confidence != null && confidence < 0.45;
  const short = words.length <= 2 && raw.length <= 16;
  if (/^happy\??$/i.test(raw)) return { weak: true, reason: 'weak_stt' };
  if (short && (low || (words.length === 1 && /\?/.test(raw)))) {
    return { weak: true, reason: low ? 'low_confidence' : 'weak_stt' };
  }
  return { weak: false, reason: 'usable' };
}

function looksLikeCallClose(text) {
  const norm = normalizeOpening(text);
  return /^(bye|goodbye|good bye|kwaheri|that'?s all|that is all|asante kwaheri)$/.test(norm);
}

function catalogNames(catalog) {
  const rows = Array.isArray(catalog) ? catalog : [];
  const names = [];
  for (const row of rows) {
    const name = typeof row === 'string' ? row : row?.name || row?.title;
    const clean = String(name || '').trim();
    if (clean) names.push(clean);
  }
  return names;
}

function reintroducesShop(sentence, businessName) {
  const raw = String(sentence || '');
  const shop = String(businessName || '').trim();
  if (!shop || shop.length < 3) return false;
  if (!raw.toLowerCase().includes(shop.toLowerCase())) return false;
  return SHOP_GREETING.test(raw);
}

/**
 * After the opener has played, a later sentence must not greet the shop again.
 * A services answer keeps its list. A pure re-greeting becomes the help line.
 */
function guardStageSentence(sentence, opts = {}) {
  const line = String(sentence || '').trim();
  if (!line || opts.greetingPlayed !== true) return line;
  if (!reintroducesShop(line, opts.businessName)) return line;
  const pack = getLanguagePack(opts.replyLanguage);
  if (SERVICE_NOUN.test(line)) {
    const shop = String(opts.businessName || '').trim();
    let kept = line;
    if (shop) {
      const re = new RegExp(shop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
      kept = kept.replace(re, ' ');
    }
    kept = kept
      .replace(/^(?:habari|hello|good morning|good afternoon|good evening)[,.]?\s*/i, '')
      .replace(/\s+/g, ' ')
      .replace(/\s+([,.?])/g, '$1')
      .trim();
    if (SERVICE_NOUN.test(kept) && !reintroducesShop(kept, opts.businessName)) return kept;
    if (SERVICE_NOUN.test(kept)) return pack.services(catalogNames(opts.catalog).length ? opts.catalog : []);
  }
  return pack.howHelp;
}

function ensureVoice(state, { greetingPlayed, businessName } = {}) {
  const voice = voiceOf(state);
  if (greetingPlayed) voice.greetingPlayed = true;
  if (businessName) voice.businessName = businessName;
  if (!CALL_STAGES.includes(voice.stage)) {
    voice.stage = voice.greetingPlayed ? 'identity' : 'greeting';
  }
  return voice;
}

/**
 * greeting → identity → serve → closing.
 * Identity is one language-pack confirm. It does not say the shop again.
 * Known services and closings speak the pack immediately.
 */
function planStageSpeech(opts = {}) {
  const state = opts.state && typeof opts.state === 'object' ? opts.state : {};
  const replyLanguage = opts.replyLanguage || 'en';
  const pack = getLanguagePack(replyLanguage);
  const voice = ensureVoice(state, opts);
  const opening = classifyOpeningStt(opts.callerText, {
    confidence: opts.confidence,
    firstCallerTurn: opts.firstCallerTurn,
    turnCount: opts.turnCount,
    awaitingReply: opts.awaitingReply,
  });
  if (opening.weak) {
    if (voice.repairSpoken) {
      return {
        stage: voice.stage,
        line: '',
        runModel: false,
        weak: true,
        reason: 'weak_stt_quiet',
        setGoal: false,
      };
    }
    voice.repairSpoken = true;
    return {
      stage: voice.stage,
      line: pack.unclear,
      runModel: false,
      weak: true,
      reason: 'weak_stt',
      setGoal: false,
    };
  }
  if (opts.closing || looksLikeCallClose(opts.callerText)) {
    voice.stage = 'closing';
    return {
      stage: 'closing',
      line: pack.closing,
      runModel: false,
      weak: false,
      reason: 'closing',
      setGoal: true,
    };
  }
  const pending = String(state?.caller?.fileNameAsked || '').trim();
  const confirmed = state?.caller?.nameConfirmed === true;
  const asked = state?.caller?.fileNameAskSpoken === true || voice.identitySpoken === true;
  if (!confirmed && pending && !asked && (voice.stage === 'greeting' || voice.stage === 'identity')) {
    voice.stage = 'identity';
    voice.identitySpoken = true;
    if (state.caller && typeof state.caller === 'object') {
      state.caller.fileNameAskSpoken = true;
      state.caller.fileNameAsked = pending;
    }
    voice.stage = 'serve';
    return {
      stage: 'identity',
      line: pack.nameConfirm(pending),
      runModel: false,
      weak: false,
      reason: 'identity',
      setGoal: true,
    };
  }
  if (voice.stage === 'greeting' || voice.stage === 'identity') voice.stage = 'serve';
  const names = catalogNames(opts.catalog);
  if (SERVICE_ASK.test(String(opts.callerText || '')) && names.length) {
    voice.stage = 'serve';
    return {
      stage: 'serve',
      line: pack.services(names),
      runModel: false,
      weak: false,
      reason: 'services_template',
      setGoal: true,
    };
  }
  voice.stage = 'serve';
  return { stage: 'serve', line: '', runModel: true, weak: false, reason: 'serve', setGoal: true };
}

function applyNameGate(sentences, state, language) {
  const gate = createNameGate(state, language);
  const kept = [];
  for (const sentence of sentences || []) {
    const line = gate.consider(sentence);
    if (line) kept.push(line);
  }
  const tail = gate.finish();
  if (tail && !kept.includes(tail)) kept.push(tail);
  return { sentences: kept.filter(Boolean), stages: gate.stages };
}

module.exports = {
  NAME_ASK,
  CALL_STAGES,
  createNameGate,
  applyNameGate,
  isNameAsk,
  classifyOpeningStt,
  looksLikeCallClose,
  catalogNames,
  guardStageSentence,
  planStageSpeech,
  meanTokenConfidence,
};
