'use strict';
// Ack metrics (v2-ack-overuse.md). An ack-led turn opens with sawa / okay / haya /
// alright / sure / poa / asante (and compounds). Goodbyes are excluded.
const fs = require('fs'); const path = require('path');
const ACK = /^\s*(sawa sawa|sawa kabisa|ni sawa|sawa|okay|ok|haya|alright|sure|poa|asante)\b\s*[,.!]/i;
const BYE = /^(Asante kwa kupiga simu|Thank you for calling|Karibu tena\. Kwaheri)/i;
const isAck = (l) => ACK.test(String(l || '')) && !BYE.test(String(l || ''));
// A stack is an ack-led line that already opens with two acks ("Sawa. Okay, …"),
// or (with heard traces) a word filler followed by an ack-led reply.
const isStack = (l) => { const t = String(l || ''); const m = t.match(ACK); return !!m && isAck(t.slice(m[0].length).trim()); };
function ackMetrics(transcripts) { // [[agentLine, ...], ...]
  let turns = 0, ack = 0, consec = 0, stacks = 0, longest = 0;
  for (const t of transcripts) { let run = 0; for (const l of t) { if (!l || BYE.test(l)) { run = 0; if (l) turns++; continue; } turns++; if (isStack(l)) stacks++; if (isAck(l)) { ack++; run++; if (run > 1) consec++; longest = Math.max(longest, run); } else run = 0; } }
  return { turns, ackLed: ack, ackRate: turns ? +(ack / turns).toFixed(4) : 0, consecutive: consec, longestRun: longest, stacks };
}
// Voice filler + hold banks must be <= 3 words (static read of src/speech).
function fillerBank(root) {
  const words = [];
  try { const th = fs.readFileSync(path.join(root, 'src/speech/toolHold.js'), 'utf8'); for (const m of th.matchAll(/^\s*(?:en|sw|sheng):\s*\[([^\]]*)\]/gm)) for (const s of m[1].matchAll(/'([^']+)'/g)) words.push(s[1]); } catch {}
  try { const ds = fs.readFileSync(path.join(root, 'src/conversation/dynamicSpeech.js'), 'utf8'); const f = ds.slice(ds.indexOf('function pickContextualAck'), ds.indexOf('function looksLikeBareCloser')); for (const s of f.matchAll(/\? '([^']+)' : '([^']+)'/g)) words.push(s[1], s[2]); } catch {}
  const over = words.filter((w) => w.trim().split(/\s+/).length > 3);
  return { n: words.length, over };
}
function lines(run) { return (run.transcript || run.turns || []).map((t) => t.a ?? t.agentLine ?? t.agent ?? ''); }
module.exports = { ACK, isAck, isStack, ackMetrics, fillerBank, lines };
