'use strict';
// ENGINE 2b (response) for BRAIN_ENGINES: the model writes every line except the read-back and the
// write-outcome line. Slot questions, handoff asks, hours/coverage/price answers are model-written from
// this turn's receipts only (exact facts). One call per turn with a hard cap; no backup race.
const ML = require('./modelLead');

const GOAL_TASK = {
  answer: 'Answer every question the caller asked, using ONLY RECEIPTS (exact facts, no invented prices or times). For hours, give only TODAY\'s hours unless the caller asked about another day. Max 2 short sentences.',
  ask: 'If the caller asked a question, answer it first from RECEIPTS in one short sentence. Then ask exactly ONE short question for SLOT.',
  readback: 'Only if the caller asked a question: answer it in ONE short sentence from RECEIPTS. Do not read back, confirm or say booked; the system adds the read-back. Otherwise reply with an empty string.',
  open: 'Reply briefly to what the caller said and ask how you can help. Max 2 short sentences.',
  close: 'Say a short, warm goodbye. One sentence. No question.',
  no_name: 'Kindly explain that without a name you cannot leave the owner a request, and that they are welcome to call again during working hours. Max 2 short sentences, no question.',
};
const SLOT_WHY = {
  name: { callback: 'their name, so the owner knows who to call back', booking: 'their name for the booking' },
  service: 'which service they need',
  date: 'which day they would like',
  time: 'what time on that day',
  place: 'where the job is (estate or landmark)',
  change: 'what they would like to change',
  phone: 'the phone number the team should call them back on',
  reason: 'what they would like the team to call them back about',
};

function task(goal) {
  let t = GOAL_TASK[goal.type === 'reask' ? 'readback' : goal.type] || GOAL_TASK.open;
  if (goal.type === 'ask') {
    const w = SLOT_WHY[goal.slot];
    t = t.replace('SLOT', typeof w === 'object' ? (w[goal.why] || w.booking) : (w || goal.slot));
  }
  if (goal.type === 'answer' && goal.offerCallback) t += ' We are closed now: end by asking if they would like the owner to call them back.';
  // B1: a degraded answer (the team will confirm) offers the callback; never a guessed fact
  if (goal.type === 'answer' && goal.teamConfirm) t += ' The business has not set this up yet: say you will have the team confirm it (never "the team will"), never guess, and end by asking if they would like the team to call them back.';
  // B1 safe mode: capture only
  if (goal.safe) t += ' SAFE MODE: never give prices, items, areas, hours, times or bookings; for any such question say the team will call them back about it.';
  return t;
}

function replyPack({ goal, text, receipts, machine, lang, caller, profile = null }) {
  // KB v2 name lock (root cause 6): the names this call may say, already in the call language; legacy: no key
  const kbs = profile ? require('../../knowledge/kb/source').catalogueSource(profile) : null;
  const names = kbs && kbs.mode === 'kb' ? kbs.lockedNames(lang).filter((n, i, a) => a.indexOf(n) === i).slice(0, 60) : null;
  return {
    ...(names && names.length ? { ITEM_NAMES: { rule: 'Say catalogue item names exactly as written here, never translated or reworded. Say each price right after its own item.', names } } : {}),
    TASK: task(goal),
    LANG: lang === 'sw' ? 'Swahili (reply ONLY in Swahili)' : 'English (reply ONLY in English)',
    CALLER_SAID: String(text || '').slice(0, 300),
    GOAL: { type: goal.type, slot: goal.slot || null, topics: goal.topics || goal.answers || [] },
    RECEIPTS: receipts.map((r) => ({ tool: r.tool, text: r.text || null, place: r.place || r.name || null, covered: r.covered ?? null })).filter((r) => r.text || r.place),
    CALLER: { name: caller?.name || null, candidate: caller?.candidate || null },
    AGENT_LAST: String(machine.lastLine || '').slice(0, 200),
  };
}

/** -> { text, ms, outcome: ok|timeout|error|empty|skipped } */
async function writeReply({ goal, text, receipts, machine, profile, lang, caller, streamFor, modelId, hardMs = 2500, clock = () => Date.now(), log = () => {} }) {
  const t0 = clock();
  if (!streamFor || !modelId) return { text: '', ms: 0, outcome: 'skipped' };
  const request = ML.replyRequest(replyPack({ goal, text, receipts, machine, lang, caller, profile }), profile);
  const ac = new AbortController();
  let capTimer = null;
  let buf = '';
  try {
    const call = streamFor(modelId)({ request, signal: ac.signal, onText: (d) => { buf += d; } });
    const cap = new Promise((_, rej) => { capTimer = setTimeout(() => { ac.abort(); rej(new Error('abort: reply cap')); }, hardMs); });
    const res = await Promise.race([call, cap]);
    if (res && res.text) buf = res.text;
    let reply = '';
    try { reply = String(JSON.parse(buf).reply || ''); } catch { const m = buf.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/); reply = m ? JSON.parse(`"${m[1]}"`) : ''; }
    return { text: reply.trim(), ms: clock() - t0, outcome: reply.trim() ? 'ok' : 'empty' };
  } catch (e) {
    const outcome = /abort/i.test(String(e)) ? 'timeout' : 'error';
    log(`[brain_engines] reply ${outcome}: ${e?.message || e}`);
    return { text: '', ms: clock() - t0, outcome };
  } finally {
    clearTimeout(capTimer);
  }
}

module.exports = { writeReply, replyPack, task };
