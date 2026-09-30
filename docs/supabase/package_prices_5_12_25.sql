-- package_prices_5_12_25.sql
-- Purpose: Lock monthly prices. Each package includes 1 number.
--          Starter KES 5,000. Growth KES 12,000. Scale KES 25,000.
--          Annual stays monthly x 12 x (1 - discount %). Discount stays on the rate card.
--          Does not change included minutes, SMS, email, WhatsApp, or seats.
--          Does not charge a wallet. INSERT in package_catalog.sql does not update existing rows.
-- Run after: package_catalog.sql
-- Idempotent.

update public.billing_packages
set
  monthly_price_kes = case sku
    when 'starter' then 5000
    when 'growth' then 12000
    when 'scale' then 25000
    else monthly_price_kes
  end,
  dids = 1,
  updated_at = now()
where sku in ('starter', 'growth', 'scale');
