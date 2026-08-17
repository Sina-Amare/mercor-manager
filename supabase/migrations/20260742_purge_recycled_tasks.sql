-- ═══════════════════════════════════════════════════════════════════════════
-- Let an admin permanently remove a task that is already in the recycle bin.
--
-- Until now nothing could delete a task row: removal was soft, through
-- `deleted_at`, and `20260731_enable_rls.sql` deliberately left `tasks` with no
-- delete policy at all. That is still the right default — but a recycled task
-- keeps its Task ID reserved by the unique index
-- `tasks_task_id_unique_normalized`, so an ID can never be uploaded again while
-- its old row sits in the bin. Emptying the bin is how that ID is released.
--
-- The policy is deliberately narrower than "admins may delete tasks":
--
--   using (private.is_admin() and deleted_at is not null)
--
-- A live task cannot be hard-deleted by anyone, through any client, however the
-- request is shaped. Destroying a task therefore always takes two deliberate
-- steps — recycle it, then purge it — and the second one is only reachable from
-- a screen that exists for exactly that.
--
-- `task_events.task_id` cascades, so a purge takes the task's audit trail with
-- it. That is the intent: the row is gone, and a history of a task that no
-- longer exists is not worth the confusion of keeping.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks
  for delete to authenticated
  using (private.is_admin() and deleted_at is not null);

grant delete on public.tasks to authenticated;

commit;
