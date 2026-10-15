# VOICE_OWED_CONFIRM_FOLD

Flagged fix for doubled agent acknowledgements after a barged booking/callback
(`HD_0daf1d0fd631` / `HD_9c1864aacd5f`). Default **off**.

## Behaviour

| Flag | Behaviour |
| --- | --- |
| `off` (default) | Byte-identical to main: `#617` speaks the owed receipt first, then the next reply. |
| `on` | Fold the owed receipt into the next reply as one line; strip a second saved-claim; block duplicate `create_service_request` on the same call by `(type, item)` within 60s. |

## Staging

Set `VOICE_OWED_CONFIRM_FOLD=on` on the staging Voice service only. Leave prod unset/off until an Alvin listen passes.

## Tests

`npm run test:spoken-filter` includes `tests/owedConfirmFold.test.js`.
