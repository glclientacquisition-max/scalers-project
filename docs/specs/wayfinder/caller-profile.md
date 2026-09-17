# Wayfinder: summarized caller profile

## Destination

A rolling summarized profile from finished calls. Feeds the compact live card and the desk contact header. No transcript dump.

## Notes

Lanes: Brain first (hangup merge + card clip). Platform blesses `contacts.metadata.caller_profile`. Desk shows it on `/contacts/[id]` later. Spec: `docs/specs/caller-profile.md`. Depends on ADR-0005 and `docs/specs/caller-memory.md`.

## Decisions so far

- Profile is a summary, not CRM history (this spec)
- Lived facts from tools/rows beat Gemini prose (this spec)
- v1 storage: `contacts.metadata.caller_profile`, no new SQL (this spec)
- Shared line: per-person standing facts; household visits stay on the phone file (this spec)
- Instant TTS opener stays brand-first (this spec)

## Not yet specified

- Exact review JSON keys vs a deterministic standing line with no extra Gemini call
- Whether `facts[]` is needed in v1 or standing line alone is enough
- Desk copy for an empty profile

## Out of scope

- Mid-call RAG
- Twenty / full CRM
- Welcome-back on the local opener
- Chat UI
- Owner notes overwrite

## Frontier

### task: Lived-fact merge on hangup

Write language, landmark, typical job from the Brain snapshot + saved rows into `metadata.caller_profile`. No extra Gemini. Tests on merge and clip.

Blocked by: none

### task: Standing line from review (optional second)

Only if lived facts are not enough. Same Flash-Lite job, grounded in the trusted snapshot. Reject ungrounded prose.

Blocked by: Lived-fact merge on hangup

### task: Clip profile onto RETURNING CALLER

Add standing / language / landmark / typical job to the existing card when the speaker owns the file. Do not list aloud.

Blocked by: Lived-fact merge on hangup

### task: Desk standing block

`/contacts/[id]` header from `caller_profile`. Desk lane.

Blocked by: Lived-fact merge on hangup
