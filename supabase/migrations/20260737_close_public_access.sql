-- ═══════════════════════════════════════════════════════════════════════════
-- Close two holes the Supabase security advisor found, plus the class of bug
-- that produced them.
--
-- 1. public.task_transitions had no row level security AND `anon` held ALL on
--    it — readable, writable and deletable with nothing but the publishable
--    key. Deleting its rows makes the guardrail trigger reject every status
--    change in the panel; inserting rows widens what a member may do. The
--    table was created after the cutover migration, so it silently inherited
--    Supabase's default `grant all to anon` and was never revoked.
--
-- 2. Self-signup was enabled on the Auth project, and three policies were
--    written `using (true)` for any authenticated role. Anyone could register
--    through /auth/v1/signup and read the whole user roster, every shared
--    prompt and the settings row. Verified before this migration: a session
--    with no matching public.users row saw 4 users, 7 prompts, 1 settings row.
--    Every policy now requires a linked, active AGNUS account.
--
-- The root cause of (1) is fixed at the end: `anon` no longer inherits rights
-- on tables created here in future, so a new table is closed until somebody
-- grants it open on purpose.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ─── Identity helpers move out of the REST-exposed schema ───────────────────
-- `security definer` functions in `public` are published as RPC endpoints, so
-- current_app_user_id() and is_admin() were callable by anyone holding the
-- publishable key. They leak nothing — they answer about the caller — but an
-- authorization primitive has no business being an endpoint. PostgREST exposes
-- only `public` and `graphql_public`, so `private` is reachable from policies
-- and triggers and from nowhere else.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create or replace function private.current_app_user_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.users
  where auth_user_id = auth.uid()
    and is_active
  limit 1;
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select role = 'admin'
      from public.users
      where auth_user_id = auth.uid()
        and is_active
      limit 1
    ),
    false
  );
$$;

revoke all on function private.current_app_user_id() from public;
revoke all on function private.is_admin() from public;
grant execute on function private.current_app_user_id() to authenticated, service_role;
grant execute on function private.is_admin() to authenticated, service_role;

-- ─── Trigger functions: fixed search_path, and not callable over REST ────────
-- Every function below is reached through a trigger. A trigger fires the
-- function as the table owner regardless of who may EXECUTE it, so revoking
-- EXECUTE removes the RPC endpoint without touching the guardrails.

create or replace function public.enforce_task_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id text := private.current_app_user_id();
  actor_is_admin boolean := private.is_admin();
  allowed boolean;
begin
  if actor_id is null then
    raise exception 'No active AGNUS account is linked to this session';
  end if;

  if not actor_is_admin and old.assigned_to is distinct from actor_id then
    raise exception 'You can only change tasks assigned to you';
  end if;

  -- Columns only an admin may write.
  if not actor_is_admin then
    if new.assigned_to        is distinct from old.assigned_to
      or new.task_id            is distinct from old.task_id
      or new.body               is distinct from old.body
      or new.admin_notes        is distinct from old.admin_notes
      or new.admin_verdict      is distinct from old.admin_verdict
      or new.admin_verdict_date is distinct from old.admin_verdict_date
      or new.payment_status     is distinct from old.payment_status
      or new.payment_amount_usd is distinct from old.payment_amount_usd
      or new.payment_date       is distinct from old.payment_date
      or new.deleted_at         is distinct from old.deleted_at
      or new.deleted_by         is distinct from old.deleted_by
      or new.created            is distinct from old.created
    then
      raise exception 'Members cannot change assignment, review, payment or deletion fields';
    end if;
  end if;

  -- A status change must be a legal transition for the acting role.
  if new.status is distinct from old.status then
    select case when actor_is_admin then t.admin_allowed else t.assignee_allowed end
      into allowed
      from public.task_transitions t
     where t.from_status = old.status
       and t.to_status   = new.status;

    if not coalesce(allowed, false) then
      raise exception 'Moving a task from % to % is not allowed for this role',
        old.status, new.status;
    end if;

    -- A paid task cannot have its approval reopened until the payment is
    -- reverted first.
    if old.status = 'approved'
      and new.status <> 'approved'
      and old.payment_status = 'paid'
      and new.payment_status = 'paid'
    then
      raise exception 'Revert the payment before reopening an approved task';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.record_task_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  fields text[] := '{}';
begin
  if tg_op = 'INSERT' then
    insert into public.task_events (task_id, actor_id, from_status, to_status, changed_fields)
    values (new.id, private.current_app_user_id(), null, new.status, array['created']);
    return new;
  end if;

  if new.status          is distinct from old.status          then fields := array_append(fields, 'status'); end if;
  if new.assigned_to     is distinct from old.assigned_to     then fields := array_append(fields, 'assigned_to'); end if;
  if new.member_verdict  is distinct from old.member_verdict  then fields := array_append(fields, 'member_verdict'); end if;
  if new.admin_verdict   is distinct from old.admin_verdict   then fields := array_append(fields, 'admin_verdict'); end if;
  if new.admin_notes     is distinct from old.admin_notes     then fields := array_append(fields, 'admin_notes'); end if;
  if new.payment_status  is distinct from old.payment_status  then fields := array_append(fields, 'payment_status'); end if;
  if new.payment_amount_usd is distinct from old.payment_amount_usd then fields := array_append(fields, 'payment_amount_usd'); end if;
  if new.submission_prompt is distinct from old.submission_prompt then fields := array_append(fields, 'submission_prompt'); end if;
  if new.submission_dsp  is distinct from old.submission_dsp  then fields := array_append(fields, 'submission_dsp'); end if;
  if new.submission_final_answer is distinct from old.submission_final_answer then fields := array_append(fields, 'submission_final_answer'); end if;
  if new.submission_notes is distinct from old.submission_notes then fields := array_append(fields, 'submission_notes'); end if;
  if new.studio_result   is distinct from old.studio_result   then fields := array_append(fields, 'studio_result'); end if;
  if new.deleted_at      is distinct from old.deleted_at      then fields := array_append(fields, 'deleted_at'); end if;

  if array_length(fields, 1) is null then
    return new;
  end if;

  insert into public.task_events (task_id, actor_id, from_status, to_status, changed_fields)
  values (new.id, private.current_app_user_id(), old.status, new.status, fields);

  return new;
end;
$$;

-- These three carried a mutable search_path, which lets whoever controls the
-- session's search_path decide what `now()` resolves to.
create or replace function public.stamp_task_updated()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated = now();
  return new;
end;
$$;

create or replace function public.set_prompt_updated_timestamp()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated = now();
  return new;
end;
$$;

create or replace function public.stamp_announcement_updated()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.announcement_text is distinct from old.announcement_text
     or new.announcement_level is distinct from old.announcement_level then
    new.announcement_updated = now();
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_task_transition()      from public, anon, authenticated;
revoke all on function public.record_task_event()            from public, anon, authenticated;
revoke all on function public.stamp_task_updated()           from public, anon, authenticated;
revoke all on function public.set_prompt_updated_timestamp() from public, anon, authenticated;
revoke all on function public.stamp_announcement_updated()   from public, anon, authenticated;

-- ─── Policies: require a linked, active AGNUS account ───────────────────────
-- `using (true)` meant "any authenticated role", and an Auth account is not an
-- AGNUS account. private.current_app_user_id() returns NULL for a session with
-- no active public.users row, so this is the line that turns a self-registered
-- stranger back into nobody.

drop policy if exists users_select on public.users;
create policy users_select on public.users
  for select to authenticated
  using (private.current_app_user_id() is not null);

drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select to authenticated
  using (private.is_admin() or assigned_to = private.current_app_user_id());

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert to authenticated
  with check (private.is_admin());

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update to authenticated
  using (private.is_admin() or assigned_to = private.current_app_user_id())
  with check (private.is_admin() or assigned_to = private.current_app_user_id());

-- settings_write used to be `for all`, which also matched SELECT and stacked a
-- second permissive read policy on top of settings_select for every member.
-- Split so each command has exactly one policy.
drop policy if exists settings_write on public.settings;

drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings
  for select to authenticated
  using (private.current_app_user_id() is not null);

drop policy if exists settings_insert on public.settings;
create policy settings_insert on public.settings
  for insert to authenticated
  with check (private.is_admin());

drop policy if exists settings_update on public.settings;
create policy settings_update on public.settings
  for update to authenticated
  using (private.is_admin())
  with check (private.is_admin());

drop policy if exists task_events_select on public.task_events;
create policy task_events_select on public.task_events
  for select to authenticated
  using (
    private.is_admin()
    or exists (
      select 1 from public.tasks t
      where t.id = task_events.task_id
        and t.assigned_to = private.current_app_user_id()
    )
  );

drop policy if exists prompts_select on public.prompts;
create policy prompts_select on public.prompts
  for select to authenticated
  using (
    private.current_app_user_id() is not null
    and (visibility = 'public' or owner_id = private.current_app_user_id())
  );

drop policy if exists prompts_insert on public.prompts;
create policy prompts_insert on public.prompts
  for insert to authenticated
  with check (
    created_by = private.current_app_user_id()
    and (
      (visibility = 'personal' and owner_id = private.current_app_user_id())
      or (visibility = 'public' and owner_id is null and private.is_admin())
    )
  );

drop policy if exists prompts_update on public.prompts;
create policy prompts_update on public.prompts
  for update to authenticated
  using (
    created_by = private.current_app_user_id()
    or (visibility = 'public' and private.is_admin())
  )
  with check (
    created_by = private.current_app_user_id()
    or (visibility = 'public' and private.is_admin())
  );

drop policy if exists prompts_delete on public.prompts;
create policy prompts_delete on public.prompts
  for delete to authenticated
  using (
    case
      when visibility = 'public' then private.is_admin()
      else owner_id = private.current_app_user_id()
    end
  );

-- Nothing references the public copies now.
drop function if exists public.is_admin();
drop function if exists public.current_app_user_id();

-- ─── task_transitions: the advisor's critical finding ───────────────────────
-- The rulebook the guardrail trigger reads. The trigger is `security definer`
-- and owned by the table owner, so it keeps reading this table regardless of
-- what is revoked below.

alter table public.task_transitions enable row level security;

drop policy if exists task_transitions_select on public.task_transitions;
create policy task_transitions_select on public.task_transitions
  for select to authenticated
  using (private.current_app_user_id() is not null);

-- ─── Privileges: exactly what the client uses, and nothing else ─────────────
-- Every table here still carried the default `grant all to anon` and, on most
-- of them, `grant all to authenticated` — including TRUNCATE, which is not
-- subject to row level security at all.

revoke all on public.users            from anon, authenticated;
revoke all on public.tasks            from anon, authenticated;
revoke all on public.settings         from anon, authenticated;
revoke all on public.prompts          from anon, authenticated;
revoke all on public.task_events      from anon, authenticated;
revoke all on public.task_transitions from anon, authenticated;

-- users: column by column — `password` is gone, but so is anything added later
-- that nobody thought about.
grant select (
  id, username, email, name, role, avatar, is_active, created, updated, auth_user_id
) on public.users to authenticated;

grant select, insert, update         on public.tasks            to authenticated;
grant select, insert, update         on public.settings         to authenticated;  -- upsert
grant select, insert, update, delete on public.prompts          to authenticated;
grant select                         on public.task_events      to authenticated;  -- written by trigger
grant select                         on public.task_transitions to authenticated;

-- ─── Stop this recurring ────────────────────────────────────────────────────
-- task_transitions was open because a table created after the cutover inherited
-- Supabase's default `grant all to anon`. A new table is now closed until
-- somebody opens it deliberately.

alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;

-- ─── Advisor performance lints ──────────────────────────────────────────────
-- tasks.assigned_to is compared on every row of every member's policy check.

create index if not exists tasks_assigned_to_idx      on public.tasks (assigned_to);
create index if not exists task_events_actor_id_idx   on public.task_events (actor_id);
create index if not exists prompts_created_by_idx     on public.prompts (created_by);

-- Redundant: the `auth_user_id uuid unique` constraint already indexes it.
drop index if exists public.users_auth_user_id_idx;

commit;
