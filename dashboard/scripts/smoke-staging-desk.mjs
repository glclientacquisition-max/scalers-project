#!/usr/bin/env node
// Staging Desk smoke: fetch signed-in pages and FAIL on error-boundary text.
// Desk error boundaries answer HTTP 200 ("Could not load Settings."), so a
// status-only check passes a broken deploy (staging dpl_6Quwj7p5…, 2026-10-19).
//
//   node scripts/smoke-staging-desk.mjs [--base URL] [--session FILE] [--require-auth] [paths…]
//   node scripts/smoke-staging-desk.mjs --redeem-link 'https://<ref>.supabase.co/auth/v1/verify?…' --session FILE
//
// --session FILE: Supabase session JSON (access_token, refresh_token, expires_in…),
//   e.g. from --redeem-link with a magic link sent to the QA owner. Sent as the
//   @supabase/ssr auth cookie, so pages render as that member.
// --require-auth: exit 1 when no session is given or a page bounces to /login.
// Env: SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL (cookie name), optional
//   SUPABASE_ANON_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY (to attach the user to the session).
import fs from "node:fs";

export const ERROR_BOUNDARY_PATTERNS = [
  /Could not load [^<]{0,60}\./,
  /Application error: a (?:server|client)-side exception has occurred/,
  /Internal Server Error/,
  /This page couldn(?:'|&#x27;|’)t load/,
];

/** First error-boundary marker in rendered HTML, or null. */
export function errorBoundaryText(html) {
  for (const re of ERROR_BOUNDARY_PATTERNS) {
    const m = String(html || "").match(re);
    if (m) return m[0];
  }
  return null;
}

/** @supabase/ssr cookies for a session (base64- value, chunked like the library). */
export function supabaseAuthCookies(supabaseUrl, session) {
  const ref = new URL(supabaseUrl).hostname.split(".")[0];
  const name = `sb-${ref}-auth-token`;
  const value = `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
  const CHUNK = 3180;
  if (value.length <= CHUNK) return [`${name}=${value}`];
  const out = [];
  for (let i = 0; i * CHUNK < value.length; i++) out.push(`${name}.${i}=${value.slice(i * CHUNK, (i + 1) * CHUNK)}`);
  return out;
}

const DEFAULT_PATHS = ["/home", "/settings", "/settings?tab=assistant-say", "/calls", "/contacts", "/wallet"];

function parseArgs(argv) {
  const o = { base: "https://scalers-staging.vercel.app", session: null, requireAuth: false, redeem: null, paths: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base") o.base = argv[++i];
    else if (a === "--session") o.session = argv[++i];
    else if (a === "--require-auth") o.requireAuth = true;
    else if (a === "--redeem-link") o.redeem = argv[++i];
    else o.paths.push(a);
  }
  if (!o.paths.length) o.paths = DEFAULT_PATHS;
  return o;
}

async function redeemLink(link, file) {
  const res = await fetch(link, { redirect: "manual" });
  const loc = res.headers.get("location") || "";
  const frag = new URLSearchParams(new URL(loc, link).hash.replace(/^#/, ""));
  if (!frag.get("access_token")) throw new Error(`link not redeemed: ${frag.get("error_description") || res.status}`);
  const session = Object.fromEntries(frag);
  session.expires_in = Number(session.expires_in);
  session.expires_at = Number(session.expires_at) || Math.floor(Date.now() / 1000) + session.expires_in;
  fs.writeFileSync(file, JSON.stringify(session), { mode: 0o600 });
  console.log(`session saved to ${file} (expires in ${session.expires_in}s)`);
}

async function attachUser(supabaseUrl, session) {
  const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (session.user || !key) return session;
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: key, authorization: `Bearer ${session.access_token}` } });
  if (res.ok) session.user = await res.json();
  return session;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.redeem) {
    if (!o.session) throw new Error("--redeem-link needs --session FILE");
    return redeemLink(o.redeem, o.session);
  }
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  let cookie = "";
  if (o.session) {
    if (!supabaseUrl) throw new Error("set SUPABASE_URL to build the auth cookie");
    const session = await attachUser(supabaseUrl, JSON.parse(fs.readFileSync(o.session, "utf8")));
    cookie = supabaseAuthCookies(supabaseUrl, session).join("; ");
  } else {
    console.log("UNAUTHENTICATED: no --session; signed-in pages will bounce to /login and are NOT exercised.");
  }
  let failed = 0;
  for (const p of o.paths) {
    const url = new URL(p, o.base);
    const res = await fetch(url, { headers: cookie ? { cookie } : {}, redirect: "follow" });
    const html = await res.text();
    const finalPath = new URL(res.url).pathname;
    const boundary = errorBoundaryText(html);
    const bounced = finalPath.startsWith("/login") && !p.startsWith("/login");
    let verdict = "ok";
    if (res.status >= 500) verdict = `FAIL http ${res.status}`;
    else if (boundary) verdict = `FAIL error boundary: "${boundary}"`;
    else if (bounced && (cookie || o.requireAuth)) verdict = "FAIL redirected to /login (not signed in)";
    else if (bounced) verdict = "skipped (login)";
    if (verdict.startsWith("FAIL")) failed++;
    console.log(`${String(res.status).padEnd(4)} ${p.padEnd(32)} -> ${finalPath.padEnd(10)} ${String(html.length).padStart(7)}B  ${verdict}`);
  }
  if (!cookie && o.requireAuth) {
    console.log("FAIL --require-auth without --session");
    failed++;
  }
  console.log(failed ? `smoke FAILED (${failed})` : "smoke ok");
  process.exitCode = failed ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
  });
}
