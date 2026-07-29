-- ═══════════════════════════════════════════════════════════════════════════
-- Step 2 of 3: the cutover. Revokes anonymous access, enables row level
-- security, and turns on the workflow guardrail trigger.
--
-- ⚠ Run this ONLY when both of these are true, or you will lock everyone out:
--   1. Every active row in public.users has a non-null auth_user_id
--      (the admin-users Edge Function `backfill` action does this), and
--   2. the AGNUS build that signs in through Supabase Auth is deployed.
--
-- Check before running:
--   select id, username from public.users where is_active and auth_user_id is null;
--   -- must return zero rows
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ─── End anonymous access ───────────────────────────────────────────────────

revoke all on public.users     from anon;
revoke all on public.tasks     from anon;
revoke all on public.settings  from anon;
revoke all on public.prompts   from anon;

-- public.users is readable by signed-in members (they need assignee names), but
-- only column by column — `password` is not in the list, so it stops being
-- readable here even before step 3 drops it. All writes go through the
-- admin-users Edge Function under the service role.
revoke all on public.users from authenticated;
grant select (
  id, username, email, name, role, avatar, is_active, created, updated, auth_user_id
) on public.users to authenticated;

grant select, insert, update on public.tasks    to authenticated;
grant select, insert, update on public.settings to authenticated;
grant select, insert, update, delete on public.prompts to authenticated;

-- ─── Guardrail trigger ──────────────────────────────────────────────────────
-- Enforces the two things React cannot: that a status change is a legal
-- transition for the acting role, and that members never write admin-only or
-- money columns.
--
-- Optimistic concurrency deliberately stays in the client's `.eq('updated', …)`
-- WHERE clause rather than becoming a monotonic check here. Device clocks
-- drift, so comparing client-supplied timestamps would reject honest writes;
-- the WHERE clause is evaluated against the pre-update row, so it is exact.

create or replace function public.enforce_task_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id text := public.current_app_user_id();
  actor_is_admin boolean := public.is_admin();
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

drop trigger if exists tasks_enforce_transition on public.tasks;
create trigger tasks_enforce_transition
before update on public.tasks
for each row execute function public.enforce_task_transition();

-- ─── Row level security ─────────────────────────────────────────────────────

alter table public.users       enable row level security;
alter table public.tasks       enable row level security;
alter table public.settings    enable row level security;
alter table public.task_events enable row level security;

-- Drop every pre-existing policy on these tables before installing ours.
--
-- This project carried dormant "Public <table> access" policies granting ALL to
-- role `public` with `using (true)`. They were invisible while RLS was off, and
-- because permissive policies OR together, enabling RLS would have activated
-- them and left the tables wide open to any signed-in user. Sweeping by name
-- rather than dropping three known ones also catches anything added later.
do $$
declare
  policy_record record;
  expected text[] := array[
    'users_select',
    'tasks_select', 'tasks_insert', 'tasks_update',
    'settings_select', 'settings_write',
    'task_events_select',
    'prompts_select', 'prompts_insert', 'prompts_update', 'prompts_delete'
  ];
begin
  for policy_record in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('users', 'tasks', 'settings', 'task_events', 'prompts')
      and not (policyname = any (expected))
  loop
    raise notice 'dropping legacy policy % on %', policy_record.policyname, policy_record.tablename;
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_record.policyname, policy_record.schemaname, policy_record.tablename
    );
  end loop;
end
$$;

-- users: every signed-in account can read the roster (assignee names, avatars).
-- No client writes at all.
drop policy if exists users_select on public.users;
create policy users_select on public.users
  for select to authenticated
  using (true);

-- tasks: admins see everything, members see only their own.
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select to authenticated
  using (public.is_admin() or assigned_to = public.current_app_user_id());

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert to authenticated
  with check (public.is_admin());

-- Column-level and transition rules are enforced by the trigger above.
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update to authenticated
  using (public.is_admin() or assigned_to = public.current_app_user_id())
  with check (public.is_admin() or assigned_to = public.current_app_user_id());

-- No delete policy: removal is soft, through deleted_at.

drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings
  for select to authenticated
  using (true);

drop policy if exists settings_write on public.settings;
create policy settings_write on public.settings
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists task_events_select on public.task_events;
create policy task_events_select on public.task_events
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.tasks t
      where t.id = task_events.task_id
        and t.assigned_to = public.current_app_user_id()
    )
  );

-- ─── Replace the wide-open prompts policy ───────────────────────────────────
-- The previous policy was `using (true) with check (true)` for anon, which made
-- every personal prompt world-readable. These mirror canEditPrompt /
-- canDeletePrompt in src/api/prompts.ts.

drop policy if exists prompts_legacy_custom_auth_access on public.prompts;
alter table public.prompts enable row level security;

drop policy if exists prompts_select on public.prompts;
create policy prompts_select on public.prompts
  for select to authenticated
  using (visibility = 'public' or owner_id = public.current_app_user_id());

drop policy if exists prompts_insert on public.prompts;
create policy prompts_insert on public.prompts
  for insert to authenticated
  with check (
    created_by = public.current_app_user_id()
    and (
      (visibility = 'personal' and owner_id = public.current_app_user_id())
      or (visibility = 'public' and owner_id is null and public.is_admin())
    )
  );

drop policy if exists prompts_update on public.prompts;
create policy prompts_update on public.prompts
  for update to authenticated
  using (
    created_by = public.current_app_user_id()
    or (visibility = 'public' and public.is_admin())
  )
  with check (
    created_by = public.current_app_user_id()
    or (visibility = 'public' and public.is_admin())
  );

drop policy if exists prompts_delete on public.prompts;
create policy prompts_delete on public.prompts
  for delete to authenticated
  using (
    case
      when visibility = 'public' then public.is_admin()
      else owner_id = public.current_app_user_id()
    end
  );

commit;
