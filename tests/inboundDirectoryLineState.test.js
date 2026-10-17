// #645 inbound directory x #639/#651 closed-line gate: the cached directory
// must decide with the same isTenantLineInactive / tenantLineState rules as
// db.inboundTenantLine, so the fast path never answers an archived,
// suspended or is_active=false business, and a live owner of the same
// number always wins.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createInboundDirectory } = require('../src/sautikit/inboundDirectory');
const { tenantLineState, sameNumber } = require('../src/sautikit/inactiveTenantGate');

const DID = '+254700000009';

function dir(rows, opts = {}) {
  return createInboundDirectory({ loadTenants: async () => ({ rows, packageColumns: true }), ...opts });
}

const base = { sautikit_virtual_number: DID, is_active: true, archived_at: null, line_status: null };

describe('inbound directory honours isTenantLineInactive', () => {
  for (const [label, over, reason] of [
    ['archived (archived_at set)', { archived_at: '2026-10-09T18:00:00Z' }, 'archived'],
    ['suspended (line_status)', { line_status: 'suspended' }, 'suspended'],
    ['is_active = false', { is_active: false }, 'inactive'],
  ]) {
    it(`${label} closes the line`, async () => {
      const r = await dir([{ id: 'dead', ...base, ...over }]).lookup({ fromNumber: '+254711111111', toNumber: DID });
      assert.equal(r.tenantId, 'dead');
      assert.deepEqual(r.lineState, { closed: true, reason, tenantId: 'dead' });
      assert.equal(r.line.active, false);
    });
  }

  it('grace still answers', async () => {
    const r = await dir([{ id: 'g', ...base, line_status: 'grace' }]).lookup({ toNumber: DID });
    assert.equal(r.lineState.closed, false);
  });

  it('live wins over archived on the same number (either row order, +254/254/0 forms)', async () => {
    const archived = { id: 'old', ...base, archived_at: '2026-10-01T00:00:00Z' };
    const live = { id: 'new', ...base, sautikit_virtual_number: '0700000009' };
    for (const rows of [[archived, live], [live, archived]]) {
      for (const toNumber of [DID, '254700000009', '0700000009']) {
        const r = await dir(rows).lookup({ fromNumber: '+254711111111', toNumber });
        assert.equal(r.tenantId, 'new', `to=${toNumber}`);
        assert.deepEqual(r.lineState, { closed: false, reason: 'live', tenantId: 'new' });
      }
    }
  });

  it('agrees with tenantLineState (the db.inboundTenantLine rule) on mixed owners', async () => {
    const rows = [
      { id: 'a', ...base, is_active: false },
      { id: 'b', ...base, line_status: 'suspended' },
      { id: 'c', ...base, archived_at: '2026-10-09T00:00:00Z' },
      { id: 'x', ...base, sautikit_virtual_number: '+254700000010' },
    ];
    const r = await dir(rows).lookup({ toNumber: DID });
    const owners = rows.filter((row) => sameNumber(row.sautikit_virtual_number, DID));
    assert.deepEqual(r.lineState, tenantLineState(owners));
    assert.equal(r.lineState.reason, 'archived');
  });

  it('missing columns (older schema) never close a line', async () => {
    const r = await dir([{ id: 'o', sautikit_virtual_number: DID, is_active: true }]).lookup({ toNumber: DID });
    assert.equal(r.lineState.closed, false);
  });

  it('DEFAULT_TENANT_ID deploy and number-less webhook fail open (lineState null)', async () => {
    const d1 = await dir([{ id: 'dead', ...base, is_active: false }], { defaultTenantId: 'dead' }).lookup({ toNumber: DID });
    assert.equal(d1.lineState, null);
    const d2 = await dir([{ id: 'dead', ...base, is_active: false }]).lookup({});
    assert.equal(d2.lineState, null);
  });
});

describe('server wiring: closed-line gate uses the directory decision, before Stream and the call row', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const gate = src.indexOf('directoryHit && directoryHit.lineState');
  it('the gate reads directoryHit.lineState and falls back to db.inboundTenantLine', () => {
    assert.ok(gate > 0);
    assert.ok(src.indexOf('db.inboundTenantLine', gate) > gate);
  });
  it('the gate runs before the package gate / upsertCall on the inbound path', () => {
    const pkg = src.indexOf('directoryHit.gate && directoryHit.gate.open === false');
    assert.ok(pkg > gate, 'line gate before package gate');
  });
  it('db.listInboundTenantRows selects archived_at and line_status', () => {
    const db = fs.readFileSync(path.join(__dirname, '..', 'src', 'db.js'), 'utf8');
    const fn = db.slice(db.indexOf('async function listInboundTenantRows'));
    assert.match(fn.slice(0, 1500), /archived_at, line_status, minutes_included/);
  });
});
