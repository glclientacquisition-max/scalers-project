# Usage page meter

**Status:** Implementing in #422  
**Lane:** Desk UI/UX + Ops display math  
**Route:** `/wallet` (nav name Usage). Path stays `/wallet`.

## Job

Prepaid KES operational infrastructure. Not an analytics product.

## Functionality

1. Month call minutes split inbound vs live-transfer outbound (`calls.summary.kind === live_transfer` and `direction === outbound`).
2. Estimated month cost uses both rate-card rates. Inbound default is KES 0. Transfer default is KES 4.
3. Runway days use spend pace when Usage has it (beta: estimated call cost. Paid: ledger `call_charge` total). Home keeps the light duration query and inbound rate.
4. Ledger `call_charge` rows with `reference_id` open `/calls/[id]`.
5. No new RPCs, SQL, or wallet ledger write rules.

## Page

- Title Usage. Top up (or Free beta) on the same header row.
- Prepaid balance primary. Runway caption under the balance when paid and 1 to 90 days.
- Supporting facts: billed or estimated month, calls, minutes, transfer minutes when > 0, line fee, SMS used/included.
- Rate card stays.
- Recent activity: phone list below `md`, dense table from `md`. One dataset.
- On-demand and top-up stay.

## Out of scope

Soft spend UI (removed). Period picker. Email or seat packs. Nairobi month boundaries. M-Pesa live rails.
