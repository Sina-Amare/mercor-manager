-- ═══════════════════════════════════════════════════════════════════════════
-- Make Realtime actually deliver task changes.
--
-- Two separate faults, found after a studio result saved on one laptop never
-- appeared on another:
--
-- 1. `public.tasks` was never in the supabase_realtime publication — only
--    `prompts` was. Task changes have never been broadcast on this project.
--    Nobody noticed because the app used to re-read every task every four
--    seconds, which hid it completely. Removing that poll made a latent defect
--    visible. `users` and `settings` were missing too, so their subscriptions
--    were dead as well.
--
-- 2. REPLICA IDENTITY was DEFAULT everywhere. With RLS enabled, Realtime has to
--    evaluate the policy against the row to decide who may receive an event; on
--    UPDATE the old tuple carries only the primary key under DEFAULT, so those
--    checks fail and the events are dropped. RLS-protected tables need FULL.
--
-- The WAL cost of FULL is the whole old row per update. On a table of this size,
-- with a handful of writes a day, that is nothing.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

alter table public.tasks       replica identity full;
alter table public.users       replica identity full;
alter table public.settings    replica identity full;
alter table public.prompts     replica identity full;

do $$
declare
  target text;
begin
  foreach target in array array['tasks', 'users', 'settings', 'prompts'] loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = target
    ) then
      execute format('alter publication supabase_realtime add table public.%I', target);
      raise notice 'added public.% to supabase_realtime', target;
    end if;
  end loop;
end
$$;

commit;
