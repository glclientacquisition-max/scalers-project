#!/usr/bin/env node
// Subscribe the phone-vendor wallet.low_balance webhook and set its threshold.
//
// DRY RUN BY DEFAULT: prints the two planned requests and exits. Nothing is
// sent unless you pass --apply AND set WALLET_WEBHOOK_SETUP_CONFIRM=yes.
// Needs Alvin's GO and a key with webhook + wallet write scope. The key is read
// from SAUTIKIT_API_KEY in the environment and is never printed.
//
// Usage:
//   node scripts/setup-wallet-low-balance-webhook.js \
//     --url https://<voice-host>/voice/events --threshold-kes 500
//   # after the GO, against one environment at a time:
//   WALLET_WEBHOOK_SETUP_CONFIRM=yes railway run ... -- \
//     node scripts/setup-wallet-low-balance-webhook.js --url ... --apply
//
// Options:
//   --url <https url>        webhook target (Voice /voice/events). Required.
//   --threshold-kes <n>      vendor threshold in KES (default 500 = our top threshold)
//   --threshold-method <m>   PATCH (docs example, default) or PUT (one guide uses PUT)
//   --skip-threshold         only subscribe the webhook
//   --skip-subscribe         only set the threshold
//   --apply                  actually send (also needs WALLET_WEBHOOK_SETUP_CONFIRM=yes)

const DEFAULT_API_BASE = 'https://api.sautikit.com';

function parseArgs(argv) {
  const out = { thresholdKes: 500, thresholdMethod: 'PATCH', apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--url') out.url = argv[++i];
    else if (a === '--threshold-kes') out.thresholdKes = Number(argv[++i]);
    else if (a === '--threshold-method') out.thresholdMethod = String(argv[++i] || '').toUpperCase();
    else if (a === '--skip-threshold') out.skipThreshold = true;
    else if (a === '--skip-subscribe') out.skipSubscribe = true;
    else if (a === '--apply') out.apply = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error(`unknown option ${a}`);
  }
  return out;
}

function planRequests(opts, env = process.env) {
  const base = String(env.SAUTIKIT_API_BASE || DEFAULT_API_BASE).replace(/\/$/, '');
  const reqs = [];
  if (!opts.skipSubscribe) {
    if (!/^https:\/\//.test(String(opts.url || ''))) throw new Error('--url must be an https URL');
    reqs.push({
      label: 'subscribe webhook',
      method: 'POST',
      url: `${base}/v1/webhooks`,
      body: { url: opts.url, events: ['wallet.low_balance'] },
    });
  }
  if (!opts.skipThreshold) {
    if (!Number.isFinite(opts.thresholdKes) || opts.thresholdKes <= 0) {
      throw new Error('--threshold-kes must be a positive number');
    }
    if (!['PATCH', 'PUT'].includes(opts.thresholdMethod)) {
      throw new Error('--threshold-method must be PATCH or PUT');
    }
    reqs.push({
      label: 'set wallet threshold',
      method: opts.thresholdMethod,
      url: `${base}/v1/wallet/threshold`,
      body: { threshold_minor: Math.round(opts.thresholdKes * 100) },
    });
  }
  return reqs;
}

/** Drop anything secret-looking from a vendor response before printing. */
function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = /secret|token|key|signature/i.test(k) ? '[redacted]' : redact(v);
  }
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(require('fs').readFileSync(__filename, 'utf8').split('\n').slice(1, 23).join('\n'));
    return;
  }
  const reqs = planRequests(opts);
  for (const r of reqs) {
    console.log(`[plan] ${r.label}: ${r.method} ${r.url} ${JSON.stringify(r.body)}`);
  }
  const confirmed = process.env.WALLET_WEBHOOK_SETUP_CONFIRM === 'yes';
  if (!opts.apply || !confirmed) {
    console.log('[dry-run] nothing sent. Needs --apply and WALLET_WEBHOOK_SETUP_CONFIRM=yes (after the GO).');
    return;
  }
  const apiKey = String(process.env.SAUTIKIT_API_KEY || '').trim();
  if (!apiKey) throw new Error('SAUTIKIT_API_KEY is not set');
  for (const r of reqs) {
    const res = await fetch(r.url, {
      method: r.method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(r.body),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    console.log(
      `[apply] ${r.label}: HTTP ${res.status} ${json ? JSON.stringify(redact(json)) : '(non-JSON body omitted)'}`
    );
    if (!res.ok) {
      console.log('[apply] stopping at first failure. A 403 usually means the key lacks the scope.');
      process.exitCode = 1;
      return;
    }
  }
  console.log(
    '[apply] done. If the subscribe response included a signing secret, store it as the Voice webhook secret ' +
      'in the service variables by hand. Do not paste it into chat or logs.'
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[setup] ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, planRequests, redact };
