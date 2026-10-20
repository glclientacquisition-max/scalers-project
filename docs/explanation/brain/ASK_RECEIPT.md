---
owner: brain
last_reviewed: 2026-10-20
---

# Ask receipt (BA v2)

The receptionist path. One caller turn becomes a ticket. Code speaks one shop line. The model never writes a fee, a policy, or a booking sentence.

This is the same split Lex, Dialogflow CX, and PolyAI use: NLU picks a label and an optional place; fulfillment reads the business file.

## Ticket

`{ job, kind, place }`

- `speak` — pay, come_cost, cover, hours, service, refund, cancel_rules, deposit, warranty
- `write` — book, cancel_visit
- `drop` — unknown

A how / what / handle cancellation question is `cancel_rules`. Cancel my booking is `cancel_visit`.

## Mouth

`compileAskReceipt(profile, ticket, lang)` reads the shop file only.

A named place speaks only that place. Missing Locations fees are a hole, not the delivery map. A second shop uses the same kinds and its own file.

## Proof

`tests/askReceipt.test.js`. Add a row when a live miss appears. Do not add a new mouth.

## Live

Staging Jirani only. Prod DID +254709221536 stays put.
