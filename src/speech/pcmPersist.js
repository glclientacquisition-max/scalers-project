// Rendered greeting / filler / outage PCM that survives restarts
// (VOICE_PCM_PERSIST=on). Stored in a private Supabase Storage bucket
// (VOICE_PCM_BUCKET, default "voice-pcm") under <kind>/<sha256(cache key)>.pcm,
// so the object name is keyed by the existing cache key. Every call is
// best-effort: errors degrade to the in-memory caches, and nothing on the call
// audio path awaits it (loads run in warmers; saves are fire-and-forget).
//
// VOICE_PCM_WARM_TENANTS=<id,id>: when set, the greeting warmer only sweeps
// those tenants (staging: the DnD tenant).

const crypto = require('crypto');

function pcmPersistOn(env = process.env) {
  return String(env.VOICE_PCM_PERSIST ?? '').trim() === 'on';
}

function bucketName(env = process.env) {
  return String(env.VOICE_PCM_BUCKET || 'voice-pcm').trim() || 'voice-pcm';
}

function warmAllowlist(env = process.env) {
  const raw = String(env.VOICE_PCM_WARM_TENANTS || '').trim();
  if (!raw) return null;
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
}

function objectPath(kind, key) {
  const k = String(kind || 'misc').replace(/[^a-z0-9_-]/gi, '') || 'misc';
  const h = crypto.createHash('sha256').update(String(key), 'utf8').digest('hex');
  return `${k}/${h}.pcm`;
}

/**
 * @param {{ client?: object|(() => object), env?: object, log?: (m: string) => void }} [opts]
 */
function createPcmStore(opts = {}) {
  const env = opts.env || process.env;
  const log = opts.log || (() => {});
  const enabled = opts.enabled != null ? Boolean(opts.enabled) : pcmPersistOn(env);
  const bucket = bucketName(env);
  let bucketEnsured = false;
  const stats = { loads: 0, hits: 0, saves: 0, errors: 0 };

  function client() {
    if (typeof opts.client === 'function') return opts.client();
    if (opts.client) return opts.client;
    return require('../lib/supabaseClient').supabase;
  }

  async function ensureBucket(sb) {
    if (bucketEnsured) return;
    bucketEnsured = true;
    try {
      const { error } = await sb.storage.createBucket(bucket, { public: false });
      if (error && !/exist/i.test(error.message || '')) log(`[pcm-persist] bucket ${bucket}: ${error.message}`);
    } catch (err) {
      log(`[pcm-persist] bucket ${bucket}: ${err?.message || err}`);
    }
  }

  /** @returns {Promise<Buffer|null>} */
  async function load(kind, key) {
    if (!enabled || !key) return null;
    stats.loads += 1;
    try {
      const { data, error } = await client().storage.from(bucket).download(objectPath(kind, key));
      if (error || !data) return null;
      const buf = Buffer.from(await data.arrayBuffer());
      if (!buf.length) return null;
      stats.hits += 1;
      return buf;
    } catch (err) {
      stats.errors += 1;
      log(`[pcm-persist] load ${kind} failed: ${err?.message || err}`);
      return null;
    }
  }

  /** Fire-and-forget; resolves true on success, never rejects. */
  async function save(kind, key, pcm) {
    if (!enabled || !key || !pcm || !pcm.length) return false;
    try {
      const sb = client();
      await ensureBucket(sb);
      const { error } = await sb.storage
        .from(bucket)
        .upload(objectPath(kind, key), Buffer.from(pcm), { contentType: 'application/octet-stream', upsert: true });
      if (error) throw new Error(error.message || String(error));
      stats.saves += 1;
      return true;
    } catch (err) {
      stats.errors += 1;
      log(`[pcm-persist] save ${kind} failed: ${err?.message || err}`);
      return false;
    }
  }

  return { enabled, bucket, load, save, stats };
}

let shared = null;
function sharedPcmStore() {
  if (!shared) shared = createPcmStore({ log: (m) => console.warn(m) });
  return shared;
}
function setSharedPcmStore(store) {
  shared = store;
}

module.exports = { pcmPersistOn, bucketName, warmAllowlist, objectPath, createPcmStore, sharedPcmStore, setSharedPcmStore };
