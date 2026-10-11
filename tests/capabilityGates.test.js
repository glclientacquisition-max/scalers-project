const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { evaluateCapabilityGates, holdReasonId } = require('../src/conversation/capabilityGates');
const { buildBrainCapabilities } = require('../src/conversation/brainPolicy');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const RPC_REASONS = [
  'Holds are not enabled in policies.',
  'Need at least one holdable product with owner provenance in the catalog.',
  'Need a verified notify target (WhatsApp or email alerts).',
];

function loadTwin() {
  let mod;
  try {
    mod = require(path.join(ROOT, 'dashboard/node_modules/jiti'));
  } catch {
    return null;
  }
  const opts = { alias: { '@': path.join(ROOT, 'dashboard/src') }, interopDefault: true };
  const target = path.join(ROOT, 'dashboard/src/lib/capabilityGates.ts');
  // jiti 2 exports createJiti; jiti 1 exports a factory.
  if (typeof mod.createJiti === 'function') return mod.createJiti(__filename, opts)(target);
  const factory = typeof mod === 'function' ? mod : mod.default;
  return factory(__filename, opts)(target);
}

describe('capability gates (call brain)', () => {
  it('maps every tenant_hold_gate reason to a requirement id', () => {
    assert.deepEqual(RPC_REASONS.map(holdReasonId), ['holds_policy_on', 'holdable_item', 'verified_alert']);
  });

  it('Aris Kenya today: holds off in policies keeps holds locked on the call', () => {
    const profile = { holdGate: { allowed: false, reasons: [RPC_REASONS[0]] } };
    const gates = evaluateCapabilityGates(profile);
    assert.equal(gates.holds.allowed, false);
    assert.deepEqual(gates.holds.missing, ['holds_policy_on']);
    assert.equal(buildBrainCapabilities(profile).placeHold, false);
  });

  it('the brain uses the same gate decisions', () => {
    const profile = {
      holdGate: { allowed: true, reasons: [] },
      servicesCatalog: [{ name: 'Sofa cleaning', source: 'owner' }],
      businessPolicies: { booking_mode: 'confirmed_slot', booking: { source: 'owner' } },
    };
    const gates = evaluateCapabilityGates(profile);
    const caps = buildBrainCapabilities(profile);
    assert.equal(caps.placeHold, gates.holds.allowed);
    assert.equal(caps.confirmVisit, gates.site_visits.allowed);
    assert.equal(caps.confirmedSlot, gates.booking_slots.allowed);
    assert.equal(gates.booking_slots.allowed, true);
  });

  it('booking slots stay locked until the owner picks confirmed_slot', () => {
    assert.deepEqual(evaluateCapabilityGates({}).booking_slots, { allowed: false, missing: ['booking_mode_confirmed'] });
    assert.equal(
      evaluateCapabilityGates({ businessPolicies: { booking_mode: 'request', booking: { source: 'owner' } } }).booking_slots.allowed,
      false
    );
  });
});

describe('capability gates (Overview twin)', () => {
  const twin = loadTwin();

  it('shares requirement ids with the call brain', () => {
    const ts = read('dashboard/src/lib/capabilityGates.ts');
    const js = read('src/conversation/capabilityGates.js');
    for (const id of ['holds_policy_on', 'holdable_item', 'verified_alert', 'owner_service', 'booking_mode_confirmed', 'handoff_live', 'transfer_phone']) {
      assert.match(ts, new RegExp(`"${id}"`), `${id} in twin`);
      assert.match(js, new RegExp(`'${id}'`), `${id} in brain`);
    }
  });

  it('holds: Needs setup lists each missing step with a deep link and caller lines', { skip: !twin }, () => {
    const gates = twin.capabilityGates(
      { vertical: 'retail', business_policies: {} },
      { holdGate: { allowed: false, reasons: RPC_REASONS.slice(0, 2) } }
    );
    const holds = gates.find((g) => g.id === 'holds');
    assert.equal(holds.status, 'needs_setup');
    assert.deepEqual(holds.missing.map((r) => r.id), ['holds_policy_on', 'holdable_item']);
    assert.match(holds.missing[0].href, /panel=policies#holds$/);
    assert.match(holds.missing[1].href, /tab=catalog#holdable$/);
    assert.equal(holds.requirements.find((r) => r.id === 'verified_alert').done, true);
    assert.match(holds.callerHearsLocked, /can't hold/);
  });

  it('holds: Live when the RPC allows, and says the max hold time', { skip: !twin }, () => {
    const holds = twin
      .capabilityGates({ vertical: 'retail', business_policies: { holds: { allowed: 'yes', max_hours: 6 } } }, { holdGate: { allowed: true, reasons: [] } })
      .find((g) => g.id === 'holds');
    assert.equal(holds.status, 'live');
    assert.match(holds.callerHearsLive, /6 hours/);
  });

  it('home services get visit requests and bookings, not holds', { skip: !twin }, () => {
    const ids = twin.capabilityGates({ vertical: 'home_services' }).map((g) => g.id);
    assert.deepEqual(ids, ['site_visits', 'booking_slots', 'live_transfer']);
    const slots = twin
      .capabilityGates({ vertical: 'home_services', business_policies: { booking_mode: 'confirmed_slot', booking: { source: 'owner' } } })
      .find((g) => g.id === 'booking_slots');
    assert.equal(slots.status, 'live');
  });

  it('live transfer names Scalers when only the platform switch is missing', { skip: !twin }, () => {
    const g = twin
      .capabilityGates({ vertical: 'retail', handoff_mode: 'live_transfer', team_directory: [{ name: 'Aris', phone: '0790381872' }] }, { liveTransferExecutor: false })
      .find((x) => x.id === 'live_transfer');
    assert.deepEqual(g.missing.map((r) => r.id), ['platform']);
    assert.equal(g.missing[0].href, null);
  });
});

describe('Overview hold count (Aris "1 Hold" while locked)', () => {
  it('counts only open hold/order requests as holds; open enquiries are callers to return', () => {
    const src = read('dashboard/src/lib/inboxPurpose.ts');
    assert.match(src, /HOLD_REQUEST_TYPES = new Set\(\["hold", "order", "hold_or_pickup"\]\)/);
    assert.match(src, /toFulfill = live\.filter\(\(item\) => openRequest\(item\) && isHoldRequestType/);
    assert.match(src, /openRequest\(item\) && !isHoldRequestType/);
  });

  it('Overview uses the gate model, with Needs setup instead of Locked', () => {
    const home = read('dashboard/src/app/(desk)/home/page.tsx');
    assert.match(home, /capabilityGates\(tenant/);
    assert.match(home, /<CapabilityGatesPanel gates=\{gates\} \/>/);
    assert.doesNotMatch(home, />Locked</);
    const panel = read('dashboard/src/components/CapabilityGatesPanel.tsx');
    assert.match(panel, /from "@\/components\/ui\/Sheet"/);
    assert.match(panel, /Callers hear now/);
  });
});
