/**
 * Server-only Gemini helper for onboarding prompt compilation.
 * Uses the Generative Language REST API (no extra npm client required).
 */

function extractText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const root = payload as {
    text?: string;
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string; thought?: boolean }> };
    }>;
  };
  if (typeof root.text === "string") return root.text;
  const parts = root.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((p) => p && !p.thought && typeof p.text === "string")
    .map((p) => p!.text as string)
    .join("");
}

export async function generateGeminiText(opts: {
  systemInstruction: string;
  userText: string;
  temperature?: number;
  maxOutputTokens?: number;
}): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: opts.systemInstruction }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: opts.userText }],
        },
      ],
      generationConfig: {
        temperature: opts.temperature ?? 0.35,
        maxOutputTokens: opts.maxOutputTokens ?? 2048,
      },
    }),
  });

  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const message =
      json &&
      typeof json === "object" &&
      "error" in json &&
      json.error &&
      typeof json.error === "object" &&
      "message" in json.error
        ? String((json.error as { message?: string }).message)
        : `Gemini HTTP ${res.status}`;
    throw new Error(message);
  }

  const text = extractText(json).trim();
  if (!text) throw new Error("Gemini returned an empty prompt");
  return text;
}
