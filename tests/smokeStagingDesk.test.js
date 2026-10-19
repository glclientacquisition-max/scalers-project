'use strict';
// The staging smoke must not pass on Desk error boundaries (they return 200).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DASH = path.join(__dirname, '..', 'dashboard');
const load = () => import(path.join(DASH, 'scripts', 'smoke-staging-desk.mjs'));

test('every Desk "Could not load …" boundary is detected', async () => {
  const { errorBoundaryText } = await load();
  const files = ['src/app/(desk)/error.tsx', 'src/app/(desk)/settings/error.tsx'].map((f) => path.join(DASH, f));
  for (const f of files) {
    const msg = fs.readFileSync(f, 'utf8').match(/Could not load [^"<]*\./)[0];
    assert.equal(errorBoundaryText(`<main><p>${msg}</p></main>`), msg, f);
  }
  assert.equal(errorBoundaryText('<p>Application error: a server-side exception has occurred</p>') !== null, true);
  assert.equal(errorBoundaryText('<h1>Overview</h1><p>Your line is open.</p>'), null);
});

test('auth cookie matches @supabase/ssr naming and chunking', async () => {
  const { supabaseAuthCookies } = await load();
  const small = supabaseAuthCookies('https://abcdref.supabase.co', { access_token: 'a', refresh_token: 'r' });
  assert.equal(small.length, 1);
  assert.match(small[0], /^sb-abcdref-auth-token=base64-/);
  const big = supabaseAuthCookies('https://abcdref.supabase.co', { access_token: 'x'.repeat(5000) });
  assert.ok(big.length > 1 && big.every((c, i) => c.startsWith(`sb-abcdref-auth-token.${i}=`)));
  const joined = big.map((c) => c.split('=').slice(1).join('=')).join('');
  assert.equal(JSON.parse(Buffer.from(joined.replace(/^base64-/, ''), 'base64url')).access_token.length, 5000);
});

test('signed-out in-body redirect counts as a login bounce', async () => {
  const { loginRedirectInBody } = await load();
  assert.equal(loginRedirectInBody('self.__next_f.push([1,"NEXT_REDIRECT;replace;/login;307;"])'), true);
  assert.equal(loginRedirectInBody('<a href="/login">Sign in</a>'), false);
});
