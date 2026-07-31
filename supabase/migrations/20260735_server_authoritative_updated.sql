-- ═══════════════════════════════════════════════════════════════════════════
-- Let the database own `tasks.updated`.
--
-- It was whatever the writing browser's clock said. Two laptops in this project
-- already disagree by about a minute, which means "last activity" ordering and
-- the optimistic-concurrency token both depended on whose clock was fastest.
-- now() is one clock for everyone.
--
-- The client's `.eq('updated', …)` guard still works: it compares against the
-- value the server previously returned, which is now server-stamped.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.stamp_task_updated()
returns trigger
language plpgsql
as $$
begin
  new.updated = now();
  return new;
end;
$$;

drop trigger if exists tasks_stamp_updated on public.tasks;

-- Postgres fires BEFORE triggers in name order, so this runs after
-- tasks_enforce_transition. That is fine: the guard checks status, role and
-- column permissions, none of which involve `updated`.
create trigger tasks_stamp_updated
before update on public.tasks
for each row execute function public.stamp_task_updated();

commit;
