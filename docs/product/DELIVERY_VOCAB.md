# Delivery honesty vocabulary (Product cite)

**Authority:** Scalers Critic PASS 2026-09-20 — Product adopts as law.  
**Use:** Platform notify ledger design/SQL; desk/voice copy. Not marketing copy deck.

## Ladder (strict)

1. **opened** — Operator started outbound client surface (wa.me, dialer). Evidence: click/navigate on that call/contact. Never claim sent/delivered.
2. **followed_up** — Operator marked intentional follow-up. Evidence: lead_status / explicit operator action. Not channel DLR.
3. **sent** — Our system handed message to carrier/API successfully. Evidence: HTTP 2xx + provider message id.
4. **delivered** — Carrier/device confirmed. Evidence: DLR/webhook. Else omit.
5. **failed** — No live channel succeeded or provider rejected. Copy: “Needs human. Notify failed.” Never “Escalation sent”.

Optional **queued** = in our outbox, not provider-accepted. Must not show as sent.

## Hard never-claims

- Escalation sent / texted the team without **sent** evidence
- Delivered without DLR
- opened upgraded to sent/delivered
- soft / desk_only / empty dispatch as sent
- Rings {name} / Online / PSTN without transfer executor + ring evidence
- Fake Online / live badges as presence

## #358 mapping

- “WhatsApp follow-up opened” → opened (PASS)
- Mark done after WA click → followed_up (PASS if copy ≠ delivered)
- Escalation channel + to + time → sent (PASS)
- “Needs human. Notify failed.” → failed (PASS)

## Product decisions

- Term **followed_up** kept (no rename).
- WA open may clear Needs you as followed_up; channel line stays opened.
