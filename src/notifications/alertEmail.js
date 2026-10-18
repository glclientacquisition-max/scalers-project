'use strict';

// Staff call-alert email (lead, call back, request, visit, voicemail,
// callback): one card, one "Open call" button, plain-text alternative.
// Table layout, inline CSS, system fonts, no images. Colours are the Desk
// MASTER tokens (dashboard/src/app/globals.css), light with a dark override.
// Billing, wallet and ops emails do not use this file.
// Callbacks only: never imply a live transfer or a confirmed booking.

const BRAND = 'Scalers Business Assistant';

// MASTER tokens (light / dark).
const T = Object.freeze({
  canvas: '#f4f7fb',
  surface: '#ffffff',
  hairline: '#dde4ee',
  ink: '#0a192f',
  ink2: '#4a5b73',
  ink3: '#5b6d85',
  accent: '#005ccc',
  accentOn: '#ffffff',
  dCanvas: '#0b1220',
  dSurface: '#121c2c',
  dHairline: '#24324a',
  dInk: '#e9eff7',
  dInk2: '#9dafc6',
  dAccent: '#3d9bff',
  dAccentOn: '#071426',
});
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function esc(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cap(text) {
  const t = String(text || '');
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

function safeUrl(url) {
  const u = String(url || '').trim();
  return /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : null;
}

function callerLabel(alert) {
  return alert.name || alert.phone || 'a caller';
}

/** '<Business>: <label> from <caller name or number>' */
function staffEmailSubject(alert) {
  const head = alert.businessName ? `${alert.businessName}: ${alert.label}` : cap(alert.label);
  return `${head} from ${callerLabel(alert)}`;
}

function staffEmailPreheader(alert) {
  if (alert.reason) return alert.reason;
  return [cap(alert.label), alert.name || alert.phone].filter(Boolean).join(', ');
}

function staffEmailText(alert) {
  const lines = [
    alert.businessName ? `${cap(alert.label)} - ${alert.businessName}` : cap(alert.label),
    '',
  ];
  if (alert.name) lines.push(alert.name);
  if (alert.phone) lines.push(alert.phone);
  if (alert.reason) lines.push('', alert.reason);
  if (alert.details.length) {
    lines.push('');
    for (const [label, value] of alert.details) lines.push(`${label}: ${value}`);
  }
  const rec = safeUrl(alert.recordingUrl);
  if (rec) lines.push('', `Recording: ${rec}`);
  const link = safeUrl(alert.link);
  if (link) lines.push('', `Open call: ${link}`);
  lines.push('', '--', BRAND);
  return lines.join('\n');
}

function detailRows(alert) {
  return alert.details
    .map(
      ([label, value]) => `
              <tr>
                <td class="ink3" style="padding:6px 12px 6px 0;width:84px;vertical-align:top;font-family:${FONT};font-size:13px;line-height:20px;color:${T.ink3};">${esc(label)}</td>
                <td class="ink" style="padding:6px 0;vertical-align:top;font-family:${FONT};font-size:15px;line-height:20px;color:${T.ink};">${esc(value)}</td>
              </tr>`
    )
    .join('');
}

function staffEmailHtml(alert) {
  const subject = staffEmailSubject(alert);
  const preheader = staffEmailPreheader(alert);
  const link = safeUrl(alert.link);
  const rec = safeUrl(alert.recordingUrl);
  const phone = alert.phone
    ? alert.tel
      ? `<a href="${esc(alert.tel)}" class="accent" style="color:${T.accent};text-decoration:none;">${esc(alert.phone)}</a>`
      : esc(alert.phone)
    : '';
  const rows = [];
  rows.push(`
          <tr>
            <td class="ink2" style="padding:0 0 4px 0;font-family:${FONT};font-size:13px;line-height:18px;color:${T.ink2};">${esc(alert.businessName || BRAND)}</td>
          </tr>
          <tr>
            <td class="ink" style="padding:0 0 16px 0;font-family:${FONT};font-size:20px;line-height:26px;font-weight:600;color:${T.ink};">${esc(cap(alert.label))}</td>
          </tr>`);
  if (alert.name || phone) {
    rows.push(`
          <tr>
            <td style="padding:0 0 16px 0;font-family:${FONT};font-size:17px;line-height:24px;">
              ${alert.name ? `<div class="ink" style="font-weight:600;color:${T.ink};">${esc(alert.name)}</div>` : ''}
              ${phone ? `<div style="color:${T.accent};">${phone}</div>` : ''}
            </td>
          </tr>`);
  }
  if (alert.reason) {
    rows.push(`
          <tr>
            <td class="ink" style="padding:0 0 16px 0;font-family:${FONT};font-size:15px;line-height:22px;color:${T.ink};">${esc(alert.reason)}</td>
          </tr>`);
  }
  if (alert.details.length) {
    rows.push(`
          <tr>
            <td class="rule" style="padding:8px 0 16px 0;border-top:1px solid ${T.hairline};">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${detailRows(alert)}
              </table>
            </td>
          </tr>`);
  }
  if (rec) {
    rows.push(`
          <tr>
            <td style="padding:0 0 16px 0;font-family:${FONT};font-size:15px;line-height:22px;">
              <a href="${esc(rec)}" class="accent" style="color:${T.accent};text-decoration:underline;">Play recording</a>
            </td>
          </tr>`);
  }
  if (link) {
    rows.push(`
          <tr>
            <td style="padding:8px 0 0 0;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td align="center" class="btn" bgcolor="${T.accent}" style="border-radius:10px;background-color:${T.accent};">
                    <a href="${esc(link)}" class="btn-a" style="display:block;padding:14px 20px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:600;color:${T.accentOn};text-decoration:none;border-radius:10px;">Open call</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`);
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(subject)}</title>
<style>
  body { margin:0; padding:0; }
  a { color:${T.accent}; }
  @media (prefers-color-scheme: dark) {
    .canvas { background-color:${T.dCanvas} !important; }
    .card { background-color:${T.dSurface} !important; border-color:${T.dHairline} !important; }
    .rule { border-color:${T.dHairline} !important; }
    .ink { color:${T.dInk} !important; }
    .ink2, .ink3 { color:${T.dInk2} !important; }
    .accent { color:${T.dAccent} !important; }
    .btn { background-color:${T.dAccent} !important; }
    .btn-a { color:${T.dAccentOn} !important; }
  }
  [data-ogsc] .canvas { background-color:${T.dCanvas} !important; }
  [data-ogsc] .card { background-color:${T.dSurface} !important; border-color:${T.dHairline} !important; }
  [data-ogsc] .ink { color:${T.dInk} !important; }
  [data-ogsc] .ink2, [data-ogsc] .ink3 { color:${T.dInk2} !important; }
  [data-ogsc] .accent { color:${T.dAccent} !important; }
</style>
</head>
<body class="canvas" style="margin:0;padding:0;background-color:${T.canvas};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${T.canvas};">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="canvas" style="background-color:${T.canvas};">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">
        <tr>
          <td class="card" style="background-color:${T.surface};border:1px solid ${T.hairline};border-radius:12px;padding:24px 20px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join('')}
            </table>
          </td>
        </tr>
        <tr>
          <td class="ink3" style="padding:16px 4px 0 4px;font-family:${FONT};font-size:12px;line-height:18px;color:${T.ink3};text-align:center;">${BRAND}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/** { subject, preheader, html, text } for a staffAlert() model, or null. */
function renderStaffAlertEmail(alert) {
  if (!alert) return null;
  return {
    subject: staffEmailSubject(alert),
    preheader: staffEmailPreheader(alert),
    html: staffEmailHtml(alert),
    text: staffEmailText(alert),
  };
}

module.exports = {
  ALERT_EMAIL_BRAND: BRAND,
  renderStaffAlertEmail,
  staffEmailSubject,
};
