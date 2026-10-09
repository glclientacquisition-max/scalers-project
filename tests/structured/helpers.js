// Shared fixtures for the structured-mouth tests: the real Done and Dusted
// catalogue and coverage list from HD_015bae4a4af2, and Gemini-shaped streams.
const FIXTURE = require('../fixtures/voice-calls/HD_015bae4a4af2.json');
const { buildFactTable } = require('../../src/speech/structured/facts');
const { chunksFromJson, streamOf } = require('../../src/speech/structured/mockStream');

const DUSTED = {
  businessName: FIXTURE.businessName,
  vertical: FIXTURE.vertical,
  servicesCatalog: FIXTURE.servicesCatalog,
  businessPolicies: FIXTURE.businessPolicies,
};

function dustedTable() {
  return buildFactTable(DUSTED, { speakerBound: false });
}

function factId(table, pattern) {
  const entry = table.entries.find((row) => pattern.test(row.label));
  if (!entry) throw new Error(`no fact for ${pattern}`);
  return entry.id;
}

/** openStream for runStructuredTurn: attempt n gets replies[n-1]. */
function scripted(replies, opts = {}) {
  const calls = [];
  const openStream = async ({ attempt, correction }) => {
    calls.push({ attempt, correction });
    const reply = replies[Math.min(attempt, replies.length) - 1];
    if (reply instanceof Error) throw reply;
    return streamOf(chunksFromJson(reply, { chunkChars: opts.chunkChars || 17 }), opts.stream || {});
  };
  return { openStream, calls };
}

module.exports = { FIXTURE, DUSTED, dustedTable, factId, scripted };
