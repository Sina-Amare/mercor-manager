# Supabase setup

Copy `.env.example` to `.env` and fill in the project URL and publishable key
from your own project. There is no hardcoded fallback any more: a missing value
fails at boot instead of silently pointing at somebody else's database. Never
put a service-role key in a Vite variable.

## Migrations

Apply in filename order through the SQL editor.

| File | What it does | Safe to run any time? |
|---|---|---|
| `20260728_realtime_task_integrity.sql` | Realtime on `tasks`; case-insensitive unique task IDs and usernames | yes |
| `20260729_prompts_workspace.sql` | Shared and personal prompt library | yes |
| `20260729_task_recycle_bin.sql` | Soft delete columns | yes |
| `20260729_task_submission_details.sql` | Shared submission fields | yes |
| `20260730_auth_link_and_guardrails.sql` | `auth_user_id` link, identity helpers, transition table, audit trail | **yes — purely additive** |
| `20260731_enable_rls.sql` | Ends anonymous access, enables RLS, turns on the guardrail trigger | **no — this is the cutover** |
| `20260732_drop_legacy_passwords.sql` | Drops the browser-readable password column | after everyone has signed in |
| `20260733_ai_usage.sql` | Per-user daily AI counter | optional, with `docs/AI.md` |

## The authentication cutover

The old login read `public.users` and compared the password in the browser,
which means every password was readable by anyone who opened the site. Moving to
Supabase Auth is a three-step sequence, in this order:

1. **Apply `20260730_auth_link_and_guardrails.sql`.** Additive only — the
   running app keeps working.

2. **Deploy `admin-users` and back-fill identities.**

   ```bash
   supabase functions deploy admin-users
   supabase secrets set MIGRATION_SECRET=<one-time value>

   curl -X POST "$SUPABASE_URL/functions/v1/admin-users" \
     -H 'Content-Type: application/json' \
     -d '{"action":"backfill","secret":"<one-time value>"}'
   ```

   This creates a Supabase Auth identity per legacy row and links it. Accounts
   whose stored password is shorter than eight characters are reported back and
   need a password reset from Settings instead. Verify before continuing:

   ```sql
   select id, username from public.users where is_active and auth_user_id is null;
   -- must return zero rows
   ```

3. **Deploy the new frontend, then apply `20260731_enable_rls.sql`.** That file
   revokes anonymous access, so it must not run before the build that signs in
   through Supabase Auth is live. Finish with
   `20260732_drop_legacy_passwords.sql`.

Members keep signing in with the username they already use — the client derives
`username@agnus.local` as the Auth address, and the Edge Function creates the
same one.

**Rotate everything afterwards.** Every password in that column, and the anon
key, were readable from the public site and are in git history. Dropping the
column removes the leak, not the exposure that already happened.

## What the database now enforces

Role checks used to live only in React, which meant anyone holding the public
key could set any status or payment on any task. Now:

- **`tasks`** — members select and update only their own rows; only admins
  insert; nobody deletes (removal is soft, through `deleted_at`).
- **`enforce_task_transition()`** — a status change must exist in
  `public.task_transitions` and be permitted for the acting role. Members cannot
  write assignment, review, payment or deletion columns at all. A paid task
  cannot have its approval reopened until the payment is reverted.
- **`task_events`** — every change records who, when, from what, and which
  fields. This is what makes one-click reversals safe to offer.
- **`prompts`** — the old policy was literally `using (true)` for anonymous
  users, so every personal prompt was world-readable. Now scoped to public
  prompts plus your own.
- **`users`** — readable column by column, and `password` is not in the list.
  All writes go through `admin-users` under the service role.

`public.task_transitions` and `src/workflow.ts` are the same rulebook written
twice. `npm run lint` runs `scripts/check-workflow-parity.mjs`, which fails if
they drift — the failure mode that otherwise shows up as "the button is there
but the save fails".

### Editing tasks by hand

The guardrail applies to the SQL editor and the Management API too, not just the
app: neither has a linked AGNUS account, so any `update public.tasks` fails with
*"No active AGNUS account is linked to this session"*. That is the trigger doing
its job. For a genuine data repair, take it off for exactly the statements you
need and put it straight back:

```sql
alter table public.tasks disable trigger tasks_enforce_transition;
-- your corrective UPDATE here
alter table public.tasks enable trigger tasks_enforce_transition;
```

Confirm it is back on afterwards — `tgenabled` must be `O`:

```sql
select tgenabled from pg_trigger where tgname = 'tasks_enforce_transition';
```

## Realtime

Confirm `tasks` and `prompts` appear under **Database → Publications →
supabase_realtime**. The app subscribes after sign-in and reconciles the full
list on connect, reconnect, focus and visibility change, so a missed websocket
event cannot leave a stale screen.
