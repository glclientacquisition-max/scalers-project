-- Roll back access_requests (staging only).

drop table if exists public.access_requests cascade;
