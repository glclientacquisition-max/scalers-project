'use strict';

const { describe, it, before, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  contactNameLockEnabled,
  isContactNameLocked,
  isNameDismissed,
  resolveContactIdentityForUpsert,
  dismissNameKey,
} = require('../src/conversation/contactNameLock');
const { mergeContactIdentity } = require('../src/conversation/contactIdentity');

const FLAG_OFF = {};
const FLAG_ON = { VOICE_CONTACT_NAME_LOCK: 'on' };

describe('VOICE_CONTACT_NAME_LOCK flag', () => {
  it('is off unless the exact value on', () => {
    assert.equal(contactNameLockEnabled({}), false);
    assert.equal(contactNameLockEnabled({ VOICE_CONTACT_NAME_LOCK: '' }), false);
    assert.equal(contactNameLockEnabled({ VOICE_CONTACT_NAME_LOCK: 'off' }), false);
    assert.equal(contactNameLockEnabled({ VOICE_CONTACT_NAME_LOCK: '1' }), false);
    assert.equal(contactNameLockEnabled({ VOICE_CONTACT_NAME_LOCK: 'true' }), false);
    assert.equal(contactNameLockEnabled({ VOICE_CONTACT_NAME_LOCK: 'ON' }), false);
    assert.equal(contactNameLockEnabled({ VOICE_CONTACT_NAME_LOCK: 'on' }), true);
  });
});

describe('isContactNameLocked', () => {
  it('treats single_person and name_locked (bool or Desk object) as locked', () => {
    assert.equal(isContactNameLocked({}), false);
    assert.equal(isContactNameLocked({ single_person: true }), true);
    assert.equal(isContactNameLocked({ name_locked: true }), true);
    assert.equal(
      isContactNameLocked({ name_locked: { at: '2026-10-18T12:00:00.000Z', by: 'owner' } }),
      true
    );
    assert.equal(isContactNameLocked({ single_person: false }), false);
  });
});

describe('dismissed names', () => {
  it('matches case and diacritics insensitive, Desk {name,at} or plain string', () => {
    const meta = {
      alternate_names_dismissed: [
        { name: 'José', at: '2026-10-18T12:00:00.000Z' },
        'Brian',
      ],
    };
    assert.equal(isNameDismissed(meta, 'jose'), true);
    assert.equal(isNameDismissed(meta, 'José'), true);
    assert.equal(isNameDismissed(meta, '  brian '), true);
    assert.equal(isNameDismissed(meta, 'Amina'), false);
    assert.equal(dismissNameKey('José'), dismissNameKey('jose'));
  });
});

describe('resolveContactIdentityForUpsert', () => {
  it('flag off: identical to mergeContactIdentity', () => {
    const existing = {
      name: 'Amina',
      metadata: {
        favourite_at: '2026-09-23T08:00:00.000Z',
        alternate_names: [{ name: 'Amy', seen_at: 't', call_id: 'c1' }],
      },
    };
    const incoming = { name: 'Brian', callId: 'c2', seenAt: '2026-10-18T00:00:00.000Z' };
    assert.deepEqual(
      resolveContactIdentityForUpsert(existing, incoming, FLAG_OFF),
      mergeContactIdentity(existing, incoming)
    );
    assert.deepEqual(
      resolveContactIdentityForUpsert(null, { name: 'Amina' }, FLAG_OFF),
      mergeContactIdentity(null, { name: 'Amina' })
    );
  });

  it('locked contact keeps its name and adds no alternate', () => {
    const existing = {
      name: 'Alvin',
      metadata: {
        name_locked: { at: '2026-10-18T12:00:00.000Z', by: 'owner' },
        favourite_at: '2026-09-23T08:00:00.000Z',
        alternate_names: [{ name: 'Alwyn', seen_at: 't', call_id: 'c1' }],
      },
    };
    const next = resolveContactIdentityForUpsert(
      existing,
      { name: 'Brian', callId: 'c9', seenAt: '2026-10-18T15:00:00.000Z' },
      FLAG_ON
    );
    assert.equal(next.name, 'Alvin');
    assert.equal(next.metadata.alternate_names.length, 1);
    assert.equal(next.metadata.alternate_names[0].name, 'Alwyn');
    assert.equal(next.metadata.favourite_at, '2026-09-23T08:00:00.000Z');
    assert.deepEqual(next.metadata.name_locked, existing.metadata.name_locked);
  });

  it('single_person behaves the same as locked', () => {
    const existing = {
      name: 'Amina',
      metadata: { single_person: true, favourite_at: '2026-01-01T00:00:00.000Z' },
    };
    const next = resolveContactIdentityForUpsert(
      existing,
      { name: 'Other', callId: 'c3' },
      FLAG_ON
    );
    assert.equal(next.name, 'Amina');
    assert.deepEqual(next.metadata.alternate_names, []);
    assert.equal(next.metadata.favourite_at, '2026-01-01T00:00:00.000Z');
    assert.equal(next.metadata.single_person, true);
  });

  it('a dismissed alternate is not re-added when unlocked', () => {
    const existing = {
      name: 'Amina',
      metadata: {
        favourite_at: '2026-09-23T08:00:00.000Z',
        note: 'keep-me',
        alternate_names_dismissed: [{ name: 'Brian', at: '2026-10-01T00:00:00.000Z' }],
      },
    };
    const next = resolveContactIdentityForUpsert(
      existing,
      { name: 'Brian', callId: 'c4', seenAt: '2026-10-18T00:00:00.000Z' },
      FLAG_ON
    );
    assert.equal(next.name, 'Amina');
    assert.deepEqual(next.metadata.alternate_names, []);
    assert.equal(next.metadata.favourite_at, '2026-09-23T08:00:00.000Z');
    assert.equal(next.metadata.note, 'keep-me');
  });

  it('unlocked contact still merges a fresh alternate as today when flag on', () => {
    const existing = { name: 'Amina', metadata: { favourite_at: '2026-09-23T08:00:00.000Z' } };
    const next = resolveContactIdentityForUpsert(
      existing,
      { name: 'Colin', callId: 'c5', seenAt: '2026-10-18T00:00:00.000Z' },
      FLAG_ON
    );
    assert.equal(next.name, 'Amina');
    assert.equal(next.metadata.alternate_names.length, 1);
    assert.equal(next.metadata.alternate_names[0].name, 'Colin');
    assert.equal(next.metadata.favourite_at, '2026-09-23T08:00:00.000Z');
  });

  it('preserves favourite_at and other keys on the locked path', () => {
    const existing = {
      name: 'Owner',
      metadata: {
        single_person: true,
        favourite_at: '2026-08-01T00:00:00.000Z',
        custom_tag: 'vip',
        alternate_names: [],
      },
    };
    const next = resolveContactIdentityForUpsert(existing, { name: 'X' }, FLAG_ON);
    assert.equal(next.metadata.favourite_at, '2026-08-01T00:00:00.000Z');
    assert.equal(next.metadata.custom_tag, 'vip');
    assert.equal(next.metadata.single_person, true);
  });
});

describe('upsertContact respects VOICE_CONTACT_NAME_LOCK', () => {
  const contacts = [];
  let updates;
  let inserts;
  let db;
  let prevFlag;

  function builder(table) {
    const st = { op: 'select', patch: null, row: null, eq: {}, inPhone: null };
    const run = () => {
      if (table !== 'contacts') return { data: null, error: null };
      if (st.op === 'select') {
        const hit = contacts.find((c) => {
          if (st.eq.tenant_id && c.tenant_id !== st.eq.tenant_id) return false;
          if (st.inPhone && !st.inPhone.includes(c.phone)) return false;
          if (st.eq.id && c.id !== st.eq.id) return false;
          return true;
        });
        return { data: hit ? { ...hit, metadata: hit.metadata ? { ...hit.metadata } : {} } : null, error: null };
      }
      if (st.op === 'update') {
        const hit = contacts.find((c) => c.id === st.eq.id);
        if (!hit) return { data: null, error: null };
        Object.assign(hit, st.patch);
        updates.push({ id: hit.id, patch: { ...st.patch } });
        return { data: { ...hit, metadata: { ...hit.metadata } }, error: null };
      }
      if (st.op === 'insert') {
        const row = { id: `id-${contacts.length + 1}`, ...st.row };
        contacts.push(row);
        inserts.push(row);
        return { data: { ...row, metadata: { ...row.metadata } }, error: null };
      }
      return { data: null, error: null };
    };
    const b = {
      select() {
        return b;
      },
      update(p) {
        st.op = 'update';
        st.patch = p;
        return b;
      },
      insert(row) {
        st.op = 'insert';
        st.row = row;
        return b;
      },
      eq(k, v) {
        st.eq[k] = v;
        return b;
      },
      in(k, list) {
        if (k === 'phone') st.inPhone = list;
        return b;
      },
      order() {
        return b;
      },
      limit() {
        return b;
      },
      maybeSingle() {
        return Promise.resolve(run());
      },
      single() {
        return Promise.resolve(run());
      },
      then(res, rej) {
        return Promise.resolve(run()).then(res, rej);
      },
    };
    return b;
  }

  before(() => {
    const clientPath = require.resolve('../src/lib/supabaseClient');
    require.cache[clientPath] = {
      id: clientPath,
      filename: clientPath,
      loaded: true,
      exports: {
        supabase: {
          from: () => builder('contacts'),
          rpc: async () => ({ data: null, error: null }),
        },
      },
    };
    delete require.cache[require.resolve('../src/db')];
    db = require('../src/db');
  });

  beforeEach(() => {
    contacts.length = 0;
    updates = [];
    inserts = [];
    prevFlag = process.env.VOICE_CONTACT_NAME_LOCK;
    delete process.env.VOICE_CONTACT_NAME_LOCK;
    contacts.push({
      id: 'c-locked',
      tenant_id: 't1',
      phone: '+254700000001',
      name: 'Alvin',
      notes: null,
      last_reason: null,
      metadata: {
        name_locked: { at: '2026-10-18T12:00:00.000Z', by: 'owner' },
        favourite_at: '2026-09-23T08:00:00.000Z',
        alternate_names: [],
        alternate_names_dismissed: [{ name: 'Brian', at: '2026-10-01T00:00:00.000Z' }],
      },
    });
    contacts.push({
      id: 'c-open',
      tenant_id: 't1',
      phone: '+254700000002',
      name: 'Amina',
      notes: null,
      last_reason: null,
      metadata: {
        favourite_at: '2026-09-01T00:00:00.000Z',
        alternate_names: [],
      },
    });
  });

  afterEach(() => {
    if (prevFlag === undefined) delete process.env.VOICE_CONTACT_NAME_LOCK;
    else process.env.VOICE_CONTACT_NAME_LOCK = prevFlag;
  });

  it('flag off: unlocked contact still gains an alternate', async () => {
    const out = await db.upsertContact({
      tenantId: 't1',
      phone: '+254700000002',
      name: 'Brian',
      callId: 'call-1',
    });
    assert.equal(out.name, 'Amina');
    assert.equal(out.metadata.alternate_names[0].name, 'Brian');
    assert.equal(out.metadata.favourite_at, '2026-09-01T00:00:00.000Z');
  });

  it('flag on: locked contact keeps name, no alternate, favourite_at kept', async () => {
    process.env.VOICE_CONTACT_NAME_LOCK = 'on';
    const out = await db.upsertContact({
      tenantId: 't1',
      phone: '+254700000001',
      name: 'SomeoneElse',
      callId: 'call-2',
    });
    assert.equal(out.name, 'Alvin');
    assert.deepEqual(out.metadata.alternate_names, []);
    assert.equal(out.metadata.favourite_at, '2026-09-23T08:00:00.000Z');
    assert.ok(out.metadata.name_locked);
  });

  it('flag on: dismissed alternate is not re-added on an unlocked contact', async () => {
    process.env.VOICE_CONTACT_NAME_LOCK = 'on';
    contacts[1].metadata.alternate_names_dismissed = [
      { name: 'Brian', at: '2026-10-01T00:00:00.000Z' },
    ];
    const out = await db.upsertContact({
      tenantId: 't1',
      phone: '+254700000002',
      name: 'Brian',
      callId: 'call-3',
    });
    assert.equal(out.name, 'Amina');
    assert.deepEqual(out.metadata.alternate_names, []);
    assert.equal(out.metadata.favourite_at, '2026-09-01T00:00:00.000Z');
  });
});
