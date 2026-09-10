# Scalers

Kenya-focused multi-tenant voice **Business Assistant** plus an owner **Desk**. One DID answers missed and overflow calls; the Desk is how the owner trains knowledge and works the inbox.

## Language

**Business Assistant**:
The live voice agent on the tenant DID. Not a chatbot. Not a generic LLM wrapper.
_Avoid_: receptionist-as-product-name (the spoken role may still say receptionist), bot, copilot

**Desk**:
The owner Next.js app (Home, Calls, Requests, Appointments, Contacts, Settings, Wallet). Super Admin is a separate shell.
_Avoid_: dashboard-as-a-second-product-name, CRM, admin (for owner surfaces)

**Voice engine**:
The Railway Node process (`server.js`) that owns telephony media, STT/TTS, and the Gemini turn loop.
_Avoid_: backend (too vague), LiveKit/Pipecat/Vapi (rejected)

**Brain**:
Call reasoning: prompts, playbooks, tools, live ground truth. Memory on a live call is **Brain state**. Memory across calls is the **returning-caller card**.
_Avoid_: RAG, embeddings, fine-tune, agent-memory-as-a-vendor-product

**Brain state**:
Per-call structured memory (intent, slots, language, repair). Dies when the call ends.
_Avoid_: conversation history dump, full transcript in the prompt

**Compile**:
Desk structured fields written into `tenants.llm_system_prompt` by the prompt compiler. Owners do not edit raw prompt text.
_Avoid_: system prompt editor, fine-tuning

**Live ground truth**:
Per-turn facts injected above the compiled prompt (hours, bulletin, catalog matches, policies). Wins over stale compiled text.
_Avoid_: RAG, knowledge chunks mid-turn

**CONTEXT HEADER**:
Live per-call header in `src/prompts.js` (Kenya time, identity, open/closed, bulletin, returning-caller card). Highest priority on that call.

**Returning-caller card**:
Compact phone file loaded at call setup from `contacts` plus open requests and the next appointment. Not prior transcripts.
_Avoid_: CRM profile, embeddings, chat memory, full history

**Contact**:
Thin Scalers row keyed by tenant + phone (E.164 when possible). Name, last reason, notes, alternate names for shared lines.
_Avoid_: Twenty, HubSpot, customer-360

**Shared line**:
A contact whose `alternate_names` is non-empty. Confirm who is speaking. Do not greet by the primary name.
_Avoid_: household graph, identity provider

**DID**:
The SautiKit number assigned to a tenant. Incoming calls route by this number.
_Avoid_: Twilio number (deprecated path)

**Handoff**:
Getting a human involved. Shipped path is async notify (WhatsApp/email). Live Dial is specced, not the default.
_Avoid_: warm transfer (not shipped as default)

**Lane**:
One agent chat owns one subsystem (`docs/agents/{LANE}.md`). One task, one PR.
_Avoid_: full-repo rewrite, mega-thread

**Eval**:
A scored Brain fixture (Evalite / `npm run eval:brain`). Complements deterministic `npm run test:brain`. Does not train Gemini.
_Avoid_: fine-tune, RLHF
