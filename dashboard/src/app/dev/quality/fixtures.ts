import {
  couldntAnswerQuestions,
  emptyChecks,
  repeatFailuresFromCalls,
  type BusinessQualityDetail,
  type BusinessQualityRow,
  type QualityRange,
  type ReleaseDelta,
  type VoiceCallTrace,
  type VoiceCheckCounts,
  type VoiceTurnTrace,
} from "@/lib/adminQualityModel";

/**
 * Dev harness only. Production reads stay empty in `adminQuality.ts`.
 */

const TENANT = "11111111-2222-4333-8444-555555555555";

function checks(partial: Partial<VoiceCheckCounts> = {}): VoiceCheckCounts {
  return { ...emptyChecks(), ...partial };
}

function turn(
  callId: string,
  turnIndex: number,
  caller: string,
  hit: Partial<VoiceCheckCounts>,
  stages: VoiceTurnTrace["stages"],
): VoiceTurnTrace {
  return {
    schema: "scalers.voice.turn",
    schemaVersion: 1,
    callId,
    tenantId: TENANT,
    turnIndex,
    pii: "transcript",
    at: "2026-10-06T09:11:00.000Z",
    voiceId: "ke-receptionist",
    caller: { text: caller, language: "sw", confidence: 0.91 },
    stages,
    checks: checks(hit),
  };
}

const lowStagesAsk: VoiceTurnTrace["stages"] = [
  {
    stage: "stt",
    kind: "final",
    text: "Unafanya huduma gani?",
    tokens: [
      { text: "Unafanya", final: true, language: "sw", startMs: 120, endMs: 480 },
      { text: "huduma", final: true, language: "sw", startMs: 480, endMs: 820 },
      { text: "gani?", final: true, language: "sw", startMs: 820, endMs: 1100 },
    ],
  },
  { stage: "turn_end", decision: "flush", reason: "endpoint" },
  { stage: "language", detected: "sw", sticky: "sw", confidence: 0.94 },
  {
    stage: "model",
    phase: "request",
    provider: "gemini",
    model: "gemini-2.5-flash",
    promptId: "voice.system",
    promptVersion: "1",
    language: "sw",
  },
  {
    stage: "model",
    phase: "output",
    provider: "gemini",
    model: "gemini-2.5-flash",
    promptId: "voice.system",
    outputText: "Tunaosha sofa na carpet, na general cleaning ya nyumba. Ni Alvin ninaongea naye?",
    chars: 78,
    spokenEmitted: 5,
  },
  {
    stage: "transform",
    name: "polishSpokenReply",
    reason: "cut",
    before: "Tunaosha sofa na carpet, na general cleaning ya nyumba.",
    after: "Sawa.",
    dropped: "Tunaosha sofa na carpet, na general cleaning ya nyumba.",
  },
  { stage: "tts", text: "Sawa.", before: "Sawa.", language: "sw", voiceId: "ke-receptionist" },
  {
    stage: "latency",
    callerStopToModelFirstTokenMs: 640,
    callerStopToFirstTtsPcmMs: 1640,
  },
  { stage: "outcome", value: "ok" },
];

const lowSilence: VoiceTurnTrace["stages"] = [
  {
    stage: "stt",
    kind: "final",
    text: "Unafanya huduma gani?",
    tokens: [{ text: "Unafanya huduma gani?", final: true, language: "sw", startMs: 0, endMs: 900 }],
  },
  { stage: "language", detected: "sw", sticky: "sw", confidence: 0.9 },
  { stage: "turn_end", decision: "flush", reason: "endpoint" },
  {
    stage: "canned",
    path: "llm_recovery",
    text: "Samahani, sema tena.",
  },
  { stage: "outcome", value: "speech_repair" },
];

const lowUnknown: VoiceTurnTrace["stages"] = [
  {
    stage: "stt",
    kind: "final",
    text: "Naweza kuja kesho?",
    tokens: [{ text: "Naweza kuja kesho?", final: true, language: "sw", startMs: 0, endMs: 700 }],
  },
  { stage: "language", detected: "sw", sticky: "sw", confidence: 0.88 },
  {
    stage: "model",
    phase: "output",
    outputText: "Kesho tuna nafasi asubuhi.",
    chars: 28,
    spokenEmitted: 28,
  },
  { stage: "tts", text: "Kesho tuna nafasi asubuhi.", before: "Kesho tuna nafasi asubuhi.", language: "sw", voiceId: null },
  { stage: "latency", callerStopToModelFirstTokenMs: 420, callerStopToFirstTtsPcmMs: 880 },
  { stage: "outcome", value: "UNKNOWN" },
];

const lowEscalation: VoiceTurnTrace["stages"] = [
  {
    stage: "stt",
    kind: "final",
    text: "Ni Alvin.",
    tokens: [{ text: "Ni Alvin.", final: true, language: "sw", startMs: 0, endMs: 400 }],
  },
  { stage: "language", detected: "sw", sticky: "sw", confidence: 0.8 },
  { stage: "barge_in", reason: "caller" },
  { stage: "outcome", value: "escalation" },
];

const lowClear: VoiceTurnTrace["stages"] = [
  {
    stage: "stt",
    kind: "final",
    text: "Asante, hiyo inatosha.",
    tokens: [{ text: "Asante, hiyo inatosha.", final: true, language: "sw", startMs: 0, endMs: 800 }],
  },
  { stage: "language", detected: "sw", sticky: "sw", confidence: 0.93 },
  {
    stage: "model",
    phase: "output",
    outputText: "Karibu.",
    chars: 7,
    spokenEmitted: 7,
  },
  { stage: "tts", text: "Karibu.", before: "Karibu.", language: "sw", voiceId: "ke-receptionist" },
  { stage: "latency", callerStopToModelFirstTokenMs: 300, callerStopToFirstTtsPcmMs: 740 },
  { stage: "outcome", value: "ok" },
];

export const LOW_CALL: VoiceCallTrace = {
  schema: "scalers.voice.call",
  schemaVersion: 1,
  callId: "HD_dev_low",
  tenantId: TENANT,
  businessId: "biz-dusted",
  businessName: "Done and Dusted",
  startedAt: "2026-10-06T09:11:00.000Z",
  endedAt: "2026-10-06T09:13:34.000Z",
  turnCount: 5,
  voiceId: "ke-receptionist",
  sttModel: "soniox",
  ttsModel: "soniox",
  greeting: [{ stage: "canned", path: "greeting", text: "Habari, Done and Dusted." }],
  score: 38,
  checks: checks({ incomplete: 2, silence: 1, deletedAnswer: 1, slow: 1, repeatedQuestion: 1 }),
  diagnosis: null,
  release: { gitSha: "a1b2c3d4e5f67890", branch: "main", label: "Mouth filters" },
  turns: [
    turn("HD_dev_low", 0, "Unafanya huduma gani?", { incomplete: 1, deletedAnswer: 1, slow: 1 }, lowStagesAsk),
    turn("HD_dev_low", 1, "Unafanya huduma gani?", { silence: 1 }, lowSilence),
    turn("HD_dev_low", 2, "Naweza kuja kesho?", { incomplete: 1 }, lowUnknown),
    turn("HD_dev_low", 3, "Ni Alvin.", {}, lowEscalation),
    turn("HD_dev_low", 4, "Asante, hiyo inatosha.", {}, lowClear),
  ],
};

export const MID_CALL: VoiceCallTrace = {
  schema: "scalers.voice.call",
  schemaVersion: 1,
  callId: "HD_dev_mid",
  tenantId: TENANT,
  businessId: "biz-dusted",
  businessName: "Done and Dusted",
  startedAt: "2026-10-05T14:02:00.000Z",
  endedAt: "2026-10-05T14:03:26.000Z",
  turnCount: 1,
  voiceId: "ke-receptionist",
  sttModel: "soniox",
  ttsModel: "soniox",
  greeting: [],
  score: 74,
  checks: checks({ incomplete: 1, repeatedQuestion: 1 }),
  diagnosis: "Name asked twice",
  release: { gitSha: "a1b2c3d4e5f67890", branch: "main", label: "Mouth filters" },
  turns: [
    turn(
      "HD_dev_mid",
      0,
      "Jina lako nani?",
      { incomplete: 1, repeatedQuestion: 1 },
      [
        { stage: "language", detected: "sw", sticky: "sw", confidence: 0.7 },
        {
          stage: "model",
          phase: "output",
          outputText: "Naomba jina tena.",
          chars: 18,
          spokenEmitted: 18,
        },
        { stage: "tts", text: "Naomba jina tena.", before: "Naomba jina tena.", language: "sw", voiceId: null },
        { stage: "outcome", value: "ok" },
      ],
    ),
  ],
};

export const OK_CALL: VoiceCallTrace = {
  schema: "scalers.voice.call",
  schemaVersion: 1,
  callId: "HD_dev_ok",
  tenantId: TENANT,
  businessId: "biz-esga",
  businessName: "Esga Stationery",
  startedAt: "2026-10-06T08:04:00.000Z",
  endedAt: "2026-10-06T08:04:40.000Z",
  turnCount: 1,
  voiceId: "ke-receptionist",
  sttModel: "soniox",
  ttsModel: "soniox",
  greeting: [],
  score: 91,
  checks: checks(),
  diagnosis: "No failing checks",
  release: { gitSha: "ff00aa11bb22cc33", branch: "main", label: "Turn end" },
  turns: [
    turn("HD_dev_ok", 0, "Nataka counter books.", {}, [
      { stage: "language", detected: "sw", sticky: "sw", confidence: 0.86 },
      {
        stage: "model",
        phase: "output",
        outputText: "Tuna counter books.",
        chars: 19,
        spokenEmitted: 19,
      },
      { stage: "tts", text: "Tuna counter books.", before: "Tuna counter books.", language: "sw", voiceId: null },
      { stage: "latency", callerStopToModelFirstTokenMs: 280, callerStopToFirstTtsPcmMs: 690 },
      { stage: "outcome", value: "ok" },
    ]),
  ],
};

function stubCall(
  callId: string,
  businessId: string,
  businessName: string,
  score: number,
  at: string,
): VoiceCallTrace {
  return {
    schema: "scalers.voice.call",
    schemaVersion: 1,
    callId,
    tenantId: TENANT,
    businessId,
    businessName,
    startedAt: at,
    endedAt: at,
    turnCount: 1,
    voiceId: null,
    sttModel: null,
    ttsModel: null,
    greeting: [],
    score,
    checks: checks(),
    diagnosis: "No failing checks",
    release: null,
    turns: [turn(callId, 0, "Habari.", {}, [{ stage: "outcome", value: "ok" }])],
  };
}

const CALLS = [
  LOW_CALL,
  MID_CALL,
  OK_CALL,
  stubCall("HD_dev_d3", "biz-dusted", "Done and Dusted", 52, "2026-10-04T10:00:00.000Z"),
  stubCall("HD_dev_d4", "biz-dusted", "Done and Dusted", 61, "2026-10-03T10:00:00.000Z"),
  stubCall("HD_dev_d5", "biz-dusted", "Done and Dusted", 70, "2026-10-02T10:00:00.000Z"),
  stubCall("HD_dev_c1", "biz-chapter", "Chapter One", 48, "2026-09-20T11:00:00.000Z"),
  stubCall("HD_dev_c2", "biz-chapter", "Chapter One", 55, "2026-09-19T11:00:00.000Z"),
  stubCall("HD_dev_c3", "biz-chapter", "Chapter One", 64, "2026-09-18T11:00:00.000Z"),
  stubCall("HD_dev_c4", "biz-chapter", "Chapter One", 71, "2026-09-17T11:00:00.000Z"),
  stubCall("HD_dev_c5", "biz-chapter", "Chapter One", 80, "2026-09-16T11:00:00.000Z"),
];

const DUSTED: BusinessQualityRow = {
  businessId: "biz-dusted",
  name: "Done and Dusted",
  score: 38,
  trend: [78, 71, 63, 55, 38],
  topFailure: "incomplete",
  dropping: true,
  droppingReason: "Score fell 22 points in 7 days",
  callsTraced: 5,
  lastCallAt: "2026-10-06T09:11:00.000Z",
};

const ESGA: BusinessQualityRow = {
  businessId: "biz-esga",
  name: "Esga Stationery",
  score: 91,
  trend: [91, 90],
  topFailure: null,
  dropping: false,
  droppingReason: "",
  callsTraced: 1,
  lastCallAt: "2026-10-06T08:04:00.000Z",
};

const CHAPTER: BusinessQualityRow = {
  businessId: "biz-chapter",
  name: "Chapter One",
  score: 64,
  trend: [80, 74, 70, 66, 64],
  topFailure: "slow",
  dropping: true,
  droppingReason: "First audio past 1200 ms on 5 calls",
  callsTraced: 5,
  lastCallAt: "2026-09-20T11:00:00.000Z",
};

export function fixtureRows(range: QualityRange): BusinessQualityRow[] {
  return range === "30d" ? [DUSTED, CHAPTER, ESGA] : [DUSTED, ESGA];
}

export function fixtureReleases(): ReleaseDelta[] {
  return [
    {
      release: { gitSha: "a1b2c3d4e5f67890", branch: "main", label: "Mouth filters" },
      before: { avgScore: 44, checks: checks({ silence: 6, incomplete: 5, deletedAnswer: 3 }) },
      after: { avgScore: 61, checks: checks({ silence: 2, incomplete: 4, deletedAnswer: 1 }) },
    },
    {
      release: { gitSha: "ff00aa11bb22cc33", branch: "main", label: "Turn end" },
      before: { avgScore: 61, checks: checks({ prematureTurn: 4, slow: 3 }) },
      after: { avgScore: 58, checks: checks({ prematureTurn: 1, slow: 5 }) },
    },
  ];
}

/** Pins, a turn score, detected language, a tool, and a played filler. */
export const PINS_CALL: VoiceCallTrace = {
  schema: "scalers.voice.call",
  schemaVersion: 1,
  callId: "HD_dev_pins",
  tenantId: TENANT,
  businessId: "biz-dusted",
  businessName: "Done and Dusted",
  startedAt: "2026-10-07T20:49:00.000Z",
  endedAt: "2026-10-07T20:51:05.000Z",
  turnCount: 2,
  voiceId: "ke-receptionist",
  sttModel: "soniox",
  ttsModel: "soniox",
  greeting: [],
  score: 54,
  checks: checks({ silence: 1, deletedAnswer: 1 }),
  diagnosis: "A correct answer was deleted (turn 1)",
  release: { gitSha: "59af35d9", branch: "main", label: "" },
  turns: [
    {
      schema: "scalers.voice.turn",
      schemaVersion: 1,
      callId: "HD_dev_pins",
      tenantId: TENANT,
      turnIndex: 0,
      pii: "transcript",
      at: "2026-10-07T20:49:20.000Z",
      voiceId: "ke-receptionist",
      score: 40,
      checks: checks({ silence: 1, deletedAnswer: 1 }),
      caller: {
        text: "Mnatosha nyumba?",
        language: "en",
        detected: "sw",
        sticky: "en",
        confidence: 0.62,
      },
      stages: [
        {
          stage: "stt",
          kind: "final",
          text: "Mnatosha nyumba?",
          tokens: [{ text: "Mnatosha nyumba?", final: true, language: "", startMs: 0, endMs: 900 }],
        },
        { stage: "language", detected: "unknown", sticky: "en", confidence: 0.4 },
        { stage: "filler", text: "Mm-hmm", before: "Mm-hmm.", language: "sw" },
        {
          stage: "tool",
          name: "save_caller_info",
          status: "succeeded",
          args: "name=Alvin",
        },
        {
          stage: "tool",
          name: "create_service_request",
          status: "consent_blocked",
          args: "type=cleaning",
        },
        {
          stage: "model",
          phase: "output",
          outputText: "Tunaosha nyumba.",
          chars: 18,
          spokenEmitted: null,
        },
        { stage: "outcome", value: "ok" },
      ],
    },
    {
      schema: "scalers.voice.turn",
      schemaVersion: 1,
      callId: "HD_dev_pins",
      tenantId: TENANT,
      turnIndex: 1,
      pii: "transcript",
      at: "2026-10-07T20:50:10.000Z",
      voiceId: "ke-receptionist",
      caller: { text: "Sawa.", language: "sw", confidence: 0.8 },
      stages: [
        { stage: "language", detected: "sw", sticky: "sw", confidence: 0.8 },
        { stage: "tts", text: "Sawa.", before: "Sawa.", language: "sw", voiceId: null },
        { stage: "outcome", value: "ok" },
      ],
    },
  ],
};

export function fixtureCall(callId: string): VoiceCallTrace | null {
  if (callId === PINS_CALL.callId) return PINS_CALL;
  return CALLS.find((call) => call.callId === callId) || null;
}

export function fixtureBusiness(businessId: string, range: QualityRange): BusinessQualityDetail | null {
  const row = fixtureRows(range).find((item) => item.businessId === businessId);
  if (!row) return null;
  const calls = CALLS.filter((call) => call.businessId === businessId);
  return {
    ...row,
    calls: calls.map((call) => ({
      callId: call.callId,
      score: call.score,
      checks: call.checks,
      durationSec: call.callId === "HD_dev_low" ? 154 : call.callId === "HD_dev_mid" ? 86 : 40,
      at: call.startedAt,
    })),
    repeatFailures: repeatFailuresFromCalls(calls),
    couldntAnswer: couldntAnswerQuestions(calls.flatMap((call) => call.turns)),
  };
}
