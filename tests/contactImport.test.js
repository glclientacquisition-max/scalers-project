const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  isContactPickerAvailable,
  planContactCsv,
  planManualContact,
} = require('../src/conversation/contactImport');

const csv = (body) => `name,phone,notes\n${body}`;

describe('planManualContact', () => {
  it('accepts a Kenyan phone and optional name', () => {
    const next = planManualContact({
      name: 'Amina',
      phone: '0712345678',
      notes: 'VIP',
    });
    assert.equal(next.ok, true);
    assert.equal(next.phone, '+254712345678');
    assert.equal(next.name, 'Amina');
    assert.equal(next.notes, 'VIP');
    assert.deepEqual(next.metadata.alternate_names, []);
  });

  it('rejects an unparseable phone', () => {
    const next = planManualContact({ phone: 'abc' });
    assert.equal(next.ok, false);
    assert.match(next.error, /Kenyan/);
  });

  it('flags an existing tenant phone as a duplicate', () => {
    const next = planManualContact({
      phone: '+254712345678',
      existingId: 'ct-1',
    });
    assert.equal(next.ok, false);
    assert.equal(next.error, 'Already saved');
    assert.equal(next.existingId, 'ct-1');
  });
});

describe('planContactCsv', () => {
  it('plans valid rows for create', () => {
    const plan = planContactCsv(
      csv('Amina,0712345678,Hold\nBrian,+254700000001,')
    );
    assert.equal(plan.ok, true);
    assert.equal(plan.summary.create, 2);
    assert.equal(plan.create[0].phone, '+254712345678');
    assert.equal(plan.create[0].name, 'Amina');
  });

  it('rejects invalid phones with row numbers and writes nothing for them', () => {
    const plan = planContactCsv(csv('Amina,not-a-phone,x\nJane,0711111111,'));
    assert.equal(plan.ok, true);
    assert.equal(plan.rejected.length, 1);
    assert.equal(plan.rejected[0].rowNumber, 2);
    assert.equal(plan.summary.create, 1);
    assert.equal(plan.create[0].name, 'Jane');
  });

  it('skips duplicate phones within the file', () => {
    const plan = planContactCsv(
      csv('Amina,0712345678,\nOther,0712 345 678,')
    );
    assert.equal(plan.ok, true);
    assert.equal(plan.summary.create, 1);
    assert.equal(plan.skipped[0].reason, 'Duplicate phone in this file');
    assert.equal(plan.skipped[0].rowNumber, 3);
  });

  it('skips phones that already exist for the tenant', () => {
    const plan = planContactCsv(csv('Amina,0712345678,'), {
      '+254712345678': 'ct-9',
    });
    assert.equal(plan.ok, true);
    assert.equal(plan.summary.create, 0);
    assert.equal(plan.skipped[0].reason, 'Already exists');
    assert.equal(plan.skipped[0].existingId, 'ct-9');
  });

  it('rejects files over 500 data rows', () => {
    const lines = ['name,phone,notes'];
    for (let i = 0; i < 501; i += 1) {
      lines.push(`N${i},0712345678,`);
    }
    const plan = planContactCsv(lines.join('\n'));
    assert.equal(plan.ok, false);
    assert.match(plan.error, /Max is 500/);
  });

  it('requires a name,phone,notes header', () => {
    const plan = planContactCsv('foo,bar\n1,2');
    assert.equal(plan.ok, false);
    assert.match(plan.error, /Header/);
  });
});

describe('Contact Picker feature detection', () => {
  it('is true only when contacts and ContactsManager exist', () => {
    assert.equal(isContactPickerAvailable(null), false);
    assert.equal(isContactPickerAvailable({ navigator: {} }), false);
    assert.equal(
      isContactPickerAvailable({ navigator: { contacts: {} } }),
      false
    );
    assert.equal(
      isContactPickerAvailable({
        navigator: { contacts: {} },
        ContactsManager: function ContactsManager() {},
      }),
      true
    );
  });

  it('renders the picker button only when available', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../dashboard/src/components/AddContactPanel.tsx'),
      'utf8'
    );
    assert.match(src, /export function ContactPickButton/);
    assert.match(src, /if \(!available\) return null/);
    assert.match(src, /Pick from phone contacts/);
    assert.match(src, /isContactPickerAvailable\(window\)/);
  });
});
