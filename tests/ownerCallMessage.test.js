// Run: node --test tests/ownerCallMessage.test.js
// One owner message per call, after the call. Replays the two calls that
// showed "duplicate" alerts on 2026-10-09:
//   staging HD_b82fbfef7649 (20:12 EAT): lead at turn 2 + VISIT UPDATED, 2 inbox recipients
//   prod    HD_d3900cbf2b2d (20:18 EAT): lead + ENQUIRY, same pattern
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  ANSWERED_LEAD_TITLE,
  MISSED_LEAD_TITLE,
  buildOwnerCallMessage,
  callWasAnswered,
  clearOwnerCallItems,
  mergeOwnerCallItems,
  noteOwnerCallItem,
  ownerMessageAtEndEnabled,
  ownerSummaryKeyBase,
  pendingOwnerCallItems,
} = require('../src/notifications/ownerCallMessage');
const {
  beginInstanceSend,
  buildLedgerRow,
  idempotencyKey,
  recordDispatchResult,
  releaseInstanceFlight,
  resetInstanceFlights,
} = require('../src/notifications/sendLedger');

const B82F_CALL = {
  id: '7b0c2f8e-b82f-4e24-a484-a80a3504e2c3',
  tenant_id: 'df4ad9d8-tenant',
  call_sid: 'HD_b82fbfef7649',
  from_number: '+254700000001',
  name: 'Alvin',
  reason: 'Asked about a plumbing visit',
  status: 'complete',
  summary: JSON.stringify({ first_forward: { greeting_played: true } }),
};

// Earlier visit (from another call) updated on this call. The live row's
// caller name was the junk "like"; name-quality rules for that word land
// separately, so here the row carries no usable name and the call's is used.
const B82F_VISIT = {
  id: 'appt-1',
  service_name: 'Plumbing',
  when_text: 'Tomorrow 10am',
  address_landmark: 'line',
  caller_name: '...',
  caller_phone: '+254700000001',
  status: 'requested',
};

const ARIS_CALL = {
  id: '32fb7b9d-aris',
  tenant_id: 'aris-tenant',
  call_sid: 'HD_d3900cbf2b2d',
  from_number: '+254700000002',
  name: 'Peter',
  reason: 'Asked if a phone is in stock',
  status: 'complete',
  summary: JSON.stringify({ first_forward: { greeting_played: true } }),
};

const ARIS_ENQUIRY = {
  id: 'req-1',
  request_type: 'enquiry',
  item: 'Phone case',
  caller_name: 'Peter',
  caller_phone: '+254700000002',
};

describe('owner message at end of call', () => {
  beforeEach(() => {
    clearOwnerCallItems(B82F_CALL.call_sid);
    clearOwnerCallItems(ARIS_CALL.call_sid);
    resetInstanceFlights();
  });

  it('is on by default and off only when asked', () => {
    assert.equal(ownerMessageAtEndEnabled({}), true);
    assert.equal(ownerMessageAtEndEnabled({ VOICE_OWNER_MESSAGE_AT_END: 'on' }), true);
    assert.equal(ownerMessageAtEndEnabled({ VOICE_OWNER_MESSAGE_AT_END: 'off' }), false);
    assert.equal(ownerMessageAtEndEnabled({ VOICE_OWNER_MESSAGE_AT_END: 'false' }), false);
  });

  it('b82f: lead + visit update becomes one VISIT UPDATED message, caller name from the call', () => {
    noteOwnerCallItem(B82F_CALL.call_sid, { type: 'visit', kind: 'updated', row: B82F_VISIT });
    const msg = buildOwnerCallMessage({
      call: B82F_CALL,
      items: pendingOwnerCallItems(B82F_CALL.call_sid),
      businessName: 'Done and Dusted',
      callUrl: 'https://desk.example/calls/1',
    });
    assert.equal(msg.kind, 'appointment');
    assert.match(msg.subject, /^VISIT UPDATED\. Done and Dusted$/);
    assert.match(msg.body, /Caller: Alvin/);
    assert.doesNotMatch(msg.body, /Caller: like/);
    assert.doesNotMatch(msg.body, /missed-call/i);
    assert.equal((msg.body.match(/Open call:/g) || []).length, 1);
  });

  it('aris: lead + enquiry becomes one ENQUIRY message, no lead', () => {
    noteOwnerCallItem(ARIS_CALL.call_sid, { type: 'request', row: ARIS_ENQUIRY });
    const msg = buildOwnerCallMessage({
      call: ARIS_CALL,
      items: pendingOwnerCallItems(ARIS_CALL.call_sid),
      businessName: 'Aris Kenya',
    });
    assert.equal(msg.kind, 'service_request');
    assert.doesNotMatch(msg.body, /missed-call/i);
    assert.match(msg.body, /Item: Phone case/);
  });

  it('answered lead-only call says "New call lead", unanswered says missed-call', () => {
    const answered = buildOwnerCallMessage({ call: B82F_CALL, items: [], businessName: 'X' });
    assert.equal(answered.kind, 'lead');
    assert.equal(answered.title, ANSWERED_LEAD_TITLE);
    assert.match(answered.body, /^New call lead\. X/);
    const missed = buildOwnerCallMessage({
      call: { ...B82F_CALL, summary: null },
      items: [],
      businessName: 'X',
    });
    assert.equal(missed.title, MISSED_LEAD_TITLE);
    assert.equal(missed.answered, false);
  });

  it('sends nothing for a call with no name/reason and no visit or request', () => {
    const msg = buildOwnerCallMessage({
      call: { ...B82F_CALL, name: null, reason: null },
      items: [],
    });
    assert.equal(msg, null);
  });

  it('keeps one entry per visit; created then updated in the same call stays created', () => {
    noteOwnerCallItem('HD_x', { type: 'visit', kind: 'created', row: { id: 'a', service_name: 'S' } });
    noteOwnerCallItem('HD_x', {
      type: 'visit',
      kind: 'updated',
      row: { id: 'a', service_name: 'S', when_text: 'Friday' },
    });
    const items = pendingOwnerCallItems('HD_x');
    assert.equal(items.length, 1);
    assert.equal(items[0].kind, 'created');
    assert.equal(items[0].row.when_text, 'Friday');
    clearOwnerCallItems('HD_x');
  });

  it('merges DB rows for this call with in-memory updates, memory wins', () => {
    const merged = mergeOwnerCallItems(
      [{ type: 'visit', kind: 'created', row: { id: 'a', when_text: 'old' }, at: 1 }],
      [
        { type: 'visit', kind: 'created', row: { id: 'a', when_text: 'new' }, at: 2 },
        { type: 'visit', kind: 'updated', row: { id: 'b' }, at: 3 },
      ]
    );
    assert.equal(merged.length, 2);
    assert.equal(merged.find((i) => i.row.id === 'a').row.when_text, 'new');
  });

  it('answered falls back to agent turns and first_forward', () => {
    assert.equal(callWasAnswered({}, { agentTurns: 2 }), true);
    assert.equal(callWasAnswered({ summary: '{"first_forward":{"greeting_played":true}}' }), true);
    assert.equal(callWasAnswered({ summary: '{}' }), false);
    assert.equal(callWasAnswered({ summary: '{}' }, { answered: true }), true);
  });
});

describe('summary ledger key (handoff spec #632)', () => {
  it('follows handoff:<call_id>:summary:<channel>:<recipient>, kind-free', () => {
    const base = ownerSummaryKeyBase(B82F_CALL.id, B82F_CALL.call_sid);
    assert.equal(base, `handoff:${B82F_CALL.id}:summary`);
    const lead = idempotencyKey({
      tenantId: 't',
      callSid: B82F_CALL.call_sid,
      kind: 'lead',
      channel: 'email',
      to: 'Owner@Example.com',
      keyBase: base,
    });
    const visit = idempotencyKey({
      tenantId: 't',
      callSid: B82F_CALL.call_sid,
      kind: 'appointment',
      channel: 'email',
      to: 'owner@example.com',
      keyBase: base,
    });
    assert.equal(lead, `handoff:${B82F_CALL.id}:summary:email:owner@example.com`);
    assert.equal(lead, visit);
    const row = buildLedgerRow({
      tenantId: 't',
      callSid: 'HD_1',
      kind: 'appointment',
      channel: 'sms',
      to: '+254711000000',
      body: 'x',
      keyBase: base,
    });
    assert.equal(row.idempotency_key, `${base}:sms:254711000000`);
    assert.equal(row.kind, 'appointment');
  });

  it('legacy keys are unchanged without a key base', () => {
    assert.equal(
      idempotencyKey({ tenantId: 't', callSid: 'HD_1', kind: 'lead', channel: 'email', to: 'a@b.c' }),
      'call:t:HD_1:lead:email:a@b.c'
    );
  });
});

function stubDb(exports) {
  const dbPath = require.resolve('../src/db');
  const prev = require.cache[dbPath];
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports };
  return () => {
    if (prev) require.cache[dbPath] = prev;
    else delete require.cache[dbPath];
  };
}

describe('two senders, one message per recipient', () => {
  it('a second sender for the same call and recipient is refused, even with a different kind', async () => {
    resetInstanceFlights();
    const rows = new Map(); // emulates unique (tenant_id, idempotency_key)
    const restore = stubDb({
      findNotifySend: async ({ tenantId, idempotencyKey: key }) =>
        rows.get(`${tenantId}|${key}`) || null,
      insertNotifySend: async (row) => {
        const k = `${row.tenant_id}|${row.idempotency_key}`;
        if (rows.has(k)) return { ok: false, reason: 'duplicate' };
        rows.set(k, { id: `n${rows.size + 1}` });
        return { ok: true };
      },
    });
    try {
      const keyBase = ownerSummaryKeyBase(B82F_CALL.id);
      const recipients = ['yegon@example.com', 'owner@example.com'];
      const senders = [
        { tenantId: 't', callSid: B82F_CALL.call_sid, callId: B82F_CALL.id, kind: 'lead', keyBase },
        { tenantId: 't', callSid: B82F_CALL.call_sid, callId: B82F_CALL.id, kind: 'appointment', keyBase },
      ];
      let accepted = 0;
      for (const ledger of senders) {
        for (const to of recipients) {
          const gate = await beginInstanceSend(ledger, [to]);
          if (!gate.ok) continue;
          await recordDispatchResult(ledger, { channel: 'email', to }, 'body');
          releaseInstanceFlight(gate.key);
          accepted += 1;
        }
      }
      assert.equal(accepted, 2, 'one message per recipient for the call');
      assert.equal(rows.size, 2);
      // The DB refuses a racing insert with the same key.
      const dup = await recordDispatchResult(senders[1], { channel: 'email', to: recipients[0] }, 'b');
      assert.equal(dup.reason, 'duplicate');
    } finally {
      restore();
      resetInstanceFlights();
    }
  });
});

describe('server wiring', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  it('sends the owner message from the shared terminal path', () => {
    const fn = src.slice(src.indexOf('async function markCallTerminalFromWebhook'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    assert.match(body, /sendOwnerCallMessage\(callSid, \{ terminal: true/);
  });

  it('never sends an owner lead mid-call when the flag is on', () => {
    const fn = src.slice(src.indexOf('async function maybeSendWhatsAppNotification'));
    const head = fn.slice(0, 400);
    assert.match(head, /ownerMessageAtEndEnabled\(\)/);
    assert.match(head, /opts\.midCall === true\) return;/);
  });

  it('visit and request tools note the item instead of texting the owner', () => {
    for (const name of ['maybeSendAppointmentNotification', 'maybeSendServiceRequestNotification']) {
      const fn = src.slice(src.indexOf(`async function ${name}`));
      const body = fn.slice(0, fn.indexOf('\n}\n'));
      assert.match(body, /noteOwnerCallItem\(/, name);
      assert.match(body, /if \(!ownerAtEnd\) \{/, name);
    }
  });
});

describe('one terminal close per call (prod HD_d3900cbf2b2d: webhook Completed + socket close)', () => {
  const { ownerNotifiedMeta, ownerNotifyChannels } = require('../src/notifications/ownerCallMessage');
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const dbSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'db.js'), 'utf8');

  it('only the update that leaves a live status is the terminal transition', () => {
    assert.match(dbSrc, /TERMINAL_CLAIM_FILTER = 'status\.is\.null,status\.not\.in\.\(complete,completed,failed,no_answer\)'/);
    assert.match(dbSrc, /if \(claimsTerminal\) \{\n\s+query = query\.or\(TERMINAL_CLAIM_FILTER\);/);
    assert.match(dbSrc, /shaped\.terminal_transition = terminalTransition;/);
  });

  it('the second close skips resolution, review, first-forward and the owner message', () => {
    const fn = src.slice(src.indexOf('async function markCallTerminalFromWebhook'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    const guard = body.indexOf("updated.terminal_transition !== true");
    assert.ok(guard > 0);
    assert.ok(guard < body.indexOf('persistCallResolution('));
    assert.ok(guard < body.indexOf('persistFirstForwardAcceptance('));
    assert.ok(guard < body.indexOf('sendOwnerCallMessage('));
  });

  it('owner_notified is the dedupe marker; whatsapp only when WhatsApp landed', () => {
    assert.equal(ownerNotifiedMeta({ summary: '{"owner_notified":true}' }), true);
    assert.equal(ownerNotifiedMeta({ summary: '{"whatsapp_sent":true}' }), true);
    assert.equal(ownerNotifiedMeta({ summary: '{}' }), false);
    // HD_d3900: SMS 402, WhatsApp 502, email accepted.
    const ch = ownerNotifyChannels(
      [{ channel: 'email', errors: ['sms:402 insufficient credits', 'whatsapp:502'] }],
      []
    );
    assert.deepEqual(ch, { sms: 'failed', whatsapp: 'failed', email: 'sent' });
  });
});
