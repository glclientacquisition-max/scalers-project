# Requests

**Route:** `/requests`  
**Job:** Fulfill holds, orders, enquiries, callbacks. Not the voice inbox.

**Layout:** `DeskPageHeader` + one status `FilterTabs` + dense table + `Pagination`. Open count is tenant-wide.

Columns: Item / Who / Needed / Status. Primary verb is **Done**. Related transcript is **Call**, not Open.

**Empty:** Nothing to fulfill. Show all if other statuses exist.

**Do not:** copy Calls columns. A second type-filter bar. Stacked cards. KPI tiles.
