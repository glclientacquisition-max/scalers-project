# Calls

**Route:** `/calls`  
**Job:** Voice inbox. People who phoned.

**Chrome:** `DeskPageHeader` title **Calls** (matches nav). Caption is new count. Search is unique to this list.

Preserve: toolbar + search, dense table, pagination, `?from=` on detail, bare `/calls` defaults to New when work waits.

Columns: When / Caller / Lead / Follow-up / Open. Open goes to the transcript.

**Fix when touching:** empty-state hrefs must use `?tab=train` / `?tab=test` via `businessSettingsHref`, not `#train` / `#test`.
