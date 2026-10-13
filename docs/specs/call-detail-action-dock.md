# Call-detail action dock (P0)

**Status:** Ready for Desk UX — PR #358 staging smoke GO 2026-09-20 11:10 EAT  
**Lane:** Desk UX (placement / interaction). Builder only if wiring gaps appear.  
**Staging:** https://scalers-staging.vercel.app/ — Done and Dusted TEST (ignore badge volume)

---

## Problem

On call detail, Mark done, WhatsApp, Call, and Ping teammate already work after #358, but the common path still buries them (More / scattered chrome). On a phone between jobs, the owner should not hunt.

## Operator outcome

On `/calls/[id]`, the four daily actions sit in **one** thumb-friendly action dock. Owner can close a return call, open WhatsApp, place a call, or ping an Escalate-flagged teammate without opening More.

## Acceptance (done means)

1. **One dock** on call detail showing, when each applies: Mark done · WhatsApp · Call · Ping teammate.
2. Touch targets **≥44px**, safe-area aware, same desk chrome / `btnDock` language as Inbox list hits.
3. **Semantics unchanged** from #358 smoke PASS:
   - Mark done → same `lead_status` / Needs you exit as list/ticket today
   - WhatsApp → existing deep-link + write-back
   - Call → `tel:` (or existing Call path)
   - Ping teammate → Escalate-flagged people only; delivery truth unchanged
4. Live-call honesty preserved: no “Rings …” when live connect is off; Connect live call stays hidden when unavailable.
5. More / overflow keeps secondary only (e.g. Archive). Common path does not require More.
6. Phone (~390px) and `lg+` both usable; one composition, no second visual language.
7. Lint + desk build green. PR notes what moved into the dock vs what stayed elsewhere.

## Out of scope

- New `lead_status` / Needs you / notify channel semantics
- Real PSTN / warm transfer / voice product
- Needs you row recipes (next P0 after this)
- Inbox list overflow / bulk verb cut (separate brief from `inbox-verb-simplification.md`)
- KPI chrome, glass, fake Online
- Wiping TEST tenant data

## Residual (not this PR)

Release: Team copy missing PR “Coming soon…” string; behavior OK. **Critic** owns that copy honesty — do not block the dock on it.

## Seat

| Who | Does |
| --- | --- |
| Desk UX | Placement, interaction, PR |
| Desk Builder | Only if handlers are missing or broken |
| Critic | Residual Team copy (parallel, non-blocking) |
| Release | Smoke dock after UX ships |

## Verify on staging (TEST account)

Open a Needs you return-call ticket → four dock actions visible without More → Mark done clears Needs you → WhatsApp write-back still fires → Call opens dialer → Ping only Escalate people → with live connect off, no Rings promise.
