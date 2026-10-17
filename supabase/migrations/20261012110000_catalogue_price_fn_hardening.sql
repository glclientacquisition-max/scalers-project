-- Catalogue price history functions: clear two advisor warnings. No behaviour change.
-- 1. Pin search_path on the item-key helper (function_search_path_mutable).
alter function public._catalogue_item_key(jsonb) set search_path = public;
-- 2. The history trigger function is only ever run by its trigger; nobody calls it directly.
revoke all on function public._record_catalogue_prices() from public, anon, authenticated;
