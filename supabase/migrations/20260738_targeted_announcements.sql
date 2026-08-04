-- ═══════════════════════════════════════════════════════════════════════════
-- Announcements addressed to one person, not only to everyone.
--
-- The team-wide notice lived on the single-row settings table, which is exactly
-- as many announcements as that shape can hold. A table replaces it: one row per
-- notice, `target_user_id` null for everyone and set for one member. Several can
-- run at once, so "the whole team must upload by Friday" and "Nasim, your last
-- three came back for the same reason" coexist instead of overwriting.
--
-- Who may read a row is the interesting part, and it is enforced here rather
-- than by filtering in the client: a member's browser never receives a notice
-- addressed to somebody else, over REST or over the Realtime socket.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.announcements (
  id text primary key,
  body text not null check (char_length(btrim(body)) between 1 and 600),
  level text not null default 'info' check (level in ('info', 'warning', 'critical')),
  -- null means everyone. A member's notices leave with them.
  target_user_id text references public.users(id) on delete cascade,
  created_by text references public.users(id) on delete set null,
  created timestamptz not null default now(),
  updated timestamptz not null default now()
);

comment on column public.announcements.target_user_id is
  'NULL = the whole team. Otherwise the one member who sees it.';
comment on column public.announcements.updated is
  'Dismissal keys on this, so editing a notice brings it back for anyone who closed it.';

create index if not exists announcements_target_idx
  on public.announcements (target_user_id, created desc);

-- ─── One timestamp function instead of two ──────────────────────────────────
-- set_prompt_updated_timestamp() was already this exact function under a name
-- that claimed it belonged to prompts. Shared under a neutral name rather than
-- copied a third time.

create or replace function public.stamp_updated()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated = now();
  return new;
end;
$$;

drop trigger if exists prompts_set_updated on public.prompts;
create trigger prompts_set_updated
before update on public.prompts
for each row execute function public.stamp_updated();

drop trigger if exists announcements_set_updated on public.announcements;
create trigger announcements_set_updated
before update on public.announcements
for each row execute function public.stamp_updated();

drop function if exists public.set_prompt_updated_timestamp();

revoke all on function public.stamp_updated() from public, anon, authenticated;

-- ─── Who can see what ───────────────────────────────────────────────────────

alter table public.announcements enable row level security;

-- Admins manage the whole set, so they read all of it. Everybody else reads the
-- team-wide notices plus the ones addressed to them, and nothing else exists as
-- far as their session is concerned.
drop policy if exists announcements_select on public.announcements;
create policy announcements_select on public.announcements
  for select to authenticated
  using (
    private.is_admin()
    or (
      private.current_app_user_id() is not null
      and (target_user_id is null or target_user_id = private.current_app_user_id())
    )
  );

-- Separate per command rather than one `for all`: a `for all` policy also
-- matches SELECT and would stack a second permissive read policy on every row.
drop policy if exists announcements_insert on public.announcements;
create policy announcements_insert on public.announcements
  for insert to authenticated
  with check (private.is_admin() and created_by = private.current_app_user_id());

drop policy if exists announcements_update on public.announcements;
create policy announcements_update on public.announcements
  for update to authenticated
  using (private.is_admin())
  with check (private.is_admin());

drop policy if exists announcements_delete on public.announcements;
create policy announcements_delete on public.announcements
  for delete to authenticated
  using (private.is_admin());

revoke all on public.announcements from anon, authenticated;
grant select, insert, update, delete on public.announcements to authenticated;

-- ─── Carry the existing notice across ───────────────────────────────────────

insert into public.announcements (id, body, level, target_user_id, created_by, created, updated)
select
  'ann_' || replace(gen_random_uuid()::text, '-', ''),
  btrim(s.announcement_text),
  s.announcement_level,
  null,
  null,
  coalesce(s.announcement_updated, now()),
  coalesce(s.announcement_updated, now())
from public.settings s
where btrim(coalesce(s.announcement_text, '')) <> ''
  and not exists (select 1 from public.announcements);

drop trigger if exists settings_stamp_announcement on public.settings;
drop function if exists public.stamp_announcement_updated();

alter table public.settings
  drop column if exists announcement_text,
  drop column if exists announcement_level,
  drop column if exists announcement_updated;

alter table public.settings
  drop constraint if exists settings_announcement_level_check;

-- ─── Realtime ───────────────────────────────────────────────────────────────
-- `replica identity full` is required, not optional: without it an UPDATE or
-- DELETE on an RLS-filtered table carries only the primary key, which the
-- server cannot match against the policy, so the event is dropped rather than
-- delivered. This project has been bitten by exactly that before.

alter table public.announcements replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'announcements'
  ) then
    alter publication supabase_realtime add table public.announcements;
  end if;
end
$$;

commit;
