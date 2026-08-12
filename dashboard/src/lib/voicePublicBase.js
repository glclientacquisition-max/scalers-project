/**
 * Normalize Railway / voice engine public base URL.
 * Accepts host-only values (common Vercel paste mistake) and forces https.
 * @param {string|null|undefined} raw
 */
function normalizeVoicePublicBase(raw) {
  let base = String(raw || "").trim();
  if (!base) {
    base = "https://scalers-project-production.up.railway.app";
  }
  // Accidental "NAME=value" paste into the env field
  if (/^[A-Z0-9_]+=/i.test(base)) {
    base = base.replace(/^[A-Z0-9_]+=/i, "");
  }
  base = base.replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(base)) {
    base = `https://${base.replace(/^\/+/, "")}`;
  }
  try {
    const u = new URL(base);
    return `${u.protocol}//${u.host}`;
  } catch {
    return base;
  }
}

function getVoicePublicBase() {
  return normalizeVoicePublicBase(
    process.env.VOICE_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL
  );
}

module.exports = { normalizeVoicePublicBase, getVoicePublicBase };
