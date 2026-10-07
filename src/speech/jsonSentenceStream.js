// Pull completed spoken_sentences out of a Gemini JSON stream.
// A sentence is emitted when its closing quote arrives, before the
// rest of the object, so TTS can start on a whole sentence.
// The caller already locked the reply language, so the sentence does
// not wait for the reply_language field.

function readJsonStringAt(raw, startQuote) {
  let i = startQuote + 1;
  let out = '';
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '\\') {
      if (i + 1 >= raw.length) return null;
      const next = raw[i + 1];
      if (next === 'n') out += '\n';
      else if (next === 't') out += '\t';
      else if (next === 'u' && i + 5 < raw.length) {
        out += String.fromCharCode(parseInt(raw.slice(i + 2, i + 6), 16));
        i += 6;
        continue;
      } else out += next;
      i += 2;
      continue;
    }
    if (ch === '"') return { value: out, end: i + 1 };
    out += ch;
    i += 1;
  }
  return null;
}

function readStringField(raw, key) {
  const marker = `"${key}"`;
  const at = raw.indexOf(marker);
  if (at < 0) return null;
  const quote = raw.indexOf('"', at + marker.length);
  if (quote < 0) return null;
  const colon = raw.slice(at + marker.length, quote);
  if (!colon.includes(':')) return null;
  const parsed = readJsonStringAt(raw, quote);
  return parsed ? parsed.value : null;
}

function readCompletedArrayStrings(raw, key) {
  const marker = `"${key}"`;
  const at = raw.indexOf(marker);
  if (at < 0) return [];
  const bracket = raw.indexOf('[', at + marker.length);
  if (bracket < 0) return [];
  const out = [];
  let i = bracket + 1;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === ']') break;
    if (ch !== '"') {
      i += 1;
      continue;
    }
    const parsed = readJsonStringAt(raw, i);
    if (!parsed) break;
    out.push(parsed.value);
    i = parsed.end;
  }
  return out;
}

function createSpokenSentenceParser() {
  let raw = '';
  let emitted = 0;
  let language = null;
  return {
    push(delta) {
      raw += String(delta || '');
      const lang = readStringField(raw, 'reply_language');
      if (lang) language = lang;
      const sentences = readCompletedArrayStrings(raw, 'spoken_sentences');
      const fresh = sentences.slice(emitted).map((row) => String(row || '').trim()).filter(Boolean);
      emitted = sentences.length;
      return { language, sentences: fresh, raw };
    },
    raw() {
      return raw;
    },
  };
}

module.exports = {
  createSpokenSentenceParser,
  readStringField,
  readCompletedArrayStrings,
};
