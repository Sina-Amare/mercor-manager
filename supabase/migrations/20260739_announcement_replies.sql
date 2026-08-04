-- ═══════════════════════════════════════════════════════════════════════════
-- Replies to announcements, for the people an admin chooses.
--
-- Not everyone. The permission is a column on public.users that only an admin
-- can set — and only through the admin-users Edge Function, because public.users
-- has no client write policy at all. A member cannot grant it to themselves,
-- and the check that matters is in the insert policy, not in the interface: a
-- browser that hides the reply box is a courtesy, the policy is the rule.
--
-- Who reads a reply: admins read all of them, and a member reads their own.
-- Replies are addressed to whoever posted the announcement, so a member never
-- sees what a colleague wrote back — including on a notice sent to everybody.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

alter table public.users
  add column if not exists can_reply_announcements boolean not null default false;

comment on column public.users.can_reply_announcements is
  'Admin-granted. Only these accounts may write to announcement_replies.';

-- The column list is exhaustive by design — anything added later is unreadable
-- until somebody decides it should be readable.
grant select (
  id, username, email, name, role, avatar, is_active, created, updated,
  auth_user_id, can_reply_announcements
) on public.users to authenticated;

create table if not exists public.announcement_replies (
  id text primary key,
  announcement_id text not null references public.announcements(id) on delete cascade,
  author_id text not null references public.users(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created timestamptz not null default now()
);

create index if not exists announcement_replies_announcement_idx
  on public.announcement_replies (announcement_id, created);

create index if not exists announcement_replies_author_idx
  on public.announcement_replies (author_id);

-- ─── May this session reply at all? ─────────────────────────────────────────
-- `security definer` and in `private`, like the other identity helpers: the
-- answer must not depend on what the caller can read, and it has no business
-- being a REST endpoint.

create or replace function private.can_reply_announcements()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select can_reply_announcements or role = 'admin'
      from public.users
      where auth_user_id = auth.uid()
        and is_active
      limit 1
    ),
    false
  );
$$;

revoke all on function private.can_reply_announcements() from public;
grant execute on function private.can_reply_announcements() to authenticated, service_role;

-- ─── Who can do what ────────────────────────────────────────────────────────

alter table public.announcement_replies enable row level security;

drop policy if exists announcement_replies_select on public.announcement_replies;
create policy announcement_replies_select on public.announcement_replies
  for select to authenticated
  using (private.is_admin() or author_id = private.current_app_user_id());

-- Three conditions, and the interesting one is the last: you may only reply to
-- a notice that was addressed to you. Without it, a permitted member could post
-- against the id of an announcement written for somebody else — an id they
-- never received, but ids are guessable and "they cannot see it" is not the
-- same as "they cannot write to it".
drop policy if exists announcement_replies_insert on public.announcement_replies;
create policy announcement_replies_insert on public.announcement_replies
  for insert to authenticated
  with check (
    author_id = private.current_app_user_id()
    and private.can_reply_announcements()
    and exists (
      select 1
      from public.announcements a
      where a.id = announcement_id
        and (a.target_user_id is null or a.target_user_id = private.current_app_user_id())
    )
  );

-- Withdrawing what you said is the reversible half of being able to say it.
drop policy if exists announcement_replies_delete on public.announcement_replies;
create policy announcement_replies_delete on public.announcement_replies
  for delete to authenticated
  using (private.is_admin() or author_id = private.current_app_user_id());

-- No update policy: a reply is a statement made at a time. Editing one after an
-- admin has read it would quietly rewrite the record.

revoke all on public.announcement_replies from anon, authenticated;
grant select, insert, delete on public.announcement_replies to authenticated;

-- ─── Realtime ───────────────────────────────────────────────────────────────
-- So an admin watching Settings sees an answer arrive rather than discovering
-- it tomorrow. `replica identity full` is required for UPDATE/DELETE events to
-- survive the policy filter.

alter table public.announcement_replies replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'announcement_replies'
  ) then
    alter publication supabase_realtime add table public.announcement_replies;
  end if;
end
$$;

commit;
