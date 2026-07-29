-- ═══════════════════════════════════════════════════════════════════════════
-- Step 1 of 3: link app users to Supabase Auth, add workflow guardrails and an
-- audit trail. Safe to run immediately — this file does NOT enable RLS and does
-- NOT drop the password column, so nobody is locked out.
--
-- Run order:
--   20260730_auth_link_and_guardrails.sql   <- this file
--   (then back-fill auth identities via the admin-users Edge Function)
--   20260731_enable_rls.sql
--   20260732_drop_legacy_passwords.sql
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ─── Auth identity link ─────────────────────────────────────────────────────
-- public.users keeps its text primary key: tasks.assigned_to, tasks.deleted_by,
-- prompts.owner_id and prompts.created_by all reference it.

alter table public.users
  add column if not exists auth_user_id uuid unique references auth.users(id) on delete cascade;

create index if not exists users_auth_user_id_idx on public.users (auth_user_id);

-- ─── Identity helpers ───────────────────────────────────────────────────────
-- Both return NULL/false for unlinked or deactivated accounts, so every policy
-- built on them denies by default.

create or replace function public.current_app_user_id()
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

create or replace function public.is_admin()
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

-- Privileges are left untouched here on purpose: revoking anonymous access is
-- the cutover, and it belongs with the client release that adds Auth login.
-- Step 2 does it.

-- ─── Workflow transitions ───────────────────────────────────────────────────
-- The single source of truth for "who may move a task from where to where".
-- src/workflow.ts mirrors this table; keep the two in step.

create table if not exists public.task_transitions (
  from_status text not null,
  to_status text not null,
  admin_allowed boolean not null default false,
  assignee_allowed boolean not null default false,
  primary key (from_status, to_status)
);

delete from public.task_transitions;
insert into public.task_transitions (from_status, to_status, admin_allowed, assignee_allowed) values
  -- pick up and put back down
  ('assigned',         'working',          true,  true),
  ('working',          'assigned',         true,  true),

  -- record a verdict, and take it back
  ('working',          'swf',              true,  true),
  ('working',          'swof',             true,  true),
  ('working',          'member_discarded', true,  true),
  ('swf',              'working',          true,  true),
  ('swof',             'working',          true,  true),
  ('member_discarded', 'working',          true,  true),

  -- correct a verdict without losing the submission (sideways)
  ('swf',              'swof',             true,  true),
  ('swof',             'swf',              true,  true),
  ('swf',              'member_discarded', true,  true),
  ('swof',             'member_discarded', true,  true),
  ('member_discarded', 'swf',              true,  true),
  ('member_discarded', 'swof',             true,  true),

  -- admin pipeline
  ('swf',              'in_studio',        true,  false),
  ('swof',             'in_studio',        true,  false),
  ('member_discarded', 'in_studio',        true,  false),
  ('swf',              'on_hold',          true,  false),
  ('swof',             'on_hold',          true,  false),
  ('member_discarded', 'on_hold',          true,  false),
  ('on_hold',          'in_studio',        true,  false),
  ('on_hold',          'swf',              true,  false),
  ('on_hold',          'swof',             true,  false),
  ('on_hold',          'member_discarded', true,  false),
  ('on_hold',          'working',          true,  false),
  ('in_studio',        'in_review',        true,  false),
  ('in_studio',        'on_hold',          true,  false),
  ('in_studio',        'swf',              true,  false),
  ('in_studio',        'swof',             true,  false),
  ('in_studio',        'member_discarded', true,  false),
  ('in_review',        'approved',         true,  false),
  ('in_review',        'sent_back',        true,  false),
  ('in_review',        'admin_discarded',  true,  false),
  ('in_review',        'in_studio',        true,  false),

  -- reopen a decision
  ('approved',         'in_review',        true,  false),
  ('sent_back',        'in_review',        true,  false),
  ('admin_discarded',  'in_review',        true,  false),

  -- the member picks the work back up after a send-back
  ('sent_back',        'working',          true,  true);

grant select on public.task_transitions to authenticated;

-- The trigger that enforces this table lives in step 2: it rejects writes from
-- sessions with no linked account, which is every session until the client
-- release that adds Auth login goes out.

-- ─── Audit trail ────────────────────────────────────────────────────────────
-- "Who changed this, when, and from what" — the record that makes it safe to
-- offer one-click reversals and sideways verdict corrections.

create table if not exists public.task_events (
  id bigserial primary key,
  task_id text not null references public.tasks(id) on delete cascade,
  actor_id text references public.users(id) on delete set null,
  from_status text,
  to_status text,
  changed_fields text[] not null default '{}',
  at timestamptz not null default now()
);

create index if not exists task_events_task_at_idx
  on public.task_events (task_id, at desc);

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
    values (new.id, public.current_app_user_id(), null, new.status, array['created']);
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
  values (new.id, public.current_app_user_id(), old.status, new.status, fields);

  return new;
end;
$$;

drop trigger if exists tasks_record_event on public.tasks;
create trigger tasks_record_event
after insert or update on public.tasks
for each row execute function public.record_task_event();

grant select on public.task_events to authenticated;

commit;
