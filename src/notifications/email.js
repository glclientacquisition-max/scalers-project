// Owner alert emails — fallback when WhatsApp is not ready / fails.
// Provider: Resend HTTP API (no extra npm dependency).

function isEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.ALERT_EMAIL_FROM);
}

function normalizeEmail(raw) {
  const e = String(raw || '').trim().toLowerCase();
  if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return '';
  return e;
}

function buildLeadEmail({ businessName, name, reason, callerNumber, recordingUrl } = {}) {
  const subject = `New call lead${businessName ? ` — ${businessName}` : ''}`;
  const lines = [
    `New call lead${businessName ? ` — ${businessName}` : ''}`,
    ``,
    `Name: ${name || '—'}`,
    `Phone: ${callerNumber || '—'}`,
    `Reason: ${reason || '—'}`,
  ];
  if (recordingUrl) lines.push(`Recording: ${recordingUrl}`);
  return { subject, text: lines.join('\n') };
}

/**
 * @param {object} opts
 * @param {string} opts.to
 * @param {string} [opts.subject]
 * @param {string} [opts.text]
 * @param {object} [opts.lead]
 */
async function sendOwnerEmail({ to, subject, text, lead = {} } = {}) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.ALERT_EMAIL_FROM;
  if (!apiKey) throw new Error('RESEND_API_KEY is not configured');
  if (!from) throw new Error('ALERT_EMAIL_FROM is not configured');

  const dest = normalizeEmail(to);
  if (!dest) throw new Error('Alert email destination is empty');

  const built = buildLeadEmail(lead);
  const payload = {
    from,
    to: [dest],
    subject: subject || built.subject,
    text: text || built.text,
  };

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(
      `Resend email failed: ${res.status} ${json?.message || JSON.stringify(json).slice(0, 200)}`
    );
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

module.exports = {
  isEmailConfigured,
  normalizeEmail,
  buildLeadEmail,
  sendOwnerEmail,
};
