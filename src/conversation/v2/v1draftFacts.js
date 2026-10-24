'use strict';
// BRAIN_V1_DRAFT: the per-turn knowledge-base fact note. Every fact the model may state has an id;
// the verifier (v1draftVerify.js) only passes a fact sentence that cites an id from THIS note
// and whose values match it. Design: ship-briefs/2026-10-24_brain_v1-draft-kb-verify-design.md §1-2.
const N = require('./nlu');
const AC = require('./areaCoverage');
const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const DAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

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

function bookingFact(state = {}) {
  // after the write the slots reset: the booking just made (this call's receipt) is still the call's truth
  const rec = [...(state.receipts || [])].reverse().find((r) => r && r.ok && r.tool === 'create_booking');
  const live = state.slots && (state.slots.service || state.slots.place || (state.slots.when && state.slots.when.date));
  const sl = live || !rec ? (state.slots || {}) : { service: rec.service, when: rec.when || {}, place: rec.place, name: state.slots && state.slots.name, nameConfirmed: state.slots && state.slots.nameConfirmed };
  const w = sl.when || {};
  const pend = state.pending || (live ? {} : { items: rec && rec.items });
  const svc = (Array.isArray(pend.items) && pend.items.length ? pend.items : [sl.service && (sl.service.name || sl.service)]).filter(Boolean).map(String);
  const parts = []; const nums = new Set(); const words = new Set();
  if (svc.length) parts.push(`service ${svc.join(' + ')}`);
  if (w.date) {
    const d = new Date(`${w.date}T12:00:00Z`);
    if (!Number.isNaN(d.getTime())) { nums.add(String(d.getUTCDate())); words.add(MONTHS[d.getUTCMonth()]); words.add(DAYS[d.getUTCDay()]); parts.push(`date ${w.date} (${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]})`); }
  }
  if (w.time) {
    const [hh, mm] = String(w.time).split(':').map(Number);
    if (Number.isFinite(hh)) { nums.add(String(hh)); nums.add(String(hh % 12 || 12)); if (mm) nums.add(String(mm)); nums.add(`${hh % 12 || 12}:${String(mm || 0).padStart(2, '0')}`); parts.push(`time ${w.time}`); }
  }
  const place = sl.place && (sl.place.name || sl.place);
  if (place) { parts.push(`place ${place}`); String(place).toLowerCase().split(/[^a-z]+/).forEach((x) => x && words.add(x)); }
  if (sl.name && sl.nameConfirmed) { parts.push(`name ${sl.name}`); words.add(String(sl.name).toLowerCase()); }
  if (!parts.length) return null;
  for (const n of svc.flatMap((x) => num(x))) nums.add(n);
  return { id: 'K1', family: 'booking', auto: true, text: `Booking so far (caller gave it): ${parts.join('; ')}`, nums: [...nums], words: [...words], name: sl.name && sl.nameConfirmed ? sl.name : null, place: place || null, services: svc };
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
  // places the caller named (this turn) or the booking holds, resolved on the shared Kenya area tree +
  // the owner's include/exclude rows. auto: backed by the system, valid without a model citation.
  const seenPlace = new Set(areas.map((a) => a.toLowerCase()));
  [callerText, state?.slots?.place].forEach((src, i) => {
    const r = src ? AC.resolve(src, profile) : null;
    if (!r || !r.name || r.status === 'unknown' || seenPlace.has(r.name.toLowerCase())) return;
    seenPlace.add(r.name.toLowerCase());
    const covered = r.status === 'covered';
    facts.push({ id: `AR${i + 1}`, family: 'area', place: r.name, covered, auto: true, county: r.county || null, text: covered ? `${r.name}: covered${r.county ? ` (in ${r.county})` : ''}` : `${r.name}: NOT covered` });
  });
  // the booking in progress: what the caller gave this call is a backed fact (call state is the truth)
  const b = bookingFact(state);
  if (b) facts.push(b);
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
module.exports = { buildFactNote, bookingFact, keyWords, num, hoursFact };
