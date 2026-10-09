# Super Admin Quality read API

Contract for the Super Admin Quality reads. `dashboard/src/lib/quality/readQuality.ts` is the only code that reads `voice_turn_traces` for Super Admin. The `/api/admin/quality*` routes call it directly. The `/admin/quality*` screens, Overview, and Businesses call it through `dashboard/src/lib/adminQuality.ts`, which only reshapes the bodies for the desk view model. `dashboard/src/lib/quality/rollup.js` owns the Dropping and release math. Nothing else computes them.

Auth matches the other Super Admin APIs: `isLegacyAuthenticated()` (Better Auth session, or the leftover HMAC cookie). A miss returns `403` `{ "error": "ops_only" }`. Reads use the server service-role client. The service key never goes to the browser. `voice_turn_traces` stays service-role only, with no owner RLS policy.

## Named readers

Desk imports these from `@/lib/quality/readQuality`:

| Function | HTTP | Purpose |
| --- | --- | --- |
| `listBusinessQuality({ windowDays })` | `GET /api/admin/quality?windowDays=7` | Per-business rollup for the Quality home |
| `getBusinessQuality({ businessId, limit, windowDays })` | `GET /api/admin/quality/businesses/{businessId}?limit=30&windowDays=7` | One business: rollup, dropping flag, calls in the window |
| `getCallTrace(callId)` | `GET /api/admin/quality/calls/{callId}` | Call record plus turn timeline |
| `listReleaseDeltas({ windowDays, businessId })` | `GET /api/admin/quality/releases?windowDays=7&businessId=` | Per-release score delta. `businessId` is optional |
| `listCallTurns(callIds)` | none | Turn rows for a set of calls (Couldn't answer on the business screen) |
| `readCallMedia(callIds)` | none | Duration and recording URL from `calls` |
| `readBusinessNames(ids)` | none | Business names from `tenants` |

`windowDays` defaults to 7 and must be an integer from 1 to 30. Trend compares that window with the one before it. The fetch lookback is `max(windowDays, 7) * 2` days so the dropping rule can see both weeks. `limit` defaults to 30 and must be an integer from 1 to 100. `businessId` is a tenant uuid. `callId` is the voice call id (`HD_…`).

Row cap is 2000 traces. `truncated: true` when the cap is hit.

## Call rows only

Voice writes `score`, `checks`, `diagnosis`, and `release` `{ gitSha, branch, label }` on the `record_kind = 'call'` row at hangup, both as columns and inside the call payload. `src/speech/voiceScore.js` is the writer. This API does not import it and does not rescore.

`listBusinessQuality`, `getBusinessQuality`, `listReleaseDeltas`, and the dropping rule read call rows only. The column wins. If the column is null, the same field on the call payload wins. `scoreSource` is `"stored"` when that score is a number, and `null` when it is not. A call with a null score stays on the business call list and stays out of averages, `callCount`, dropping, top failure, and release deltas.

Turn rows carry their own `score` and `checks` since #605: Voice writes them on each turn row at `finishCall` (`src/speech/voiceTrace.js`, `sink.update`). `getCallTrace` copies them from the turn row, then the turn payload. Calls written before #605, or turns Voice did not rescore, have none. Those stay `score: null` and `checks: null`, and Desk shows "Not logged". Missing checks are never `{}`, so "no checks stored" and "no check failed" stay different. The timeline does not run `scoreTurns` and never copies call-level checks onto a turn.

If the score columns are not on the table yet, the read retries without them and uses the payload copies. It still does not score turns.

`diagnosis` is the one line Voice stored on the call row, for example `Name asked 3 times (turns 4, 7, 9)` or `No failed checks.`

## Dropping

`dropping` is a boolean. `droppingReason` is a string, or `null` when the business is not dropping. It is fixed to 7 days, even when `windowDays` is something else.

`dropping` is true when either rule hits:

- The last 7 days' average is at least 10 points below the prior 7 days, and each window has at least 5 call rows with a numeric score.
- A check that was not hit in the prior 7 days shows up on at least 3 calls in the last 7.

Reason copy:

- `Score fell 20 points versus the prior 7 days.`
- `Silence on 3 calls, none in the prior 7 days.`

Both sentences are joined with a space when both rules hit. Check names use the plain labels in `rollup.js` `CHECK_LABELS` (`Wrong language`, `Incomplete answer`, `Repeated question`, `Silence`, `Deleted answer`, `Respelling`, `Cut off early`, `Slow reply`), the same words Desk shows on chips. A call with no stored checks never counts as a hit.

## Home

`listBusinessQuality`

```json
{
  "ok": true,
  "ready": true,
  "windowDays": 7,
  "truncated": false,
  "release": {
    "gap": "Release groups use release.gitSha from the call row. Branch and label ride along. Calls with no stored git SHA are left out of release before/after."
  },
  "businesses": [
    {
      "businessId": "uuid",
      "businessName": "Done and Dusted",
      "currentScore": 70,
      "priorScore": 90,
      "trend": -20,
      "trendDirection": "down",
      "dropping": true,
      "droppingReason": "Score fell 20 points versus the prior 7 days.",
      "topFailure": { "check": "languageMismatch", "count": 2 },
      "callCount": 5,
      "checkedCount": 5,
      "priorCallCount": 5,
      "scores": [80, 74, 70, 66, 60],
      "lastCallAt": "2026-10-07T08:59:00.000Z",
      "releases": [
        {
          "key": "abc1234",
          "source": "release",
          "gitSha": "abc1234",
          "branch": "main",
          "label": "staging",
          "firstCallAt": "2026-10-03T07:12:00.000Z",
          "score": 70,
          "delta": -20,
          "callCount": 5,
          "checks": { "languageMismatch": 2 }
        }
      ]
    }
  ]
}
```

`currentScore` is the mean of call rows with a numeric score in the recent `windowDays`, one decimal, same rounding as the voice scorecard. `priorScore` is the previous window of the same length. `trend` is `currentScore - priorScore`. It is `null` when either window has no scored calls. `trendDirection` is `up`, `down`, `flat`, or `unknown`. `callCount` counts those scored call rows, not turns and not unscored calls. A business with only unscored call rows is left off the home list.

`checkedCount` counts the recent scored calls that stored a `checks` object. `scores` is those calls' scores, oldest first, for the sparkline. `lastCallAt` is the newest recent scored call.

`topFailure` is the check with the highest count in the recent trend window. Ties go to the heavier check: silence, deletedAnswer, languageMismatch, incomplete, repeatedQuestion, respelling, prematureTurn, slow. `null` when every recent count is 0.

`releases` is chronological (oldest first) and holds only groups with a git SHA. Calls with no SHA are skipped, so they never form a release and never sit between two releases. `delta` is this group's mean minus the previous group. The first group's delta is `null`. `checks` sums the check counts of the group's calls. `firstCallAt` is the group's first call, which Desk uses to name a release that has no label ("Release of 3 Oct"). Desk does not show the SHA.

`source` is `release` when `release.gitSha` supplied the key, or `payload` for a legacy git SHA on the call payload. A call key can still fall back to the `YYYY-MM-DD` day in Africa/Nairobi (UTC+3), source `day`, but day keys are not release groups. `gitSha` comes from `RAILWAY_GIT_COMMIT_SHA` or `GIT_SHA`. `branch` is `RAILWAY_GIT_BRANCH`. `label` is `VOICE_RELEASE_LABEL` when set.

Missing table (`42P01` or schema cache for the table): `ready: false`, `businesses: []`, HTTP 200. No rows: `ready: true`, `businesses: []`.

## Business

`getBusinessQuality`

Same rollup fields as one home row, for `windowDays` (default 7), plus `calls`: newest first, inside that window, up to `limit`. Unscored calls stay on the list.

```json
{
  "callId": "HD_shape",
  "at": "2026-10-07T08:59:00.000Z",
  "score": 41,
  "checks": { "silence": 2 },
  "diagnosis": "Silence after a caller turn (turns 1)",
  "scoreSource": "stored",
  "turnCount": 1,
  "topFailure": { "check": "silence", "count": 2 },
  "release": {
    "key": "deadbeef",
    "source": "release",
    "gitSha": "deadbeef",
    "branch": "main",
    "label": "staging"
  }
}
```

Unknown business and no traces: `404` `{ "error": "No business." }`. Known business and no traces: `calls: []`, scores null, `dropping: false`. Missing table: `ready: false`.

## Call timeline

`getCallTrace`

```json
{
  "ok": true,
  "ready": true,
  "call": {
    "callId": "HD_shape",
    "tenantId": "uuid",
    "startedAt": "2026-10-07T08:59:00.000Z",
    "endedAt": "2026-10-07T09:00:00.000Z",
    "turnCount": 1,
    "voiceId": "voice-1",
    "sttModel": "stt-rt-v5",
    "ttsModel": "tts-rt-v2",
    "pii": "transcript",
    "score": 41,
    "checks": { "silence": 2 },
    "diagnosis": "Silence after a caller turn (turns 1)",
    "scoreSource": "stored",
    "topFailure": { "check": "silence", "count": 2 },
    "release": { "key": "deadbeef", "source": "release", "gitSha": "deadbeef", "branch": "main", "label": null },
    "stages": [{ "stage": "canned", "path": "greeting", "text": "Habari" }]
  },
  "turns": [
    {
      "turnIndex": 1,
      "at": "2026-10-07T08:59:30.000Z",
      "caller": { "text": "Ni huduma gani?", "language": "sw" },
      "spoken": "Tuna usafi wa nyumba.",
      "outcome": "ok",
      "score": 72,
      "checks": { "slow": 1 },
      "latency": {
        "callerStopToModelFirstTokenMs": null,
        "callerStopToFirstTtsPcmMs": 900
      },
      "stages": []
    }
  ]
}
```

The call header uses the call row. Per-turn `score` and `checks` come from the turn row (written by #605), and are `null` on turns Voice did not score. `caller` also carries `confidence`, `detected`, and `sticky` when the writer stored them. `stages` is the writer payload, unchanged. `pii` is `transcript`. Names stay. The writer already redacts emails and phone numbers of 8 digits or more. This API does not redact again.

No rows for that call: `404` `{ "error": "No trace for that call." }`. Missing table: `ready: false`, `call: null`, `turns: []`.

## Release deltas

`listReleaseDeltas` returns `{ ok, ready, windowDays, businessId, truncated, release, releases }`. `releases` is the same bucket shape as on a business, across the lookback. Pass `businessId` to limit the buckets to one tenant.

## Checks

Same names as the voice scorecard: `languageMismatch`, `incomplete`, `repeatedQuestion`, `silence`, `deletedAnswer`, `respelling`, `prematureTurn`, `slow`. Call rows and, since #605, turn rows store them. This API does not recompute a call average from turn payloads, and it does not score spoken text to fill a missing turn.

## Desk view rules

- The diagnosis line is the stored `diagnosis`. Null means Voice could not score the call (#621) and reads "Not scored".
- Missing checks read "Not logged". "No failures" means checks were stored and none failed.
- A filler reads "Played" only when its stage stored `played: true`, "Not played" for `false`, and "Not logged" otherwise. Voice does not write `played` yet, so today every filler reads "Not logged".
- Couldn't answer lists caller questions from turns whose outcome is `unknown` or `escalation`, or that used the `llm_recovery` canned line. Silence and deleted answer do not count. Brain confirms these literals (`COULDNT_ANSWER_OUTCOMES`, `COULDNT_ANSWER_CANNED` in `adminQualityModel.ts`).
- Save as test writes `null` for provider, model, and prompt id when the trace did not store them.
- The call screen says "Heard" and "Model output", and the Raw view drops provider, model, and voice ids. Releases show the label or the first-call date, not the git SHA.
- Overview and Businesses wrap the Quality read in `.catch(noQualityBadges(...))`, so a Quality failure logs and leaves the badges empty.

## Staging SQL

The table and the score columns are owned by Voice PR #582: `docs/supabase/voice_turn_traces.sql`, after `platform_ops_people.sql`. Apply it by hand in the staging SQL editor. This PR does not apply SQL, and it does not add a production apply step. Production stays without the table until ops turns `VOICE_TRACE` on and applies the script there separately.
