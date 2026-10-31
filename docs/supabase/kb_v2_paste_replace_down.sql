-- Rollback for kb_v2_paste_replace.sql (2026-10-28.3). Rows a Replace hid stay hidden (restore them from the Desk).
drop function if exists public.kb_import_items(uuid, text, jsonb, boolean);
