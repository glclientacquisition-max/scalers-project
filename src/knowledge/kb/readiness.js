'use strict';
// Root 2: the readiness check that picks the brain for a business (replaces BRAIN_V2_TENANTS / BRAIN_V1_DRAFT_TENANTS).
// Runs the live brain's own read-only code (engineTools receipts over the snapshot) in text mode: no model, no network.
// Pass = every check ok. A pass for the live snapshot moves tenants.kb_ready_version (rpc kb_record_readiness);
// the first real call after a switch is recorded on top (Decisions, 28 Oct: scripted text test + one real call).
const ET = require('../../conversation/v2/engineTools');
const AC = require('../../conversation/v2/areaCoverage');
const R = require('./rules');
const { SCHEMA } = require('./compile');

const check = (id, ok, detail, fix) => ({ id, ok: !!ok, detail: detail || null, fix: ok ? null : fix || null });
const placeName = (node) => String(node || '').split(':').pop().replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * @param {object} profile  tenant profile with profile.kb attached (live.attach force) and areaPicksRows
 * @param {{ latest?: object, currentHash?: string }} o  latest snapshot row + the source hash of kb_items now
 * @returns {{ passed, checks: object[], tests: object[], version }}
 */
function runReadiness(profile, { latest = null, currentHash = null, now = new Date() } = {}) {
  const kb = profile && profile.kb && profile.kb.handle;
  const doc = kb ? kb.doc : null;
  const checks = [];
  const blocking = (latest && Array.isArray(latest.issues) ? latest.issues : []).filter((i) => i.severity === 'block');
  checks.push(check('kb_compiled', doc && doc.schema === SCHEMA && latest && latest.status === 'live' && !blocking.length && (!currentHash || currentHash === latest.source_hash),
    doc ? `version ${profile.kb.version}${currentHash && latest && currentHash !== latest.source_hash ? ', older than the saved catalogue' : ''}` : 'no live snapshot', 'Save the catalogue so it compiles; fix any blocking issue.'));
  const items = doc ? doc.items : [];
  const unpriced = items.filter((x) => !x.price.say_en && !x.price.quote);
  checks.push(check('catalogue', items.length > 0 && unpriced.length === 0,
    `${items.length} items${unpriced.length ? `, ${unpriced.length} without a price callers can hear: ${unpriced.slice(0, 5).map((x) => x.name).join(', ')}` : ''}`,
    items.length ? 'Add a price (or mark it a custom quote) for each item listed.' : 'Add your products or services.'));
  // the brain's own reader finds a sample of items by their name
  const sample = items.filter((_, i) => i % Math.max(1, Math.floor(items.length / 10)) === 0).slice(0, 10);
  const misses = kb ? sample.filter((it) => { const a = R.answer(kb, it.name, { asksPrice: true, lang: 'en' }); return !(a.ids || []).includes(it.id); }) : sample;
  checks.push(check('reader_finds_items', kb && sample.length && !misses.length, `${sample.length - misses.length} of ${sample.length} found by name`, `These names are hard to find: ${misses.map((x) => x.name).join(', ')}. Add aliases or a clearer name.`));
  const picks = Array.isArray(profile.areaPicksRows) ? profile.areaPicksRows : [];
  const confirmed = picks.filter((p) => p.confirmed_at);
  checks.push(check('areas', confirmed.length > 0, `${confirmed.length} confirmed area picks of ${picks.length}`, 'Open Service areas, pick where you serve, tap Looks right.'));
  checks.push(check('hours', !!(profile.hoursSchedule && profile.hoursSchedule.days), profile.hoursSchedule ? 'weekly hours set' : 'no hours', 'Set your opening hours.'));
  const ch = profile.notifyChannels || {};
  const capture = (profile.whatsappNumber && (ch.sms || ch.whatsapp)) || (profile.alertEmail && ch.email);
  checks.push(check('capture_path', capture, capture ? 'owner alerts reach a phone or email' : 'no owner alert channel', 'Add your phone or email under Alerts so saved requests reach you.'));

  // scripted text test through the live brain's tools (engineTools.runTools), built from this business's KB
  const tests = [];
  const run = (name, u, text, lang, expect) => {
    const machine = { slots: {}, file: {}, turn: 1 };
    let out; try { out = ET.runTools({ understanding: u, machine, profile, lang, text, now }); } catch (e) { tests.push({ name, ok: false, text: null, error: String(e && e.message || e) }); return; }
    const r = out.receipts.filter((x) => x.tool !== 'lookup_caller');
    const said = r.map((x) => x.text).filter(Boolean).join(' ');
    const res = expect(r, said);
    tests.push({ name, ok: !!res.ok, lang, asked: text, heard: said || null, why: res.why || null, ms: r.find((x) => x.kb)?.ms ?? null });
  };
  if (items.length) {
    const it = items.find((x) => x.price.say_en) || items[0];
    run('price_one_item', { answers: ['price'], slots: { service: it.name } }, `How much is ${it.name}?`, 'en', (r, said) => ({ ok: !!it.price.say_en && said.includes(it.price.say_en), why: `expects "${it.price.say_en}"` }));
    if (it.price.say_sw) run('price_one_item_sw', { answers: ['price'], slots: { service: it.name } }, `Bei ya ${it.name} ni ngapi?`, 'sw', (r, said) => ({ ok: said.includes(it.price.say_sw), why: `expects "${it.price.say_sw}"` }));
    const big = (kb.categories || []).find((c) => c.count > 3 && c.name);
    if (big) {
      run('group_hick', { answers: ['services'], slots: {} }, `What ${big.name} do you have?`, 'en', (r, said) => {
        const shown = items.filter((x) => said.toLowerCase().includes(x.say_en.toLowerCase())).length;
        return { ok: shown > 0 && shown <= 3 && said.includes(String(big.count)) && /\?$/.test(said.trim()) && !/shilling/.test(said), why: `${shown} names, count ${big.count}, one question, no prices` };
      });
    }
    run('overview', { answers: ['services'], slots: {} }, 'What do you offer?', 'en', (r, said) => ({ ok: !!said, why: 'an answer, not silence' }));
  }
  const served = confirmed.find((p) => p.serve && /:/.test(p.node));
  if (served) {
    const place = placeName(served.node);
    let cov = null; try { cov = AC.coverageReceipt([place], profile).places[0]; } catch { cov = null; }
    tests.push({ name: 'coverage', ok: !!(cov && cov.covered === 'yes'), asked: `Do you cover ${place}?`, heard: cov ? AC.line({ ...cov, name: cov.name || place }, 'en') || cov.covered : null, why: 'a confirmed served area answers yes' });
  }
  if (profile.hoursSchedule && profile.hoursSchedule.days) {
    const h = ET.hoursReceipt(profile, 'en', { now });
    tests.push({ name: 'hours', ok: !!(h && h.ok && h.text), asked: 'Are you open today?', heard: h ? h.text : null });
  }
  const passed = checks.every((c) => c.ok) && tests.length > 0 && tests.every((t) => t.ok);
  return { passed, checks, tests, version: profile.kb ? profile.kb.version : null };
}

module.exports = { runReadiness };
