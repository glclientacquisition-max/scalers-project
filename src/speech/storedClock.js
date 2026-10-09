// Stored visit times for this call (minutes since midnight, EAT), so a
// Kiswahili time the model writes can be checked against the database
// before TTS (HD_d199dbbf6b79: 09:00 was spoken "saa 9 asubuhi").
// Sources: the caller file's open visits at call setup, and every
// create/update_appointment that succeeds on the call.

const { reconcileSwahiliTimes } = require('../conversation/swahiliClock');

const byCall = new Map();
const latestByCall = new Map();

function eatMinutes(value) {
  const at = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(at.getTime())) return null;
  const eat = new Date(at.getTime() + 3 * 60 * 60 * 1000);
  return eat.getUTCHours() * 60 + eat.getUTCMinutes();
}

function setFor(callSid) {
  const key = String(callSid || '');
  if (!byCall.has(key)) byCall.set(key, new Set());
  return byCall.get(key);
}

/** Open visit rows (window_start) from the caller file. */
function noteStoredAppointments(callSid, rows = []) {
  if (!callSid) return;
  const set = setFor(callSid);
  for (const row of Array.isArray(rows) ? rows : []) {
    const start = row?.window_start || row?.windowStart;
    if (!start) continue;
    const minutes = eatMinutes(start);
    if (minutes != null) set.add(minutes);
  }
}

/** Succeeded create/update_appointment results (hours.resolved). */
function noteStoredToolResults(callSid, results = []) {
  if (!callSid) return;
  for (const row of Array.isArray(results) ? results : []) {
    if (!row || row.status !== 'succeeded') continue;
    if (row.action !== 'create_appointment' && row.action !== 'update_appointment') continue;
    const resolved = row.hours?.resolved;
    if (!resolved || resolved.isNow || resolved.periodLabel) continue;
    const minutes = Number(resolved.minutesSinceMidnight);
    if (Number.isFinite(minutes)) {
      // The newest write is the time the caller is talking about.
      const set = setFor(callSid);
      set.delete(minutes);
      set.add(minutes);
      latestByCall.set(String(callSid), minutes);
    }
  }
}

function storedClockMinutes(callSid) {
  const set = byCall.get(String(callSid || ''));
  return set ? [...set] : [];
}

/** The visit time written most recently on this call, or null. */
function latestStoredClock(callSid) {
  const value = latestByCall.get(String(callSid || ''));
  return Number.isFinite(value) ? value : null;
}

function clearStoredClocks(callSid) {
  byCall.delete(String(callSid || ''));
  latestByCall.delete(String(callSid || ''));
}

/** Shilling amounts in catalogue price text ("KSh 6,000 flat", "200 per window"). */
function catalogueAmounts(profile = {}) {
  const out = new Set();
  const rows = [
    ...(Array.isArray(profile?.servicesCatalog) ? profile.servicesCatalog : []),
    ...(Array.isArray(profile?.productCatalog) ? profile.productCatalog : []),
  ];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const text = [row.price_range, row.price, row.price_text, row.notes].filter(Boolean).join(' ');
    for (const m of String(text).matchAll(/\d[\d,]*(?:\.\d{1,2})?/g)) {
      const value = Number(m[0].replace(/,/g, ''));
      if (Number.isFinite(value) && value >= 10) out.add(value);
    }
  }
  return [...out];
}

/**
 * Kiswahili text checked against stored times: a phrase that names a stored
 * time is spoken in the Kiswahili clock; one that names none is reported.
 */
function reconcileStoredSwahiliTimes(text, stored) {
  return reconcileSwahiliTimes(text, stored);
}

module.exports = {
  eatMinutes,
  noteStoredAppointments,
  noteStoredToolResults,
  storedClockMinutes,
  latestStoredClock,
  catalogueAmounts,
  clearStoredClocks,
  reconcileStoredSwahiliTimes,
};
