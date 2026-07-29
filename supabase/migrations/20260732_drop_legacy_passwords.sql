-- ═══════════════════════════════════════════════════════════════════════════
-- Step 3 of 3: remove the browser-comparable password column.
--
-- Run once step 2 is live and everyone has signed in successfully through
-- Supabase Auth. After this, passwords exist only in auth.users, hashed, and
-- are reset through the admin-users Edge Function.
--
-- ⚠ Every password in this column was readable by anyone who loaded the public
-- site. Reset all of them, and rotate the Supabase anon key, before or
-- immediately after running this file. Dropping the column removes the leak,
-- not the exposure that already happened.
--
-- Check before running:
--   select count(*) from public.users where is_active and auth_user_id is null;
--   -- must be 0
-- ═══════════════════════════════════════════════════════════════════════════

begin;

do $$
begin
  if exists (
    select 1 from public.users where is_active and auth_user_id is null
  ) then
    raise exception
      'Refusing to drop passwords: % active account(s) are not linked to Supabase Auth yet',
      (select count(*) from public.users where is_active and auth_user_id is null);
  end if;
end
$$;

alter table public.users drop column if exists password;

commit;
