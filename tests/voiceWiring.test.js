// Static wiring checks for runtime-only voice paths that syntax checks miss.
// Run: node tests/voiceWiring.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'server.js');
const source = fs.readFileSync(serverPath, 'utf8');
const sttPath = path.join(__dirname, '..', 'src/speech/sonioxStt.js');
const sttSource = fs.readFileSync(sttPath, 'utf8');

assert.match(
  source,
  /const\s*\{\s*createSpokenStreamBuffer\s*,?\s*\}\s*=\s*require\(['"]\.\/src\/speech\/spokenStreamBuffer['"]\)/,
  'server.js must import createSpokenStreamBuffer before the streaming turn path uses it'
);

assert.match(
  source,
  /resolveLlmRecoverySpeech/,
  'Gemini failure must speak a callback recovery line and persist it'
);

assert.match(
  source,
  /decideCallerEvent/,
  'media path must ask the turn-taking decision table what to do with caller speech'
);

assert.match(
  source,
  /createOverlapHold/,
  'media path must hold overlapping caller finals by playback generation'
);

assert.match(
  source,
  /beginSpeech/,
  'agent questions are staged at playback start and committed only if playback completes'
);

assert.match(
  source,
  /commitPlayback/,
  'a cancelled question must not replace the last safe replay target'
);

assert.match(
  source,
  /caller_turn_queued/,
  'overlap finals during TTS must be queued until playback ends'
);

assert.match(
  source,
  /caller_turn_released/,
  'playback end must release the generation-tagged overlap queue'
);

assert.match(
  source,
  /agent_question_replay/,
  'Sorry/Pardon must replay the committed agent question'
);

assert.match(
  source,
  /idle_nudge/,
  'after a committed question, silent callers get one canned check-in'
);

assert.match(
  source,
  /heardCallerUtterance/,
  'idle check-in must not arm after the greeting before the caller has spoken'
);

assert.match(
  source,
  /shouldSpeakThinkingAck\(clean\)/,
  'how-are-you turns must not get a thinking-ack stall'
);

assert.match(
  source,
  /isIdleNudge/,
  'idle check-in must not arm another nudge from its own playback'
);

assert.match(
  source,
  /createIdleNudgeController/,
  'media path must arm an idle nudge timer after a committed agent question'
);

assert.match(
  source,
  /isReplay:\s*true/,
  'question replay must not commit as a newly generated question'
);

assert.match(
  source,
  /filler cancelled for reply audio/,
  'reply path must cancel thinking-ack without awaiting remote TTS terminated'
);

assert.match(
  source,
  /speakThinkingAck/,
  'slow turns must play a cached thinking-ack when PCM is already in memory'
);

assert.match(
  source,
  /thinking-ack cached/,
  'cached thinking-ack must be logged distinctly from live filler TTS'
);

assert.match(
  source,
  /isCancelableTtsStreamId/,
  'filler cancel must not send Soniox cancel for cached-filler stream ids'
);

assert.match(
  source,
  /warmFillerAckPcm/,
  'after greeting, common ack PCM must warm without speaking to the caller'
);

assert.match(
  source,
  /function releaseQueuedCallerSpeech/,
  'playback end / barge-in must release queued caller speech'
);

assert.match(
  source,
  /createVoiceTurnTiming/,
  'media turns must record voice-timing markers for speed/consistency'
);

assert.match(
  source,
  /createCallTranscript/,
  'media session must keep structured transcript turns for latency_ms'
);

assert.match(
  source,
  /callTranscript\.stampFromSummary/,
  'voice-timing summaries must stamp the first agent line of that caller turn'
);

assert.match(
  source,
  /appendTranscript\(\{\s*callSid: sessionCallSid,\s*turns: callTranscript\.turns\(\)/,
  'media close must flush structured turns, not a Caller:/Agent: blob'
);

assert.match(
  source,
  /function logTurnTiming/,
  'media path must stamp latency when a turn timing log fires'
);

assert.match(
  source,
  /llm→tts stream prefetched/,
  'reply TTS must be prefetched while Gemini starts'
);

assert.match(
  source,
  /cancel ONLY the filler stream/,
  'filler stop must cancel only the filler stream id, not the reply prefetch'
);

assert.match(
  source,
  /action-progress action=/,
  'action turns must speak a progress line before Gemini+tools dead air'
);

assert.match(
  source,
  /consumeLiveTransferWebhook/,
  'Stream lifecycle webhooks must be able to return Dial XML for a pending live transfer'
);

assert.match(
  source,
  /live transfer Dial blocked/,
  'must not close /ws/media for transfer until conference REST can ring a human'
);

assert.match(
  source,
  /\/voice\/transfer/,
  'post-Stream Redirect must hit /voice/transfer to issue Dial'
);

assert.match(
  source,
  /liveTransfer: \{/,
  'healthz must expose liveTransfer executor flags for staging Dial verification'
);

assert.match(
  source,
  /voiceProfile: publicVoiceProfile\(\)/,
  'healthz must expose the locked TTS pace and PCM gain profile'
);

assert.match(
  source,
  /applyPcmGain\(pcm, resolveVoiceProfile\(\)\.gain\)/,
  'outbound PCM must apply the voice-profile phone gain on the whole utterance'
);

assert.match(
  source,
  /pickContextualAck\(clean, fillerLanguage\(callLanguage\)\)/,
  'thinking-acks must follow the call language, not swap EN/SW'
);

assert.match(
  source,
  /speed: speedForLanguage\(prepared\.language\)/,
  'speakText must pass the profile speed into Soniox TTS'
);

assert.match(
  source,
  /gitSha: resolveVoiceGitSha\(\)/,
  'healthz must expose gitSha so staging Voice can be verified without merging to main'
);

assert.match(
  source,
  /falling back to generateContent/,
  'a hung Gemini stream with no text must retry generateContent instead of speaking fallback immediately'
);

assert.match(
  source,
  /geminiParts/,
  'successful Gemini turns must keep model parts so the next turn can replay thought signatures'
);

assert.match(
  source,
  /ttsReadyPromise/,
  'greeting must wait for TTS ready to avoid silent answer'
);

assert.match(
  source,
  /function bindMediaTts/,
  'TTS must connect in parallel with tenant fetch, not after tenantWarm'
);

assert.match(
  source,
  /ttsVoiceNeedsSwap/,
  'greeting may swap TTS only when the tenant catalog voice differs'
);

assert.match(
  source,
  /mode: 'instant'/,
  'media greeting must be the local instant opener after tenant names load'
);

assert.doesNotMatch(
  source,
  /tenantWarm\s*\.then\(async/,
  'must not delay TTS connect until tenantWarm resolves'
);

assert.match(
  source,
  /if \(state === 'completed' && hasCallSetupFields\) return false;/,
  'SautiKit initial callback with callSessionState=Completed must still open the media stream'
);

assert.match(
  source,
  /speaking clone-voice downtime clip/,
  'Soniox billing/fatal TTS+STT failure must speak a clone-voice downtime clip instead of silence'
);

assert.match(
  source,
  /lastError: getSonioxProviderHealth\(\)/,
  'healthz must expose last Soniox STT/TTS error so 402 billing is visible without log tailing'
);

assert.match(
  source,
  /outageClips: getOutageClipStatus\(\)/,
  'healthz must expose per-voice downtime clip readiness'
);

assert.match(
  source,
  /noteSpeechOutage/,
  'speech outage must notify each owner at most once per cooldown'
);

assert.match(
  source,
  /noteSpeechOutage\(\{ profile: brainProfile, kind: 'llm' \}\)/,
  'Gemini credits / reasoning outage must notify each owner at most once per cooldown'
);

assert.match(
  source,
  /lastError: getGeminiProviderHealth\(\)/,
  'healthz must expose last Gemini error so credits/denied is visible without log tailing'
);

assert.match(
  source,
  /scheduleOutageClipWarm\(\{ voiceId: tenantSonioxVoiceId \}\)/,
  'live Soniox PCM must warm that catalog voice downtime clip'
);

assert.match(
  source,
  /local:\s*true/,
  'instant greeting must be marked local so it is not sent as an unsigned Gemini model turn'
);

assert.match(
  source,
  /geminiTurnTimeoutMs/,
  'Gemini voice turns must use a hang timeout so the caller is not left silent'
);

assert.match(
  source,
  /resolvePrefetchedStreamSpeech/,
  'prefetched TTS with no chunks must speak fallback once, not also hit the guarantee'
);

assert.match(
  source,
  /spokenTextForToolTurn/,
  'Gemini turns must drop model prose after outcome tools so confirmation is backend-only'
);

assert.match(
  source,
  /spoken chunk TTS failed/,
  'TTS errors on streamed chunks must not fail the Gemini stream (HD_5de59f6babc7)'
);

assert.match(
  source,
  /activeOutboundStreamId/,
  'outbound PCM must be gated by active Soniox stream id'
);

assert.match(
  source,
  /mergeInterimHypothesis/,
  'barge-in must accumulate interim STT hypotheses'
);

assert.match(
  source,
  /type:\s*['"]killAudio['"]/,
  'media clear must send drachtio killAudio on barge-in'
);

assert.match(
  sttSource,
  /context_used=/,
  'Soniox STT open must log context_used for A/B measurement'
);

assert.match(
  source,
  /contextPromise:/,
  'media path must pass tenant STT contextPromise into createSonioxSttSession'
);

assert.match(
  source,
  /buildSttContext/,
  'media path must build per-tenant Soniox STT context'
);

assert.match(
  source,
  /summarizeHeaders/,
  'HTTP and WS upgrade logs must use summarizeHeaders (no raw header dumps)'
);

assert.match(
  source,
  /summarizeBody/,
  'voice webhooks must log summarizeBody instead of raw JSON bodies'
);

assert.match(
  source,
  /createWsPayloadSampler/,
  'media WS JSON frames must be sampled, not dumped in full'
);

assert.doesNotMatch(
  source,
  /RAW BODY:/,
  'must not log raw webhook bodies'
);

assert.doesNotMatch(
  source,
  /VOICE EVENT PAYLOAD/,
  'must not log full voice event payloads'
);

assert.doesNotMatch(
  source,
  /WS INCOMING PAYLOAD/,
  'must not log full inbound WS JSON payloads'
);

assert.doesNotMatch(
  source,
  /JSON\.stringify\(req\.headers/,
  'must not JSON.stringify full request headers'
);

assert.match(
  source,
  /writeWavResponse\(res,\s*result\.wav\)/,
  'POST /api/tts/preview must write raw WAV bytes, not res.send a typed array'
);

assert.doesNotMatch(
  source,
  /res\.send\(new Uint8Array/,
  'Express res.send(Uint8Array) JSON-serializes preview audio; use writeWavResponse'
);

console.log('Voice runtime wiring checks passed.');
