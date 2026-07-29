begin;

create table if not exists public.prompts (
  id text primary key,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  body text not null check (char_length(btrim(body)) between 1 and 50000),
  visibility text not null check (visibility in ('public', 'personal')),
  owner_id text references public.users(id) on delete cascade,
  created_by text references public.users(id) on delete set null,
  created timestamptz not null default now(),
  updated timestamptz not null default now(),
  constraint prompts_visibility_owner_check check (
    (visibility = 'public' and owner_id is null)
    or
    (visibility = 'personal' and owner_id is not null)
  )
);

create index if not exists prompts_visibility_updated_idx
  on public.prompts (visibility, updated desc);

create index if not exists prompts_owner_updated_idx
  on public.prompts (owner_id, updated desc);

create or replace function public.set_prompt_updated_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated = now();
  return new;
end;
$$;

drop trigger if exists prompts_set_updated on public.prompts;
create trigger prompts_set_updated
before update on public.prompts
for each row execute function public.set_prompt_updated_timestamp();

alter table public.prompts enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'prompts'
      and policyname = 'prompts_legacy_custom_auth_access'
  ) then
    create policy prompts_legacy_custom_auth_access
      on public.prompts
      for all
      to anon, authenticated
      using (true)
      with check (true);
  end if;
end
$$;

grant select, insert, update, delete on public.prompts to anon, authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'prompts'
  ) then
    alter publication supabase_realtime add table public.prompts;
  end if;
end
$$;

commit;
