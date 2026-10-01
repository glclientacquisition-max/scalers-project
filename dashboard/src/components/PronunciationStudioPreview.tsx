"use client";

import { useState } from "react";
import { PronunciationCoach } from "@/components/PronunciationCoach";
import type { PronunciationReviewCandidate } from "@/lib/pronunciationGeminiScan";
import {
  parseTtsLexicon,
  type TtsLexiconEntry,
} from "@/lib/pronunciationLexicon";

/** ChapterOne-shaped fixture for local UI verification without desk credentials. */
const FIXTURE = {
  tenantId: "9f3ff5d6-f189-46c9-8c2d-4bb15f07aecf",
  businessName: "ChapterOne Bookstore",
  agentName: "Aisha",
  locations: [
    {
      label: "Nairobi CBD",
      address: "Muindi Mbingu Street, Shop No. M4, Nairobi CBD",
      landmark: "opposite City Market Fashion Mall",
      directions: "",
    },
  ],
  team: [{ name: "Harrison Maina", role: "Owner" }],
  services: [{ name: "White Paper Books" }],
  faqs: [] as Array<{ question: string; answer: string }>,
  bulletinTexts: ["White Paper Books are 3 for 1000 shillings."],
  initialReview: [
    {
      id: "fixture-speech-aisha",
      source: "gemini_scan",
      type: "AGENT_MISPRONUNCIATION",
      word_or_phrase: "Aisha",
      suggested_form: "Eye-sha",
      confidence: "high",
      reasoning: "",
      timestamp_seconds: 4,
      call_id: "fixture-call",
      status: "pending",
      created_at: "2026-10-01T08:00:00.000Z",
    },
    {
      id: "fixture-hearing-ruiru",
      source: "gemini_scan",
      type: "LIKELY_MISHEARD",
      word_or_phrase: "Ruiru",
      suggested_form: "Ruiru",
      confidence: "medium",
      reasoning: "",
      timestamp_seconds: 12,
      call_id: "fixture-call",
      status: "pending",
      created_at: "2026-10-01T08:00:00.000Z",
    },
  ] satisfies PronunciationReviewCandidate[],
  initialLexicon: parseTtsLexicon([
    {
      match: "aisha",
      say: "Eye-sha",
      label: "Aisha",
      priority: 220,
    },
    {
      match: "muindi\\s+mbingu",
      say: "Moo-in-dee Mbeen-goo",
      label: "Muindi Mbingu",
      priority: 220,
    },
  ]),
};

export function PronunciationStudioPreview() {
  const [lexicon, setLexicon] = useState<TtsLexiconEntry[]>(
    FIXTURE.initialLexicon
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <p className="mb-4 text-xs text-ink-soft">Local preview. ChapterOne fixture.</p>
      <PronunciationCoach
        tenantId={FIXTURE.tenantId}
        businessName={FIXTURE.businessName}
        agentName={FIXTURE.agentName}
        locations={FIXTURE.locations}
        team={FIXTURE.team}
        services={FIXTURE.services}
        faqs={FIXTURE.faqs}
        bulletinTexts={FIXTURE.bulletinTexts}
        initialLexicon={lexicon}
        onLexiconChange={setLexicon}
        initialMode="fix"
        initialReview={FIXTURE.initialReview}
        voiceId="Kenya-A"
      />
    </div>
  );
}
