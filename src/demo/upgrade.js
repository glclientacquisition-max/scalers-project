'use strict';

// /ws/demo upgrade. A valid single-use demo token is consumed here.
// The concurrency slot reserved at mint is released when the socket closes.
// DEMO_ENABLED must be exactly `on`. The drachtio subprotocol is not selected.
// This file does not import a telephony client.

const { WebSocketServer } = require('ws');
const { demoEnabled, demoOpusOn, originAllowed } = require('./flags');
const { getDemoGuard, hashValue } = require('./guards');
const { getDemoLedger } = require('./meter');
const { demoTenant } = require('./profiles');
const { createDemoSession } = require('./session');

const demoWss = new WebSocketServer({
  noServer: true,
  perMessageDeflate: false,
  handleProtocols() {
    // Never select audio.drachtio.org. The widget does not need a subprotocol.
    return false;
  },
});

function rejectUpgrade(socket, status, reason) {
  const text = {
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
  }[status] || 'Error';
  const body = JSON.stringify({ reason });
  const packet = [
    `HTTP/1.1 ${status} ${text}`,
    `X-Demo-Reason: ${reason}`,
    'Content-Type: application/json; charset=utf-8',
    'Cache-Control: no-store',
    `Content-Length: ${Buffer.byteLength(body)}`,
    'Connection: close',
    '',
    body,
  ].join('\r\n');
  try { socket.write(packet); } catch { /* ignore */ }
  try { socket.destroy(); } catch { /* ignore */ }
}

function queryOf(url) {
  try {
    return new URL(url || '', 'http://localhost').searchParams;
  } catch {
    return new URLSearchParams();
  }
}

function header(req, name) {
  const headers = req.headers || {};
  const value = headers[name];
  if (value == null) return '';
  return Array.isArray(value) ? String(value[0]) : String(value);
}

function resolveCodec(raw, env) {
  const name = String(raw || '').trim().toLowerCase();
  if (!name) return demoOpusOn(env) ? 'opus' : 'pcm16';
  if (name === 'pcm16' || name === 'pcm8') return name;
  if (name === 'opus' && demoOpusOn(env)) return name;
  return null;
}

function refuseLog(log, env, claims, reason) {
  if (typeof log !== 'function') return;
  const salt = String(env.DEMO_IP_SALT || '');
  const device = claims && claims.device_id;
  const fields = { reason };
  if (claims && claims.ip_hash) fields.ip_hash = claims.ip_hash;
  if (salt && device) fields.device_hash = hashValue(salt, device);
  try { log(`demo_ws_refuse ${JSON.stringify(fields)}`); } catch { /* ignore */ }
}

function handleDemoUpgrade(req, socket, head, opts = {}) {
  const env = opts.env || process.env;
  const guard = opts.guard || getDemoGuard();
  const ledger = opts.ledger === undefined ? getDemoLedger() : opts.ledger;
  const origin = header(req, 'origin').trim();
  const query = queryOf(req.url);
  const token = String(query.get('t') || '').trim();

  // No token: stay on HTTP. A browser cannot read X-Demo-Reason, and there
  // is nothing to finish on a socket.
  if (!token) {
    rejectUpgrade(socket, demoEnabled(env) ? 401 : 404, demoEnabled(env) ? 'rejected' : 'disabled');
    return;
  }
  if (!originAllowed(origin, env)) {
    rejectUpgrade(socket, 403, 'origin');
    return;
  }
  const codec = resolveCodec(query.get('codec'), env);
  if (!codec) {
    rejectUpgrade(socket, 400, 'codec');
    return;
  }

  let verified;
  try {
    verified = guard.verify(token);
  } catch {
    rejectUpgrade(socket, 401, 'rejected');
    return;
  }
  if (!verified || !verified.ok) {
    rejectUpgrade(socket, 401, (verified && verified.reason) || 'rejected');
    return;
  }
  const claims = verified.claims || {};
  if (!demoTenant(claims.tenant)) {
    try { guard.release(claims.jti); } catch { /* ignore */ }
    rejectUpgrade(socket, 401, 'tenant');
    return;
  }

  let released = false;
  function release() {
    if (released) return;
    released = true;
    try { guard.release(claims.jti); } catch { /* ignore */ }
  }

  function openSession(ws) {
    try {
      const session = createDemoSession({
        ws,
        claims,
        codec,
        env,
        origin,
        ledger,
        log: opts.log,
        maxMs: opts.maxMs,
        idleMs: opts.idleMs,
        createStt: opts.createStt,
        createTts: opts.createTts,
        brain: opts.brain,
        loadProfile: opts.loadProfile,
        silenceGate: opts.silenceGate,
      });
      session.start().catch(() => {
        try { ws.close(1011, 'error'); } catch { /* ignore */ }
      });
    } catch {
      try { ws.close(1011, 'error'); } catch { /* ignore */ }
      release();
    }
  }

  // Token is valid. Accept the upgrade, then refuse on the socket. Browsers
  // do not expose X-Demo-Reason when the handshake fails.
  try {
    demoWss.handleUpgrade(req, socket, head, (ws) => {
      ws.on('error', () => {});
      ws.on('close', release);
      (async () => {
        let reason = null;
        if (!demoEnabled(env)) reason = 'kill';
        else {
          if (ledger && typeof ledger.ready === 'function') {
            try { await ledger.ready(); } catch { /* in-memory total still applies */ }
          }
          if (ledger && typeof ledger.blocked === 'function' && ledger.blocked()) reason = 'cap';
        }
        if (!reason) {
          openSession(ws);
          return;
        }
        refuseLog(opts.log, env, claims, reason);
        try { ws.send(JSON.stringify({ type: 'end', reason })); } catch { /* ignore */ }
        setImmediate(() => {
          try { ws.close(1000, String(reason).slice(0, 40)); } catch { /* ignore */ }
          release();
        });
      })().catch(() => {
        try { ws.close(1011, 'error'); } catch { /* ignore */ }
        release();
      });
    });
  } catch {
    release();
    try { socket.destroy(); } catch { /* ignore */ }
  }
}

module.exports = {
  handleDemoUpgrade,
  rejectUpgrade,
  resolveCodec,
};
