begin;

create unique index if not exists tasks_task_id_unique_normalized
  on public.tasks (lower(btrim(task_id)));

create unique index if not exists users_username_unique_normalized
  on public.users (lower(btrim(username)));

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'tasks'
  ) then
    alter publication supabase_realtime add table public.tasks;
  end if;
end
$$;

commit;
