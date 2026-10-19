---
owner: platform
last_reviewed: 2026-10-19
---

# Assistant facts, fallbacks and payment answers

**Status:** Current as of main `a0fc061c` (2026-10-19, EAT).
**Covers:** the assistant facts release (#810, #813, #815, #816, #817), the payment answers (#821) and the callback-only pay default (#822).

## Production flags

| Where | Flag | State |
| --- | --- | --- |
| Voice (Railway) | `VOICE_LOOKUPS`, `VOICE_AREA_FEES` | on |
| Voice + Desk | `VOICE_FALLBACK_BY_KIND`, `FACT_PAYMENTS_V2_HASH` | on |
| Desk (Vercel) | `DESK_ATTEST_SERVICE_AREAS`, `FACT_SAVE_IS_CONFIRM`, `DESK_ASSISTANT_SAY_PAGE`, `DESK_LOOKUP_PREVIEW` | on |
| Voice + Desk | `FACT_HASH_MODE` | unset (hash mode off) |

Flags are plain `on`, set on the production target only. Turning one off and redeploying is the first rollback step. A code rollback promotes the previous Vercel deployment and redeploys the previous Railway commit. Record both ids in the release log before you merge.

## Readiness comes from lookup probes

The Desk "ready" checklist and the **What your assistant will say** page (`/settings?tab=assistant-say`) do not have rules of their own. They run the same lookup the voice runs (`src/knowledge/lookup.js`) on probe questions and show the result: **Will say**, **Won't say** (with the reason), or the fallback line. The payment row uses a general "how do I pay" probe, so paybill, till, Pochi, Airtel and legacy setups all tick correctly. If readiness and a live call disagree, treat it as a bug in the probe, not in the page.

## The voiceRequire bundle

The Desk server runs voice code. `dashboard/scripts/sync-voice-modules.cjs` copies the static require closure of the entries in `dashboard/scripts/voice-modules.cjs` from `src/` into `dashboard/.voice` before `next build`. `next.config` traces `.voice/**`. `dashboard/src/lib/voiceRequire.server.ts` is the only resolver. `check-voice-trace.cjs` fails the build if `/home` or `/settings` do not trace the voice entries. Tests: `npm run test:desk-bundle` (runs first in `test:mvp`).

Smoke test after every Desk deploy with `npm run smoke:staging` (`dashboard/scripts/smoke-staging-desk.mjs`). It fails on error-boundary text ("Could not load …"), which returns HTTP 200, so a status-only check is not enough. It treats an in-body redirect to `/login` as signed out, and `--session` / `--require-auth` enable a signed-in pass.

## Fallback by kind

With `VOICE_FALLBACK_BY_KIND` on, an unknown answer is classified as `price`, `fee`, `hours`, `pay` or `general` (`src/conversation/unknownAnswerByKind.js`, mirrored in `dashboard/src/lib/unknownAnswerByKindConstants.ts`). Order for each kind:

1. The owner's custom line for that kind, if it passes `callbackSafeLine` (speech guard).
2. The owner's general line, if it fits the kind (`generalFitsFallbackKind`).
3. The built-in default for the kind and language (`DEFAULT_BY_KIND`).

**Quote-line rule:** a quote-style line ("ask for a quote", "cannot quote", "formal quote", …; `isQuoteStyleFallbackLine`) is used **for prices only**. For every other kind, including `general`, it falls through to the default. The migration `docs/supabase/unknown_answer_by_kind.sql` uses the same patterns.

**Pay default (callback only):** EN "I'll ask the team to call you back with the payment details." SW "Timu itakupigia simu kukupa maelezo ya malipo." The assistant never promises to *send* payment details. The wording "The team will call you back…" is blocked by the speech guard's saved-claim rule, so the default is phrased as a request.

## Catalogue matcher rules

`src/knowledge/lookup.js` matches a question to a price-list row:

- Words like *deep* and *standard* are not generic: they distinguish rows.
- A row is ruled out when the question names a different number, or names another row's word while missing one of its own. Rows named in full are exempt.
- The minimum match score is 0.5. The legacy fallback skips ruled-out rows.
- Swahili noun-class numbers count: *kimoja / viwili / vitatu* and the m-/wa-/ma- forms.
- When several rows remain, the assistant asks which one instead of guessing.

Tests: `tests/lookupCatalogueMatch.test.js` in `test:lookups`.

## Payment answers (#821)

- **Method openers** name only the saved methods: "We take M-Pesa." / "Tunapokea M-Pesa.", "You can pay by cash or M-Pesa Paybill.", and so on. Swahili uses *Tunapokea*, never *Tunachukua*.
- **Number types** are read with their labels: paybill (+ account), till, Pochi, Airtel Money, send money. A paybill question never reads the till.
- **Send money:** if no send-money number is saved, the answer gives the methods that are saved and reads their number, instead of the callback line.
- **Bank account digits are never spoken.**
- **Unconfirmed (imported, not saved) payment facts are never spoken.** The pay-later check reports *unconfirmed* before *not found*.
- Pay-later questions get the pay callback line.

## How releases go

1. **Staging:** pin staging voice (Railway) and staging Desk (alias `scalers-staging.vercel.app`) to the PR head. Redeploy only when staging has 0 calls. Check `/healthz`, run all suites plus `node scripts/replay-voice-suite.js`, and run a read-only production impact diff (spoken changes by tenant).
2. **OK:** the reviewer gives a merge verdict, and the owner approves the production release.
3. **Backup → migration → merge:** back up the affected production columns, apply the migration if there is one, then merge with a normal merge (no force pushes). Do this in a window with zero live calls.
4. **Verify:** prod voice `/healthz` at the new main SHA (STT, TTS, telephony, SMS), the Desk deploy READY, runtime logs clean, a few lookup spot checks.
5. **Clean staging:** point staging voice and Desk back at main and delete the pin branches.

See also [RELEASE_PROCESS](../../how-to/RELEASE_PROCESS.md) and [LOOKUPS](../../how-to/LOOKUPS.md).
