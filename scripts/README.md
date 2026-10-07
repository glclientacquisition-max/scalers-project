# Scripts

These files stay in one folder. `package.json` and CI call them by path. Move one only when you update every caller in the same pull request.

| Job | Files |
| --- | --- |
| Local tunnel for SautiKit | `tunnel.js`, `tunnel-cloudflared.sh` |
| Database smoke and schema check | `smoke-db.js`, `verify-staging-schema.js` |
| Voice and brain smokes | `smoke-mvp-retail.js`, `smoke-retail-playbooks.js`, `smoke-home-services-playbooks.js`, `smoke-escalation-scenarios.js`, `smoke-one-person-voice.js`, `smoke-pronunciation-chapterone.js`, `smoke-tts-pace.js` |
| Notify checks | `smoke-whatsapp-did.js`, `verify-textsms.js`, `send-whatsapp-template.js`, `smoke-recording-webhook.js` |
| Staging and release | `stage-pull-request.js`, `stage-pull-request-hold.js`, `stage-pull-request-note.js`, `stage-desk-alias.js`, `release-candidate.sh` |
| Data repair | `backfill-contacts-from-calls.js`, `backfill-phone-e164.js` |
| Speech harness | `soniox-tts-listen-harness.js`, `score-voice-naturalness.js`, `generate-kenya-lexicon.js`, `render-outage-clips.js`, `data/kenyanWordlists.js` |
| Pronunciation checks | `verify-pronunciation-studio.ts`, `verify-pronunciation-fallback.ts` |

npm names are in the root `package.json` `scripts` block. Tunnel steps: [`docs/operations/WEBHOOK_TUNNEL.md`](../docs/operations/WEBHOOK_TUNNEL.md).
