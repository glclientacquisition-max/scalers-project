// src/notifications/telegram.js
// Interim owner lead alerts via Telegram Bot API.

function isTelegramConfigured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

function buildLeadTelegramText({ businessName, name, reason, callerNumber, recordingUrl }) {
  const lines = [
    `🔔 New missed-call lead${businessName ? ` — ${businessName}` : ''}`,
    ``,
    `Name: ${name || '—'}`,
    `Phone: ${callerNumber || '—'}`,
    `Reason: ${reason || '—'}`,
  ];
  if (recordingUrl) lines.push(`Recording: ${recordingUrl}`);
  return lines.join('\n');
}

/**
 * @param {object} opts
 * @param {string} [opts.text]
 * @param {object} [opts.lead]
 * @param {string|number} [opts.chatId]
 */
async function sendOwnerTelegram({ text, lead = {}, chatId } = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = chatId || process.env.TELEGRAM_CHAT_ID;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  if (!chat) throw new Error('TELEGRAM_CHAT_ID is not configured');

  const bodyText = text || buildLeadTelegramText(lead);
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chat,
      text: bodyText,
      disable_web_page_preview: true,
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) {
    const err = new Error(
      `Telegram send failed: ${res.status} ${json?.description || JSON.stringify(json).slice(0, 200)}`
    );
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

module.exports = {
  isTelegramConfigured,
  buildLeadTelegramText,
  sendOwnerTelegram,
};
