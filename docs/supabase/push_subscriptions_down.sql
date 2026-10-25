-- Rollback for docs/supabase/push_subscriptions.sql. Drops every saved phone-alert device.
-- Owners must turn phone alerts on again after a re-apply. SMS/WhatsApp/email are unaffected.
drop table if exists public.push_subscriptions;
