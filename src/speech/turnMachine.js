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
  createNameGate,
  applyNameGate,
  isNameAsk,
};
