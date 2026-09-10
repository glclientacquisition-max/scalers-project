# ADR-0005 — Returning-caller card at call setup

## Status
Accepted

## Context
Contacts, service requests, and appointments already persist. Post-call review upserts a contact by phone. The next live call still created empty Brain state, so the Business Assistant treated every visit as a first meeting. Full transcript replay would blow the prompt, add latency, and invite invented history.

## Decision
At call setup, load a compact returning-caller card (`getCallerMemory`) and inject it into CONTEXT HEADER. Seed Brain state from that card. Do not retrieve transcripts or add embeddings. Instant greeting stays local and brand-first.

## Alternatives considered
- Dump prior transcripts into Gemini: rejected (latency, cost, PII, hallucination).
- Fine-tune Gemini per tenant: rejected (wrong layer; hosted model stays frozen).
- Mid-turn RAG: rejected by the intelligence roadmap except call-setup retrieve if prompt size breaks.
- External CRM (Twenty) as the live file: rejected for the tenant Desk this quarter.

## Consequences
Brain depends on a Platform read helper. Shared lines must not be greeted by the primary name. Evalite scores the card shape without requiring the Vercel AI SDK on the live wire.

## Date
2026-09-10

## Related systems
Voice engine call setup, `contacts`, `service_requests`, `appointments`, Brain state, CONTEXT HEADER
