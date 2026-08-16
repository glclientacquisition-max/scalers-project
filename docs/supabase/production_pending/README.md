# Production-pending SQL

**DO NOT apply without explicit human approval on ALCR (`fjxcdccgyhnvnnlnovcl`).**

| File | Purpose | Status | Doc |
| --- | --- | --- | --- |
| `grant_notify_channels_update.sql` | Column grant for desk notify prefs | **APPLIED** 2026-08-16 on ALCR (`20260816180900`) | [`PRODUCTION_CHANGE_NOTIFY_CHANNELS.md`](../../operations/PRODUCTION_CHANGE_NOTIFY_CHANNELS.md) |
| `storage_call_recordings_policies.sql` | PROPOSED storage RLS | **NOT APPLIED** | [`STORAGE_SECURITY_MODEL.md`](../../storage/STORAGE_SECURITY_MODEL.md) |

Canonical grant also lives in [`notify_channels.sql`](../notify_channels.sql) for greenfield/staging catch-up.
