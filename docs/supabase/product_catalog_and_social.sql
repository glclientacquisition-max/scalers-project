-- product_catalog_and_social.sql
-- Purpose: Separate retail product catalogue from services offerings, plus social handles.
-- Run after: business_operating_model.sql (and services_catalog.sql era)

alter table public.tenants
  add column if not exists product_catalog jsonb not null default '[]'::jsonb;

alter table public.tenants
  add column if not exists social_handles jsonb not null default '{}'::jsonb;

comment on column public.tenants.product_catalog is
  'Retail/product rows: [{name, sku, category, price, unit, in_stock, notes, aliases[]}]. Separate from services_catalog.';

comment on column public.tenants.social_handles is
  'Public contact channels: {channels:[{kind,label,value}]} — phones/WhatsApp/social/web. Legacy flat fields still accepted on read.';

-- Owners already UPDATE tenants via existing RLS; jsonb columns inherit that.
grant select, update (product_catalog, social_handles) on table public.tenants to authenticated;
