// Social / web / phone channels for live ground truth.

const KIND_LABELS = {
  phone: 'Phone',
  whatsapp: 'WhatsApp',
  website: 'Website',
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  twitter: 'X (Twitter)',
  youtube: 'YouTube',
  email: 'Email',
  other: 'Other',
};

const KIND_SET = new Set(Object.keys(KIND_LABELS));
const CHANNELS_MAX = 24;

function normalizeKind(raw) {
  const k = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
  if (k === 'x' || k === 'twitterx') return 'twitter';
  if (k === 'ig') return 'instagram';
  if (k === 'web' || k === 'url' || k === 'site') return 'website';
  if (k === 'wa' || k === 'whatsappbusiness') return 'whatsapp';
  if (k === 'tel' || k === 'mobile' || k === 'call') return 'phone';
  if (KIND_SET.has(k)) return k;
  return 'other';
}

function kindLabel(kind) {
  return KIND_LABELS[kind] || 'Other';
}

function splitMulti(raw) {
  return String(raw || '')
    .split(/[\n,;|]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function pushChannel(channels, kind, value, label = '') {
  const v = String(value || '').trim();
  if (!v) return;
  const k = normalizeKind(kind);
  if (
    channels.some(
      (c) => c.kind === k && c.value.toLowerCase() === v.toLowerCase()
    )
  ) {
    return;
  }
  channels.push({
    kind: k,
    label: String(label || '').trim() || kindLabel(k),
    value: v,
  });
}

function emptyHandles() {
  return { channels: [] };
}

function normalizeSocialHandles(raw) {
  const channels = [];
  if (!raw) return { channels };

  let obj = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      pushChannel(channels, 'other', raw);
      return { channels };
    }
  }

  if (Array.isArray(obj)) {
    for (const row of obj) {
      if (!row || typeof row !== 'object') continue;
      pushChannel(
        channels,
        row.kind || row.platform || row.type || 'other',
        row.value || row.handle || row.url || row.number || row.phone || '',
        row.label || row.name || ''
      );
    }
    return { channels: channels.slice(0, CHANNELS_MAX) };
  }

  if (!obj || typeof obj !== 'object') return { channels };

  if (Array.isArray(obj.channels)) {
    for (const row of obj.channels) {
      if (!row || typeof row !== 'object') continue;
      pushChannel(
        channels,
        row.kind || row.platform || 'other',
        row.value || row.handle || row.url || row.number || '',
        row.label || ''
      );
    }
  }

  if (Array.isArray(obj.phones)) {
    for (const row of obj.phones) {
      if (typeof row === 'string') {
        pushChannel(channels, 'phone', row, 'Main');
        continue;
      }
      if (!row || typeof row !== 'object') continue;
      const num = String(row.number || row.value || row.phone || '').trim();
      const label = String(row.label || row.name || 'Main');
      pushChannel(
        channels,
        row.whatsapp || row.is_whatsapp ? 'whatsapp' : 'phone',
        num,
        label
      );
    }
  }

  for (const key of [
    'website',
    'instagram',
    'facebook',
    'tiktok',
    'twitter',
    'youtube',
    'whatsapp',
    'phone',
    'email',
    'other',
  ]) {
    const val = obj[key];
    if (val == null) continue;
    if (Array.isArray(val)) {
      for (const item of val) pushChannel(channels, key, String(item));
      continue;
    }
    for (const part of splitMulti(String(val))) {
      pushChannel(channels, key, part);
    }
  }

  if (obj.ig) {
    for (const part of splitMulti(String(obj.ig))) {
      pushChannel(channels, 'instagram', part);
    }
  }
  if (obj.x || obj.X) {
    for (const part of splitMulti(String(obj.x || obj.X))) {
      pushChannel(channels, 'twitter', part);
    }
  }

  return { channels: channels.slice(0, CHANNELS_MAX) };
}

function socialHandlesHaveContent(h) {
  return Boolean(
    h &&
      Array.isArray(h.channels) &&
      h.channels.some((c) => String(c?.value || '').trim())
  );
}

function formatSocialHandlesBlock(h) {
  const channels = normalizeSocialHandles(h).channels.filter((c) =>
    String(c.value || '').trim()
  );
  if (!channels.length) return '(none listed)';

  const phones = channels.filter(
    (c) => c.kind === 'phone' || c.kind === 'whatsapp'
  );
  const socials = channels.filter(
    (c) => c.kind !== 'phone' && c.kind !== 'whatsapp'
  );
  const lines = [];
  if (phones.length) {
    lines.push('Phones / WhatsApp:');
    for (const c of phones) {
      const kind = c.kind === 'whatsapp' ? 'WhatsApp' : 'Phone';
      const label = c.label && c.label !== kind ? ` (${c.label})` : '';
      lines.push(`- ${kind}${label}: ${c.value}`);
    }
  }
  if (socials.length) {
    if (lines.length) lines.push('');
    lines.push('Social & web:');
    for (const c of socials) {
      const kind = kindLabel(c.kind);
      const label = c.label && c.label !== kind ? ` (${c.label})` : '';
      lines.push(`- ${kind}${label}: ${c.value}`);
    }
  }
  return lines.join('\n');
}

module.exports = {
  emptyHandles,
  normalizeSocialHandles,
  socialHandlesHaveContent,
  formatSocialHandlesBlock,
};
