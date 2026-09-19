# Wallet

**Route:** `/wallet`  
**Job:** Prepaid KES operational infrastructure. Not an analytics product.

**Hierarchy:** No Wallet H1. Prepaid balance is the primary figure (`text-3xl sm:text-4xl`). Month billed, calls, minutes, and line fee are supporting facts (`text-lg`), not a second dashboard.

**Keep:** rates, ledger as a dense table, on-demand, SMS used/included, top-up, beta caption. Do not invent KPIs.

**Warn:** `bg-warn-soft` when prepaid is empty or under the low threshold.
