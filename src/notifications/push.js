// Phone alerts (web push). Desk lane helper; NOT wired into dispatch.js yet.
// Voice/Brain own the dispatchAlert hook: see docs/reference/platform/DESK_PWA_PUSH.md ("Hook spec").
//
// sendPush({ tenantId | userId, title, body, url, tag }) sends to every live device row in
// public.push_subscriptions (docs/supabase/push_subscriptions.sql) through a PushProvider.
// Provider 'webpush' now (web-push package + VAPID); 'fcm'/'apns' can be added for a native wrapper.
// A 404/410 from the push service deletes the row. Other failures bump fail_count; at 5 the row
// is disabled (disabled_at set). Never throws: returns { sent, failed, removed, disabled, skipped }.
//
// Env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto: or https:). The browser uses
// NEXT_PUBLIC_VAPID_PUBLIC_KEY (same public key).

const MAX_FAILS = 5;

/** Live env read (named explicitly so docs/reference/env.md lists them). */
function vapidEnv() {
  return {
    VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: process.env.VAPID_SUBJECT,
  };
}
const MAX_PAYLOAD_BYTES = 2048;

function isPushConfigured(env = vapidEnv()) {
  return Boolean(
    String(env.VAPID_PUBLIC_KEY || '').trim() &&
      String(env.VAPID_PRIVATE_KEY || '').trim() &&
      /^(mailto:|https:)/.test(String(env.VAPID_SUBJECT || '').trim())
  );
}

/** @typedef {{ name: string, send(row: object, payload: string): Promise<void> }} PushProvider */

/** Web push provider. Throws errors carrying statusCode like web-push does. */
function createWebPushProvider(env = vapidEnv(), webpush = require('web-push')) {
  webpush.setVapidDetails(
    String(env.VAPID_SUBJECT).trim(),
    String(env.VAPID_PUBLIC_KEY).trim(),
    String(env.VAPID_PRIVATE_KEY).trim()
  );
  return {
    name: 'webpush',
    async send(row, payload) {
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        payload,
        { TTL: 60 * 60, urgency: 'high' }
      );
    },
  };
}

/** Builds the JSON payload the service worker reads. Trims body to stay under 2 KB. */
function buildPayload({ title, body, url, tag }) {
  const safeUrl = typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') ? url : '/home';
  const out = {
    title: String(title || 'Scalers').slice(0, 80),
    body: String(body || ''),
    url: safeUrl,
    tag: tag ? String(tag).slice(0, 64) : undefined,
  };
  let json = JSON.stringify(out);
  while (Buffer.byteLength(json) > MAX_PAYLOAD_BYTES && out.body.length > 0) {
    out.body = out.body.slice(0, Math.max(0, out.body.length - 100));
    json = JSON.stringify(out);
  }
  return json;
}

function defaultDb() {
  const { createClient } = require('@supabase/supabase-js');
  const url = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '').replace(/\/rest\/v1$/i, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function sendPush(
  { tenantId, userId, title, body, url, tag } = {},
  { env = vapidEnv(), db, providers } = {}
) {
  const result = { sent: 0, failed: 0, removed: 0, disabled: 0, skipped: null };
  if (!tenantId && !userId) return { ...result, skipped: 'no_target' };
  if (!isPushConfigured(env) && !providers) return { ...result, skipped: 'not_configured' };
  const client = db || defaultDb();
  if (!client) return { ...result, skipped: 'no_db' };

  let q = client
    .from('push_subscriptions')
    .select('id, provider, endpoint, p256dh, auth, fail_count')
    .is('disabled_at', null);
  q = userId ? q.eq('user_id', userId) : q.eq('tenant_id', tenantId);
  const { data: rows, error } = await q;
  if (error) return { ...result, skipped: 'db_error' };
  if (!rows || rows.length === 0) return { ...result, skipped: 'no_devices' };

  const byName = providers || { webpush: createWebPushProvider(env) };
  const payload = buildPayload({ title, body, url, tag });

  await Promise.all(
    rows.map(async (row) => {
      const provider = byName[row.provider || 'webpush'];
      if (!provider) {
        result.failed += 1;
        return;
      }
      try {
        await provider.send(row, payload);
        result.sent += 1;
        await client
          .from('push_subscriptions')
          .update({ last_ok_at: new Date().toISOString(), fail_count: 0 })
          .eq('id', row.id);
      } catch (err) {
        const code = Number(err && err.statusCode);
        if (code === 404 || code === 410) {
          result.removed += 1;
          await client.from('push_subscriptions').delete().eq('id', row.id);
          return;
        }
        result.failed += 1;
        const fails = Number(row.fail_count || 0) + 1;
        const patch = { fail_count: fails };
        if (fails >= MAX_FAILS) {
          patch.disabled_at = new Date().toISOString();
          result.disabled += 1;
        }
        await client.from('push_subscriptions').update(patch).eq('id', row.id);
      }
    })
  );
  return result;
}

module.exports = {
  MAX_FAILS,
  buildPayload,
  createWebPushProvider,
  isPushConfigured,
  sendPush,
};
