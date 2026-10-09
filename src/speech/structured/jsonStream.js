// Incremental reader for the structured reply as Gemini streams it.
// Gemini sends the JSON object as text fragments (candidates[0].content.parts[].text).
// After every fragment this rescans the buffer (replies are a few hundred
// characters) and reports what is complete so far: lang, intent, facts_used
// once its array closes, each say[] string as soon as its closing quote
// arrives, and whether the say array has closed. Salvaged from #583
// jsonSentenceStream.js, rewritten as a real top-level scanner so a key name
// inside a string value can never be mistaken for a field.

function readString(raw, start) {
  // raw[start] === '"'
  let i = start + 1;
  let out = '';
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '\\') {
      if (i + 1 >= raw.length) return { done: false };
      const next = raw[i + 1];
      if (next === 'u') {
        if (i + 5 >= raw.length) return { done: false };
        out += String.fromCharCode(parseInt(raw.slice(i + 2, i + 6), 16));
        i += 6;
        continue;
      }
      out += next === 'n' ? '\n' : next === 't' ? '\t' : next === 'r' ? '\r' : next;
      i += 2;
      continue;
    }
    if (ch === '"') return { done: true, value: out, end: i + 1 };
    out += ch;
    i += 1;
  }
  return { done: false };
}

function skipWs(raw, i) {
  while (i < raw.length && /\s/.test(raw[i])) i += 1;
  return i;
}

/** End index (exclusive) of a complete JSON value at i, or -1 if incomplete. */
function valueEnd(raw, i) {
  const ch = raw[i];
  if (ch === '"') {
    const s = readString(raw, i);
    return s.done ? s.end : -1;
  }
  if (ch === '{' || ch === '[') {
    let depth = 0;
    let j = i;
    while (j < raw.length) {
      const c = raw[j];
      if (c === '"') {
        const s = readString(raw, j);
        if (!s.done) return -1;
        j = s.end;
        continue;
      }
      if (c === '{' || c === '[') depth += 1;
      else if (c === '}' || c === ']') {
        depth -= 1;
        if (depth === 0) return j + 1;
      }
      j += 1;
    }
    return -1;
  }
  const m = /^(?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(raw.slice(i));
  if (!m) return -1;
  const end = i + m[0].length;
  // A bare number may still be growing at the buffer end.
  return end < raw.length ? end : /^(true|false|null)$/.test(m[0]) ? end : -1;
}

function scanSay(raw, i) {
  // raw[i] === '['
  const items = [];
  let j = i + 1;
  while (j < raw.length) {
    j = skipWs(raw, j);
    if (j >= raw.length) break;
    const c = raw[j];
    if (c === ']') return { items, closed: true, end: j + 1 };
    if (c === ',') {
      j += 1;
      continue;
    }
    if (c === '"') {
      const s = readString(raw, j);
      if (!s.done) break;
      items.push(s.value);
      j = s.end;
      continue;
    }
    // Not a string item: let the full parse report the schema problem.
    const end = valueEnd(raw, j);
    if (end < 0) break;
    items.push(null);
    j = end;
  }
  return { items, closed: false, end: -1 };
}

/**
 * @returns {{ fields: Record<string, unknown>, say: Array<string|null>, sayClosed: boolean,
 *   sawFactsUsed: boolean, keys: string[], complete: boolean }}
 */
function scanStructured(raw) {
  const out = { fields: {}, say: [], sayClosed: false, sawFactsUsed: false, keys: [], complete: false };
  let i = skipWs(raw, 0);
  if (raw.startsWith('```')) {
    i = raw.indexOf('{');
    if (i < 0) return out;
  }
  if (raw[i] !== '{') return out;
  i += 1;
  while (i < raw.length) {
    i = skipWs(raw, i);
    if (raw[i] === ',') {
      i += 1;
      continue;
    }
    if (raw[i] === '}') {
      out.complete = true;
      return out;
    }
    if (raw[i] !== '"') return out;
    const key = readString(raw, i);
    if (!key.done) return out;
    i = skipWs(raw, key.end);
    if (raw[i] !== ':') return out;
    i = skipWs(raw, i + 1);
    if (i >= raw.length) return out;
    out.keys.push(key.value);
    if (key.value === 'say' && raw[i] === '[') {
      const said = scanSay(raw, i);
      out.say = said.items;
      out.sayClosed = said.closed;
      if (!said.closed) return out;
      i = said.end;
      continue;
    }
    const end = valueEnd(raw, i);
    if (end < 0) return out;
    try {
      out.fields[key.value] = JSON.parse(raw.slice(i, end));
      if (key.value === 'facts_used') out.sawFactsUsed = true;
    } catch {
      return out;
    }
    i = end;
  }
  return out;
}

function stripFence(text) {
  let raw = String(text || '').trim();
  if (raw.startsWith('```')) raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return raw.trim();
}

function parseStructured(text) {
  const raw = stripFence(text);
  if (!raw) return { ok: false, error: 'empty', value: null };
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: 'not_object', value: null };
    }
    return { ok: true, error: '', value };
  } catch {
    return { ok: false, error: 'parse', value: null };
  }
}

/** Feed text deltas; each push returns the newly completed say items. */
function createStructuredStreamReader() {
  let raw = '';
  let emitted = 0;
  let last = scanStructured('');
  return {
    push(delta) {
      raw += String(delta || '');
      last = scanStructured(raw);
      const fresh = last.say.slice(emitted);
      emitted = last.say.length;
      return { ...last, fresh };
    },
    state() {
      return last;
    },
    raw() {
      return raw;
    },
  };
}

module.exports = { createStructuredStreamReader, scanStructured, parseStructured };
