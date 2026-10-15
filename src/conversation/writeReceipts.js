'use strict';
// Write receipts: one idempotency key per (call, kind, item) write, and the
// rescue callback a successful booking supersedes. Mirrors BA v2's typed
// receipts (src/conversation/v2/machine.js commit(): one receipt per write)
// so v1 and v2 share the same key and the same supersede rule.
//
// Staging HD_4ec204aafa93 (2026-10-14): a "day but no time" create was
// rejected, Brain's rescue saved callback 3349098f, then the visit booked as
// appointment a59fc8d8 and the callback stayed open beside it.
//
// Off by default: WRITE_RECEIPTS=1 (optional WRITE_RECEIPTS_TENANTS=id1,id2).
// Needs supabase/migrations/20261014210000_write_receipts.sql applied first.

const ON = /^(1|true|on|yes)$/i;

function writeReceiptsEnabled({ env = process.env, tenantId } = {}) {
  if (!ON.test(String(env.WRITE_RECEIPTS || ''))) return false;
  const allow = String(env.WRITE_RECEIPTS_TENANTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (allow.length && !allow.includes(String(tenantId || ''))) return false;
  return true;
}

function normItem(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

/** Stable key for one logical write on one call. Null when there is no call. */
function writeKey({ callId, kind, item } = {}) {
  const id = String(callId || '').trim();
  const k = String(kind || '').trim().toLowerCase();
  if (!id || !k) return null;
  return `call:${id}:${k}:${normItem(item) || '-'}`;
}

/** Does an open rescue callback describe the visit that just booked? */
function callbackSupersededBy(callback = {}, appointment = {}) {
  if (!callback || String(callback.request_type || '').toLowerCase() !== 'callback') return false;
  if (String(callback.status || 'open').toLowerCase() !== 'open') return false;
  if (callback.call_id && appointment.call_id && callback.call_id !== appointment.call_id) return false;
  const a = normItem(callback.item);
  const b = normItem(appointment.service_name);
  if (!a || a === 'visit' || a === 'message') return a === 'visit';
  return a === b || a.includes(b) || b.includes(a);
}

module.exports = { writeReceiptsEnabled, writeKey, normItem, callbackSupersededBy };
