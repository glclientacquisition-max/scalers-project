// Local loopback only: a fake /ws/media on 127.0.0.1. Never a real server.
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { WebSocketServer } = require('ws');
const sim = require('../../scripts/voice-call-simulator');

const hasEspeak = spawnSync('espeak-ng', ['--version']).status === 0;

describe('voice call simulator', () => {
  it('builds 16 kHz mono WAVs and refuses remote targets', () => {
    const pcm = Buffer.alloc(3200);
    const back = sim.parseWav(sim.wavFile(pcm));
    assert.strictEqual(back.rate, 16000);
    assert.strictEqual(back.pcm.length, 3200);
    assert.ok(sim.isLocalHost('http://localhost:3000'));
    assert.ok(!sim.isLocalHost('https://scalers-staging.up.railway.app'));
    assert.strictEqual(sim.FRAME_BYTES, 640);
  });

  it('streams a caller turn and captures agent audio, tap text, and latency', { skip: !hasEspeak }, async () => {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0, handleProtocols: () => 'audio.drachtio.org' });
    await new Promise((r) => wss.once('listening', r));
    const port = wss.address().port;
    let meta = null;
    wss.on('connection', (ws, req) => {
      assert.match(req.url, /callSid=HD_sim_test/);
      ws.send(Buffer.alloc(16000 * 2 * 0.3), { binary: true }); // greeting
      let voiced = 0;
      let quiet = 0;
      ws.on('message', (data, isBinary) => {
        if (!isBinary) { meta = JSON.parse(String(data)); return; }
        let peak = 0;
        for (let i = 0; i < data.length; i += 2) peak = Math.max(peak, Math.abs(data.readInt16LE(i)));
        if (peak > 500) { voiced += 1; quiet = 0; return; }
        quiet += 1;
        if (voiced > 5 && quiet === 15) {
          voiced = 0;
          ws.send(JSON.stringify({ type: 'simTap', event: 'caller_turn', text: 'hi there' }));
          ws.send(JSON.stringify({ type: 'simTap', event: 'agent_text', path: 'structured_model', text: 'Hello Alvin.', spoken: 'Hello Alvin.', wire: 'Hello Alvin.' }));
          ws.send(Buffer.alloc(16000 * 2 * 0.4), { binary: true });
        }
      });
    });
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-sim-'));
    const opts = { from: '+254700000001', to: null, quietMs: 300, greetingMs: 3000, turnTimeoutMs: 4000 };
    const turns = [{ say: 'hi there', pcm: sim.synthesize('hi there', { tts: 'espeak', lang: 'en' }), pauseMs: 100 }];
    const result = await sim.runCall({ wsUrl: `ws://127.0.0.1:${port}/ws/media?callSid=HD_sim_test`, callSid: 'HD_sim_test', turns, opts, outDir });
    wss.close();
    assert.strictEqual(meta.simulator, true);
    assert.strictEqual(result.turns.length, 1);
    assert.deepStrictEqual(result.turns[0].heard, ['hi there']);
    assert.strictEqual(result.turns[0].agent[0].spoken, 'Hello Alvin.');
    assert.ok(result.turns[0].firstAudioMs >= 0 && result.turns[0].firstAudioMs < 2000);
    for (const f of ['agent.wav', 'caller.wav', 'events.jsonl', 'summary.json']) assert.ok(fs.existsSync(path.join(outDir, f)), f);
  });
});
