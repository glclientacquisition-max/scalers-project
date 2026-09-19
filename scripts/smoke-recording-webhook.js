#!/usr/bin/env node
// HTTP smoke: POST SautiKit recording envelopes at a live Voice process.
// Dummy Supabase is enough to boot. Attach may miss the row; the pass
// condition is that the handler parsed call_id + download_url and tried attach.

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const PORT = Number(process.env.SMOKE_VOICE_PORT || 3044);
const ROOT = path.join(__dirname, '..');

function fail(label, detail) {
  console.error(`✗ ${label}`);
  if (detail) console.error(detail);
  process.exit(1);
}

function postJson(pathname, body, headers = {}) {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: PORT,
        path: pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function getHealthz() {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${PORT}/healthz`, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.on('error', reject);
  });
}

async function waitForListen(child, timeoutMs = 15000) {
  const start = Date.now();
  let buf = '';
  child.stdout.on('data', (chunk) => {
    buf += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    buf += String(chunk);
  });
  while (Date.now() - start < timeoutMs) {
    if (/Server listening on port/i.test(buf) || /listening on port/i.test(buf)) {
      return buf;
    }
    try {
      const health = await getHealthz();
      if (health.status === 200) return buf + health.body;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  fail('voice boot', buf.slice(-2000) || 'timed out waiting for /healthz');
}

async function main() {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH,
      PORT: String(PORT),
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'smoke-service-role-key',
      SAUTIKIT_VALIDATE_WEBHOOKS: 'false',
      GIT_SHA: 'smoke-recording-webhook',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let logs = '';
  const collect = (chunk) => {
    logs += String(chunk);
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);

  let fileServer = null;
  const shutdown = () => {
    try {
      child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }, 300);
    try {
      fileServer?.close();
    } catch {
      /* ignore */
    }
  };
  process.on('exit', shutdown);

  try {
    await waitForListen(child);
    const health = await getHealthz();
    if (health.status !== 200) fail('/healthz', health.body);
    console.log('✓ local Voice /healthz 200');

    fileServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'audio/wav' });
      res.end('RIFF');
    });
    const filePort = await new Promise((resolve) => {
      fileServer.listen(0, '127.0.0.1', () => resolve(fileServer.address().port));
    });
    const downloadUrl = `http://127.0.0.1:${filePort}/alvin.wav`;

    const documented = await postJson('/voice/events', {
      kind: 'call.recording.ready',
      data: {
        call_id: '01900000-0000-7000-8000-000000000003',
        recording_id: '01900000-0000-7000-8000-000000000005',
        download_url: downloadUrl,
      },
    });
    if (documented.status !== 200) {
      fail('documented recording.ready', `HTTP ${documented.status} ${documented.body}`);
    }
    await new Promise((r) => setTimeout(r, 400));
    if (!/call\.recording\.ready/.test(logs)) {
      fail('documented recording.ready', `kind not logged\n${logs.slice(-1500)}`);
    }
    if (!/01900000-0000-7000-8000-000000000003/.test(logs)) {
      fail('documented recording.ready', `call_id not parsed\n${logs.slice(-1500)}`);
    }
    if (!/data\.download_url/.test(logs)) {
      fail('documented recording.ready', `download_url not in payload summary\n${logs.slice(-1500)}`);
    }
    console.log('✓ documented call.recording.ready parsed call_id and download_url');

    const guide = await postJson(
      '/voice/events',
      {
        event_kind: 'call.recording.ready',
        payload: {
          call_id: '01900000-0000-7000-8000-000000000099',
          recording_duration_seconds: 72,
        },
      },
      { 'x-sautikit-event': 'call.recording.ready' }
    );
    if (guide.status !== 200) {
      fail('guide recording.ready', `HTTP ${guide.status} ${guide.body}`);
    }
    await new Promise((r) => setTimeout(r, 400));
    if (!/01900000-0000-7000-8000-000000000099/.test(logs)) {
      fail('guide recording.ready', `payload.call_id not parsed\n${logs.slice(-1500)}`);
    }
    console.log('✓ event_kind recording.ready parsed payload.call_id');

    console.log('\nRecording webhook smoke passed.');
  } finally {
    shutdown();
    await new Promise((r) => setTimeout(r, 200));
  }
}

main().catch((err) => {
  console.error('✗ recording webhook smoke failed:', err?.message || err);
  process.exit(1);
});
