'use strict';

// Line-unavailable clips (#639) hosted the only supported way: uploaded to
// SautiKit (POST /v1/uploads/audio), which returns a presigned
// storage.sautikit.com URL valid for 7 days. Not re-signed for us (only
// number routing configs are), so a refresh job re-uploads before expiry.
//
// Packaged clips: src/speech/pcm/line-unavailable-{en,sw}.v1.wav (16 kHz mono,
// platform clone voice). The signed URL and its expiry live in
// public.voice_platform_audio (docs/supabase/voice_platform_audio.sql), never
// in files or logs. Logs show the host and expiry only.
//
// Refresh: at boot (after a short delay) and every 6 h, each clip is
// re-uploaded when it has no row, its file changed (sha256), or under 48 h
// remain. A 7-day link is therefore renewed at about day 5. Failure sends one
// platform-ops alert (kind "audio", respects VOICE_PLATFORM_OPS_DRY_RUN).
// No key, or a key without the numbers.claim scope (401/403), or no table:
// one warn log, no alert, calls keep the <Say> fallback.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_API_BASE = 'https://api.sautikit.com';
const PLAY_HOST = 'storage.sautikit.com';
const SIGNED_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RENEW_BEFORE_MS = 48 * 60 * 60 * 1000;
const MIN_LEFT_FOR_CALLS_MS = 10 * 60 * 1000;
const URL_CACHE_MS = 60 * 1000;
const UPLOAD_TIMEOUT_MS = 30 * 1000;

const CLIPS = Object.freeze({
  en: { key: 'line_unavailable_en_v1', file: 'line-unavailable-en.v1.wav', mime: 'audio/wav' },
  sw: { key: 'line_unavailable_sw_v1', file: 'line-unavailable-sw.v1.wav', mime: 'audio/wav' },
});

function clipDir() {
  return process.env.VOICE_LINE_UNAVAILABLE_CLIP_DIR || path.join(__dirname, '..', 'speech', 'pcm');
}

function clipPath(lang) {
  return path.join(clipDir(), CLIPS[lang === 'sw' ? 'sw' : 'en'].file);
}

function apiBase() {
  return String(process.env.SAUTIKIT_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, '');
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** Expiry of a SigV4 presigned URL (X-Amz-Date + X-Amz-Expires), else uploadedAt + 7 d. */
function signedUrlExpiry(url, uploadedAtMs) {
  try {
    const q = new URL(url).searchParams;
    const date = q.get('X-Amz-Date') || q.get('x-amz-date');
    const secs = Number(q.get('X-Amz-Expires') || q.get('x-amz-expires'));
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(String(date || ''));
    if (m && Number.isFinite(secs) && secs > 0) {
      return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) + secs * 1000;
    }
  } catch {
    /* fall through */
  }
  return uploadedAtMs + SIGNED_TTL_MS;
}

function errorCodeOf(json) {
  return String(json?.error?.code || json?.code || '').slice(0, 80);
}

/** Error body with anything secret-looking removed (for logs and reports). */
function redactBody(text) {
  return String(text || '')
    .replace(/https?:\/\/[^\s"']+/g, (u) => `https://${hostOf(u) || 'redacted'}/…`)
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[jwt]')
    .replace(/(Bearer\s+)[\w.-]+/gi, '$1[redacted]')
    .slice(0, 600);
}

/**
 * POST one packaged clip to SautiKit. Never logs the key or the signed URL.
 * @returns {Promise<{ ok: true, url: string, expiresAt: string, sizeBytes: number, mime: string }
 *   | { ok: false, reason: 'no_key'|'missing_scope'|'unauthorized'|'no_file'|'http'|'fetch_error'|'bad_response', status?: number, code?: string, body?: string }>}
 */
async function uploadClip(lang, { apiKey = process.env.SAUTIKIT_API_KEY, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const key = String(apiKey || '').trim();
  if (!key) return { ok: false, reason: 'no_key' };
  const clip = CLIPS[lang === 'sw' ? 'sw' : 'en'];
  let bytes;
  try {
    bytes = fs.readFileSync(clipPath(lang));
  } catch {
    return { ok: false, reason: 'no_file' };
  }
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: clip.mime }), clip.file);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPLOAD_TIMEOUT_MS);
  let status = 0;
  let text = '';
  try {
    const res = await fetchImpl(`${apiBase()}/v1/uploads/audio`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      body: form,
      signal: ctrl.signal,
    });
    status = res.status;
    text = await res.text();
  } catch (err) {
    return { ok: false, reason: 'fetch_error', body: redactBody(err?.message || err) };
  } finally {
    clearTimeout(timer);
  }
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  const code = errorCodeOf(json);
  if (status === 403 || /scope|forbidden/i.test(code)) {
    return { ok: false, reason: 'missing_scope', status, code, body: redactBody(text) };
  }
  if (status === 401) return { ok: false, reason: 'unauthorized', status, code, body: redactBody(text) };
  if (status < 200 || status >= 300) return { ok: false, reason: 'http', status, code, body: redactBody(text) };
  const url = String(json?.url || json?.data?.url || '').trim();
  if (!/^https:\/\//i.test(url) || hostOf(url) !== PLAY_HOST) {
    return { ok: false, reason: 'bad_response', status, body: `host=${hostOf(url) || 'none'}` };
  }
  const uploadedAt = now();
  return {
    ok: true,
    url,
    expiresAt: new Date(signedUrlExpiry(url, uploadedAt)).toISOString(),
    sizeBytes: Number(json?.size_bytes || bytes.length),
    mime: String(json?.mime_type || clip.mime),
  };
}

function fileSha256(lang) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(clipPath(lang))).digest('hex');
  } catch {
    return '';
  }
}

function needsUpload(row, { sha, nowMs }) {
  if (!row || !row.url || !row.expires_at) return 'missing';
  if (sha && row.file_sha256 && row.file_sha256 !== sha) return 'file_changed';
  const left = Date.parse(row.expires_at) - nowMs;
  if (!Number.isFinite(left) || left < RENEW_BEFORE_MS) return 'expiring';
  return '';
}

let quietWarned = false;
function warnOnce(log, message) {
  if (quietWarned) return;
  quietWarned = true;
  log(message);
}

function defaultDb() {
  return require('../db');
}

function defaultOps() {
  return require('../notifications/platformOpsAlert');
}

/**
 * One refresh pass over both clips.
 * @param {{ db?: object, ops?: object, apiKey?: string, fetchImpl?: Function, now?: () => number, log?: Function }} [opts]
 */
async function refreshLineUnavailableClips(opts = {}) {
  const db = opts.db || defaultDb();
  const ops = opts.ops || defaultOps();
  const now = opts.now || Date.now;
  const log = opts.log || console.warn;
  const results = {};
  let rows;
  try {
    rows = await db.getPlatformAudio(Object.values(CLIPS).map((c) => c.key));
  } catch (err) {
    warnOnce(log, `[line-unavailable] clip store unavailable (${String(err?.message || err).slice(0, 120)}) — calls use <Say>`);
    return { ok: false, reason: 'no_store' };
  }
  const failures = [];
  for (const lang of ['en', 'sw']) {
    const clip = CLIPS[lang];
    const row = (rows || []).find((r) => r && r.key === clip.key) || null;
    const sha = fileSha256(lang);
    const why = needsUpload(row, { sha, nowMs: now() });
    if (!why) {
      results[lang] = 'fresh';
      continue;
    }
    const up = await uploadClip(lang, { apiKey: opts.apiKey, fetchImpl: opts.fetchImpl, now });
    if (!up.ok) {
      if (up.reason === 'no_key' || up.reason === 'missing_scope') {
        warnOnce(
          log,
          `[line-unavailable] clip upload skipped (${up.reason}${up.status ? ` HTTP ${up.status}` : ''}${up.code ? ` ${up.code}` : ''}): SAUTIKIT_API_KEY needs the numbers.claim scope — calls use <Say>`
        );
        return { ok: false, reason: up.reason, results };
      }
      results[lang] = `failed:${up.reason}`;
      failures.push(`${lang} ${up.reason}${up.status ? ` ${up.status}` : ''}${up.code ? ` ${up.code}` : ''}`);
      try {
        await db.notePlatformAudioError({ key: clip.key, error: `${up.reason} ${up.status || ''} ${up.code || ''}`.trim() });
      } catch {
        /* ignore */
      }
      continue;
    }
    try {
      await db.upsertPlatformAudio({
        key: clip.key,
        url: up.url,
        expiresAt: up.expiresAt,
        fileSha256: sha,
        sizeBytes: up.sizeBytes,
        mimeType: up.mime,
      });
    } catch (err) {
      results[lang] = 'failed:store';
      failures.push(`${lang} store ${String(err?.message || err).slice(0, 80)}`);
      continue;
    }
    resetStoredClipCache();
    results[lang] = `uploaded:${why}`;
    log(`[line-unavailable] ${lang} clip uploaded (${why}) host=${hostOf(up.url)} expires=${up.expiresAt}`);
  }
  if (failures.length) {
    void Promise.resolve(
      ops.notePlatformOpsDegrade('audio', { channel: 'line-unavailable clips', message: `upload failed: ${failures.join('; ')}` })
    ).catch(() => {});
    return { ok: false, reason: 'upload_failed', results, failures };
  }
  try {
    ops.notePlatformOpsRecovered('audio');
  } catch {
    /* ignore */
  }
  return { ok: true, results };
}

function refreshIntervalMs() {
  const n = Number(process.env.VOICE_LINE_UNAVAILABLE_REFRESH_MS || 6 * 60 * 60 * 1000);
  return Number.isFinite(n) && n >= 60 * 1000 ? n : 6 * 60 * 60 * 1000;
}

/** Boot hook. VOICE_LINE_UNAVAILABLE_REFRESH=off disables it. */
function startLineUnavailableClipRefresh({ delayMs = 30 * 1000 } = {}) {
  if (String(process.env.VOICE_LINE_UNAVAILABLE_REFRESH || 'on').toLowerCase() === 'off') return null;
  const tick = () => {
    void refreshLineUnavailableClips().catch((err) => {
      console.warn('[line-unavailable] clip refresh error:', err?.message || err);
    });
  };
  const first = setTimeout(tick, delayMs);
  const every = setInterval(tick, refreshIntervalMs());
  if (first.unref) first.unref();
  if (every.unref) every.unref();
  return { first, every };
}

// Call time: stored URLs, cached for a minute. Expired or nearly expired
// rows are ignored (the gate then uses <Say>).
let storedCache = null;

function resetStoredClipCache() {
  storedCache = null;
}

/**
 * @param {{ db?: object, now?: () => number }} [opts]
 * @returns {Promise<{ en: string, sw: string }>}
 */
async function storedClipUrls({ db, now = Date.now } = {}) {
  const t = now();
  if (storedCache && storedCache.until > t) return storedCache.urls;
  const urls = { en: '', sw: '' };
  try {
    const rows = await (db || defaultDb()).getPlatformAudio(Object.values(CLIPS).map((c) => c.key));
    for (const lang of ['en', 'sw']) {
      const row = (rows || []).find((r) => r && r.key === CLIPS[lang].key);
      const left = row ? Date.parse(row.expires_at) - t : -1;
      if (row && row.url && Number.isFinite(left) && left > MIN_LEFT_FOR_CALLS_MS) urls[lang] = String(row.url);
    }
  } catch {
    /* <Say> */
  }
  storedCache = { urls, until: t + URL_CACHE_MS };
  return urls;
}

function resetLineUnavailableAudioForTests() {
  quietWarned = false;
  storedCache = null;
}

module.exports = {
  CLIPS,
  PLAY_HOST,
  clipPath,
  signedUrlExpiry,
  redactBody,
  uploadClip,
  needsUpload,
  refreshLineUnavailableClips,
  startLineUnavailableClipRefresh,
  storedClipUrls,
  resetStoredClipCache,
  resetLineUnavailableAudioForTests,
  RENEW_BEFORE_MS,
};
