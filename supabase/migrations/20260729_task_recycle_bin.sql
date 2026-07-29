begin;

alter table public.tasks
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text;

create index if not exists tasks_deleted_at_idx
  on public.tasks (deleted_at);

comment on column public.tasks.deleted_at is
  'Soft-delete timestamp. Non-null tasks stay in the recycle bin and remain part of duplicate detection.';

comment on column public.tasks.deleted_by is
  'Application user id that moved the task to the recycle bin.';

commit;
