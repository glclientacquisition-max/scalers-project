# WhatsApp two-way and Scalers-as-tenant

**Status:** Phase 1 implementing. First Utility template is Active. Phase 2 cutover blocked on a second DID.  
**Do not:** enable WhatsApp Calling, POST `/whatsapp/retry`, Chatwoot, or SautiKit-DELETE `+254709221536`.

## Phase 0 dual-use (live until Phase 2)

Same E.164 `+254709221536` (0709221536):

| Path | Identity |
| --- | --- |
| Voice (`resolveTenantId` on `tenants.sautikit_virtual_number`) | Done and Dusted Cleaning Services (agent Shy) |
| WhatsApp Cloud (`metadata.phone_number_id` `1237105982825100`) | Scalers platform |

Keep `tenants.sautikit_virtual_number` and `sautikit_did_pool` assigned to Done and Dusted. Pool status must never be `available` for this DID.

Ops:

1. Railway Voice `SAUTIKIT_WHATSAPP_NUMBER_ID=81424fbd-8f4c-459a-858d-98ced4393df6`
2. Optional `SAUTIKIT_WHATSAPP_PHONE_NUMBER_ID=1237105982825100`
3. Subscribe workspace webhook `whatsapp.event.received` to `https://VOICE_HOST/whatsapp/events` (HMAC same as voice)
4. WhatsApp Manager display name: Scalers
5. Do not set Done and Dusted `notify_channels.whatsapp` until a template actually arrives at `+254790381872`
6. Park Calling (Meta 138015). `scripts/smoke-whatsapp-did.js` FAIL is Calling-only.

## Phase 1 (this PR)

- Explicit platform sender in `sendOwnerWhatsApp`
- `POST /whatsapp/events` plus demux on `/` and `/voice/events` via `X-Sautikit-Event-Kind`
- Persist `whatsapp_threads` / `whatsapp_messages` (apply `docs/supabase/whatsapp_threads.sql`)
- Inbound: mark read, text ack from Scalers inside the 24h window. `parseWhatsAppReceived` accepts a Graph `{ object, entry, changes }` envelope, a bare Meta `value` object, and a SautiKit workspace `{ kind, event_id, data }` envelope. Staging `whatsapp.event.received` posts are the last (~475 bytes).
- Originate: Meta Utility template when the 24h window is closed. Session text only inside an open window (inbound ack).
- Desk WhatsApp toggle is live (`NEXT_PUBLIC_NOTIFY_WHATSAPP_AVAILABLE` defaults true). Owners who already saved Alerts with WhatsApp off stay off until they turn it on.
- Keep `wa.me` follow-up to the caller. That is not a Scalers send.

## Approved first template (Active)

Staff cold send (closed 24h window, or no inbound from that phone) uses this name until a kind-specific env is set.

| Field | Value |
| --- | --- |
| Name | `scalers_staff_alert` |
| Language | `en` (set `SAUTIKIT_WHATSAPP_TEMPLATE_LANG=en_US` if Manager stored US English) |
| Category | Utility |
| Who may send | Voice notify dispatch to owner / permissioned staff (`dispatchAlert`). Ops dry-run: `node scripts/send-whatsapp-template.js --to +2547…` |
| Who must not | No blast of `contacts`. No desk composer. No inbound auto-template. |

| Window | Payload |
| --- | --- |
| Open (inbound within 24h) | `type=text` session body (ack only today) |
| Closed | `type=template` `scalers_staff_alert` with three body params |

Kind names (`scalers_lead`, `scalers_escalation`, `scalers_visit`, `scalers_request`, `scalers_wallet`, `scalers_outage`) send only after that env is set (`SAUTIKIT_WHATSAPP_TEMPLATE_LEAD=…`). Stale `SAUTIKIT_WHATSAPP_TEMPLATE=missed_call_lead` is ignored unless `SAUTIKIT_WHATSAPP_TEMPLATE_ALLOW_LEGACY=on`.

If Meta approved a different first name, pass it: `sendWhatsAppTemplate({ templateName, language })` or `--template` on the dry-run script.

Helpers: `sendOwnerWhatsApp` (window-aware), `sendWhatsAppTemplate` (always template). Catalog: [`../WHATSAPP_TEMPLATES.md`](../WHATSAPP_TEMPLATES.md).

## Phase 2 (separate PR, after a new Kenya DID exists)

1. Insert tenant Scalers / Scalers Support
2. Buy DID, `assign_specific_did_to_tenant` Done and Dusted to the new number, confirm Shy still answers there
3. Point Scalers `sautikit_virtual_number` at `+254709221536`; pool assigned-to-Scalers (never `available`)
4. Do not DELETE the SautiKit number
5. Retarget any shop call-forward
6. Then publish 0709221536 as Scalers voice support

## Phase 3 (out of scope)

Per-tenant Embedded Signup. Route shop inboxes by `phone_number_id`. Platform number stays Scalers.
