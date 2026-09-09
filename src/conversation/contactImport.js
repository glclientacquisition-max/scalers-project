const { normalizeKenyaE164 } = require('./liveTransferReady');
const { mergeContactIdentity } = require('./contactIdentity');

const CONTACT_CSV_MAX_ROWS = 500;

/** Same contract as src/db.js normalizeStoredPhone. */
function normalizeStoredPhone(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  return normalizeKenyaE164(trimmed) || trimmed;
}

/**
 * Kenyan E.164 only. Unparseable numbers are errors (unlike live call writes
 * that keep a trimmed fallback).
 */
function parseDialableContactPhone(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return { ok: false, error: 'Phone is required.' };
  const stored = normalizeStoredPhone(trimmed);
  const e164 = normalizeKenyaE164(trimmed);
  if (!stored || !e164 || stored !== e164) {
    return { ok: false, error: 'Phone is not a Kenyan number.' };
  }
  return { ok: true, phone: e164 };
}

function trimField(raw) {
  const value = String(raw || '').trim();
  return value || null;
}

function buildNewContactIdentity(name) {
  return mergeContactIdentity(null, { name: trimField(name) });
}

function parseCsvRecords(text) {
  const src = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    const next = src[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      continue;
    }
    if (ch === '\r') continue;
    field += ch;
  }
  if (inQuotes) {
    return { ok: false, error: 'CSV has an unclosed quote.' };
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  while (rows.length && rows[rows.length - 1].every((cell) => !String(cell || '').trim())) {
    rows.pop();
  }
  return { ok: true, rows };
}

function headerIndex(cells) {
  const map = {};
  cells.forEach((cell, i) => {
    map[String(cell || '').trim().toLowerCase()] = i;
  });
  return map;
}

function parseContactCsv(text) {
  const parsed = parseCsvRecords(text);
  if (!parsed.ok) return parsed;
  if (!parsed.rows.length) {
    return { ok: false, error: 'CSV is empty. Include a header row: name,phone,notes.' };
  }
  const header = headerIndex(parsed.rows[0]);
  if (!('name' in header) || !('phone' in header) || !('notes' in header)) {
    return {
      ok: false,
      error: 'Header row must include name, phone, and notes.',
    };
  }
  const data = parsed.rows.slice(1);
  if (data.length > CONTACT_CSV_MAX_ROWS) {
    return {
      ok: false,
      error: `CSV has ${data.length} data rows. Max is ${CONTACT_CSV_MAX_ROWS}.`,
    };
  }
  const records = data.map((cells, i) => ({
    rowNumber: i + 2,
    name: trimField(cells[header.name]),
    phone: trimField(cells[header.phone]),
    notes: trimField(cells[header.notes]),
  }));
  return { ok: true, records };
}

function planContactCsv(text, existingByPhone = {}) {
  const parsed = parseContactCsv(text);
  if (!parsed.ok) return parsed;

  const create = [];
  const skipped = [];
  const rejected = [];
  const seen = new Map();

  for (const rec of parsed.records) {
    const phoneResult = parseDialableContactPhone(rec.phone);
    if (!phoneResult.ok) {
      rejected.push({
        rowNumber: rec.rowNumber,
        phone: rec.phone,
        name: rec.name,
        reason: phoneResult.error,
      });
      continue;
    }
    const phone = phoneResult.phone;
    if (seen.has(phone)) {
      skipped.push({
        rowNumber: rec.rowNumber,
        phone,
        name: rec.name,
        reason: 'Duplicate phone in this file',
        existingId: null,
      });
      continue;
    }
    seen.set(phone, rec.rowNumber);
    const existingId = existingByPhone[phone] || null;
    if (existingId) {
      skipped.push({
        rowNumber: rec.rowNumber,
        phone,
        name: rec.name,
        reason: 'Already exists',
        existingId,
      });
      continue;
    }
    const identity = buildNewContactIdentity(rec.name);
    create.push({
      rowNumber: rec.rowNumber,
      phone,
      name: identity.name,
      notes: rec.notes,
      metadata: identity.metadata,
    });
  }

  return {
    ok: true,
    create,
    skipped,
    rejected,
    summary: {
      create: create.length,
      skipped: skipped.length,
      rejected: rejected.length,
    },
  };
}

function planManualContact({ name, phone, notes, existingId } = {}) {
  const phoneResult = parseDialableContactPhone(phone);
  if (!phoneResult.ok) {
    return { ok: false, error: phoneResult.error };
  }
  if (existingId) {
    return {
      ok: false,
      error: 'Already saved',
      existingId,
      phone: phoneResult.phone,
    };
  }
  const identity = buildNewContactIdentity(name);
  return {
    ok: true,
    phone: phoneResult.phone,
    name: identity.name,
    notes: trimField(notes),
    metadata: identity.metadata,
  };
}

function isContactPickerAvailable(globalObj) {
  if (!globalObj || typeof globalObj !== 'object') return false;
  const nav = globalObj.navigator;
  return Boolean(nav && 'contacts' in nav && 'ContactsManager' in globalObj);
}

function mapPickedContacts(entries) {
  const list = Array.isArray(entries) ? entries : [];
  return list.map((row) => {
    const names = Array.isArray(row?.name) ? row.name : [];
    const tels = Array.isArray(row?.tel) ? row.tel : [];
    return {
      name: trimField(names[0]),
      phone: trimField(tels[0]),
      notes: null,
    };
  });
}

module.exports = {
  CONTACT_CSV_MAX_ROWS,
  buildNewContactIdentity,
  isContactPickerAvailable,
  mapPickedContacts,
  normalizeStoredPhone,
  parseContactCsv,
  parseDialableContactPhone,
  planContactCsv,
  planManualContact,
};
