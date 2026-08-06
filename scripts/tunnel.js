#!/usr/bin/env node
/**
 * tunnel.js — expose local port 3000 for SautiKit webhook testing.
 *
 * IMPORTANT about Localtunnel + Bypass-Tunnel-Reminder:
 *   The header `Bypass-Tunnel-Reminder: true` must be sent by the *HTTP client*
 *   (the caller hitting your public URL). Our server cannot inject it into
 *   inbound SautiKit webhooks. Localtunnel's anti-phishing splash therefore
 *   still blocks many automated POSTs.
 *
 * Recommended for SautiKit: use Cloudflare Tunnel instead:
 *   npm run tunnel:cloudflared
 *   (or: npx --yes cloudflared tunnel --url http://localhost:3000)
 *
 * Usage:
 *   node tunnel.js
 *   PORT=3000 SUBDOMAIN=my-sautikit-hook node tunnel.js
 */

const localtunnel = require('localtunnel');

const PORT = Number(process.env.PORT || 3000);
const SUBDOMAIN = process.env.SUBDOMAIN || undefined;

async function main() {
  console.log(`\n⏳ Opening Localtunnel to http://127.0.0.1:${PORT} …`);
  if (SUBDOMAIN) console.log(`   requested subdomain: ${SUBDOMAIN}`);

  const tunnel = await localtunnel({
    port: PORT,
    local_host: '127.0.0.1',
    subdomain: SUBDOMAIN,
    // allow_invalid_cert is unused for local http targets
  });

  const publicUrl = tunnel.url.replace(/\/$/, '');
  const voiceWebhook = `${publicUrl}/voice/incoming`;
  const mediaWs = publicUrl.replace(/^https/i, 'wss') + '/ws/media';

  console.log('\n✅ Localtunnel is up');
  console.log(`   Public URL:     ${publicUrl}`);
  console.log(`   Voice webhook:  ${voiceWebhook}`);
  console.log(`   Media WSS:      ${mediaWs}`);
  console.log(`
⚠️  Localtunnel shows an anti-phishing interstitial for many clients.
   SautiKit will NOT send Bypass-Tunnel-Reminder, so webhooks often never
   reach node server.js. Prefer Cloudflare Tunnel for Phase 2:

     npm run tunnel:cloudflared

   Or use Cursor Ports (see docs/WEBHOOK_TUNNEL.md).
`);

  tunnel.on('close', () => {
    console.log('Localtunnel closed');
    process.exit(0);
  });

  tunnel.on('error', (err) => {
    console.error('Localtunnel error:', err?.message || err);
  });

  const shutdown = () => {
    try {
      tunnel.close();
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Failed to start Localtunnel:', err?.message || err);
  console.error('Fall back to: npm run tunnel:cloudflared');
  process.exit(1);
});
