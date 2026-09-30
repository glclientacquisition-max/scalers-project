-- package_rate_card_ondemand_6_9.sql
-- Purpose: On-demand inbound KES 6/min (0.10/sec) and outbound KES 9/min (0.15/sec).
--          Outbound is stored for live transfer. Landing and Usage do not show it.
--          Does not change package monthly prices. Does not debit beta.
-- Run after: package_catalog.sql
-- Idempotent. CREATE TABLE defaults do not update an existing rate card row.

update public.billing_rate_card
set
  inbound_kes_per_second = 0.10,
  outbound_kes_per_second = 0.15,
  updated_at = now()
where id = 1;
