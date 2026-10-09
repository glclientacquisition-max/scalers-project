// Brain's caller-file speech guard on the structured mouth (HD_1b3a67ea7ee9).
// The legacy path runs Brain's guardSpokenReply; the structured path checks
// each say[] sentence in verify.js, so it calls the same Brain rules here:
//   - claimsNoRecord while the file is masked (or has open rows): never "no
//     bookings saved under this number";
//   - the file-name ask is asked once (fileNameAskSpoken, code-held).
// Brain owns the rules (src/conversation/callFixesD199.js, #634, behind
// BRAIN_CALL_FIXES_D199). On a branch without that module this is a no-op.

const BRAIN_MODULE = '../../conversation/callFixesD199';
const NEEDED = ['callFixesD199Enabled', 'fileMasked', 'fileHasRows', 'claimsNoRecord'];

let cached;

function brainFixes() {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line global-require
    const mod = require(BRAIN_MODULE);
    cached = NEEDED.every((name) => typeof mod?.[name] === 'function') ? mod : null;
  } catch (err) {
    if (err?.code !== 'MODULE_NOT_FOUND' || !String(err.message || '').includes('callFixesD199')) throw err;
    cached = null;
  }
  return cached;
}

/** Tests only: swap Brain's module (null = not on this branch). */
function setBrainFixesForTest(mod) {
  cached = mod === undefined ? undefined : mod;
}

function active(state) {
  const fx = brainFixes();
  if (!fx || !state || typeof state !== 'object') return null;
  return fx.callFixesD199Enabled() ? fx : null;
}

function pendingFileName(state) {
  if (!state || state.caller?.nameConfirmed === true) return '';
  return String(state.caller?.fileNameAsked || state.returning?.fileOwnerName || '').trim();
}

/** "Am I speaking with Wanjiku?" / "Naongea na Wanjiku?" for the pending file name. */
function isFileNameAsk(fx, sentence, state) {
  const text = String(sentence || '').trim();
  if (!text) return false;
  if (/^(?:sorry,?\s+)?am i speaking with\b/i.test(text)) return true;
  const name = pendingFileName(state);
  return Boolean(name && typeof fx.agentAskedFileName === 'function' && fx.agentAskedFileName(text, name));
}

/** Brain's rule: the ask was spoken on an earlier turn and the name is still unconfirmed. */
function askedBefore(state) {
  const conv = state?.conversation;
  const turn = Number(conv?.turnCount || 0);
  return (
    state?.caller?.nameConfirmed !== true &&
    state?.caller?.fileNameAskSpoken === true &&
    !(conv && conv.fileNameAskTurn === turn)
  );
}

/**
 * Problems for one say[] sentence (verify.js), or [].
 * @returns {Array<{ code: 'no_record_claim'|'name_ask_repeat', detail: string }>}
 */
function fileGuardProblems(sentence, state) {
  const fx = active(state);
  if (!fx) return [];
  const problems = [];
  const masked = fx.fileMasked(state);
  if ((masked || fx.fileHasRows(state)) && fx.claimsNoRecord(sentence)) {
    problems.push({
      code: 'no_record_claim',
      detail: masked ? 'the caller file is masked, not empty' : 'the caller file has open rows',
    });
  }
  if (askedBefore(state) && isFileNameAsk(fx, sentence, state)) {
    problems.push({ code: 'name_ask_repeat', detail: 'the file-name ask was already spoken on this call' });
  }
  return problems;
}

/**
 * Brain's line in place of a dropped no-record claim: confirm_identity_first
 * while masked (with the ask when it is still due), else the open-file read.
 * @returns {string}
 */
function noRecordReplacement(state, lang = 'en') {
  const fx = active(state);
  if (!fx) return '';
  if (fx.fileMasked(state)) {
    if (typeof fx.confirmIdentityFirst !== 'function') return '';
    return fx.confirmIdentityFirst(state, lang, { askAllowed: !askedBefore(state) })?.line || '';
  }
  if (typeof fx.openFileRead !== 'function') return '';
  return fx.openFileRead(state, lang)?.line || '';
}

/** A spoken line that asks the file name marks the ask spoken (Brain's code-held flag). */
function noteSpokenLine(line, state) {
  const fx = active(state);
  if (!fx || !state.caller || !pendingFileName(state)) return;
  if (!isFileNameAsk(fx, line, state)) return;
  if (state.caller.fileNameAskSpoken === true) return;
  state.caller.fileNameAskSpoken = true;
  if (state.conversation) state.conversation.fileNameAskTurn = Number(state.conversation.turnCount || 0);
}

module.exports = { fileGuardProblems, noRecordReplacement, noteSpokenLine, setBrainFixesForTest };
