# Usage

**Route:** `/wallet`  
**Job:** Package remaining buckets. Not an analytics product. Desk destination name is Usage. Path and ledger stay `/wallet`.

**Hierarchy:** Large in-page Usage title (`deskListTitleClass`). No Wallet H1 and no product wordmark. Minutes left is the primary figure (`text-3xl sm:text-4xl`). Used/included for minutes, SMS, email, WhatsApp, and seats are supporting facts (`text-lg`). Rate card sits under that.

**Keep:** package name and period, rate card, ledger as a dense table, on-demand, beta caption. Do not invent KPIs. No owner checkout or prepaid top-up on this page. Activity uses `Pagination` at 25 rows (`?page=`). A page past the end returns to the last page.

**Warn:** `bg-warn-soft` when an included bucket is empty and on-demand is off (skip for beta).
