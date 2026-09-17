# Spec: summarized caller profile

**Status:** Proposed (idea, not shipped)  
**Lanes:** Brain (hangup merge + live card clip) · Platform (bless `contacts.metadata` shape; column later if needed) · Desk (show the profile on `/contacts/[id]`, later)  
**Depends on:** [caller-memory.md](./caller-memory.md), [ADR-0005](../adr/ADR-0005-returning-caller-card.md)  
**Does not replace:** the compact live card. The profile *feeds* that card.

## Destination

After each finished call, Scalers updates a **rolling summarized profile** for that tenant+phone (and, on a shared line, for the person who spoke). The next live call still gets a clipped phone file. The desk shows the same summary plus the timeline. Nobody dumps transcripts into Gemini.

## Why this, not full CRM history

A live call cannot carry every past visit. The desk already has the raw rows (calls, holds, visits, transcript). What is missing is a **durable understanding** that survives hangup: who this person is *to this business*, in a few facts that were earned, not guessed.

Two clients, never mixed:

| Surface | What they get | Cap |
| --- | --- | --- |
| **Caller (voice)** | Clipped standing facts on the existing RETURNING CALLER card | 1 standing line, landmark, language, typical job, next visit, 2 recent bookings |
| **Owner (desk / later chat)** | Same summary, then the timeline if they need the row | Full timeline stays tappable. Profile is the header, not the archive |

Chat and in-app can show more than the mouth can say. They still use this summary as the intelligence layer. Opening a past conversation is how you go deeper, not stuffing every transcript into the model.

## What the profile is

Two layers. Tools and rows win. The model may only propose standing facts that those layers already support.

**Lived facts** (deterministic, from Brain state + tools + appointment/request rows):

- Confirmed name (and shared-line role)
- Language last used (`en` / `sw` / `sheng`)
- Landmark if captured on a visit
- Typical job (most common saved service, else last saved service)
- Next open visit
- Up to two recent bookings (already on the live card)
- Last reason (already `contacts.last_reason`)

**Standing line** (one clipped sentence, hangup merge):

- What the owner would tell a new receptionist: `Usually carpet. Morning. Kiswahili. Rongai.`
- No biography. No prices. No ETAs. No “she is friendly.”
- Clip ~80 characters. Drop transcript-like text.

Owner `notes` stay owner notes. Gemini never overwrites them.

## Shape (v1, no new SQL)

Store under `contacts.metadata.caller_profile`. `upsertContact` already merges `metadata` and preserves `alternate_names`. Promote to columns only if Desk filters need them.

```text
caller_profile: {
  version: 1,
  updated_at: ISO,
  language: "sw" | "en" | "sheng" | null,
  landmark: "Barnabas, Rongai" | null,
  typical_job: "carpet cleaning" | null,
  standing: "Usually carpet. Morning. Kiswahili.",
  facts: ["prefers morning"],
  persons: {
    "amina": { ...same fields... },
    "brian": { language, standing, facts }
  }
}
```

`persons` is keyed by compact name. Unique line uses the top-level fields. Shared line: household visit rows stay on the phone file; standing facts bind to the speaker after identity.

Caps: `standing` 80 chars. `facts` max 3, each 40 chars. Landmark 48. Typical job 48.

## Write path (hangup, fire-and-forget)

Hangup already:

1. Persists Brain summary instantly
2. Upserts the contact (`persistCompletedCallContact`)
3. Runs a narrow name extract + transcript review (Flash-Lite, ~6s, kill switch `POST_CALL_GEMINI_REVIEW=off`)

Add a **merge**, not a second novel:

1. Take lived facts from this call (language, landmark, saved service). If absent, keep the previous profile.
2. Optionally ask review JSON for `standing` / `facts` with the same untrusted-transcript rules as today’s `reason`. Reject anything not grounded in the trusted Brain snapshot or a saved tool.
3. Merge: never clobber a good fact with empty. Never write junk names. Never copy `Caller:` / `Agent:` lines. Prefer a fact seen on two calls, or once if a tool saved it.
4. Shared line: write into `persons[compactName]` when the name is confirmed; do not copy Mama’s visit into Brian’s standing line.

Contact persist still runs if review is off. Profile merge can no-op when review is off (lived facts from Brain snapshot only).

## Read path

- **Live call:** `getCallerMemory` already loads the contact. Clip `standing`, `language`, `landmark`, `typical_job` into the existing card. Do not add a new DB helper. Instant greeting stays brand-first. Do not read the standing line aloud as a list. First reasoned turn still prefers the open visit, then last reason, then standing facts if they mention a past job.
- **Desk:** `/contacts/[id]` already has last reason, notes, timeline. Add a standing block from `metadata.caller_profile` (Desk lane, later). Tap timeline for the conversation.
- **Chat (later):** same profile in the thread header. Fetch one matching call if the owner opens it. No mid-turn RAG.

## Merge rules (invention)

1. Saved appointment / request / escalate result beats Gemini prose.
2. Landmark only from a confirmed visit slot, not from small talk.
3. Language from `callLanguageState` at hangup, not from a guessed “they sound Swahili.”
4. Typical job from saved `service_name` counts, not from `last_reason` chatter.
5. If the caller had a new ask, standing may mention it; do not keep a stale typical job after three different services with no repeat.
6. Do not invent coverage, price, or “we always go to them on Tuesdays.”

## Observable behavior (when implemented)

- After two saved carpet visits, the next unique-line call’s RETURNING CALLER includes a standing line that names carpet, without a transcript.
- Shared line: Brian identified does not receive Amina’s standing line or her visit.
- Review kill switch off: lived facts still update from Brain snapshot; standing line may stay unchanged.
- Desk contact detail can render `standing` without querying transcripts.

## Out of scope

- Full CRM, Twenty, embeddings, mid-call RAG, transcript dump
- Welcome-back by name on the instant TTS opener
- Lookup by name across phones
- Overwriting owner notes
- Personality / sentiment scores
- Chat receptionist product (profile is the feed; chat UI is Desk)

## Tests (when implemented)

- Merge unit tests in `tests/callTranscriptReview.test.js` / `tests/callerMemory.test.js`: clip, no transcript, shared-line person split, tool-wins-over-prose
- Live card includes standing line only when the speaker owns the file
- `npm run test:brain`

## Implementation order

1. Brain: merge helper + hangup write into `metadata.caller_profile` (lived facts first, standing line second)
2. Brain: clip onto the returning-caller card / CALL STATE
3. Desk: standing block on contact detail
4. Platform: promote to columns only if we need to filter
