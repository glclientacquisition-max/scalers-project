# Calls

**Route:** `/calls`  
**Role:** Benchmark inbox. Do not redesign.

Preserve: toolbar + search, dense table, pagination, `?from=` on detail, bare `/calls` defaults to New when work waits.

**Fix when touching:** empty-state hrefs must use `?tab=train` / `?tab=test` via `businessSettingsHref`, not `#train` / `#test`.
