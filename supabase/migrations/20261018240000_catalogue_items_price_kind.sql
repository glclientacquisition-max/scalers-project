-- Structured catalogue prices on normalized catalogue_items (additive).
-- JSON catalogues on tenants stay the live source until cutover; voice reads these names.

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
  add column if not exists price_kind text,
  add column if not exists price_min numeric,
  add column if not exists price_max numeric;

do $$ begin
  alter table public.catalogue_items add constraint catalogue_items_price_kind_chk
    check (price_kind is null or price_kind in ('fixed', 'from', 'range', 'quote'));
exception when duplicate_object then null; end $$;

comment on column public.catalogue_items.price is 'Legacy free-text price; kept for older readers.';
comment on column public.catalogue_items.price_kind is 'fixed | from | range | quote (voice contract).';
comment on column public.catalogue_items.price_min is 'Amount or range low (KSh).';
comment on column public.catalogue_items.price_max is 'Range high (KSh); null for fixed/from/quote.';

commit;
