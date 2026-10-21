// Third preload for the v2 end-call e2e: no request leaves the box.
// Any fetch to a host other than 127.0.0.1 / localhost is refused before it is
// sent (so no Gemini, SautiKit or Supabase call can happen even with a key set)
// and reported to the parent as { ev: 'net_blocked', host }.
'use strict';

const realFetch = globalThis.fetch;
const LOCAL = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const send = (msg) => {
  try {
    if (process.send) process.send(msg);
  } catch {
    /* parent gone */
  }
};

globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input && (input.url || String(input));
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    host = String(url || '');
  }
  if (!LOCAL.has(host)) {
    send({ ev: 'net_blocked', host });
    throw new Error(`network blocked in sim: ${host}`);
  }
  return realFetch(input, init);
};
