'use strict';
// Closed ask ticket for BA v2. The model may only pick a kind and an optional
// place. Speech never comes from it. Regex still wins when it already knows.

const { matchArea } = require('./nlu');

const KINDS = [
  'pay',
  'come_cost',
  'cover',
  'hours',
  'service',
  'refund',
  'cancel_rules',
  'cancel_visit',
  'book',
  'unknown',
];

const KIND_TO_INFO = {
  pay: 'payment_how',
  come_cost: 'coverage',
  cover: 'coverage',
  hours: 'hours',
  service: 'services',
  refund: 'policy_returns',
  cancel_rules: 'policy_cancel',
};

function normalizeTicket(raw, profile = {}) {
  const kind = KINDS.includes(raw && raw.kind) ? raw.kind : 'unknown';
  const place = String((raw && raw.place) || '').trim();
  const area = place ? matchArea(place, profile) : null;
  return { kind, area };
}

function applyTicket(u, ticket) {
  if (!ticket || ticket.kind === 'unknown') return u;
  if (ticket.kind === 'book') return u;
  if (ticket.area) u.area = ticket.area;
  if (ticket.kind === 'come_cost') u.feeAsk = true;
  if (ticket.kind === 'cancel_visit') {
    if (!u.intents.includes('cancel')) u.intents = ['cancel', ...u.intents];
    return u;
  }
  const info = KIND_TO_INFO[ticket.kind];
  if (info && !u.intents.includes(info)) u.intents = [info, ...u.intents];
  return u;
}

function needsClassify(u, transactional) {
  if (!u || transactional) return false;
  if (u.yes || u.no || u.done || u.ack) return false;
  const known = (u.intents || []).find((i) => (
    i !== 'want_know' && i !== 'price' && i !== 'greeting' && i !== 'who_are_you'
  ));
  if (known) return false;
  if ((u.intents || []).includes('price') && (u.service || (u.products || []).length)) return false;
  return true;
}

function parseModelJson(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
}

function createClassifyAsk({ send, timeoutMs = 1200 } = {}) {
  if (typeof send !== 'function') return null;
  return async function classify({ text, profile, lang } = {}) {
    const listed = require('../listedAreas').listedAreaNames(profile).slice(0, 8).join(', ');
    const request = {
      systemInstruction: {
        parts: [{
          text: 'Classify the caller turn. Reply with JSON only: {"kind":"...","place":""}. kind must be one of pay, come_cost, cover, hours, service, refund, cancel_rules, cancel_visit, book, unknown. place is a listed area they named, else "". Never invent a fee, policy, or sentence.',
        }],
      },
      contents: [{
        role: 'user',
        parts: [{ text: `lang=${lang || 'en'}\nlisted=${listed || '(none)'}\ntext=${String(text || '').slice(0, 240)}` }],
      }],
      generationConfig: { temperature: 0, maxOutputTokens: 48, responseMimeType: 'application/json' },
    };
    const ac = timeoutMs;
    let out;
    try {
      out = await Promise.race([
        send(request),
        new Promise((_, reject) => { setTimeout(() => reject(new Error('classify timeout')), ac); }),
      ]);
    } catch {
      return normalizeTicket({ kind: 'unknown' }, profile);
    }
    const textOut = typeof out === 'string' ? out : (out && (out.text || out.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || ''));
    return normalizeTicket(parseModelJson(textOut) || { kind: 'unknown' }, profile);
  };
}

module.exports = {
  KINDS,
  normalizeTicket,
  applyTicket,
  needsClassify,
  parseModelJson,
  createClassifyAsk,
};
