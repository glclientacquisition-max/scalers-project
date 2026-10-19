import "server-only";

import { generateGeminiText } from "./gemini";
import type { SpokenLinePair } from "./unknownAnswerSpoken";

const SYSTEM = `Rewrite the owner's unsure-answer line into one short spoken sentence in English and one in Kiswahili.
The caller hears this when the business does not know the answer.
Callbacks only. Do not offer to transfer, connect, or put the caller through.
Do not confirm a booking or an appointment.
Do not mention a specific time: no today, tomorrow, tonight, right now, within the hour, in N minutes, or a clock time.
If you name this product, write Business Assistant in full.
Keep the owner's meaning. One sentence each. No exclamation marks.
Return JSON only: {"en":"...","sw":"..."}`;

function parseSpokenJson(raw: string): SpokenLinePair | null {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1)) as { en?: unknown; sw?: unknown };
    if (typeof obj.en !== "string" || typeof obj.sw !== "string") return null;
    return { en: obj.en, sw: obj.sw };
  } catch {
    return null;
  }
}

/** Gemini rewrite. Null when the key is missing, the call fails, or the JSON is unusable. */
export async function generateUnknownAnswerSpoken(source: string): Promise<SpokenLinePair | null> {
  if (!process.env.GEMINI_API_KEY) return null;
  try {
    const raw = await generateGeminiText({
      systemInstruction: SYSTEM,
      userText: source,
      temperature: 0.2,
      maxOutputTokens: 256,
      timeoutMs: 8_000,
    });
    return parseSpokenJson(raw);
  } catch {
    return null;
  }
}
