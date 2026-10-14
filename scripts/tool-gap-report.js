#!/usr/bin/env node
// Tool-turn gap before/after VOICE_TOOL_SMOOTH on logged staging tool turns.
const fs = require('fs'); const path = require('path');
const T = require('../src/speech/toolSmooth');
const DIR = path.join(__dirname, '..', 'tests', 'fixtures', 'tool-turns');
const fx = fs.readdirSync(DIR).filter((n) => n.endsWith('.json')).sort().map((n) => JSON.parse(fs.readFileSync(path.join(DIR, n), 'utf8')));
const run = (flags) => fx.map((f) => ({ call: f.callId, ...T.simulateToolTurn(f, flags) }));
const before = run({}); const after = run({ hold: true, receipt: true });
const row = (r) => ({ call: r.call, holds: r.holds, gaps: T.scoreToolTurns([r]).gaps, segments: r.segments });
console.log(JSON.stringify({
  before: { ...T.scoreToolTurns(before), perCall: before.map(row) },
  after: { ...T.scoreToolTurns(after), perCall: after.map(row) },
}, null, 1));
