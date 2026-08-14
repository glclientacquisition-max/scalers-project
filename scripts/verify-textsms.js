#!/usr/bin/env node
/**
 * Verify TextSMS credentials (balance probe) and optionally send one test SMS.
 *
 * Usage:
 *   node scripts/verify-textsms.js
 *   node scripts/verify-textsms.js --to 254790381872
 *   node scripts/verify-textsms.js --to 0740442943 --send
 *
 * Requires env: TEXTSMS_API_KEY, TEXTSMS_PARTNER_ID, TEXTSMS_SHORTCODE
 */

const {
  isSmsConfigured,
  probeSmsCredentials,
  sendSms,
  getSmsStatus,
} = require('../src/notifications/sms');

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  return process.argv[idx + 1] || null;
}

async function main() {
  const to = argValue('--to');
  const doSend = process.argv.includes('--send');

  if (!isSmsConfigured()) {
    console.error('FAIL: TEXTSMS_API_KEY / TEXTSMS_PARTNER_ID / TEXTSMS_SHORTCODE missing');
    process.exit(2);
  }

  console.log('Probing TextSMS balance…');
  const probe = await probeSmsCredentials({ force: true });
  console.log(JSON.stringify(probe, null, 2));

  if (!probe.verified) {
    console.error(
      'FAIL: TextSMS credentials not verified.' +
        ' Open the portal → GET API KEY & PARTNER ID and refresh Railway env.'
    );
    process.exit(1);
  }

  console.log('OK: TextSMS credentials verified.');

  if (doSend) {
    if (!to) {
      console.error('FAIL: --send requires --to <mobile>');
      process.exit(2);
    }
    const result = await sendSms({
      to,
      body: `Scalers TextSMS verify ${new Date().toISOString()}`,
    });
    console.log('SEND OK:', JSON.stringify(result, null, 2));
  } else if (to) {
    console.log(`(pass --send to deliver a test SMS to ${to})`);
  }

  console.log('status:', getSmsStatus());
}

main().catch((err) => {
  console.error('FAIL:', err?.message || err);
  process.exit(1);
});
