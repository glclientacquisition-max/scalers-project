# Usage

**Route:** `/wallet`  
**Job:** Prepaid KES operational infrastructure. Not an analytics product. Desk destination name is Usage. Path and ledger stay `/wallet`.

**Hierarchy:** Large in-page Usage title (`deskListTitleClass`) plus Top up or Free beta on the same header row. No Wallet H1 and no product wordmark. Prepaid balance is the primary figure (`text-3xl sm:text-4xl`). Quiet runway caption under the balance when paid and 1 to 90 days (`walletRunwayLabel`, spend pace). Month billed or estimated, calls, minutes, line fee, and SMS used/included are supporting facts (`text-lg`), not a second dashboard. Transfer minutes appear only when a live-transfer outbound leg ran this month.

**Keep:** rates, ledger, on-demand, SMS used/included, top-up, beta caption. Ledger is a phone list below `md` and a dense table from `md`. Call rows with a ledger `reference_id` open the ticket. Estimated month uses inbound plus transfer rates. Do not invent KPIs.

**Warn:** `bg-warn-soft` when prepaid is empty or under the low threshold.
