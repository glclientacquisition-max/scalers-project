# Super Admin Quality read API

Platform contract for Desk. There is no `/admin/quality` screen in this change. Desk Engineer renders the page from these readers.

Auth matches the other Super Admin APIs: `isLegacyAuthenticated()` (Better Auth session, or the leftover HMAC cookie). A miss returns `403` `{ "error": "ops_only" }`. Reads use the server service-role client. The service key never goes to the browser. `voice_turn_traces` stays service-role only, with no owner RLS policy.

## Named readers

Desk imports these from `@/lib/quality/readQuality`:

| Function | HTTP | Purpose |
| --- | --- | --- |
| `listBusinessQuality({ windowDays })` | `GET /api/admin/quality?windowDays=7` | Per-business rollup for the Quality home |
| `getBusinessQuality({ businessId, limit })` | `GET /api/admin/quality/businesses/{businessId}?limit=30` | One business: rollup, dropping flag, recent calls |
| `getCallTrace(callId)` | `GET /api/admin/quality/calls/{callId}` | Call record plus turn timeline |
| `listReleaseDeltas({ windowDays, businessId })` | `GET /api/admin/quality/releases?windowDays=7&businessId=` | Per-release score delta. `businessId` is optional |

`windowDays` defaults to 7 and must be an integer from 1 to 30. Trend compares that window with the one before it. The fetch lookback is `max(windowDays, 7) * 2` days so the dropping rule can see both weeks. `limit` defaults to 30 and must be an integer from 1 to 100. `businessId` is a tenant uuid. `callId` is the voice call id (`HD_…`).

Row cap is 2000 traces. `truncated: true` when the cap is hit.

## Stored score first

Voice PR #582 (`ed1f0a93`) writes these on the call row at hangup, both as columns and inside the call payload: `score`, `checks`, `diagnosis`, and `release` `{ gitSha, branch, label }`. Turn rows leave the columns null.

When `score` is a number on the column, that value wins. If the column is null, `payload.score` wins. Checks and diagnosis follow the same order. The API does not rescore those calls. `scoreSource` is `"stored"`.

When both are null, the API scores the turn payloads with `scoreTurns` and `diagnoseCall` from `src/speech/voiceScore.js` (the same module #582 uses). The desk image does not include the voice tree, so `loadVoiceScore` uses that file when it is on disk and otherwise `voiceScoreSnapshot.js`, a copy of `ed1f0a93`. `scoreSource` is `"scored"`. Do not add a second set of checks.

If the score columns are not on the table yet, the read retries without them and scores from turns.

`diagnosis` is the one line Voice stored, for example `Name asked 3 times (turns 4, 7, 9)` or `No failed checks.`

## Dropping

`dropping` is a boolean. `droppingReason` is a string, or `null` when the business is not dropping. It is fixed to 7 days, even when `windowDays` is something else.

`dropping` is true when either rule hits:

- The last 7 days' average is at least 10 points below the prior 7 days, and each window has at least 5 traced calls.
- A check that was not hit in the prior 7 days shows up on at least 3 calls in the last 7.

Reason copy:

- `Average fell 20 points versus the prior 7 days.`
- `silence showed up on 3 calls and was absent in the prior 7 days.`

Both sentences are joined with a space when both rules hit. Check names are the scorecard ids.

## Home

`listBusinessQuality`

```json
{
  "ok": true,
  "ready": true,
  "windowDays": 7,
  "truncated": false,
  "release": {
    "gap": "Release buckets use release.gitSha from the call row when Voice stored it. Branch and label ride along. An empty git SHA falls back to the Africa/Nairobi calendar day."
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
      "droppingReason": "Average fell 20 points versus the prior 7 days.",
      "topFailure": { "check": "languageMismatch", "count": 2 },
      "callCount": 5,
      "priorCallCount": 5,
      "releases": [
        {
          "key": "abc1234",
          "source": "release",
          "gitSha": "abc1234",
          "branch": "main",
          "label": "staging",
          "score": 70,
          "delta": -20,
          "callCount": 5
        }
      ]
    }
  ]
}
```

`currentScore` is the mean of scored calls in the recent `windowDays`, one decimal, same rounding as the voice scorecard. `priorScore` is the previous window of the same length. `trend` is `currentScore - priorScore`. It is `null` when either window has no scored calls. `trendDirection` is `up`, `down`, `flat`, or `unknown`.

`topFailure` is the check with the highest count in the recent trend window. Ties go to the heavier check: silence, deletedAnswer, languageMismatch, incomplete, repeatedQuestion, respelling, prematureTurn, slow. `null` when every recent count is 0.

`releases` is chronological (oldest first). `delta` is this bucket's mean minus the previous bucket. The first bucket's delta is `null`.

`source` is `release` when `release.gitSha` or `release.label` supplied the key, `payload` for a legacy git SHA on the call payload, or `day` for the `YYYY-MM-DD` in Africa/Nairobi (UTC+3). `gitSha` comes from `RAILWAY_GIT_COMMIT_SHA` or `GIT_SHA`. `branch` is `RAILWAY_GIT_BRANCH`. `label` is `VOICE_RELEASE_LABEL` when set.

Missing table (`42P01` or schema cache for the table): `ready: false`, `businesses: []`, HTTP 200. No rows: `ready: true`, `businesses: []`.

## Business

`getBusinessQuality`

Same rollup fields as one home row, plus `calls` (newest first, within the last 14 days):

```json
{
  "callId": "HD_shape",
  "at": "2026-10-07T08:59:00.000Z",
  "score": 41,
  "checks": { "silence": 2 },
  "diagnosis": "Silence after a caller turn (turns 1)",
  "scoreSource": "stored",
  "nameAsks": 0,
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
    "checks": {},
    "diagnosis": "Silence after a caller turn (turns 1)",
    "scoreSource": "stored",
    "nameAsks": 0,
    "topFailure": null,
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
      "score": 100,
      "omit": false,
      "checks": {},
      "notes": [],
      "latency": {
        "callerStopToModelFirstTokenMs": null,
        "callerStopToFirstTtsPcmMs": 900
      },
      "stages": []
    }
  ]
}
```

The call header uses the stored score. Turn rows still carry per-turn scores from `scoreTurns` so the timeline can show where a check landed. `stages` is the writer payload, unchanged. `pii` is `transcript`. Names stay. The writer already redacts emails and phone numbers of 8 digits or more. This API does not redact again.

No rows for that call: `404` `{ "error": "No trace for that call." }`. Missing table: `ready: false`, `call: null`, `turns: []`.

## Release deltas

`listReleaseDeltas` returns `{ ok, ready, windowDays, businessId, truncated, release, releases }`. `releases` is the same bucket shape as on a business, across the lookback. Pass `businessId` to limit the buckets to one tenant.

## Checks

Same names as the voice scorecard: `languageMismatch`, `incomplete`, `repeatedQuestion`, `silence`, `deletedAnswer`, `respelling`, `prematureTurn`, `slow`. A turn with outcome `unlogged` is left out of a recomputed call average.

## Staging SQL

The table and the score columns are owned by Voice PR #582: `docs/supabase/voice_turn_traces.sql`, after `platform_ops_people.sql`. Apply it by hand in the staging SQL editor. This PR does not apply SQL, and it does not add a production apply step. Production stays without the table until ops turns `VOICE_TRACE` on and applies the script there separately.
