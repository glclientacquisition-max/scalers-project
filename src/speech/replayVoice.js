// Replay recorded caller turns through the same mouth the live call uses:
// polishSpokenReply, empty-turn repair, cutNoAiSlop, prepareForTts.
// Recorded mode speaks the fixture's model text. Live mode asks Gemini,
// then the same mouth. A later phase swaps `respond` without a new harness.

const { polishSpokenReply, planEmptyGeminiSpeech } = require('../conversation/dynamicSpeech');
const { cutNoAiSlop } = require('./noAiSlop');
const { prepareForTts } = require('./ttsNormalize');
const { analyzeCallerLanguage, languageDirective, createLanguageState } = require('../conversation/language');
const { SCHEMA, SCHEMA_VERSION } = require('./voiceTrace');
const { structuredReplyEnabled } = require('./structuredReplyFlag');
const { detectTurnLanguage, lockReplyLanguage } = require('./languageLock');
const { speakStructuredTurn } = require('./structuredReplay');
const { modelStageProvider } = require('./geminiLive');

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
    },
    language: language === 'unknown' ? 'en' : language,
    toolResults: [],
    capabilities: {},
  };
}

function speakModelText(modelText, ctx, caller) {
  const stages = [];
  const polished = polishSpokenReply(modelText, ctx);
  if (polished.trim() !== String(modelText || '').trim()) {
    stages.push({
      stage: 'transform',
      name: 'polish',
      reason: polished.trim() ? 'rewritten' : 'dropped',
      before: String(modelText || ''),
      after: polished,
      dropped: !polished.trim(),
    });
  }
  let spoken = polished;
  let canned = null;
  if (!spoken.trim() && String(modelText || '').trim()) {
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
    ? prepareForTts(cut, { callLanguage: ctx.language })
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
  return { spoken: prepared.text || '', ttsLanguage: prepared.language || ctx.language, stages, canned };
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
  const evidence = structuredReplyEnabled()
    ? detectTurnLanguage({ text: caller, tokens: turn.tokens || [] })
    : analyzeCallerLanguage(caller);
  if (!ctx.languageState) ctx.languageState = createLanguageState();
  if (structuredReplyEnabled()) {
    ctx.languageState = lockReplyLanguage(ctx.languageState, evidence);
  }
  const sticky = structuredReplyEnabled()
    ? ctx.languageState.reply
    : evidence.language === 'unknown'
      ? ctx.language || 'unknown'
      : evidence.language;
  const callerLanguage = structuredReplyEnabled()
    ? evidence.language && evidence.language !== 'unknown'
      ? evidence.language
      : sticky
    : evidence.language;
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

  const mouth = structuredReplyEnabled()
    ? speakStructuredTurn({
        caller,
        recorded: modelText,
        canned: canned?.text || '',
        replyLang: sticky,
        state: ctx.state,
        fixture: ctx.fixture,
      })
    : modelText
      ? speakModelText(modelText, speech, caller)
      : {
          spoken: canned?.text || '',
          ttsLanguage: speech.language,
          stages: [],
          canned,
        };
  if (!structuredReplyEnabled() && !modelText && canned) {
    const prepared = prepareForTts(canned.text, { callLanguage: speech.language });
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
      confidence: evidence.confidence,
    },
    {
      stage: 'model',
      phase: 'output',
      provider: modelStageProvider(structuredReplyEnabled() ? 'structured' : provider),
      model: modelName,
      promptId: structuredReplyEnabled() ? 'voice.structured' : promptId,
      promptVersion,
      language: speech.language,
      outputText: mouth.outputText != null ? mouth.outputText : modelText,
      chars: turn.model?.chars ?? modelText.length,
      spokenEmitted: turn.model?.spokenEmitted ?? null,
    },
    ...mouth.stages,
  ];
  if (canned && !mouth.stages.some((row) => row.stage === 'canned')) {
    stages.push({ stage: 'canned', path: canned.path, text: canned.text });
  }
  stages.push({
    stage: 'tts',
    text: mouth.spoken,
    language: mouth.ttsLanguage,
    voiceId: ctx.voiceId || null,
  });
  stages.push({ stage: 'outcome', value: mouth.spoken ? 'replay' : 'silence' });
  stages.push({
    stage: 'latency',
    callerStopToModelFirstTokenMs: turn.observed?.firstTokenMs ?? null,
    callerStopToFirstTtsPcmMs: turn.observed?.firstPcmMs ?? null,
    structuredFirstSentenceMs: mouth.pipelineFirstSentenceMs ?? null,
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
      language: callerLanguage,
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
    languageState: createLanguageState(),
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
        language: ctx.languageState?.reply || ctx.language,
        fixture,
        state: ctx.state,
        replyLanguage: ctx.languageState?.reply || ctx.language,
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
