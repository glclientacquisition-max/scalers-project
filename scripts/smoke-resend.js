#!/usr/bin/env node
// Smoke test Resend email alerts (no DB / no live call).
require('dotenv').config();

const {
  isEmailConfigured,
  sendOwnerEmail,
  buildLeadEmail,
} = require('../src/notifications/email');
const {
  dispatchAlert,
  dispatchEscalationAlert,
  emailFallbackReady,
  whatsAppSenderReady,
} = require('../src/notifications/dispatch');

async function main() {
  const to = String(process.argv[2] || process.env.OWNER_ALERT_EMAIL || '').trim();
  if (!to) {
    console.error('Usage: node scripts/smoke-resend.js <to-email>');
    process.exit(1);
  }

  console.log('emailFallbackReady:', emailFallbackReady());
  console.log('isEmailConfigured:', isEmailConfigured());
  console.log('whatsAppSenderReady:', whatsAppSenderReady());
  console.log('ALERT_EMAIL_FROM:', process.env.ALERT_EMAIL_FROM || '(missing)');
  console.log('to:', to);

  if (!isEmailConfigured()) {
    console.error('FAIL: RESEND_API_KEY + ALERT_EMAIL_FROM required');
    process.exit(1);
  }

  const lead = {
    businessName: 'Scalers Smoke Test',
    name: 'Smoke Tester',
    reason: 'Resend alert smoke test',
    callerNumber: '+254700000000',
  };

  console.log('\n1) Direct sendOwnerEmail…');
  try {
    const built = buildLeadEmail(lead);
    const result = await sendOwnerEmail({
      to,
      subject: `[SMOKE] ${built.subject}`,
      text: built.text + '\n\n(This is a Scalers Resend smoke test.)',
      lead,
    });
    console.log('OK direct:', JSON.stringify(result));
  } catch (err) {
    console.error('FAIL direct:', err.message);
    if (err.body) console.error('body:', JSON.stringify(err.body));
    process.exitCode = 1;
  }

  console.log('\n2) dispatchAlert (lead path)…');
  try {
    const result = await dispatchAlert({
      to: null, // force email fallback (skip WhatsApp dest)
      email: to,
      lead,
      subject: '[SMOKE] New call lead — Scalers Smoke Test',
    });
    console.log('OK dispatchAlert:', result.channel, result.to || '', result.reason || '');
    if (!result.channel) process.exitCode = 1;
  } catch (err) {
    console.error('FAIL dispatchAlert:', err.message);
    process.exitCode = 1;
  }

  console.log('\n3) dispatchEscalationAlert (teammate email)…');
  try {
    const sent = await dispatchEscalationAlert({
      teammatePhone: null,
      teammateEmail: to,
      ownerPhone: null,
      ownerEmail: null,
      body: [
        'Escalation for Desk (General queries) — Scalers Smoke Test',
        '',
        'Caller: Smoke Tester',
        'Phone: +254700000000',
        'Reason: Resend escalation smoke test',
        '',
        '(This is a Scalers Resend smoke test.)',
      ].join('\n'),
      lead,
      subject: '[SMOKE] Escalation for Desk — Scalers Smoke Test',
    });
    console.log(
      'OK dispatchEscalationAlert:',
      sent.map((s) => `${s.channel}:${s.role}:${s.to || ''}`).join(', ') || '(none)'
    );
    if (!sent.length) process.exitCode = 1;
  } catch (err) {
    console.error('FAIL dispatchEscalationAlert:', err.message);
    process.exitCode = 1;
  }

  if (process.exitCode) {
    console.error('\nSmoke FAILED');
  } else {
    console.log('\nSmoke PASSED — check the inbox (and spam).');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
