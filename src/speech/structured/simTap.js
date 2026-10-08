// Opt-in text tap for scripts/voice-call-simulator.js.
// Off unless VOICE_SIM_TAP=on on the server AND the stream's first metadata
// frame carries simulator:true. Then /ws/media also sends JSON text frames
// { type: 'simTap', event, at, ... } with the caller turn the server heard and
// each agent line (original text, spoken text, wire text). SautiKit never
// sends simulator:true, so a real call never sees these frames.

const ON = new Set(['on', '1', 'true', 'yes']);

function simTapAllowed(env = process.env) {
  return ON.has(String(env.VOICE_SIM_TAP || 'off').trim().toLowerCase());
}

function simTapFrame(event, fields = {}) {
  return { type: 'simTap', event: String(event), at: Date.now(), ...fields };
}

module.exports = { simTapAllowed, simTapFrame };
