---
owner: desk
last_reviewed: 2026-10-11
---

# Desk state — Scalers Product
**As of:** 2026-09-20 ~12:00 EAT  
**North star:** Kenyan SME owners on phone — triage faster, know the real next action, never be lied to by the desk.  
**Staging:** https://scalers-staging.vercel.app/ (TEST — ignore badge volume)

## 1. Shipped vs blocked vs queued

### Shipped (evidence)
| Item | Evidence |
| --- | --- |
| **#358 honesty P0** | Release GO 2026-09-20 11:10 EAT — Mark done, WhatsApp write-back, live-call honesty, escalation delivery truth, Ping teammate |
| **#360 call-detail action dock** | Merged — Mark done · WhatsApp · Call · Ping in one thumb dock |
| **#362 Contacts Call/WA + Name this caller** | Staging-accepted by user; Critic merge path (confirm if already on main) |
| **Team copy residual** | Critic PASS — do **not** put “Coming soon…” on Message teammate; Coming soon only on Connect live call when that chip shows |

### Blocked
| Item | Blocker | Who waits |
| --- | --- | --- |
| **#364 Needs you row recipes** | Draft/open; staging tip still on **#363**; Vercel free-tier daily deploy limit; no READY preview URL | Desk UX on hold; Release standing by with staging bypass until **~07:54 EAT 2026-09-21** |

### Queued (why not now)
| Item | Why not now |
| --- | --- |
| Inbox verb cut (snooze / unread shells) | Owner approved cut; waits until #364 ships so Needs you rows are honest first |
| LeadStatusToggle second dialect | Separate cut; collides with Mark done — after verb cut |
| Voice / PSTN live transfer | Hard kill — notify is the product; Critic/Release law |
| KPI / Online chrome | Hard kill — north star |

## 2. Single next P0

### While #364 is blocked (now → ~07:54 EAT 2026-09-21)
**No new coding P0.** Deploy quota is the blocker. Product does not pretend progress.

**Unblocked Product work only:** hold this packet; intake Intelligence briefs with the rubric below; do not order Builder/UX.

### Once #364 unblocks (deploy quota or READY preview)
**P0 = #364 Needs you row recipes** (finish → Release smoke → merge)

- **Problem:** Needs you rows still risk wrong primary verb (Confirm/Done on intent-only, Call/WA buried).
- **Operator outcome:** On Inbox → Needs you (~390px), each row shows who, one work line, and **one** honest thumb verb.
- **Acceptance:** Visit+appointment → Confirm only; open hold → Done only; return/missed/human + number → Call then WhatsApp; intent-only → no Confirm/Done; no number → empty dock; ≥44px; #358/#360 semantics unchanged; Release smoke on staging or preview.
- **Out of scope:** New piles / lead_status / notify channels; call-detail dock; snooze/unread cut; PSTN transfer; TEST data wipe.
- **Seat:** Desk UX (Builder only if handlers broken). Critic if stamp/verb copy changes meaning. Release for GO/NO-GO.
- **Kill / rollback:** If smoke shows lying verbs or badge lies → Revert #364; keep #358/#360. If still blocked after quota reset with no preview → keep P0 frozen; do not start verb-cut coding.

### After #364 Release GO
**Next P0 (pre-declared, not started):** Inbox verb cut phase 1 — remove snooze/unread shells per `docs/specs/inbox-verb-simplification.md` (owner approved). Seat: Desk UX + Builder as needed; Critic on copy; Release smoke.

## 3. Intelligence briefs — ACCEPT / DEFER / KILL

1. **ACCEPT** — Speeds phone triage, clarifies next action, or fixes a desk lie; fits current P0 or clear queue slot; Critic-safe (no new status/notify invention); name seat + acceptance in one page.
2. **DEFER** — Real operator value, but blocked by current P0, deploy/smoke, or a dependency; park with the unlock condition dated.
3. **KILL** — KPI wallpaper, fake Online, parallel status machine, PSTN live transfer as product, design-system rewrite, or bypasses Product→Builder; one-line kill reason; do not route to Builder.
4. **Intake path** — Intelligence → Chief → Product verdict → Chief routes. Intelligence never orders Builder/UX.
5. **Bar** — If it needs a new `lead_status` / Needs you rule / notify channel, require Critic + user before ACCEPT.

## 4. Routing
Product decides. Chief routes. Critic = honesty semantics. Release = smoke evidence. No coding orders in this packet.

## 5. Intelligence intake — 2026-09-20

| Brief | Verdict | One-line reason |
| --- | --- | --- |
| 1.1 Whose-turn / next-step on Needs you | **ACCEPT (queued)** | Clears implied next action from existing records; no new status. Starts only after #364 Release GO. Becomes next coding P0. Seat: Product brief → Desk UX → Critic if copy asserts status. |
| 1.2 Contact activity strip | **DEFER** | Real, but behind whose-turn. Unlock: whose-turn shipped + smoke GO. |
| 1.3 Honest Nudge-me-later snooze | **KILL** | Owner already approved cutting snooze/unread shells; a “honest snooze” reopens a parallel attention channel. |
| 2 Stack scout (Chatwoot / Twilio / Wanie notes) | **ACCEPT (bounded)** | Notes-only 1–2 day map onto #360/#362/WA write-back while deploy is blocked. Kill if rewrite, Baileys, fake Online, or PSTN invent. Output = memo to Product, not a Builder order. Seats: Platform lead + Builder consult + Critic on honesty claims. |
| 3 Copy/packaging KES + Meta fees | **DEFER** | Real Kenyan packaging work; not desk triage. Unlock: after #364 + whose-turn on the ops queue. |

**Queue after this intake:** #364 (blocked) → whose-turn line → inbox verb cut (snooze/unread remove) → contact activity strip. Packaging on a parallel Product track only when ops P0 is not starving.

## 6. Brief 2 stack scout — Product intake (2026-09-20)

Source: Desk Builder notes-only memo (Chief-routed). No product PR.

| Steal | Verdict | Why / unlock |
| --- | --- | --- |
| Chatwoot voice-bubble on #360 (status + duration + audio above dock) | **DEFER** | Shape is good; after #364 + whose-turn. Seat later: Desk UX sketch → Critic on status chips. |
| Twilio contact→thread→messages vs #362 | **DEFER** | Person→history chain; after whose-turn. Seat later: Product brief → UX/Builder. |
| Meta Cloud sent→delivered→read\|failed ladder (Wanie job shape) | **ACCEPT (Product vocab only now)** | #358 “follow-up opened” ≠ delivered is a real honesty gap. Product locks vocabulary with Critic before any Platform build. **No Cloud send implementation** until Platform roadmap + Critic. Unlock for build: after #364 GO + whose-turn + Critic PASS on labels. |
| Presence Online / Baileys / PSTN / parallel status / full Chatwoot import | **KILL** | Hard walls. |

**Queue unchanged:** #364 (blocked) → whose-turn → inbox verb cut → contact strip. Call-timeline bubble and thread chain stay behind those. WA delivery ladder is a Critic+Product semantics card, not a Builder order.

## 7. #364 GO + next P0 (2026-09-20 14:01 EAT)

- **#364 Needs you row recipes — Release GO** (recipes PASS; #358 regression PASS; Ping soft-notify residual = honest fail copy, non-blocking).
- **Active coding P0:** whose-turn/next-step — `docs/specs/whose-turn-next-step.md` — Desk UX.
- **Then:** inbox verb cut → contact strip.
- **Parallel (non-coding desk):** Product + Critic lock delivery vocab (opened / followed up / sent / delivered / failed). Platform notify ledger only after that lock + Chief unlock. No Product→Platform coding order yet.
- **Platform seated** (4486659). Idle until unlock.
- **Company Brain v0.2** docs-only — required reading when merged; Product facts still update via Chief.

## 8. Delivery vocab — Critic PASS (2026-09-20)

Product cites Critic gate as law before Platform P2 notify ledger:

| Term | Means |
| --- | --- |
| opened | Operator opened outbound surface (wa.me / dialer). Never sent/delivered. |
| followed_up | Operator intentional follow-up (Mark done / Followed up). Not channel DLR. |
| sent | Provider accept (2xx + provider message id). |
| delivered | DLR/webhook only. |
| failed | No live channel / reject / desk_only. Never “Escalation sent”. |

Hard never: opened=sent; soft-sent fail-open; Rings/Online/PSTN without executor evidence; “notified/queued” as user-facing success without mapping to sent or lower. Optional `queued` = outbox only — must not display as sent.

Product calls on Critic ASK USER items:
- Keep name **followed_up** (no rename).
- Keep #358: WA open may clear Needs you as **followed_up** (operator intent); UI must still say **opened** for the channel claim, never delivered.

Platform unlock scope (via Chief): notify ledger SQL/events using this ladder only. No Meta Cloud send / IG / campaigns until separate Product+Critic brief.

## 9. #369 GO + inbox verb cut P0 (2026-09-20 15:12 EAT)

- **#369 whose-turn — Release GO** (Live omit-line residual = fixture gap, non-blocking).
- **Active coding P0:** inbox verb cut Phase 1 — `docs/specs/inbox-verb-cut-p0.md` (cut snooze/unread; add Unarchive; keep columns).
- **Then:** contact activity strip.
- Platform P2 notify ledger: unlocked by Chief (vocab law). Desk sequence independent.

## 10. Bookings+holds honesty (founder lock 2026-09-20)

- ACCEPT spec: `docs/specs/bookings-holds-honesty-p0.md`
- Four P0 kills: K1 hangup copy, K2 resolution↔Needs you agreement, K3 When+Save dual write, K4 gate Confirm booking
- Spines: appointments + service_requests only. A1/B1/C1/D1 locked.
- Desk coding in flight separately: #371 inbox verb cut. Contact strip still after verb cut unless Chief reorders for this honesty wedge.

## 11. Contact strip ACCEPT (2026-09-21)

Founder unlock after #382 GO. Spec: `docs/product/CONTACT_STRIP_ACCEPT.md`. Parallel polish — Funnel ladder unchanged. Strip DEFER lifted.

## 12. Ticket chat display ACCEPT (2026-09-21)

Founder ask. Spec: `docs/product/TICKET_CHAT_DISPLAY_ACCEPT.md`. Declutter transcript; keep dock. Not Funnel / WA Cloud / Contacts.

## 13. Ticket chat follow-ups ACCEPT (2026-09-21)

After #384 GO. Spec: `docs/product/TICKET_CHAT_FOLLOWUPS_ACCEPT.md`. Mobile hide bottom nav; no em dashes; strip FAQ/Polish AI chrome. Not Funnel.

## 14. Contacts segment + click-through ACCEPT (2026-09-21)

Founder ask. Spec: `docs/product/CONTACTS_SEGMENT_WORKFLOW_ACCEPT.md`. One FilterTabs pattern with Inbox; map profile click-through. Parallel polish — Funnel unchanged.
