# Caller file model (A+B)

**Status:** Locked (Alvin GO · 7 Oct 2026)  
**Owners:** Brain (prompt/tools/summary) · Voice (media plumb + speak-gate consume) · Platform (schema/RPC when new tables land)  
**Peers:** Voice caller-file research and the OSS brief (outside this repo).  
**Runtime contract:** [`CALLER_IDENTITY_AND_SUMMARY.md`](../agents/CALLER_IDENTITY_AND_SUMMARY.md)

## Decision

**Caller file = structured lived rows (primary) + optional ≤2k redacted brief (post-bind sugar only) + gated tool lookup for detail.**

Not:

- Mid-call embedding / vector dump of prior calls
- Full prior transcripts in the prompt
- Website crawl / FAQ KB as customer history
- Phone-ANI alone as proof of who is speaking

Industry shape we copy: Bland-style open items + entities as *our tables*; Retell fields + short brief; Vapi/ElevenLabs call-start hydrate + tools; Twilio identifier thinking mapped to structured rows. KB/crawl stays business FAQ/policy only (Meta BA pattern).

## Artifacts

| Artifact | Role | When visible to the model |
| --- | --- | --- |
| **Contact / party** | Tenant-scoped person; phones[]; display name | Candidate by ANI; rows speakable only after bind |
| **Safe card** | Thin inject: display_name?, open_ask_count, last_ask_label, verification_level | Call start (always candidate-safe; no amounts/IDs/full notes) |
| **Asks / open items** | Lived rows: enquiry, visit, hold, service_request with status | List titles after bind; detail via tools |
| **Ask events** | Append-only outcomes / notes | Tool write; never invent |
| **Optional memory_brief** | ≤2k chars, redacted, rewritten post-call | Inject only after bind; never replaces rows |
| **Session transcript** | Current call only | In-call; not dumped as cross-call history |
| **Business KB** | FAQs, hours, services, policies | Separate RAG/compile path — never caller file |

## Call lifecycle

```
ANI → candidates under tenant_id
  → inject safe_card only (candidate)
  → shop greeting; identity ask if file name on card
  → BIND (nameConfirmed / verification_level)
  → optional thin brief + open-count
  → tools for ask detail / update
  → post-call: merge rows; optional brief rewrite (not last_reason dump)
```

### Bind before Open / History speech

Until the speaker is bound:

- Shop greeting and public FAQ only
- May ask identity once in locked reply language
- **No** open-row facts, history recount, or vocative file name as addressee
- NBA must not leak “rows on this number” into speech; say only that identity must be confirmed

After bind: open-count + short labels OK; full detail via tools; speak from tool results.

### Verification ladder

| Level | Meaning | Allowed |
| --- | --- | --- |
| `none` | No match / unbound | Public FAQ |
| `ani_match_single` | One contact on ANI; not yet confirmed speaker | Non-sensitive open labels only after bind gate still required for history speech |
| `step_up` | Name (+ optional fact / OTP when product requires) | Full ask detail tools |
| `staff` | Owner/staff override | Full |

ANI is a **candidate key**, not proof (shared SIMs, household lines, Kenya agency multi-tenant).

## Tools (rows in, rows out)

Preferred shapes (names may evolve; contract is return type):

- `list_open_asks` / existing file-read helpers — titles + ids + status
- `get_ask` / enquiry detail — one row
- `append_event` / resolve — mutations with idempotency

**Forbid:** returning embedding blobs or raw multi-call transcripts as “memory.”

On empty/miss/fail: say you don’t have that on file — **never invent** a prior ask.

## Hold / filler UX (product rule)

- Hold line **only** while a tool is actually in flight
- Then speak from the tool result (or honest miss)
- **No** fake “let me check” when nothing is running
- Rotate en + sw packs — not one fixed phrase

Voice owns rotation packs and timing; Brain owns when a history tool is required.

## Trust breaks (must not ship)

1. Wrong-person memory on shared ANI  
2. Invented prior asks when rows missing  
3. Sensitive inject without bind  
4. Stale open items spoken as current without tool refresh  
5. Interrupted tool side-effects duplicating writes  
6. Cross-tenant bleed  

## Ship order (locked)

1. **Bind + goal/summary single writer** (Brain PR1 + Voice thin plumb) — fixes HD_c05cdda9684d class bugs  
2. **Wait-line + status tools** (Retell-class tool calling)  
3. **Brief rewrite** (optional ≤2k redacted; not `last_reason` dump)  

Staging test before merge. Schema/RPC additions go Platform-first when new tables are required; PR1 may harden on existing contact / service_request / brain state surfaces.

## Non-goals (this model doc)

- Live Dial / warm transfer  
- Replacing Desk with an external CRM-first product  
- Vector memory as system of record for open jobs  
