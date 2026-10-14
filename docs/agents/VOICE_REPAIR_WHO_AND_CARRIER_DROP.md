# VOICE_REPAIR_WHO + VOICE_CARRIER_DROP_CALLBACK

| Flag | Default | on |
| --- | --- | --- |
| `VOICE_REPAIR_WHO` | off | `who` / `hmm` / `nani` classify as hear-again and replay the last agent line before the file-name ask (`HD_cc455b0ce145`, `HD_f80ab5e17d83`). |
| `VOICE_CARRIER_DROP_CALLBACK` | off | On ws close `1006` without a prior Completed webhook: set `summary.carrier_drop` and create a `callback` service_request when a request was in flight (`HD_8bd4ebc460d4`). |

A `carrier_drop` console warning always logs on 1006-without-Completed (ops signal only). Summary writes and callback creation stay behind the flag.
