// Social / web handles for live ground truth.

function emptyHandles() {
  return {
    website: '',
    instagram: '',
    facebook: '',
    tiktok: '',
    twitter: '',
    youtube: '',
    whatsapp: '',
    other: '',
  };
}

function normalizeSocialHandles(raw) {
  const base = emptyHandles();
  if (!raw) return base;
  let obj = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return base;
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return base;
  for (const key of Object.keys(base)) {
    base[key] = String(obj[key] || '').trim();
  }
  return base;
}

function socialHandlesHaveContent(h) {
  return Object.values(h || {}).some((v) => String(v || '').trim());
}

function formatSocialHandlesBlock(h) {
  const labels = {
    website: 'Website',
    instagram: 'Instagram',
    facebook: 'Facebook',
    tiktok: 'TikTok',
    twitter: 'X (Twitter)',
    youtube: 'YouTube',
    whatsapp: 'WhatsApp',
    other: 'Other',
  };
  const lines = [];
  for (const [key, label] of Object.entries(labels)) {
    const v = String(h?.[key] || '').trim();
    if (v) lines.push(`- ${label}: ${v}`);
  }
  return lines.length ? lines.join('\n') : '(none listed)';
}

module.exports = {
  emptyHandles,
  normalizeSocialHandles,
  socialHandlesHaveContent,
  formatSocialHandlesBlock,
};
