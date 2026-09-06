# Appointments

**Route:** `/appointments`  
**Job:** Confirm visits. Not the voice inbox.

**Layout:** `DeskPageHeader` + status `FilterTabs` + dense table + `Pagination`. Caption is requested count.

Columns: Visit (`when_text` or `window_start`) / Who / Place / Status. Primary verb is **Confirm**, then **Done**. Related transcript is **Call**.

**Empty:** No visits to confirm. Show all if other statuses exist.

**Do not:** lead with `created_at` as When. Copy Calls columns. Four equal status chips.
