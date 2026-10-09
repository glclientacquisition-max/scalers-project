#!/usr/bin/env node
/**
 * Voice call simulator: plays a scripted caller into /ws/media and records
 * what the agent says (audio + text) with turn latency.
 *
 * Caller audio is synthesised on this machine with espeak-ng (default) or
 * piper. No provider key is used by the simulator. The target server still
 * uses its own Soniox/Gemini keys, so a run against a deployed server spends
 * that server's quota and creates a call row.
 *
 * SAFETY: the target must be localhost unless --allow-remote is passed. Do
 * not point this at staging or production without the owner's go-ahead.
 *
 *   node scripts/voice-call-simulator.js --dry-run --script tests/fixtures/voice-sim/dusted-en.json
 *   node scripts/voice-call-simulator.js --target http://localhost:3000 --incoming \
 *        --from +254700000001 --to +254711000000 --script tests/fixtures/voice-sim/dusted-en.json
 *
 * Text tap: with VOICE_SIM_TAP=on on the server, the metadata frame carries
 * simulator:true and the server sends { type:'simTap', event:'caller_turn' |
 * 'agent_text', ... } frames: what STT heard, and each agent line (text,
 * spoken, wire). Without the tap you still get agent audio and latency.
 *
 * Output (--out, default $TMPDIR/voice-sim/<callSid>/):
 *   caller.wav   what was sent (16 kHz mono S16LE)
 *   agent.wav    agent audio on the playout timeline (killAudio truncates)
 *   events.jsonl every text frame and simulator event with ms offsets
 *   summary.json turns: caller line, heard text, agent lines, first-audio ms
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RATE = 16000;
const FRAME_MS = 20;
const FRAME_BYTES = (RATE / 1000) * FRAME_MS * 2; // 640

function usage() {
  return `Usage: node scripts/voice-call-simulator.js [options]

  --script <file>       JSON { turns:[{ say, lang?, pauseMs?, bargeInAfterMs? }] }
  --say "<line>"        caller line (repeatable; used when no --script)
  --target <http url>   server base URL (default http://localhost:3000)
  --ws <ws url>         media socket URL (default <target>/ws/media)
  --incoming            POST <target>/voice/incoming first (binds tenant by --to)
  --from <e164>         caller number for --incoming   (default +254700000001)
  --to <e164>           tenant DID for --incoming
  --call-sid <id>       session id (default HD_sim_<time>)
  --tts espeak|piper    caller voice engine (default espeak)
  --piper-model <file>  piper .onnx model (with --tts piper)
  --voice <name>        espeak voice override (default en-gb / sw by lang)
  --greeting-ms <n>     max wait for the greeting to finish (default 15000)
  --quiet-ms <n>        agent silence that ends its turn (default 1200)
  --turn-timeout-ms <n> max wait for an agent reply (default 20000)
  --out <dir>           output folder
  --allow-remote        allow a non-localhost target (staging/prod: owner go-ahead only)
  --dry-run             synthesise caller audio and print the plan; no network
  --help`;
}

function parseArgs(argv) {
  const opts = { say: [], target: 'http://localhost:3000', from: '+254700000001', tts: 'espeak', greetingMs: 15000, quietMs: 1200, turnTimeoutMs: 20000 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--script': opts.script = next(); break;
      case '--say': opts.say.push(next()); break;
      case '--target': opts.target = next(); break;
      case '--ws': opts.ws = next(); break;
      case '--incoming': opts.incoming = true; break;
      case '--from': opts.from = next(); break;
      case '--to': opts.to = next(); break;
      case '--call-sid': opts.callSid = next(); break;
      case '--tts': opts.tts = next(); break;
      case '--piper-model': opts.piperModel = next(); break;
      case '--voice': opts.voice = next(); break;
      case '--greeting-ms': opts.greetingMs = Number(next()); break;
      case '--quiet-ms': opts.quietMs = Number(next()); break;
      case '--turn-timeout-ms': opts.turnTimeoutMs = Number(next()); break;
      case '--out': opts.out = next(); break;
      case '--allow-remote': opts.allowRemote = true; break;
      case '--dry-run': opts.dryRun = true; break;
      case '--help': case '-h': opts.help = true; break;
      default: throw new Error(`unknown option ${a}`);
    }
  }
  return opts;
}

function loadTurns(opts) {
  if (opts.script) {
    const doc = JSON.parse(fs.readFileSync(opts.script, 'utf8'));
    const turns = Array.isArray(doc) ? doc : doc.turns;
    if (!Array.isArray(turns) || !turns.length) throw new Error('script has no turns');
    return { turns, meta: Array.isArray(doc) ? {} : doc };
  }
  if (!opts.say.length) throw new Error('give --script or at least one --say');
  return { turns: opts.say.map((say) => ({ say })), meta: {} };
}

function isLocalHost(url) {
  const host = new URL(url).hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

// ---------------------------------------------------------------- audio

function parseWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a WAV file');
  }
  let off = 12;
  let fmt = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    let size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') {
      fmt = { channels: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    } else if (id === 'data') {
      // espeak --stdout writes 0x7fffffff sizes; clamp to what is there.
      if (size > buf.length - body) size = buf.length - body;
      if (!fmt || fmt.bits !== 16) throw new Error('need 16-bit PCM WAV');
      return { ...fmt, pcm: buf.subarray(body, body + size - (size % (2 * fmt.channels))) };
    }
    off = body + size + (size % 2);
  }
  throw new Error('WAV has no data chunk');
}

/** Mono-mix and linearly resample S16LE to 16 kHz. */
function toPcm16k({ pcm, rate, channels }) {
  const frames = pcm.length / (2 * channels);
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) {
    let sum = 0;
    for (let c = 0; c < channels; c += 1) sum += pcm.readInt16LE((i * channels + c) * 2);
    mono[i] = sum / channels;
  }
  if (rate === RATE) return floatToPcm(mono);
  const outLen = Math.floor((frames * RATE) / rate);
  const out = new Float32Array(outLen);
  const step = rate / RATE;
  for (let i = 0; i < outLen; i += 1) {
    const pos = i * step;
    const j = Math.floor(pos);
    const frac = pos - j;
    const a = mono[j] || 0;
    const b = mono[Math.min(j + 1, frames - 1)] || 0;
    out[i] = a + (b - a) * frac;
  }
  return floatToPcm(out);
}

function floatToPcm(samples) {
  const buf = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i]))), i * 2);
  }
  return buf;
}

/** ms offset of the last frame louder than the noise floor. */
function voicedEndMs(pcm, floor = 500) {
  for (let off = pcm.length - FRAME_BYTES; off >= 0; off -= FRAME_BYTES) {
    for (let i = off; i < off + FRAME_BYTES && i + 1 < pcm.length; i += 2) {
      if (Math.abs(pcm.readInt16LE(i)) > floor) return ((off + FRAME_BYTES) / 2 / RATE) * 1000;
    }
  }
  return 0;
}

function silence(ms) {
  return Buffer.alloc(Math.round((RATE * ms) / 1000) * 2);
}

function wavFile(pcm) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function synthesize(text, { tts, lang, voice, piperModel }) {
  if (tts === 'piper') {
    if (!piperModel) throw new Error('--tts piper needs --piper-model');
    const tmp = path.join(os.tmpdir(), `voice-sim-${process.pid}-${Date.now()}.wav`);
    const run = spawnSync('piper', ['--model', piperModel, '--output_file', tmp], { input: text });
    if (run.status !== 0) throw new Error(`piper failed: ${String(run.stderr || '').slice(0, 200)}`);
    const buf = fs.readFileSync(tmp);
    fs.unlinkSync(tmp);
    return toPcm16k(parseWav(buf));
  }
  const v = voice || (String(lang || 'en').startsWith('sw') ? 'sw' : 'en-gb');
  const run = spawnSync('espeak-ng', ['-v', v, '-s', '155', '--stdout', text], { maxBuffer: 64 * 1024 * 1024 });
  if (run.error) throw new Error(`espeak-ng not available: ${run.error.message}`);
  if (run.status !== 0) throw new Error(`espeak-ng failed: ${String(run.stderr || '').slice(0, 200)}`);
  return toPcm16k(parseWav(run.stdout));
}

// ---------------------------------------------------------------- call

async function postIncoming(opts, callSid) {
  const url = new URL('/voice/incoming', opts.target).toString();
  const body = {
    sessionId: callSid,
    callerNumber: opts.from,
    destinationNumber: opts.to,
    direction: 'inbound',
    isActive: 1,
    callSessionState: 'Ringing',
    simulator: true,
  };
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`/voice/incoming ${res.status}: ${text.slice(0, 200)}`);
  const m = text.match(/<Stream[^>]*\surl="([^"]+)"/);
  return m ? m[1].replace(/&amp;/g, '&') : null;
}

function runCall({ wsUrl, callSid, turns, opts, outDir }) {
  const WebSocket = require('ws');
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const at = () => Date.now() - t0;
    const events = [];
    const log = (event, fields = {}) => events.push({ ms: at(), event, ...fields });
    const callerChunks = [];
    const agentTimeline = []; // { startMs, pcm }
    let playoutEnd = 0; // ms on the call clock when queued agent audio finishes
    let lastAgentAudio = -Infinity;
    const summary = [];
    let current = null; // the turn being measured
    let queue = []; // caller audio frames waiting to be sent
    let closed = false;

    const ws = new WebSocket(wsUrl, ['audio.drachtio.org'], { perMessageDeflate: false });

    const agentSpeaking = () => at() < playoutEnd;

    ws.on('open', () => {
      log('ws_open', { url: wsUrl.replace(/\?.*/, '') });
      ws.send(JSON.stringify({ callSid, sessionId: callSid, from: opts.from, to: opts.to || null, sampleRate: RATE, simulator: true }));
      startPacer();
      script().catch((err) => finish(err));
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        const pcm = Buffer.from(data);
        const now = at();
        const start = Math.max(now, playoutEnd);
        agentTimeline.push({ startMs: start, pcm });
        playoutEnd = start + (pcm.length / 2 / RATE) * 1000;
        lastAgentAudio = now;
        // Latency = first agent audio after the caller's last voiced frame.
        if (current && current.firstAudioMs == null && current.speechEndMs != null && now >= current.speechEndMs) {
          current.firstAudioMs = now - current.speechEndMs;
        }
        return;
      }
      let frame;
      try { frame = JSON.parse(String(data)); } catch { log('text_raw', { text: String(data).slice(0, 200) }); return; }
      log('frame', { frame });
      if (frame.type === 'killAudio') {
        // Drop audio that had not played yet.
        const now = at();
        for (const row of agentTimeline) {
          const endMs = row.startMs + (row.pcm.length / 2 / RATE) * 1000;
          if (endMs > now) {
            const keep = Math.max(0, Math.floor(((now - row.startMs) / 1000) * RATE)) * 2;
            row.pcm = row.pcm.subarray(0, keep);
          }
        }
        playoutEnd = Math.min(playoutEnd, now);
      }
      if (frame.type === 'simTap' && current) {
        if (frame.event === 'caller_turn') current.heard.push(frame.text);
        if (frame.event === 'agent_text') current.agent.push({ path: frame.path, text: frame.text, spoken: frame.spoken, wire: frame.wire });
      }
      if (frame.type === 'end') log('agent_end');
    });

    ws.on('close', (code) => { log('ws_close', { code }); finish(); });
    ws.on('error', (err) => finish(err));

    let pacer = null;
    function startPacer() {
      // Real-time 20 ms frames; silence when the caller is not talking so the
      // server's STT keeps endpointing like a live line.
      let sent = 0;
      const begin = Date.now();
      pacer = setInterval(() => {
        const due = Math.floor((Date.now() - begin) / FRAME_MS);
        while (sent < due && ws.readyState === WebSocket.OPEN) {
          const frame = queue.length ? queue.shift() : silence(FRAME_MS);
          ws.send(frame, { binary: true });
          callerChunks.push(frame);
          sent += 1;
        }
      }, 5);
    }

    function enqueue(pcm) {
      const frames = [];
      for (let off = 0; off < pcm.length; off += FRAME_BYTES) {
        const f = pcm.subarray(off, off + FRAME_BYTES);
        frames.push(f.length === FRAME_BYTES ? f : Buffer.concat([f, Buffer.alloc(FRAME_BYTES - f.length)]));
      }
      queue = queue.concat(frames);
      return (frames.length * FRAME_MS);
    }

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    async function waitAgentQuiet(maxMs) {
      const until = at() + maxMs;
      while (at() < until && !closed) {
        if (!agentSpeaking() && at() - lastAgentAudio >= opts.quietMs && lastAgentAudio > -Infinity) return true;
        await sleep(50);
      }
      return false;
    }

    async function script() {
      log('greeting_wait');
      await waitAgentQuiet(opts.greetingMs);
      for (let i = 0; i < turns.length && !closed; i += 1) {
        const turn = turns[i];
        await sleep(Number(turn.pauseMs ?? 400));
        if (turn.bargeInAfterMs != null) {
          // Start talking this long after the agent starts its reply.
          const until = at() + opts.turnTimeoutMs;
          while (!agentSpeaking() && at() < until) await sleep(20);
          await sleep(Number(turn.bargeInAfterMs));
        }
        current = { index: i, say: turn.say, lang: turn.lang || 'en', heard: [], agent: [], bargeIn: turn.bargeInAfterMs != null };
        summary.push(current);
        current.sentStartMs = at() + queue.length * FRAME_MS;
        current.speechEndMs = current.sentStartMs + voicedEndMs(turn.pcm);
        const durMs = enqueue(turn.pcm);
        log('caller_say', { index: i, say: turn.say, durMs });
        await sleep(durMs);
        current.sentEndMs = at();
        const replied = await waitForReply();
        current.replied = replied;
        await waitAgentQuiet(opts.turnTimeoutMs);
      }
      await sleep(1500);
      finish();
    }

    async function waitForReply() {
      const until = at() + opts.turnTimeoutMs;
      while (at() < until && !closed) {
        if (current.firstAudioMs != null) return true;
        await sleep(50);
      }
      return false;
    }

    function finish(err) {
      if (closed) return;
      closed = true;
      if (pacer) clearInterval(pacer);
      try { if (ws.readyState === WebSocket.OPEN) ws.close(1000, 'simulator done'); } catch { /* ignore */ }
      const endMs = Math.max(at(), playoutEnd);
      const agent = Buffer.alloc(Math.ceil((endMs / 1000) * RATE) * 2);
      for (const row of agentTimeline) {
        const off = Math.floor((row.startMs / 1000) * RATE) * 2;
        row.pcm.copy(agent, off, 0, Math.max(0, Math.min(row.pcm.length, agent.length - off)));
      }
      fs.writeFileSync(path.join(outDir, 'agent.wav'), wavFile(agent));
      fs.writeFileSync(path.join(outDir, 'caller.wav'), wavFile(Buffer.concat(callerChunks)));
      fs.writeFileSync(path.join(outDir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
      const out = { callSid, wsUrl: wsUrl.replace(/\?.*/, ''), turns: summary.map(({ pcm, ...rest }) => rest), error: err ? String(err.message || err) : null };
      fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(out, null, 2));
      if (err) reject(err); else resolve(out);
    }
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(usage()); return; }
  const { turns, meta } = loadTurns(opts);
  if (!opts.to && meta.to) opts.to = meta.to;
  const callSid = opts.callSid || `HD_sim_${Date.now().toString(36)}`;
  const outDir = path.resolve(opts.out || path.join(os.tmpdir(), 'voice-sim', callSid));
  fs.mkdirSync(outDir, { recursive: true });

  for (const turn of turns) {
    turn.pcm = synthesize(String(turn.say || ''), { tts: opts.tts, lang: turn.lang, voice: opts.voice, piperModel: opts.piperModel });
  }
  const plan = turns.map((t, i) => ({ i, lang: t.lang || 'en', say: t.say, seconds: +(t.pcm.length / 2 / RATE).toFixed(2), bargeInAfterMs: t.bargeInAfterMs ?? null }));

  if (opts.dryRun) {
    for (const [i, t] of turns.entries()) fs.writeFileSync(path.join(outDir, `caller-${i}.wav`), wavFile(t.pcm));
    console.log(JSON.stringify({ dryRun: true, callSid, outDir, turns: plan }, null, 2));
    return;
  }

  const target = opts.ws || opts.target;
  if (!isLocalHost(target) && !opts.allowRemote) {
    throw new Error(`refusing non-localhost target ${new URL(target).host}; pass --allow-remote only with the owner's go-ahead`);
  }
  let wsUrl = opts.ws || null;
  if (!wsUrl && opts.incoming) {
    if (!opts.to) throw new Error('--incoming needs --to (tenant DID)');
    wsUrl = await postIncoming(opts, callSid);
  }
  if (!wsUrl) {
    const u = new URL('/ws/media', opts.target);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    wsUrl = u.toString();
  }
  if (!/[?&]callSid=/.test(wsUrl)) wsUrl += `${wsUrl.includes('?') ? '&' : '?'}callSid=${encodeURIComponent(callSid)}`;

  const result = await runCall({ wsUrl, callSid, turns, opts, outDir });
  for (const t of result.turns) {
    const lines = t.agent.map((a) => a.spoken || a.text).join(' | ');
    console.log(`#${t.index} caller: ${t.say}\n    heard: ${t.heard.join(' / ') || '(no tap)'}\n    agent (${t.firstAudioMs ?? '-'} ms): ${lines || '(audio only)'}`);
  }
  console.log(`output: ${outDir}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[voice-sim] ${err.message || err}`);
    process.exit(1);
  });
}

module.exports = { parseWav, toPcm16k, wavFile, isLocalHost, parseArgs, synthesize, runCall, FRAME_BYTES };
