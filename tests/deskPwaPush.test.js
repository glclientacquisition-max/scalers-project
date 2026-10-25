// Installable Desk + phone alerts (Desk lane). Run: node --experimental-strip-types --test tests/deskPwaPush.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DASH = path.join(ROOT, 'dashboard');

function loadProxy(env) {
  Object.assign(process.env, env);
  for (const k of Object.keys(require.cache)) {
    if (k.includes(`${path.sep}dashboard${path.sep}src${path.sep}`)) delete require.cache[k];
  }
  return require('../dashboard/src/lib/adminHost.ts');
}

describe('9b: /sw.js and the manifest vs proxy host rules', () => {
  const env = {
    APP_HOST: 'app.scalers.co.ke',
    NEXT_PUBLIC_SITE_URL: 'https://www.scalers.co.ke',
    ADMIN_HOST: 'admin.scalers.co.ke',
  };
  const host = loadProxy({});
  const files = ['/sw.js', '/manifest.webmanifest', '/offline', '/offline/offline.css', '/icons/maskable-512.png'];

  it('app host: no redirect (proxy falls through to NextResponse.next)', () => {
    for (const f of files) assert.equal(host.appHostRedirect('app.scalers.co.ke', f, env), null, f);
  });
  it('admin host: not allowed, so proxy sends them to the app host (admin is not installable)', () => {
    for (const f of files) assert.equal(host.isAdminHostAllowedPath(f), false, f);
  });
  it('preview / unsplit hosts: never redirected', () => {
    for (const f of files) assert.equal(host.appHostRedirect('scalers-project-git-x.vercel.app', f, {}), null);
  });
  it('/api/push is a desk path (site host forwards it to the app host)', () => {
    assert.ok(host.isDeskPath('/api/push/subscribe'));
  });
  it('proxy matcher still runs on /sw.js (only _next/static and _next/image are skipped)', () => {
    const src = fs.readFileSync(path.join(DASH, 'src/proxy.ts'), 'utf8');
    assert.match(src, /\(\?!_next\/static\|_next\/image\)/);
  });
});

describe('registration and install rules (lib/pwa.ts)', () => {
  const pwa = require('../dashboard/src/lib/pwa.ts');
  const prod = { NODE_ENV: 'production', NEXT_PUBLIC_ADMIN_HOST: 'admin.scalers.co.ke', NEXT_PUBLIC_APP_HOST: 'app.scalers.co.ke', NEXT_PUBLIC_SITE_URL: 'https://www.scalers.co.ke' };
  it('registers on the app host in production only', () => {
    assert.equal(pwa.shouldRegisterServiceWorker('app.scalers.co.ke', '/home', prod), true);
    assert.equal(pwa.shouldRegisterServiceWorker('app.scalers.co.ke', '/home', { ...prod, NODE_ENV: 'development' }), false);
    assert.equal(pwa.shouldRegisterServiceWorker('admin.scalers.co.ke', '/admin', prod), false);
    assert.equal(pwa.shouldRegisterServiceWorker('app.scalers.co.ke', '/admin/x', prod), false);
    assert.equal(pwa.shouldRegisterServiceWorker('www.scalers.co.ke', '/', prod), false);
    assert.equal(pwa.shouldRegisterServiceWorker('x.vercel.app', '/home', { NODE_ENV: 'production' }), true);
  });
  it('install card: after a call or second visit, never on admin, 30-day snooze', () => {
    const base = { pathname: '/home', platform: 'android', hasCall: false, visits: 1, snoozedUntil: 0, now: 1000, canPrompt: true };
    assert.equal(pwa.shouldShowInstallCard(base), false);
    assert.equal(pwa.shouldShowInstallCard({ ...base, visits: 2 }), true);
    assert.equal(pwa.shouldShowInstallCard({ ...base, hasCall: true }), true);
    assert.equal(pwa.shouldShowInstallCard({ ...base, hasCall: true, pathname: '/admin' }), false);
    assert.equal(pwa.shouldShowInstallCard({ ...base, hasCall: true, snoozedUntil: 5000 }), false);
    assert.equal(pwa.shouldShowInstallCard({ ...base, hasCall: true, canPrompt: false }), false);
    assert.equal(pwa.shouldShowInstallCard({ ...base, platform: 'ios', canPrompt: false, visits: 2 }), true);
    assert.equal(pwa.shouldShowInstallCard({ ...base, platform: 'installed', visits: 3 }), false);
    assert.equal(pwa.INSTALL_SNOOZE_MS, 30 * 86400000);
  });
  it('iOS push needs a home-screen install', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)';
    assert.equal(pwa.pushSupport({ platform: 'ios', ua, hasPushManager: false, hasNotification: false }), 'ios-needs-install');
    assert.equal(pwa.pushSupport({ platform: 'installed', ua, hasPushManager: true, hasNotification: true }), 'ok');
  });
});

describe('subscribe payload validation', () => {
  const { parsePushSubscription } = require('../dashboard/src/lib/pushSubscribe.ts');
  it('accepts a browser subscription and rejects junk', () => {
    const ok = parsePushSubscription({ subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'BNc_abc-123', auth: 'xyz_9' } }, platform: 'android' });
    assert.equal(ok.endpoint, 'https://fcm.googleapis.com/fcm/send/abc');
    assert.equal(parsePushSubscription({ endpoint: 'http://x', keys: { p256dh: 'a', auth: 'b' } }), null);
    assert.equal(parsePushSubscription({ endpoint: 'https://x', keys: { p256dh: 'a b', auth: 'b' } }), null);
    assert.equal(parsePushSubscription(null), null);
  });
});

describe('src/notifications/push.js', () => {
  const push = require('../src/notifications/push.js');
  const cfg = { VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:ops@scalers.co.ke' };

  function fakeDb(rows) {
    const log = [];
    const q = (op) => {
      const chain = {
        _op: op, _patch: null,
        select() { return chain; }, is() { return chain; },
        update(p) { chain._op = 'update'; chain._patch = p; return chain; },
        delete() { chain._op = 'delete'; return chain; },
        eq(k, v) {
          if (chain._op === 'select') return Promise.resolve({ data: rows, error: null }).then((r) => r);
          log.push([chain._op, v, chain._patch]);
          return Promise.resolve({ error: null });
        },
      };
      return chain;
    };
    return { log, from: () => q('select') };
  }

  it('isPushConfigured needs all three VAPID vars', () => {
    assert.equal(push.isPushConfigured(cfg), true);
    assert.equal(push.isPushConfigured({ ...cfg, VAPID_SUBJECT: '' }), false);
    assert.equal(push.isPushConfigured({}), false);
  });
  it('skips cleanly when not configured or no target', async () => {
    assert.equal((await push.sendPush({ tenantId: 't' }, { env: {} })).skipped, 'not_configured');
    assert.equal((await push.sendPush({}, { env: cfg })).skipped, 'no_target');
  });
  it('404/410 deletes; other errors bump fail_count; 5th failure disables', async () => {
    const rows = [
      { id: 'ok', provider: 'webpush', endpoint: 'e1', fail_count: 2 },
      { id: 'gone', provider: 'webpush', endpoint: 'e2', fail_count: 0 },
      { id: 'flaky', provider: 'webpush', endpoint: 'e3', fail_count: 1 },
      { id: 'dying', provider: 'webpush', endpoint: 'e4', fail_count: 4 },
    ];
    const db = fakeDb(rows);
    const sent = [];
    const provider = {
      name: 'webpush',
      async send(row, payload) {
        sent.push(JSON.parse(payload));
        if (row.id === 'gone') throw Object.assign(new Error('gone'), { statusCode: 410 });
        if (row.id === 'flaky' || row.id === 'dying') throw Object.assign(new Error('x'), { statusCode: 500 });
      },
    };
    const r = await push.sendPush(
      { tenantId: 't1', title: 'Missed call', body: 'Jane called', url: '/calls/abc', tag: 'call-abc' },
      { env: cfg, db, providers: { webpush: provider } }
    );
    assert.deepEqual({ ...r }, { sent: 1, failed: 2, removed: 1, disabled: 1, skipped: null });
    assert.equal(sent[0].url, '/calls/abc');
    assert.equal(sent[0].tag, 'call-abc');
    assert.ok(db.log.some(([op, id]) => op === 'delete' && id === 'gone'));
    assert.ok(db.log.some(([op, id, p]) => op === 'update' && id === 'flaky' && p.fail_count === 2 && !p.disabled_at));
    assert.ok(db.log.some(([op, id, p]) => op === 'update' && id === 'dying' && p.fail_count === 5 && p.disabled_at));
    assert.ok(db.log.some(([op, id, p]) => op === 'update' && id === 'ok' && p.fail_count === 0 && p.last_ok_at));
  });
  it('payload stays under 2 KB and only allows same-site paths', () => {
    const p = JSON.parse(push.buildPayload({ title: 't', body: 'x'.repeat(5000), url: 'https://evil.example' }));
    assert.equal(p.url, '/home');
    assert.ok(Buffer.byteLength(JSON.stringify(p)) <= 2048);
  });
  it('is not wired into dispatch (Voice/Brain own that hook)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/notifications/dispatch.js'), 'utf8');
    assert.doesNotMatch(src, /require\(['"]\.\/push['"]\)/);
  });
});

describe('service worker and manifest', () => {
  const sw = fs.readFileSync(path.join(DASH, 'public/sw.js'), 'utf8');
  it('precaches only /offline + CSS, never caches api/admin/pay, has kill switch + push handlers', () => {
    assert.match(sw, /const PRECACHE = \[OFFLINE_URL, "\/offline\/offline\.css", "\/icons\/icon-192\.png"\]/);
    assert.match(sw, /\^\\\/api/);
    assert.match(sw, /\^\\\/admin/);
    assert.match(sw, /\^\\\/pay/);
    assert.doesNotMatch(sw, /cache\.put\(/);
    assert.match(sw, /const SW_KILL = false/);
    assert.match(sw, /addEventListener\("push"/);
    assert.match(sw, /addEventListener\("notificationclick"/);
  });
  it('precache is under 150 KB (CSS on disk; HTML checked in the runbook)', () => {
    const css = fs.statSync(path.join(DASH, 'public/offline/offline.css')).size;
    assert.ok(css < 150 * 1024);
  });
  it('next.config serves /sw.js no-cache with Service-Worker-Allowed /', () => {
    const cfg = fs.readFileSync(path.join(DASH, 'next.config.ts'), 'utf8');
    assert.match(cfg, /source: "\/sw\.js"[\s\S]*?"no-cache"[\s\S]*?"Service-Worker-Allowed", value: "\/"/);
  });
  it('9c: no Content-Security-Policy header in next.config or vercel.json', () => {
    for (const f of ['next.config.ts', 'vercel.json', 'src/proxy.ts']) {
      const src = fs.readFileSync(path.join(DASH, f), 'utf8');
      assert.doesNotMatch(src, /Content-Security-Policy/i, f);
    }
  });
  it('manifest has the four icons, maskable included', () => {
    const src = fs.readFileSync(path.join(DASH, 'src/app/manifest.ts'), 'utf8');
    assert.equal((src.match(/purpose: "maskable"/g) || []).length, 2);
    assert.match(src, /start_url: "\/home\?source=pwa"/);
    for (const n of ['icon-192', 'icon-512', 'maskable-192', 'maskable-512', 'apple-180']) {
      assert.ok(fs.existsSync(path.join(DASH, `public/icons/${n}.png`)), n);
    }
  });
});

/** First pixel of a PNG (top-left). Any filter on row 0 leaves pixel 0 raw. */
function pngCorner(file) {
  const zlib = require('zlib');
  const buf = fs.readFileSync(file);
  assert.equal(buf.readUInt8(25), 6, `${file} is RGBA`);
  const idat = [];
  for (let o = 8; o < buf.length; ) {
    const len = buf.readUInt32BE(o);
    if (buf.toString('latin1', o + 4, o + 8) === 'IDAT') idat.push(buf.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  return [...raw.subarray(1, 5)];
}

describe('app icon and splash (v2)', () => {
  const icons = path.join(DASH, 'public/icons');
  it('any and apple icons are the transparent mark', () => {
    for (const n of ['icon-192', 'icon-512', 'apple-180']) {
      assert.equal(pngCorner(path.join(icons, `${n}.png`))[3], 0, `${n} corner is transparent`);
    }
  });
  it('maskable icons sit on the light Desk canvas, never blue', () => {
    for (const n of ['maskable-192', 'maskable-512']) {
      assert.deepEqual(pngCorner(path.join(icons, `${n}.png`)), [0xf4, 0xf7, 0xfb, 255], n);
    }
  });
  it('manifest splash and theme colours are the light canvas', () => {
    const src = fs.readFileSync(path.join(DASH, 'src/app/manifest.ts'), 'utf8');
    assert.match(src, /theme_color: DESK_THEME_COLOR_LIGHT/);
    assert.match(src, /background_color: DESK_THEME_COLOR_LIGHT/);
    assert.doesNotMatch(src, /#0096FF/i);
  });
  it('no competing black apple-touch icon from the app directory', () => {
    assert.ok(!fs.existsSync(path.join(DASH, 'src/app/apple-icon.png')));
  });
});

describe('push_subscriptions SQL (file only)', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'docs/supabase/push_subscriptions.sql'), 'utf8');
  it('has provider default webpush, unique endpoint and own-row RLS', () => {
    assert.match(sql, /provider text not null default 'webpush'/);
    assert.match(sql, /endpoint text not null unique/);
    assert.match(sql, /enable row level security/);
    for (const op of ['select', 'insert', 'update', 'delete']) assert.match(sql, new RegExp(`for ${op} to authenticated`));
    assert.ok(fs.existsSync(path.join(ROOT, 'docs/supabase/push_subscriptions_down.sql')));
  });
});
