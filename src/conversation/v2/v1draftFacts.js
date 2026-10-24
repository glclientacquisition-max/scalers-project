'use strict';
// BRAIN_V1_DRAFT: the per-turn knowledge-base fact note. Every fact the model may state has an id;
// the verifier (v1draftVerify.js) only passes a fact sentence that cites an id from THIS note
// and whose values match it. Design: ship-briefs/2026-10-24_brain_v1-draft-kb-verify-design.md §1-2.
const N = require('./nlu');

const num = (s) => String(s || '').replace(/(\d),(?=\d{3})/g, '$1').match(/\d+(?:\.\d+)?/g) || [];
const cap = (s) => String(s || '').replace(/\b\w/g, (c) => c.toUpperCase());
const NOT_DISTINCT = new Set(['clean', 'cleaning', 'standard', 'package', 'service', 'services', 'internal', 'deep', 'per', 'room', 'seat', 'the', 'and', 'add', 'on', 'up', 'to', 'sq', 'ft']);
function keyWords(name) {
  return String(name || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z ]/g, ' ').split(/\s+/).filter((w) => w.length >= 4 && !NOT_DISTINCT.has(w));
}

function hoursFact(profile) {
  const d = profile.hoursSchedule?.days || {};
  const spans = [...new Set(Object.values(d).filter((x) => x && x.open && x.close).map((x) => `${x.open}-${x.close}`))];
  if (!spans.length) return null;
  const all = Object.keys(d).length === 7 && spans.length === 1;
  const text = all ? `Open every day ${spans[0]}` : Object.entries(d).map(([k, x]) => `${k} ${x?.open ? `${x.open}-${x.close}` : 'closed'}`).join(', ');
  const nums = new Set();
  for (const s of spans) for (const t of s.split('-')) { const h = parseInt(t, 10); nums.add(String(h)); nums.add(String(h > 12 ? h - 12 : h)); nums.add(t.replace(/^0/, '')); }
  return { id: 'H1', family: 'hours', text, nums: [...nums] };
}

/** facts: [{ id, family, text, nums, ... }]; text: the note sent to the model. */
function buildFactNote(profile = {}, state = {}, { callerText = '', writes = [] } = {}) {
  const facts = [];
  (profile.servicesCatalog || []).slice(0, 60).forEach((s, i) => {
    const desc = String(s.notes || '').trim() || null;
    facts.push({ id: `S${i + 1}`, family: 'service', serviceId: s.id, name: s.name, keys: keyWords(s.name), desc, text: `${s.name}${desc ? ` — ${desc}` : ' — (no description on file)'}` });
    const priced = s.pricing?.confirmed !== false && s.price_range;
    if (priced) facts.push({ id: `P${i + 1}`, family: 'price', serviceId: s.id, name: s.name, keys: keyWords(s.name), text: `${s.name}: ${s.price_range}`, nums: num(s.price_range) });
  });
  const areas = (profile.serviceAreas?.areas || []).map((a) => cap(String(a.id || '').replace(/^\w+:/, ''))).filter(Boolean);
  areas.forEach((a, i) => facts.push({ id: `A${i + 1}`, family: 'area', place: a, covered: true, text: `${a}: covered` }));
  // places the caller named that are NOT on the list (Kisumu): a NOT-covered fact the model can cite
  const said = N.matchArea(callerText, profile);
  if (said && said.listed === false && said.name) facts.push({ id: 'AX1', family: 'area', place: cap(said.name), covered: false, text: `${cap(said.name)}: NOT covered` });
  const h = hoursFact(profile); if (h) facts.push(h);
  const pay = String(profile.businessPolicies?.payment || '').trim();
  if (pay) facts.push({ id: 'M1', family: 'payment', text: pay, nums: num(pay) });
  if (state?.slots?.name && state.slots.nameConfirmed) facts.push({ id: 'N1', family: 'name', name: state.slots.name, text: `Caller name (confirmed): ${state.slots.name}` });
  if (profile.businessName) facts.push({ id: 'B1', family: 'business', name: profile.businessName, text: `Business: ${profile.businessName}${profile.agentName ? `; you are ${profile.agentName}` : ''}` });
  writes.forEach((w, i) => { if (w && w.id) facts.push({ id: `W${i + 1}`, family: 'write', writeId: w.id, kind: w.kind || 'callback', text: `Confirmed ${w.kind || 'callback'} (backend id ${w.id})` }); });
  const byId = new Map(facts.map((f) => [f.id, f]));
  const text = facts.map((f) => `[${f.id}] ${f.text}`).join('\n');
  return { facts, byId, text, areas };
}
module.exports = { buildFactNote, keyWords, num };
