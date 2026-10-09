// Gemini-shaped stream chunks for tests and recorded replay. Each chunk is a
// GenerateContentResponse as the @google/genai stream yields it:
// { candidates: [{ content: { role: 'model', parts: [{ text }] }, index: 0 }] },
// with finishReason STOP (and an optional thought signature) on the last one.
// Recorded fixtures store the real chunk texts; mocks slice a JSON string.

function chunksFromTexts(texts, { thoughtSignature = '', modelVersion = 'recorded' } = {}) {
  const list = Array.isArray(texts) ? texts : [];
  return list.map((text, index) => {
    const last = index === list.length - 1;
    const parts = [{ text: String(text) }];
    if (last && thoughtSignature) parts.push({ text: '', thoughtSignature });
    return {
      candidates: [
        {
          content: { role: 'model', parts },
          index: 0,
          ...(last ? { finishReason: 'STOP' } : {}),
        },
      ],
      modelVersion,
    };
  });
}

function sliceText(text, size = 24) {
  const raw = String(text || '');
  const out = [];
  for (let i = 0; i < raw.length; i += size) out.push(raw.slice(i, i + size));
  return out.length ? out : [''];
}

function chunksFromJson(value, opts = {}) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return chunksFromTexts(sliceText(text, opts.chunkChars || 24), opts);
}

async function* streamOf(chunks, { delayMs = 0, failAfter = -1, error = null } = {}) {
  let i = 0;
  for (const chunk of chunks) {
    if (failAfter >= 0 && i >= failAfter) throw error || new Error('mock stream failed');
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    yield chunk;
    i += 1;
  }
}

module.exports = { chunksFromTexts, chunksFromJson, sliceText, streamOf };
