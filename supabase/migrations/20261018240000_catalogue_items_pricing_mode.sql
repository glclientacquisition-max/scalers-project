-- Structured catalogue prices on normalized catalogue_items (additive).
-- JSON catalogues on tenants stay the live source until cutover; voice reads pricing_mode / price / price_max.

begin;

create table if not exists public.catalogue_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('product', 'service')),
  item_key text not null,
  name text not null,
  price text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, kind, item_key)
);

alter table public.catalogue_items
  add column if not exists pricing_mode text,
  add column if not exists price_max numeric;

do $$ begin
  alter table public.catalogue_items add constraint catalogue_items_pricing_mode_chk
    check (
      pricing_mode is null
      or pricing_mode in ('fixed', 'from', 'range', 'ask', 'quote')
    );
exception when duplicate_object then null; end $$;

comment on column public.catalogue_items.price is 'Low amount or legacy display text; kept for older readers.';
comment on column public.catalogue_items.pricing_mode is 'fixed | from | range | ask (legacy) | quote.';
comment on column public.catalogue_items.price_max is 'Range high (KSh); null for fixed, from, and quote.';

commit;
