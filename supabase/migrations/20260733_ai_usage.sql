-- Per-user daily counter for the `ai` Edge Function.
--
-- The free tiers in play are shared and small, so one tab stuck in a retry loop
-- would otherwise spend everybody's budget for the day. Written only by the
-- function under the service role; members may read their own row so the
-- interface can show what is left.

begin;

create table if not exists public.ai_usage (
  user_id text not null references public.users(id) on delete cascade,
  day date not null,
  calls integer not null default 0,
  primary key (user_id, day)
);

alter table public.ai_usage enable row level security;

drop policy if exists ai_usage_select_own on public.ai_usage;
create policy ai_usage_select_own on public.ai_usage
  for select to authenticated
  using (user_id = public.current_app_user_id() or public.is_admin());

grant select on public.ai_usage to authenticated;

commit;
