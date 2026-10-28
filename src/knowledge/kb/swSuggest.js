'use strict';
// AI-suggested Swahili names (Alvin, 28 Oct: Q3 yes, owner-approved). The model only suggests:
// rows go to name_sw_suggested with state 'suggested'; nothing is spoken until the owner approves or edits.
const SCHEMA = {
  type: 'object',
  properties: { entries: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, sw: { type: 'string' } }, required: ['id', 'sw'] } } },
  required: ['entries'],
};
function prompt(rows) {
  return [
    'You name items for a Kenyan business phone line. For each item give the short name a Swahili-speaking caller in Kenya would say.',
    'Keep brand and variety names as they are (e.g. "Zara F1" stays "Zara F1"); translate only common words (cabbage = kabichi, tomato = nyanya, deep cleaning = usafi wa kina).',
    'At most 5 words. No prices, no numbers that are not in the name. If the name should not be translated, repeat it.',
    'Return JSON {"entries":[{"id","sw"}]} with one entry per item.',
    `ITEMS: ${JSON.stringify(rows.map((r) => ({ id: r.id, name: r.name_en, category: r.category_id || null, kind: r.kind })))}`,
  ].join('\n');
}
const BAD = /\d{3,}|ksh|shilingi|bei|price|http/i;
/** -> kb_upsert_items rows (id + name_sw_suggested + name_sw_state) for items with no Swahili name yet. Max 80 per run. */
async function suggestSwahili(items, generate, { max = 80 } = {}) {
  const todo = (items || []).filter((x) => x && x.status !== 'hidden' && (x.name_sw_state || 'none') === 'none' && !x.name_sw_suggested).slice(0, max);
  if (!todo.length || typeof generate !== 'function') return [];
  const out = await generate({ prompt: prompt(todo), schema: SCHEMA });
  const byId = new Map(todo.map((x) => [x.id, x]));
  const rows = [];
  for (const e of (out && out.entries) || []) {
    const it = byId.get(String(e.id || ''));
    const sw = String(e.sw || '').replace(/\s+/g, ' ').trim();
    if (!it || !sw || sw.length > 60 || sw.split(' ').length > 6 || BAD.test(sw)) continue;
    rows.push({ id: it.id, kind: it.kind, name_en: it.name_en, category_id: it.category_id, unit: it.unit, price_mode: it.price_mode, price_amount: it.price_amount, price_min: it.price_min, price_max: it.price_max, in_stock: it.in_stock, status: it.status, sort: it.sort, source: it.source, description_en: it.description_en, needs_visit: it.needs_visit, bookable: it.bookable, currency: it.currency, name_sw_suggested: sw, name_sw_state: 'suggested' });
  }
  return rows;
}
module.exports = { suggestSwahili, SCHEMA, prompt };
