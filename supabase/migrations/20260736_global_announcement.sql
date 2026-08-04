-- ═══════════════════════════════════════════════════════════════════════════
-- A global announcement every signed-in member sees.
--
-- Lives on the existing single-row settings table rather than in a table of its
-- own: settings is already admin-write / everyone-read under RLS, already in the
-- Realtime publication, and already reconciled by the client. One notice needs
-- none of the machinery a second table would bring with it.
--
-- `announcement_updated` is what the dismissal is keyed on, so editing the text
-- brings the banner back for people who had already closed the previous one.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

alter table public.settings
  add column if not exists announcement_text text not null default '',
  add column if not exists announcement_level text not null default 'info',
  add column if not exists announcement_updated timestamptz;

alter table public.settings
  drop constraint if exists settings_announcement_level_check;

alter table public.settings
  add constraint settings_announcement_level_check
  check (announcement_level in ('info', 'warning', 'critical'));

comment on column public.settings.announcement_text is
  'Global notice shown to every signed-in member. Empty means no notice.';
comment on column public.settings.announcement_level is
  'info | warning | critical — drives the banner colour and icon.';
comment on column public.settings.announcement_updated is
  'Stamped whenever the text or level changes; the client keys dismissal on it.';

-- Stamp it in the database so a re-post of identical text still re-shows, and
-- so the value cannot depend on the posting browser's clock.
create or replace function public.stamp_announcement_updated()
returns trigger
language plpgsql
as $$
begin
  if new.announcement_text is distinct from old.announcement_text
     or new.announcement_level is distinct from old.announcement_level then
    new.announcement_updated = now();
  end if;
  return new;
end;
$$;

drop trigger if exists settings_stamp_announcement on public.settings;
create trigger settings_stamp_announcement
before update on public.settings
for each row execute function public.stamp_announcement_updated();

commit;
