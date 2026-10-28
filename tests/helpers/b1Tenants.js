'use strict';
// B1 fixtures: the prod gap shapes from the retire-old-brain plan §2b (Platform's facts, 28 Oct). Synthetic: no call
// data, no real numbers. Each tenant is built on the KB v2 path (live snapshot attached), as P1 makes it for all.
const C = require('../../src/knowledge/kb/compile');
const KL = require('../../src/knowledge/kb/live');
const { tenantProfileFromRow } = require('../../src/tenantProfile');

const NOW = new Date('2026-10-28T10:00:00+03:00'); // a Wednesday, 10:00 EAT
const OWNER = '+254700000902'; // synthetic
const HOURS = { days: Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, { open: '08:00', close: '17:00' }]).concat([['sun', { closed: true }]])) };
const svc = (o) => ({ kind: 'service', status: 'active', price_mode: 'fixed', price_amount: 3000, category_id: 'home', aliases: [], ...o });
const prod = (o) => ({ kind: 'product', status: 'active', price_mode: 'per_unit', price_amount: 5, unit: 'seedling', aliases: [], ...o });
const UNCONFIRMED_PICKS = { version: 1, tree_version: 'ke-areas-2026-10-24.1', picks: [{ node: 'county:nairobi', serve: true, fee_kes: null, note: null }] };

let seq = 0;
function tenant({ id, name, items = [], categories = [], hours = HOURS, legacyAreas = null, picks = null, picksConfirmedAt = null, brainMode = null, brainModeSource = null }) {
  const row = { id: `${id}-${++seq}`, business_name: name, vertical: 'home_services', agent_name: 'Amani', ...(legacyAreas ? { service_areas: legacyAreas } : {}), ...(brainMode ? { brain_mode: brainMode } : {}), ...(brainModeSource ? { brain_mode_source: brainModeSource } : {}) };
  const p = tenantProfileFromRow(row, { areaPicksRows: [] });
  p.hoursSchedule = hours;
  p.ownerPhone = OWNER;
  if (picks) { p.areaPicks = picks; p.areaPicksConfirmedAt = picksConfirmedAt; }
  KL.attach(p, { version: 3, readyVersion: 3, brainTarget: 'v2', doc: C.compileKb({ items, categories, business: id, now: NOW }).doc, bytes: null, loadMs: 1 }, { env: { BRAIN_KB_GATE: 'on' } });
  return p;
}

const TENANTS = {
  // empty catalogue, no hours (real lines: Alvin, 28 Oct)
  scalersBs: () => tenant({ id: 'scalers-bs', name: 'Scalers Business Solutions', hours: null }),
  uwezo: () => tenant({ id: 'uwezo', name: 'Uwezo', hours: null }),
  // one item, no areas at all
  dnd: () => tenant({ id: 'dnd', name: 'Done and Dusted', items: [svc({ id: 'dc', name_en: 'Deep clean', price_amount: 6000 })], categories: [{ id: 'home', name_en: 'Home cleaning' }] }),
  // product catalogue; areas only on the legacy list (never confirmed as picks)
  growTech: () => tenant({ id: 'grow-tech', name: 'Grow Tech', legacyAreas: ['Nairobi', 'Kiambu'], categories: [{ id: 'tomatoes', name_en: 'Tomatoes' }, { id: 'cabbage', name_en: 'Cabbage' }],
    items: [prod({ id: 't1', name_en: 'Anna F1', category_id: 'tomatoes' }), prod({ id: 't2', name_en: 'Rio Grande', category_id: 'tomatoes' }), prod({ id: 'g1', name_en: 'Gloria F1', category_id: 'cabbage' })] }),
  // area picks saved but the owner never tapped "Looks right"
  esga: () => tenant({ id: 'esga', name: 'Esga', picks: UNCONFIRMED_PICKS, items: [svc({ id: 'e1', name_en: 'Plumbing repair' }), svc({ id: 'e2', name_en: 'Borehole service' })] }),
  // legacy list on the business policies + unconfirmed picks absent
  alfaal: () => tenant({ id: 'alfaal', name: 'ALFAAL', legacyAreas: ['Mombasa'], items: [svc({ id: 'a1', name_en: 'Furniture repair' })] }),
};

module.exports = { TENANTS, tenant, NOW, OWNER, HOURS, svc, prod };
