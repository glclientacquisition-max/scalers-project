#!/usr/bin/env node
/**
 * Smoke-test SautiKit WhatsApp Calling on a DID (read-only).
 *
 * Usage:
 *   node scripts/smoke-whatsapp-did.js
 *   node scripts/smoke-whatsapp-did.js --did 0709221536
 *   node scripts/smoke-whatsapp-did.js --did +254709221536
 *
 * Requires env: SAUTIKIT_API_KEY
 * On Railway staging: railway run --service "scalers staging" --environment staging node scripts/smoke-whatsapp-did.js --did 0709221536
 */

require('dotenv').config();

const { probeWhatsAppDid, normalizeKenyaDid } = require('../src/sautikit/whatsappDid');

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  return process.argv[idx + 1] || null;
}

async function main() {
  const did = argValue('--did') || process.env.SAUTIKIT_DID || '0709221536';
  if (!process.env.SAUTIKIT_API_KEY) {
    console.error('FAIL: SAUTIKIT_API_KEY missing');
    process.exit(2);
  }

  console.log(`Probing WhatsApp Calling for ${normalizeKenyaDid(did)} …`);
  const result = await probeWhatsAppDid({ did });
  console.log(JSON.stringify(result, null, 2));

  if (result.active) {
    console.log('OK: WhatsApp Calling trunk is active');
    process.exit(0);
  }

  if (result.trunkHttpStatus === 404) {
    console.error('FAIL: no WhatsApp Calling trunk on this DID (GET /whatsapp → 404)');
    process.exit(1);
  }

  console.error(`FAIL: WhatsApp Calling not active (${result.error || result.trunk?.status || result.trunkHttpStatus})`);
  process.exit(1);
}

main().catch((err) => {
  console.error('FAIL:', err?.message || err);
  process.exit(1);
});
