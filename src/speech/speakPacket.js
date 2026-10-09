// SpeakPacket. A grounded file fact is authorized once, then committed.
// The name ask and a Brain END farewell read the packet. They do not
// re-check an outcome allowlist, and they do not drop a committed public fact.
//
// public: price, catalogue, hours, coverage, and a real service fact.
// step_up: identity. It trails public facts. The name ask trails both.
// private: a booking ladder, an open file row, an empty detail fallback.
// Private text is not committed.

const { offerActOf } = require('./offerAct');

const PUBLIC_OUTCOMES = new Set([
  'catalogue',
  'price',
  'hours',
  'hours_ask',
  'coverage',
]);

const STEP_UP_OUTCOMES = new Set(['identity']);

const EMPTY_DETAIL_RE = /don't have more detail on file|sina maelezo zaidi/i;

function cleanLine(line) {
  return String(line || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function openFileRow(line) {
  const { lineIsOpenFileRow } = require('./callerFileSpeech');
  return lineIsOpenFileRow(line);
}

function fileSpeechGate(line, state) {
  const { gateCallerFileSpeech } = require('./callerFileSpeech');
  return gateCallerFileSpeech(line, state);
}

/**
 * Authorize one grounded reply. Null is private and is not committed.
 * Downstream speech reads `tier`. It does not look at the outcome again.
 * @param {{ outcome?: string, line?: string } | null} [reply]
 * @returns {{ tier: 'public' | 'step_up', text: string, outcome: string, committed: true } | null}
 */
function authorizeSpeak(reply) {
  if (!reply) return null;
  const outcome = String(reply.outcome || '');
  const text = cleanLine(reply.line);
  if (!outcome || !text) return null;
  if (openFileRow(text)) return null;
  const offer = Boolean(offerActOf(text));
  if (outcome === 'service_facts') {
    if (EMPTY_DETAIL_RE.test(text)) return null;
    return { tier: 'public', text, outcome, committed: true, offer };
  }
  if (PUBLIC_OUTCOMES.has(outcome)) {
    return { tier: 'public', text, outcome, committed: true, offer };
  }
  if (STEP_UP_OUTCOMES.has(outcome)) {
    return { tier: 'step_up', text, outcome, committed: true, offer };
  }
  return null;
}

/**
 * One call. Packets survive later turns until spoken or the socket closes.
 * A Voice-owned object. Do not hang this only on brain conversation state.
 */
function createSpeakCommit() {
  /** @type {Array<{ tier: string, text: string, outcome: string, committed: true, spoken: boolean, spokenText: string }>} */
  const packets = [];

  function commit(packet) {
    if (!packet || packet.committed !== true) return null;
    const text = cleanLine(packet.text);
    if (!text) return null;
    const tier = packet.tier === 'step_up' ? 'step_up' : 'public';
    if (tier !== 'public' && tier !== 'step_up') return null;
    const existing = packets.find((row) => row.text === text && row.spoken !== true);
    if (existing) return existing;
    const stored = {
      tier,
      text,
      outcome: String(packet.outcome || ''),
      offer: packet.offer === true,
      committed: true,
      spoken: false,
      spokenText: '',
    };
    packets.push(stored);
    return stored;
  }

  function unsaidPublic() {
    return packets.filter((row) => row.tier === 'public' && row.spoken !== true);
  }

  function unsaidStepUp() {
    return packets.filter((row) => row.tier === 'step_up' && row.spoken !== true);
  }

  function wasSpoken(line) {
    const text = cleanLine(line);
    return packets.some((row) => row.spoken === true && row.spokenText === text);
  }

  /**
   * Public packets first. Step-up trails. The name ask is last.
   * A name Yes flushes unsaid public packets and does not append the ask.
   * The file-speech gate may trim a mixed sentence. A committed public fact
   * that the gate would drop entirely is still spoken.
   * @param {{ nameAsk?: string, nameJustConfirmed?: boolean, state?: object }} [opts]
   * @returns {string[]}
   */
  function drain(opts = {}) {
    const nameJustConfirmed = opts.nameJustConfirmed === true;
    const nameAsk = nameJustConfirmed ? '' : cleanLine(opts.nameAsk);
    const lines = [];

    function take(packet) {
      if (!packet || packet.spoken) return;
      let line = packet.text;
      const gated = fileSpeechGate(line, opts.state);
      if (gated.speak && gated.line) {
        line = gated.line;
      } else if (packet.tier === 'public') {
        line = packet.text;
      } else {
        return;
      }
      if (!line) return;
      if (!lines.includes(line)) lines.push(line);
      packet.spoken = true;
      packet.spokenText = line;
    }

    for (const packet of unsaidPublic()) take(packet);
    if (!nameJustConfirmed) {
      for (const packet of unsaidStepUp()) take(packet);
    }
    if (nameAsk && !lines.includes(nameAsk)) lines.push(nameAsk);
    return lines;
  }

  /**
   * END with nothing public left is a farewell. END with a public packet
   * speaks that packet and does not hang up on this turn.
   * @param {{
   *   endAction?: string,
   *   nameAsk?: string,
   *   nameJustConfirmed?: boolean,
   *   state?: object,
   * }} [opts]
   * @returns {{ farewell: boolean, lines: string[] }}
   */
  function planCommittedSpeech(opts = {}) {
    const endAction = String(opts.endAction || '').toUpperCase() === 'END';
    if (endAction && unsaidPublic().length === 0) {
      return { farewell: true, lines: [] };
    }
    const lines = drain({
      nameAsk: opts.nameAsk,
      nameJustConfirmed: opts.nameJustConfirmed === true || endAction,
      state: opts.state,
    });
    return { farewell: false, lines };
  }

  function clear() {
    packets.length = 0;
  }

  return {
    commit,
    unsaidPublic,
    unsaidStepUp,
    wasSpoken,
    drain,
    planCommittedSpeech,
    clear,
  };
}

/**
 * Commit this turn's grounded facts before any name or END gate runs.
 * A list already spoken on this call is not committed again.
 * @param {ReturnType<typeof createSpeakCommit>} commit
 * @param {{
 *   localReply?: { outcome?: string, line?: string } | null,
 *   catalogueLine?: string,
 *   catalogueListed?: boolean,
 *   groundedPrice?: string,
 * }} [opts]
 */
function commitTurnFacts(commit, opts = {}) {
  const listed = opts.catalogueListed === true;
  const catalogueLine = cleanLine(opts.catalogueLine);
  if (!listed && catalogueLine) {
    commit.commit(authorizeSpeak({ outcome: 'catalogue', line: catalogueLine }));
  }
  const packet = authorizeSpeak(opts.localReply);
  if (packet && !(packet.outcome === 'catalogue' && listed)) {
    commit.commit(packet);
  }
  const priced = commit.unsaidPublic().some((row) => row.outcome === 'price');
  const grounded = cleanLine(opts.groundedPrice);
  if (!priced && grounded) {
    commit.commit(authorizeSpeak({ outcome: 'price', line: grounded }));
  }
  return packet;
}

/**
 * Brain `conversation.speakSlots` are already authorized file lines.
 * Before the name ask, every public slot is committed.
 * On name Yes, a price or other fact is committed ahead of a catalogue slot.
 * Outcomes outside the packet tiers are ignored. Nothing is invented.
 * @param {ReturnType<typeof createSpeakCommit>} commit
 * @param {object} [state]
 * @param {{ nameJustConfirmed?: boolean, catalogueListed?: boolean }} [opts]
 */
function commitReadySpeakSlots(commit, state, opts = {}) {
  const slots = state?.conversation?.speakSlots;
  if (!commit || !Array.isArray(slots)) return;
  const listed = opts.catalogueListed === true || state?.conversation?.catalogueListed === true;
  const packets = [];
  for (const slot of slots) {
    const packet = authorizeSpeak({ outcome: slot?.outcome, line: slot?.line });
    if (!packet || packet.tier !== 'public') continue;
    if (packet.outcome === 'catalogue' && listed) continue;
    packets.push(packet);
  }
  const facts = packets.filter((packet) => packet.outcome !== 'catalogue');
  const rows = opts.nameJustConfirmed === true && facts.length ? facts : packets;
  for (const packet of rows) commit.commit(packet);
}

module.exports = {
  authorizeSpeak,
  createSpeakCommit,
  commitTurnFacts,
  commitReadySpeakSlots,
};
