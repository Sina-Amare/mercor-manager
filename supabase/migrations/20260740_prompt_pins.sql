-- ═══════════════════════════════════════════════════════════════════════════
-- Pinned prompts, kept per person and ordered by that person.
--
-- A pin is a private preference, not a recommendation: nobody else sees what
-- you pinned, including an admin. So the policies here are the strictest in the
-- project — every one of them is `user_id = private.current_app_user_id()`,
-- with no is_admin() escape hatch anywhere.
--
-- Order is an integer per row rather than a position in a list, because the
-- rows arrive independently and two devices reordering at once must not be
-- able to interleave into something unreadable. Reordering rewrites every
-- affected row in one statement; with a handful of pins that is cheaper and far
-- simpler than fractional keys, and the client sends the whole order it wants.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.prompt_pins (
  user_id text not null references public.users(id) on delete cascade,
  prompt_id text not null references public.prompts(id) on delete cascade,
  -- Deliberately not unique: a rewrite of the whole order would collide with
  -- itself mid-statement, and a duplicate here costs nothing — `created` breaks
  -- the tie and the next reorder cleans it up.
  sort_order integer not null default 0,
  created timestamptz not null default now(),
  primary key (user_id, prompt_id)
);

comment on table public.prompt_pins is
  'Per-person pinned prompts. Private: not visible to other members or to admins.';

create index if not exists prompt_pins_user_order_idx
  on public.prompt_pins (user_id, sort_order, created);

-- Deleting a prompt takes its pins with it, which is what the cascade above is
-- for — otherwise every pinner keeps a row pointing at nothing.

alter table public.prompt_pins enable row level security;

drop policy if exists prompt_pins_select on public.prompt_pins;
create policy prompt_pins_select on public.prompt_pins
  for select to authenticated
  using (user_id = private.current_app_user_id());

-- You may only pin something you can actually see. `prompts` has its own row
-- level security, so this subquery is already narrowed to public prompts plus
-- your own — a pin cannot be used to confirm that somebody else's personal
-- prompt exists.
drop policy if exists prompt_pins_insert on public.prompt_pins;
create policy prompt_pins_insert on public.prompt_pins
  for insert to authenticated
  with check (
    user_id = private.current_app_user_id()
    and exists (select 1 from public.prompts p where p.id = prompt_id)
  );

drop policy if exists prompt_pins_update on public.prompt_pins;
create policy prompt_pins_update on public.prompt_pins
  for update to authenticated
  using (user_id = private.current_app_user_id())
  with check (user_id = private.current_app_user_id());

drop policy if exists prompt_pins_delete on public.prompt_pins;
create policy prompt_pins_delete on public.prompt_pins
  for delete to authenticated
  using (user_id = private.current_app_user_id());

revoke all on public.prompt_pins from anon, authenticated;
grant select, insert, update, delete on public.prompt_pins to authenticated;

-- ─── Realtime ───────────────────────────────────────────────────────────────
-- Pinning on the laptop should show on the desktop. `replica identity full`
-- again: without it an UPDATE or DELETE carries only the key columns and the
-- server cannot match the row against the policy, so the event is dropped.

alter table public.prompt_pins replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'prompt_pins'
  ) then
    alter publication supabase_realtime add table public.prompt_pins;
  end if;
end
$$;

commit;
