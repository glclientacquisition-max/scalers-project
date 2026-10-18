/* eslint-disable @typescript-eslint/no-require-imports -- node:test loads this file with require() */
const crypto = require("node:crypto");

/**
 * Each retry is signed again. Bachs stops retrying about 80 minutes after the
 * first try, so 300 seconds of clock skew is enough. An old timestamp is rejected.
 */
const DEFAULT_MAX_SKEW_MS = 300 * 1000;

/**
 * HMAC-SHA256 of `${timestamp}.${rawBody}`, hex, compared in constant time.
 * @param {{ rawBody: string, timestamp: string, signature: string, secret: string, now?: number, maxSkewMs?: number }} input
 */
function verifyBachsSignature(input) {
  const secret = input.secret;
  const timestamp = String(input.timestamp ?? "").trim();
  const signature = String(input.signature ?? "").trim().toLowerCase();
  const rawBody = input.rawBody;
  if (!secret || !timestamp || !signature || typeof rawBody !== "string") return false;
  if (!/^[0-9]+$/.test(timestamp)) return false;
  if (!/^[0-9a-f]+$/.test(signature) || signature.length % 2 !== 0) return false;

  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum)) return false;
  const tsMs = tsNum > 1e12 ? tsNum : tsNum * 1000;
  const now = input.now ?? Date.now();
  const maxSkew = input.maxSkewMs ?? DEFAULT_MAX_SKEW_MS;
  if (Math.abs(now - tsMs) > maxSkew) return false;

  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature, "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * @param {Record<string, string | undefined>} headers
 * @returns {{ timestamp: string, signature: string }[]}
 */
function signatureCandidates(headers) {
  const lower = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (value) lower[key.toLowerCase()] = value;
  }
  const out = [];
  const v1 = lower["x-bachs-signature"];
  const ts = lower["x-bachs-timestamp"];
  if (v1 && ts) out.push({ timestamp: ts.trim(), signature: v1.trim() });

  const v2 = lower["x-bachs-signature-v2"];
  if (v2) {
    let t = ts ? ts.trim() : "";
    const sigs = [];
    for (const part of v2.split(",")) {
      const eq = part.indexOf("=");
      if (eq < 0) continue;
      const k = part.slice(0, eq).trim();
      const v = part.slice(eq + 1).trim();
      if (k === "t" && v) t = v;
      if (k === "v1" && v) sigs.push(v);
    }
    for (const signature of sigs) {
      if (t) out.push({ timestamp: t, signature });
    }
  }
  return out;
}

/**
 * @param {{ rawBody: string, headers: Record<string, string | undefined>, secret: string, now?: number, maxSkewMs?: number }} input
 */
function verifyBachsRequest(input) {
  const candidates = signatureCandidates(input.headers);
  return candidates.some((c) =>
    verifyBachsSignature({
      rawBody: input.rawBody,
      timestamp: c.timestamp,
      signature: c.signature,
      secret: input.secret,
      now: input.now,
      maxSkewMs: input.maxSkewMs,
    })
  );
}

/** @param {string} secret @param {string} rawBody @param {string | number} timestamp */
function signBachsBody(secret, rawBody, timestamp) {
  const ts = String(timestamp);
  const signature = crypto.createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
  return {
    timestamp: ts,
    signature,
    headers: {
      "x-bachs-timestamp": ts,
      "x-bachs-signature": signature,
    },
  };
}

module.exports = {
  DEFAULT_MAX_SKEW_MS,
  verifyBachsSignature,
  signatureCandidates,
  verifyBachsRequest,
  signBachsBody,
};
