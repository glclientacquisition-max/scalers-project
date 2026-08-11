/**
 * AI screening for pronunciation coach suggestions.
 * Drops obvious English, keeps hard Kenyan/brand names, rewrites as constructive sentences.
 */

import { generateGeminiText } from "@/lib/gemini";
import {
  collectHardNameCandidates,
  parseSuggestionList,
  suggestPronunciations,
  type PronunciationSuggestInput,
  type PronunciationSuggestion,
} from "@/lib/pronunciationSuggest";

const SYSTEM = `You are the Scalers pronunciation coach for Kenyan phone receptionists.

You receive a business profile and candidate hard names. Return ONLY valid JSON:
{
  "lines": [
    {
      "prompt": "Full natural sentence the owner should say out loud",
      "label": "Short title",
      "reason": "One short why",
      "targets": ["Hard Name One", "Hard Name Two"],
      "priority": 90
    }
  ]
}

Rules:
- Prefer constructive sentences (greetings, location lines, team intros) — NEVER isolated single words
- Each line should include 1–3 hard targets that actually need pronunciation help
- DROP obvious English that any TTS already says fine (Street, Shop, Bookstore, Nairobi, CBD, Mall, Welcome, Delivery, Opposite, etc.)
- Only use names present in the candidates or profile — do not invent places or people
- Max 6 lines
- Keep prompts under 160 characters, natural spoken Kenyan English
- If nothing hard remains, return {"lines":[]}`;

function extractJsonObject(text: string): Record<string, unknown> {
  const raw = String(text || "").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(raw.slice(start, end + 1));
        return parsed && typeof parsed === "object"
          ? (parsed as Record<string, unknown>)
          : {};
      } catch {
        return {};
      }
    }
    return {};
  }
}

function profileBlurb(input: PronunciationSuggestInput): string {
  const locs = (input.locations || [])
    .map((l) =>
      [l.label, l.address, l.landmark].filter(Boolean).join(" · ")
    )
    .filter(Boolean)
    .join("; ");
  const team = (input.team || [])
    .map((t) => [t.name, t.role].filter(Boolean).join(" ("))
    .filter(Boolean)
    .join("; ");
  return [
    `Business: ${input.businessName || ""}`,
    `Agent: ${input.agentName || ""}`,
    locs ? `Locations: ${locs}` : "",
    team ? `Team: ${team}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Screen + rewrite suggestions with Gemini. Falls back to deterministic sentences.
 */
export async function screenPronunciationSuggestions(
  input: PronunciationSuggestInput
): Promise<{ suggestions: PronunciationSuggestion[]; source: "gemini" | "local" }> {
  const local = suggestPronunciations(input);
  const candidates = collectHardNameCandidates(input);

  if (!candidates.length) {
    return { suggestions: local, source: "local" };
  }

  try {
    const raw = await generateGeminiText({
      systemInstruction: SYSTEM,
      userText: [
        profileBlurb(input),
        "",
        `Candidate hard names (screen these): ${JSON.stringify(candidates)}`,
        "",
        `Deterministic draft lines (improve / replace): ${JSON.stringify(
          local.map((l) => ({
            prompt: l.prompt,
            targets: l.targets.map((t) => t.label),
            reason: l.reason,
          }))
        )}`,
      ].join("\n"),
      temperature: 0.25,
      maxOutputTokens: 1024,
      timeoutMs: 14_000,
    });

    const json = extractJsonObject(raw);
    const screened = parseSuggestionList(json.lines).filter(
      (line) =>
        !input.existingLexicon?.length ||
        line.targets.some(
          (t) =>
            !input.existingLexicon!.some((e) => {
              try {
                const source = e.match.startsWith("\\b")
                  ? e.match
                  : `\\b(?:${e.match})\\b`;
                return new RegExp(source, "i").test(t.label);
              } catch {
                return false;
              }
            })
        )
    );

    if (screened.length) {
      return { suggestions: screened, source: "gemini" };
    }
  } catch {
    // fall through
  }

  return { suggestions: local, source: "local" };
}
