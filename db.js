// db.js
// SQLite for phase 1. Swap for Postgres later by replacing this module —
// keep the same function signatures (upsertCall, saveCallerInfo,
// attachRecording, getCall) so the rest of the app doesn't need to change.

const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'db', 'calls.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS calls (
    call_sid TEXT PRIMARY KEY,
    from_number TEXT,
    to_number TEXT,
    name TEXT,
    reason TEXT,
    transcript TEXT,
    recording_url TEXT,
    recording_sid TEXT,
    status TEXT DEFAULT 'in_progress',
    whatsapp_sent INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

// Lightweight migration for anyone upgrading an existing calls.db that
// predates the whatsapp_sent column.
const existingColumns = db.prepare(`PRAGMA table_info(calls)`).all().map((c) => c.name);
if (!existingColumns.includes('whatsapp_sent')) {
  db.exec(`ALTER TABLE calls ADD COLUMN whatsapp_sent INTEGER DEFAULT 0;`);
}

function upsertCall({ callSid, fromNumber, toNumber }) {
  db.prepare(`
    INSERT INTO calls (call_sid, from_number, to_number)
    VALUES (@callSid, @fromNumber, @toNumber)
    ON CONFLICT(call_sid) DO UPDATE SET
      from_number = excluded.from_number,
      to_number = excluded.to_number,
      updated_at = datetime('now')
  `).run({ callSid, fromNumber, toNumber });
}

function saveCallerInfo({ callSid, name, reason }) {
  db.prepare(`
    UPDATE calls
    SET name = @name, reason = @reason, updated_at = datetime('now')
    WHERE call_sid = @callSid
  `).run({ callSid, name, reason });
}

function appendTranscript({ callSid, transcript }) {
  db.prepare(`
    UPDATE calls
    SET transcript = @transcript, updated_at = datetime('now')
    WHERE call_sid = @callSid
  `).run({ callSid, transcript });
}

function attachRecording({ callSid, recordingUrl, recordingSid }) {
  db.prepare(`
    UPDATE calls
    SET recording_url = @recordingUrl,
        recording_sid = @recordingSid,
        status = 'complete',
        updated_at = datetime('now')
    WHERE call_sid = @callSid
  `).run({ callSid, recordingUrl, recordingSid });
}

function getCall(callSid) {
  return db.prepare(`SELECT * FROM calls WHERE call_sid = ?`).get(callSid);
}

function markWhatsappSent(callSid) {
  const result = db.prepare(`
    UPDATE calls
    SET whatsapp_sent = 1, updated_at = datetime('now')
    WHERE call_sid = @callSid AND whatsapp_sent = 0
  `).run({ callSid });
  return result.changes === 1;
}

module.exports = {
  upsertCall,
  saveCallerInfo,
  appendTranscript,
  attachRecording,
  getCall,
  markWhatsappSent,
};
