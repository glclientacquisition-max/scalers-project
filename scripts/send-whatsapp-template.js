#!/usr/bin/env node
/**
 * Dry-run (default) a Cloud API template send via SautiKit.
 *
 * Does not blast contacts. Requires an explicit --to.
 * Live POST only with --apply AND SAUTIKIT_API_KEY.
 *
 *   node scripts/send-whatsapp-template.js --to +2547XXXXXXXX
 *   node scripts/send-whatsapp-template.js --to +2547XXXXXXXX --template scalers_staff_alert --lang en
 *   node scripts/send-whatsapp-template.js --to +2547XXXXXXXX --apply
 *
 * Default template: scalers_staff_alert / en (first approved Utility).
 * Owner can pass another approved name if Meta used a different string.
 */

require('dotenv').config();

const { sendWhatsAppTemplate } = require('../src/notifications/whatsapp');
const {
  APPROVED_FIRST_TEMPLATE,
  APPROVED_FIRST_TEMPLATE_LANG,
} = require('../src/notifications/whatsappTemplates');

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  return process.argv[idx + 1] || null;
}

async function main() {
  const apply = process.argv.includes('--apply') && !process.argv.includes('--dry-run');
  const to = argValue('--to');
  const templateName = argValue('--template') || APPROVED_FIRST_TEMPLATE;
  const language = argValue('--lang') || APPROVED_FIRST_TEMPLATE_LANG;
  const p1 = argValue('--p1') || 'Scalers staff alert smoke.';
  const p2 = argValue('--p2') || 'Name: Test. Phone: .';
  const p3 = argValue('--p3') || 'Do not reply to this chat.';

  if (!to) {
    console.error('FAIL: pass --to E.164 (one staff phone). No default dest.');
    process.exit(2);
  }

  const result = await sendWhatsAppTemplate({
    to,
    templateName,
    language,
    parameters: [p1, p2, p3],
    dryRun: !apply,
  });

  if (!apply) {
    console.log('dry-run');
    console.log(JSON.stringify(result.payload, null, 2));
    console.log('Re-run with --apply to POST. Do not blast a list.');
    return;
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error('FAIL:', err?.reason || err?.message || err);
  process.exit(1);
});
