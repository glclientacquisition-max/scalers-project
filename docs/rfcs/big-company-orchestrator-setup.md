---
owner: brain
last_reviewed: 2026-10-20
---

# Research: how big-company voice orchestrators are actually set up

**Status:** Research. No runtime change.  
**Lane:** Brain. Voice owns turn-taking and TTS cache. Platform owns any later split of `server.js`.  
**Date:** 2026-10-20  
**Job:** Explain why Sierra / PolyAI / OpenAI realtime assistants feel better than ours, what [REA](https://github.com/morluto/rea) can and cannot recover, and which pieces we should steal first.

Related, do not redo: [`voice-human-naturalness-research.md`](voice-human-naturalness-research.md) (turn-taking), [`../explanation/brain/CALLER_EXPERIENCE_EXCELLENCE.md`](../explanation/brain/CALLER_EXPERIENCE_EXCELLENCE.md) (caller CX), [`../reference/lanes/BRAIN_TURN_CONTRACT.md`](../reference/lanes/BRAIN_TURN_CONTRACT.md) (our turn path), [`../reference/lanes/AGENT_ARCHITECTURE.md`](../reference/lanes/AGENT_ARCHITECTURE.md) (prompt stack).

Sources used (public engineering only):

- Sierra, [Constellation of models](https://sierra.ai/blog/constellation-of-models) (3 Dec 2025) and [Engineering low-latency voice agents](https://sierra.ai/blog/voice-latency) (9 Oct 2025)
- PolyAI, [Architecture overview](https://docs.poly.ai/glossary/architecture) (docs last modified 26 Jun 2026)
- OpenAI, [Realtime Agents demo](https://github.com/openai/openai-realtime-agents) and [Agents SDK voice guide](https://openai.github.io/openai-agents-js/guides/voice-agents/build/)
- REA, [morluto/rea](https://github.com/morluto/rea) and [rea.tools](https://morluto.github.io/rea/)

Do not decompile Sierra, PolyAI, or any other vendor binary or hosted app. That is not how we learn their orchestrator. Their Agent OS runs on their servers. REA cannot see it.

---

## Verdict

The assistants that win do not run one fat Gemini turn. They run a **task graph**: cheap classifiers and retrieval in parallel, a policy engine that already knows the next slot, a small mouth model that speaks, and a supervisor that may fire tools or refuse a line. The model is last, not first.

Scalers already has the right *shape* of gates (`turnPolicy`, `guardSpokenReply`, `guardToolPlan`, lookups). The underperformance is that those gates still sit around **one streamed Gemini call** that also has to sound Kenyan, pick a tool, and not invent a price. Big companies split those jobs.

REA is a local reverse-engineering MCP. Use it on **our** tree or on **open** demos (OpenAI realtime-agents, LiveKit examples). Do not use it to crack a competitor.

Do not replace Gemini with a 15-model constellation this cycle. Isolate the tasks first. Then pick a second model only where a live Aris miss has a named owner.

---

## What REA actually is

REA (“Reverse Engineer Anything”) is not a voice orchestrator.

It is a local toolkit: MCP server + CLI. An agent asks about one feature of a program or page. REA inspects it (Hopper / Ghidra / IDA / JS / Electron / browser / Android) and returns **code plus evidence**. Setup is `npx rea-agents@latest setup`.

| Target | REA can help | REA cannot |
| --- | --- | --- |
| Our `server.js` / `src/conversation/` | Trace the real turn path when docs drift | Replace Brain tests |
| Open-source demos (OpenAI realtime-agents, LiveKit agents) | Recover how they wire handoffs and tools | Prove they are better on a Kenyan DID |
| Sierra / PolyAI / Bland hosted agents | Nothing useful. The orchestrator is not in the marketing site JS | Recover Agent OS, policy graphs, or model routing |

If someone wants “how Sierra is wired,” read their blogs. If someone wants “how *we* are wired,” read the turn contract, then the media loop. REA is optional for that second case.

---

## How the companies that sound good are wired

### Sierra (closest product analog)

They refuse the question “which LLM do you use.” A typical turn fires **10–15 model calls**: a couple of frontier calls for hard reasoning, several classifiers, speculative retrieval, and hedges.

Agent OS breaks the agent into **tasks**: retrieval, classification, tools, policies, tone. Supervisors enforce guardrails. High-agency tasks (reason, tools) get a stronger model. Low-agency tasks (state update, classify) get a small fast one.

Voice latency is a **concurrent graph**, not a pipeline:

1. Custom VAD so TTFA is measured from true end of speech.
2. Abuse check, retrieval, and likely API calls start **before** the model decides it needs them. Known caller → prefetch their last order.
3. Provider hedge: same task to two providers, first valid answer wins.
4. If reasoning is still slow, a **context-aware** filler (“let me pull up your order”), not a canned “uh-huh.”
5. TTS cache for greetings and confirmations. Stream the rest.
6. Traces per hop: transcription, reason, synthesis. They optimize **time to first relevant audio**, not time to first filler.

They still joke that you cannot call a system of record with voice tokens. Speech-to-speech is optional. Enterprise work stays text tools + TTS.

### PolyAI (contact-center, voice-first)

A turn is fixed and visible:

1. Connection (telephony with failover back to a human queue)
2. ASR with **many providers**, language/domain routing, keyphrase bias, automatic fallback
3. Agent service: LLM reads full history (not a frozen intent classifier)
4. **Policy engine** walks nodes / flows / functions
5. RAG from two knowledge tabs: **FAQs win** and may trigger actions; Connected (Zendesk, files) is read-only
6. Response-control filters
7. TTS with a phrase cache (same greeting twice in 24 h → cached audio)

The LLM is native. The policy engine still owns structured jobs. Knowledge that can fire a tool is curated. Dump-the-help-center is not allowed to book or transfer.

### OpenAI Realtime (reference architecture, not our transport)

Two patterns they publish because one agent with every tool gets worse:

- **Chat-supervisor.** A fast realtime mouth talks. A stronger text model (`gpt-4.1`-class) owns tools and hard answers. Slightly more latency, much less “I booked it” before the API.
- **Sequential specialist handoff.** Greeter → booking specialist → payments. Same live session, new instructions and tool set. Do not load the whole playbook into one prompt.

Guardrails sit on the agent, not only in the system prompt. Function tools are native JSON, not markers in spoken text.

### LiveKit / Pipecat

Already scored in the naturalness RFC. Steal their **turn table**, not their transport. CONTEXT.md still rejects those names as product.

---

## What Scalers runs today

One caller turn, from [`BRAIN_TURN_CONTRACT.md`](../reference/lanes/BRAIN_TURN_CONTRACT.md):

```
STT → language → entities → observeCallerTurn → nextBestAction
  → resolveLocalReply (code may speak and skip the model)
  → else Gemini stream (one model, ~120 tokens, thinking MINIMAL)
  → parse ###TOOL### markers from the spoken text
  → inject required create/escalate
  → guardToolPlan → execute → polish → TTS
```

Prompt stack is **ten layers** compiled into one Gemini system prompt ([`AGENT_ARCHITECTURE.md`](../reference/lanes/AGENT_ARCHITECTURE.md)). Desk writes only `llm_system_prompt`. Runtime injects the rest every turn.

What we already stole without naming Sierra:

| Their idea | We already have | Limit |
| --- | --- | --- |
| Supervisors | `guardSpokenReply`, `guardToolPlan`, NBA, speech guard | They wrap one model, they do not replace it |
| Code speaks facts | Lookups (#791), catalogue list off Gemini by default, visit-time ladder | Still many turns fall through to Gemini |
| Returning-caller prefetch | Caller file card at setup | Not a parallel graph; no “last visit + coverage + hours” prefetch |
| Phrase cache | Voice filler / greeting cache | Confirmations still often hit live TTS |
| Failover | One Gemini retry, then backup model | No provider hedge, no ASR ensemble |
| Native tools | Text markers in the mouth | Model can leak a tool into speech |

The underperformance is not “we need 15 models.” It is:

1. **One mouth does too many jobs.** Gemini must sound like Aris, pick a tool, and not invent KSh.
2. **The turn is still mostly serial.** Entity extract → NBA → maybe Gemini → then tools. Sierra starts retrieval and the likely tool **while** the caller is still finishing.
3. **Tools ride in the spoken stream.** Big companies call tools off to the side, then the mouth only says the confirmed line.
4. **Knowledge is one compiled blob.** PolyAI splits “can trigger an action” from “just read this.” Our FAQs, bulletin, catalogue, and conversation rules share one prompt.
5. **We score one Aris feel.** They score per-task (classify abuse, retrieve SKU, speak a price, fire a hold).

---

## What to steal, in order

These are research recommendations. Each later PR is its own lane ticket and Alvin GO. Do not start a rewrite of `server.js` from this note.

### 1. Make Gemini the exception, not the default (Brain)

Widen the local-reply / lookup path until hours, price, coverage, “do you do X”, leave-it, and visit-time almost never touch the model. That is Sierra’s cheap-task routing and PolyAI’s FAQ-priority, without a new vendor.

Proof: `tests/brainSimulation.test.js` plus the next scored Aris call. If a public-fact turn still streams Gemini, it is a miss.

### 2. Prefetch the likely job at pickup (Brain + Voice)

When the DID rings, start in parallel: tenant profile, caller file, open visit/hold, today’s hours, coverage. Do not wait for the first utterance. Sierra does this for “where’s my package?”

Keep bind-before-use. Prefetch is a candidate, not a greeting by name.

### 3. Take tools out of the mouth (Brain)

Move `save_caller_info` / visit / escalate to Gemini native function calls (or a supervisor model) so spoken text cannot contain `###TOOL###`. The mouth only speaks after `executeBrainTools` returns. OpenAI’s chat-supervisor is the pattern.

Do not turn on `BRAIN_GEMINI_CATALOGUE`. Catalogue names stay code.

### 4. Split knowledge that can act from knowledge that can only be read (Brain + Desk)

Owner-confirmed catalogue, hours, and prices may fire a hold or a spoken price. Unconfirmed pack text and ingested URLs may only say “let me confirm with the owner.” That is PolyAI FAQs vs Connected.

### 5. Score tasks, not only the whole call (Brain)

Add named evals: price honesty, one-question, language stay, tool-before-promise, Kiswahili visit. Sierra’s constellation only works because each task has an eval. Our `brainSimulation` suite is the seed.

### 6. Leave the constellation and REA-vs-Sierra for later

A second model (supervisor) is justified only after (1)–(3) still fail a live Aris miss with a named owner. Voice turn-taking stays on the naturalness RFC. Do not swap Soniox or SautiKit from this note.

---

## What we will not do

- Install REA to inspect a competitor’s app or binary.
- Port Sierra Agent OS, PolyAI Studio, LiveKit Agents, or OpenAI Realtime as the product runtime.
- Set `VOICE_GEMINI_CATALOGUE` or `BRAIN_GEMINI_CATALOGUE`.
- Rewrite `server.js` in this research PR.
- Merge this into a live-call Voice change. Docs only.

---

## Decision needed

Alvin: treat (1) “Gemini last” and (3) “tools off the mouth” as the next Brain tickets after the clean Aris score, or keep patching prompts around the single Gemini turn.
