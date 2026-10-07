// Speak slots are the public facts Voice may say before a file-name ask.
// Brain fills them. Voice FactSpeakQueue drains a slot by removing it once
// that line is spoken. A slot still here after name Yes is unanswered:
// resolveLocalReply hands that same line back and clears it.
// One slot per outcome. Fields Voice drains: outcome, line, language.

const SPEAK_SLOT_OUTCOMES = new Set([
  'price',
  'catalogue',
  'hours',
  'hours_ask',
  'coverage',
  'service_facts',
]);

const EMPTY_DETAIL = /don't have more detail on file|sina maelezo zaidi/i;

function slotLanguage(language) {
  const lang = String(language || 'en').toLowerCase();
  if (lang === 'sw' || lang.startsWith('swahili')) return 'sw';
  if (lang === 'sheng') return 'sheng';
  return 'en';
}

function slotLine(line) {
  return String(line || '').replace(/\s+/g, ' ').trim();
}

function ensureSlots(state) {
  if (!state || typeof state !== 'object') return null;
  if (!state.conversation || typeof state.conversation !== 'object') {
    state.conversation = {};
  }
  if (!Array.isArray(state.conversation.speakSlots)) {
    state.conversation.speakSlots = [];
  }
  return state.conversation.speakSlots;
}

/**
 * A file-grounded public fact worth holding. Empty detail is not one.
 * @returns {{ outcome: string, line: string, language: string } | null}
 */
function speakSlotFromReply(reply, language) {
  const outcome = String(reply?.outcome || '');
  const line = slotLine(reply?.line);
  if (!SPEAK_SLOT_OUTCOMES.has(outcome) || !line) return null;
  if (outcome === 'service_facts' && EMPTY_DETAIL.test(line)) return null;
  return { outcome, line, language: slotLanguage(language) };
}

function isSpeakSlotOutcome(outcome) {
  return SPEAK_SLOT_OUTCOMES.has(String(outcome || ''));
}

/**
 * Record one public fact while the file-name ask is still due.
 * The same outcome replaces its previous line. Nothing is invented here.
 * @returns {{ outcome: string, line: string, language: string } | null}
 */
function fillSpeakSlot(state, reply, language) {
  const slot = speakSlotFromReply(reply, language);
  const slots = ensureSlots(state);
  if (!slot || !slots) return null;
  const next = slots.filter((row) => row && row.outcome !== slot.outcome);
  next.push(slot);
  state.conversation.speakSlots = next;
  return slot;
}

function eligibleSpeakSlots(state) {
  const slots = state?.conversation?.speakSlots;
  if (!Array.isArray(slots)) return [];
  return slots.filter((slot) => {
    if (!slot || !slotLine(slot.line) || !SPEAK_SLOT_OUTCOMES.has(String(slot.outcome || ''))) {
      return false;
    }
    if (slot.outcome === 'catalogue' && state?.conversation?.catalogueAnswered === true) {
      return false;
    }
    return true;
  });
}

/**
 * The fact still waiting. A price or other fact beats a catalogue list.
 * A catalogue already marked answered is not waiting.
 * @returns {{ outcome: string, line: string, language: string } | null}
 */
function pendingSpeakSlot(state) {
  const slots = eligibleSpeakSlots(state);
  if (!slots.length) return null;
  const fact = [...slots].reverse().find((slot) => slot.outcome !== 'catalogue');
  return fact || slots[slots.length - 1];
}

/**
 * Hand the pending fact to the caller and clear the queue.
 * @returns {{ outcome: string, line: string, language: string } | null}
 */
function takePendingSpeakSlot(state) {
  const held = pendingSpeakSlot(state);
  if (state?.conversation) state.conversation.speakSlots = [];
  if (!held) return null;
  return {
    outcome: held.outcome,
    line: slotLine(held.line),
    language: slotLanguage(held.language),
  };
}

/**
 * Voice calls this with the lines it actually spoke (the fact, then the
 * name ask). A spoken fact leaves the queue. An unspoken fact stays.
 */
function drainSpokenSpeakSlots(state, spokenLines) {
  const slots = ensureSlots(state);
  if (!slots) return;
  const spoken = new Set(
    (Array.isArray(spokenLines) ? spokenLines : []).map((row) => slotLine(row)).filter(Boolean)
  );
  if (!spoken.size) return;
  state.conversation.speakSlots = slots.filter((slot) => slot && !spoken.has(slotLine(slot.line)));
}

module.exports = {
  SPEAK_SLOT_OUTCOMES,
  isSpeakSlotOutcome,
  speakSlotFromReply,
  fillSpeakSlot,
  pendingSpeakSlot,
  takePendingSpeakSlot,
  drainSpokenSpeakSlots,
};
