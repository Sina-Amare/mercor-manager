-- ═══════════════════════════════════════════════════════════════════════════
-- The weekly ledger: hours owed, hours actually logged, and what is due.
--
-- A week runs Friday → Thursday and is keyed by the Friday it starts on, so a
-- week has exactly one row and two dates can never disagree about which week
-- they belong to.
--
-- Two things are deliberately separate, because they answer different
-- questions and drift apart in practice:
--
--   * what the work is WORTH — tasks × hours_per_task, and tasks × usd_per_task
--   * what was actually LOGGED into Insightful — the difference between two
--     readings of a cumulative meter
--
-- The gap between them is the debt carried into the following week, and
-- `carry_in_hours` is where an admin puts a debt that predates this ledger or
-- never went through Insightful at all.
--
-- Rates live on the week, not on a global settings row. They are "fixed for
-- now" at 2h/$4 for AGNUS and 4h/$8 for Chromium, but a rate change must not
-- silently rewrite what last month was worth.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.work_weeks (
  id text primary key,
  -- Always a Friday. The client derives it; the check keeps a hand-written
  -- INSERT from creating a week nothing can find again.
  starts_on date not null unique check (extract(isodow from starts_on) = 5),
  notes text not null default '',
  created timestamptz not null default now(),
  updated timestamptz not null default now()
);

comment on table public.work_weeks is
  'One row per Friday-to-Thursday week in the payment ledger. Admin only.';

drop trigger if exists work_weeks_set_updated on public.work_weeks;
create trigger work_weeks_set_updated
before update on public.work_weeks
for each row execute function public.stamp_updated();

-- ─── Per project, per week ──────────────────────────────────────────────────

create table if not exists public.work_week_projects (
  week_id text not null references public.work_weeks(id) on delete cascade,
  project text not null check (project in ('agnus', 'chromium')),
  tasks_done integer not null default 0 check (tasks_done >= 0),
  -- AGNUS task counts are suggested from the real task data. This records that
  -- the admin typed a number instead, so a later recount cannot quietly
  -- overwrite a deliberate figure.
  tasks_done_is_manual boolean not null default false,
  hours_per_task numeric(6, 2) not null default 0 check (hours_per_task >= 0),
  usd_per_task numeric(10, 2) not null default 0 check (usd_per_task >= 0),
  -- Hours owed from before that never went through the tracker. Added on top
  -- of what this week's tasks are worth.
  carry_in_hours numeric(7, 2) not null default 0,
  -- Readings of Insightful's cumulative meter, in minutes. NULL means "not
  -- recorded yet", which is not the same as zero.
  tracker_start_minutes integer check (tracker_start_minutes >= 0),
  tracker_end_minutes integer check (tracker_end_minutes >= 0),
  primary key (week_id, project)
);

comment on column public.work_week_projects.carry_in_hours is
  'Hours owed from earlier that were never tracked. Added to what this week is worth.';
comment on column public.work_week_projects.tracker_start_minutes is
  'Insightful meter reading when the week started, in minutes. NULL = not recorded.';

-- ─── Per person, per project, per week ──────────────────────────────────────

create table if not exists public.work_week_members (
  week_id text not null references public.work_weeks(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  project text not null check (project in ('agnus', 'chromium')),
  tasks_done integer not null default 0 check (tasks_done >= 0),
  primary key (week_id, user_id, project)
);

create index if not exists work_week_members_user_idx
  on public.work_week_members (user_id);

-- ─── Bonuses ────────────────────────────────────────────────────────────────
-- One row per bonused task rather than a count and an amount, because the
-- amount varies per task. Counting the rows answers "how many of their tasks
-- had a bonus" and summing them answers "how much" — neither is typed twice.

create table if not exists public.work_week_bonuses (
  id text primary key,
  week_id text not null references public.work_weeks(id) on delete cascade,
  user_id text references public.users(id) on delete set null,
  project text not null check (project in ('agnus', 'chromium')),
  amount_usd numeric(10, 2) not null default 0,
  note text not null default '',
  created timestamptz not null default now()
);

create index if not exists work_week_bonuses_week_idx
  on public.work_week_bonuses (week_id, created);

-- ─── Who can see any of this ────────────────────────────────────────────────
-- Everything here is money and workload across the whole team, so it is admin
-- only, on every command, with no member escape hatch.

alter table public.work_weeks         enable row level security;
alter table public.work_week_projects enable row level security;
alter table public.work_week_members  enable row level security;
alter table public.work_week_bonuses  enable row level security;

do $$
declare
  ledger_table text;
begin
  foreach ledger_table in array array[
    'work_weeks', 'work_week_projects', 'work_week_members', 'work_week_bonuses'
  ]
  loop
    execute format('drop policy if exists %I_select on public.%I', ledger_table, ledger_table);
    execute format(
      'create policy %I_select on public.%I for select to authenticated using (private.is_admin())',
      ledger_table, ledger_table
    );

    execute format('drop policy if exists %I_insert on public.%I', ledger_table, ledger_table);
    execute format(
      'create policy %I_insert on public.%I for insert to authenticated with check (private.is_admin())',
      ledger_table, ledger_table
    );

    execute format('drop policy if exists %I_update on public.%I', ledger_table, ledger_table);
    execute format(
      'create policy %I_update on public.%I for update to authenticated using (private.is_admin()) with check (private.is_admin())',
      ledger_table, ledger_table
    );

    execute format('drop policy if exists %I_delete on public.%I', ledger_table, ledger_table);
    execute format(
      'create policy %I_delete on public.%I for delete to authenticated using (private.is_admin())',
      ledger_table, ledger_table
    );

    execute format('revoke all on public.%I from anon, authenticated', ledger_table);
    execute format(
      'grant select, insert, update, delete on public.%I to authenticated', ledger_table
    );

    execute format('alter table public.%I replica identity full', ledger_table);

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = ledger_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', ledger_table);
    end if;
  end loop;
end
$$;

commit;
