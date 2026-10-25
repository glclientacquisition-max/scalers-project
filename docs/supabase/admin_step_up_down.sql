-- Down for admin_step_up.sql. Removes every step-up object. Operators re-enrol after re-apply.
-- Turn ADMIN_STEP_UP_ENFORCE off first, or risky Admin writes will fail closed.
drop function if exists public.admin_step_up_reset(text, text, text);
drop table if exists public.admin_step_up_grant;
drop table if exists public.admin_step_up_backup_code;
drop table if exists public.admin_step_up_factor;
