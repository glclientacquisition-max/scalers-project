'use strict';
// A4: BA v2 receipts for the `call.summary.ready` event. Built from the
// machine's own commit receipts (each one passed a read-back + caller yes via
// the confirm_token, except log_complaint) and from interest still on the
// slots or a read-back the caller never answered. Price and stock come only
// from the tenant catalogue (itemFromCatalogue); null stock is unconfirmed.
const { slot, itemFromCatalogue } = require('../callSummaryEvent');

const TYPE_OF_TOOL = {
  create_booking: 'booking',
  update_booking: 'booking',
  create_order: 'order',
  log_complaint: 'complaint',
};
// create_handoff runs the same backend escalate tool as v1. A caller asking
// for a person (kind manager) is an escalation (urgent); the ladder, address
// and payment handoffs are owner callbacks.
const HANDOFF_REASON = { manager: 'Caller asked for a person', ladder: 'Assistant could not finish the request', address: 'Address change only the owner can make', payment: 'Payment change only the owner can make' };
function handoffType(rec) {
  if (rec.kind === 'complaint') return 'complaint';
  return rec.kind === 'manager' ? 'escalation' : 'callback';
}
const whenText = (w) => (w && (w.date || w.time) ? [w.date, w.time].filter(Boolean).join(' ') : null);

function items(list, profile) {
  return (Array.isArray(list) ? list : []).map((x) => itemFromCatalogue(profile, { id: x.product_id, name: x.name, qty: x.qty }));
}

/**
 * @param {object} state  v2 machine state (createState/runTurn)
 * @param {object} profile tenant profile (servicesCatalog / productCatalog)
 */
function receiptsFromV2(state, profile = {}) {
  if (!state || state.v !== 2) return [];
  const out = [];
  let n = 0;
  const name = state.slots?.name && !(state.staffNames || []).includes(String(state.slots.name).toLowerCase()) ? state.slots.name : null;
  for (const rec of Array.isArray(state.receipts) ? state.receipts : []) {
    if (rec.tool === 'cancel_booking') continue; // a cancel is not new work for the owner summary
    const type = TYPE_OF_TOOL[rec.tool] || (rec.tool === 'create_handoff' ? handoffType(rec) : null);
    if (!type) continue;
    const rowId = rec.ok && rec.id ? String(rec.id) : null;
    // book/order/handoff commits only run on the redeemed confirm_token
    // (read-back + yes). A complaint is the caller's own report.
    const confirmed = type === 'booking' || type === 'order' ? Boolean(rowId) : Boolean(rec.ok);
    const r = { receiptId: `v2_${++n}`, type, status: confirmed ? 'confirmed' : 'unconfirmed', slots: {} };
    if (rowId) r.writtenRowId = rowId;
    if (type === 'booking') {
      r.slots.service = slot(rec.service || rec.row?.service);
      r.slots.when = slot(whenText(rec.when));
      r.slots.place = slot(rec.place || rec.row?.place);
    } else if (type === 'order') {
      r.slots.pickup = slot(whenText(rec.pickup));
      r.items = items(rec.items, profile);
    } else {
      r.slots.reason = slot(HANDOFF_REASON[rec.kind] || (type === 'complaint' ? 'Complaint' : rec.kind || type));
    }
    r.slots.name = slot(name);
    out.push(r);
  }
  // Interest that never committed: an unanswered read-back or held slots.
  const p = state.pending;
  const s = state.slots || {};
  const intent = p?.tool === 'create_order' ? 'order' : p?.tool === 'create_booking' ? 'book' : state.intent;
  if (intent === 'order' && ((p?.items && p.items.length) || (s.items && s.items.length))) {
    out.push({ receiptId: `v2_${++n}`, type: 'order', status: 'unconfirmed', slots: { pickup: slot(whenText(p?.pickup || s.when)), name: slot(name) }, items: items(p?.items || s.items, profile) });
  } else if (intent === 'book' && (p?.service || s.service)) {
    out.push({ receiptId: `v2_${++n}`, type: 'booking', status: 'unconfirmed', slots: { service: slot(p?.service || s.service), when: slot(whenText(p?.when || s.when)), place: slot(p?.place || s.place), name: slot(name) } });
  } else if (p?.tool === 'create_handoff') {
    out.push({ receiptId: `v2_${++n}`, type: p.kind === 'manager' ? 'escalation' : 'callback', status: 'unconfirmed', slots: { reason: slot(HANDOFF_REASON[p.kind] || p.reason), name: slot(name) } });
  }
  return out;
}

module.exports = { receiptsFromV2 };
