// Replay recorded caller turns through the same mouth the live call uses:
// polishSpokenReply, empty-turn repair, cutNoAiSlop, prepareForTts.
// Recorded mode speaks the fixture's model text. Live mode asks Gemini,
// then the same mouth. A later phase swaps `respond` without a new harness.

const { polishSpokenDetail, planEmptyGeminiSpeech } = require('../conversation/dynamicSpeech');
const { parseGeminiResponse } = require('../conversation/toolMarkers');
const { cutNoAiSlop } = require('./noAiSlop');
const { prepareForTts } = require('./ttsNormalize');
const { analyzeCallerLanguage, languageDirective } = require('../conversation/language');
const { SCHEMA, SCHEMA_VERSION } = require('./voiceTrace');
const { coverageNextStepFor } = require('../conversation/coverageNextStep');

function initialState(fixture = {}) {
  const name = String(fixture.callerName || '').trim();
  const onFile = Boolean(fixture.nameOnFile && name);
  return {
    caller: {
      name: onFile ? name : '',
      nameConfirmed: onFile,
    },
    conversation: { answersReceived: [] },
    language: { current: 'unknown' },
  };
}

function rememberName(state, callerText, fixture) {
  const name = String(fixture.callerName || '').trim();
  if (!name) return;
  if (callerText.toLowerCase().includes(name.toLowerCase())) {
    state.caller.name = name;
    state.caller.nameConfirmed = true;
  }
}

function speechContext(state, callerTurns, language, fixture) {
  return {
    callerTurns,
    state,
    profile: {
      businessName: fixture.businessName || 'the business',
      servicesCatalog: fixture.servicesCatalog || [],
      ...(fixture.vertical ? { vertical: fixture.vertical } : {}),
      ...(fixture.businessPolicies ? { businessPolicies: fixture.businessPolicies } : {}),
      ...(fixture.hoursSchedule ? { hoursSchedule: fixture.hoursSchedule } : {}),
      ...(fixture.socialHandles || fixture.social_handles
        ? {
            socialHandles: fixture.socialHandles || fixture.social_handles,
            social_handles: fixture.social_handles || fixture.socialHandles,
          }
        : {}),
    },
    language: language === 'unknown' ? 'en' : language,
    toolResults: [],
    capabilities: {},
  };
}

function speakModelText(modelText, ctx, caller) {
  const stages = [];
  const prose = String(parseGeminiResponse(modelText).spokenText || '').trim();
  const detail = polishSpokenDetail(prose, ctx);
  const polished = detail.text;
  if (polished.trim() !== prose) {
    stages.push({
      stage: 'transform',
      name: 'polish',
      reason: detail.reason || (polished.trim() ? 'rewritten' : 'dropped'),
      before: prose,
      after: polished,
      dropped: !polished.trim(),
      dropReasons: Array.isArray(detail.dropReasons) ? detail.dropReasons.slice() : [],
    });
  }
  let spoken = polished;
  let canned = null;
  if (!spoken.trim() && (prose || String(modelText || '').trim())) {
    const planned = planEmptyGeminiSpeech({
      brainState: ctx.state,
      language: ctx.language,
      userText: caller,
      llmDown: false,
      alreadyOffered: false,
    });
    if (planned.speak && planned.line) {
      spoken = planned.line;
      canned = { path: planned.kind, text: planned.line };
      stages.push({ stage: 'canned', path: planned.kind, text: planned.line });
    }
  }
  const cut = spoken ? cutNoAiSlop(spoken) : '';
  if (String(cut || '').trim() !== String(spoken || '').trim()) {
    stages.push({
      stage: 'transform',
      name: 'no_ai_slop',
      reason: String(cut || '').trim() ? 'rewritten' : 'dropped',
      before: spoken,
      after: cut,
      dropped: !String(cut || '').trim(),
    });
  }
  const prepared = String(cut || '').trim()
    ? prepareForTts(cut, {
        callLanguage: ctx.language,
        // Live voice splits glued web labels on the tenant's own words.
        addressTerms: [ctx.profile?.businessName].filter((v) => v && v !== 'the business'),
      })
    : { text: '', language: ctx.language, original: '' };
  if (prepared.text && prepared.text !== String(cut || '').trim()) {
    stages.push({
      stage: 'transform',
      name: 'tts_normalize',
      reason: 'normalized',
      before: cut,
      after: prepared.text,
      dropped: false,
    });
  }
  return {
    spoken: prepared.text || '',
    before: String(cut || '').trim(),
    ttsLanguage: prepared.language || ctx.language,
    stages,
    canned,
  };
}

function replayTurn(turn, ctx) {
  const caller = String(turn.caller || '');
  const missingModel = turn.model?.outputText == null || turn.model.outputText === '';
  if (turn.unlogged && missingModel && !turn.canned?.text) {
    ctx.callerTurns.push(caller);
    ctx.history.push({ role: 'user', content: caller });
    return {
      schema: SCHEMA,
      schemaVersion: SCHEMA_VERSION,
      recordKind: 'turn',
      callId: ctx.fixture.callId,
      tenantId: ctx.fixture.tenantId || null,
      turnIndex: ctx.turnIndex,
      pii: 'transcript',
      caller: { text: caller, language: analyzeCallerLanguage(caller).language, confidence: null },
      stages: [
        {
          stage: 'model',
          phase: 'output',
          outputText: '',
          chars: turn.model?.chars ?? 0,
          spokenEmitted: turn.model?.spokenEmitted ?? null,
        },
        { stage: 'outcome', value: 'unlogged' },
      ],
    };
  }
  const evidence = analyzeCallerLanguage(caller);
  const sticky =
    evidence.language === 'unknown' ? ctx.language || 'unknown' : evidence.language;
  const speech = speechContext(ctx.state, ctx.callerTurns.concat(caller), sticky, ctx.fixture);
  let modelText = turn.model && turn.model.outputText != null ? String(turn.model.outputText) : null;
  let provider = turn.model?.provider || 'recorded';
  let modelName = turn.model?.model || 'recorded';
  let promptId = turn.model?.promptId || 'voice.system';
  let promptVersion = turn.model?.promptVersion || 'fixture';
  let canned = null;

  if (modelText == null && turn.canned?.text) {
    canned = { path: turn.canned.path || 'canned', text: String(turn.canned.text) };
    modelText = '';
  }
  if (modelText == null) modelText = '';

  const mouth = modelText
    ? speakModelText(modelText, speech, caller)
    : {
        spoken: canned?.text || '',
        before: canned?.text || '',
        ttsLanguage: speech.language,
        stages: [],
        canned,
      };
  if (!modelText && canned) {
    const prepared = prepareForTts(canned.text, { callLanguage: speech.language });
    mouth.before = canned.text;
    mouth.spoken = prepared.text || canned.text;
    mouth.ttsLanguage = prepared.language || speech.language;
    if (prepared.text && prepared.text !== canned.text) {
      mouth.stages.push({
        stage: 'transform',
        name: 'tts_normalize',
        reason: 'normalized',
        before: canned.text,
        after: prepared.text,
        dropped: false,
      });
    }
  }

  const stages = [
    {
      stage: 'turn_end',
      decision: turn.flushed === false ? 'hold' : 'flush',
      reason: turn.holdReason || (turn.flushed === false ? 'held' : 'recorded_flush'),
    },
    {
      stage: 'language',
      detected: evidence.language,
      sticky: speech.language,
      soniox: turn.soniox || null,
      confidence: evidence.confidence,
    },
    {
      stage: 'model',
      phase: 'output',
      provider,
      model: modelName,
      promptId,
      promptVersion,
      language: speech.language,
      outputText: modelText,
      chars: turn.model?.chars ?? modelText.length,
      spokenEmitted: turn.model?.spokenEmitted ?? null,
    },
    ...mouth.stages,
  ];
  if (canned && !mouth.stages.some((row) => row.stage === 'canned')) {
    stages.push({ stage: 'canned', path: canned.path, text: canned.text });
  }
  if (turn.lateFinal) {
    stages.push({
      stage: 'stt',
      kind: 'final',
      text: String(turn.lateFinal),
      tokens: [],
    });
    stages.push({
      stage: 'turn_end',
      decision: turn.lateFinalMerged ? 'hold' : 'ignore',
      reason: turn.lateFinalMerged ? 'late_final' : 'grace',
    });
  }
  if (turn.filler) {
    stages.push({
      stage: 'filler',
      text: String(turn.filler),
      before: String(turn.filler),
      language: speech.language,
    });
  }
  const barged = turn.outcome === 'barge_in';
  // Voice speaks the coverage next step after a model coverage answer (server.js).
  if (modelText && !barged && mouth.spoken) {
    const next = coverageNextStepFor(mouth.spoken, {
      profile: speech.profile,
      language: speech.language,
      state: ctx.state,
    });
    if (next) {
      const before = mouth.spoken;
      const ask = prepareForTts(next, { callLanguage: speech.language }).text || next;
      mouth.spoken = `${mouth.spoken} ${ask}`;
      stages.push({
        stage: 'transform',
        name: 'coverage_next_step',
        reason: 'appended',
        before,
        after: mouth.spoken,
        dropped: false,
      });
    }
  }
  if (!barged) {
    stages.push({
      stage: 'tts',
      text: mouth.spoken,
      before: mouth.before || mouth.spoken,
      language: mouth.ttsLanguage,
      voiceId: ctx.voiceId || null,
    });
  }
  stages.push({
    stage: 'outcome',
    value: turn.outcome || (mouth.spoken && !barged ? 'replay' : 'silence'),
  });
  stages.push({
    stage: 'latency',
    callerStopToModelFirstTokenMs: turn.observed?.firstTokenMs ?? null,
    callerStopToFirstTtsPcmMs: turn.observed?.firstPcmMs ?? null,
    firstReplyPcmMs: turn.observed?.firstReplyPcmMs ?? null,
  });

  ctx.callerTurns.push(caller);
  ctx.state.conversation.answersReceived.push(caller);
  rememberName(ctx.state, caller, ctx.fixture);
  ctx.language = sticky;
  ctx.history.push({ role: 'user', content: caller });
  ctx.history.push({ role: 'model', content: mouth.spoken });

  return {
    schema: SCHEMA,
    schemaVersion: SCHEMA_VERSION,
    recordKind: 'turn',
    callId: ctx.fixture.callId,
    tenantId: ctx.fixture.tenantId || null,
    turnIndex: ctx.turnIndex,
    pii: 'transcript',
    caller: {
      text: caller,
      language: evidence.language,
      sticky,
      detected: evidence.language,
      soniox: turn.soniox || null,
      confidence: evidence.confidence,
    },
    stages,
  };
}

async function liveGeminiText({ caller, history, language, fixture }) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is required for live eval');
  }
  const { GoogleGenAI } = require('@google/genai');
  const { buildSystemPrompt, VOICE_SYSTEM_PROMPT_ID, VOICE_SYSTEM_PROMPT_VERSION } = require('../prompts');
  const { extractGeminiText, geminiPrimaryModel } = require('../conversation/geminiVoice');
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const system = [
    buildSystemPrompt({ businessName: fixture.businessName || 'the business' }),
    languageDirective(language),
  ]
    .filter(Boolean)
    .join('\n\n');
  const contents = history.slice(-16).map((message) => ({
    role: message.role === 'model' ? 'model' : 'user',
    parts: [{ text: String(message.content || '') }],
  }));
  contents.push({ role: 'user', parts: [{ text: caller }] });
  const response = await ai.models.generateContent({
    model: geminiPrimaryModel(),
    contents,
    config: {
      systemInstruction: { parts: [{ text: system }] },
      temperature: Number(process.env.GEMINI_VOICE_TEMPERATURE || 0.35),
      maxOutputTokens: Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || 256),
    },
  });
  return {
    outputText: extractGeminiText(response),
    provider: 'gemini',
    model: geminiPrimaryModel(),
    promptId: VOICE_SYSTEM_PROMPT_ID,
    promptVersion: VOICE_SYSTEM_PROMPT_VERSION,
  };
}

async function replayCall(fixture, opts = {}) {
  const mode = opts.mode === 'live' ? 'live' : 'recorded';
  const state = initialState(fixture);
  const ctx = {
    fixture,
    state,
    callerTurns: [],
    history: [],
    language: 'unknown',
    turnIndex: 0,
    voiceId: fixture.voiceId || null,
  };
  const turns = [];
  for (const turn of fixture.turns || []) {
    ctx.turnIndex += 1;
    let next = turn;
    if (mode === 'live') {
      const live = await (opts.respond || liveGeminiText)({
        caller: turn.caller,
        history: ctx.history,
        language: ctx.language,
        fixture,
      });
      next = {
        ...turn,
        model: {
          ...(turn.model || {}),
          outputText: live.outputText,
          provider: live.provider || 'gemini',
          model: live.model,
          promptId: live.promptId,
          promptVersion: live.promptVersion,
        },
        canned: null,
      };
    }
    turns.push(replayTurn(next, ctx));
  }
  return {
    schema: 'scalers.voice.call',
    schemaVersion: SCHEMA_VERSION,
    recordKind: 'call',
    callId: fixture.callId,
    tenantId: fixture.tenantId || null,
    mode,
    turns,
  };
}

module.exports = {
  initialState,
  replayTurn,
  replayCall,
  liveGeminiText,
  speakModelText,
};
