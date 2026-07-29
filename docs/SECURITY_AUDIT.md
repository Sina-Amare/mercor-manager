# Security audit

## What was wrong

AGNUS authenticated by selecting a row from `public.users` and comparing the
password **in the browser**. The Supabase publishable key was hardcoded in
`src/api/supabase.ts` and committed in `.env.example`. There was no row level
security on `users`, `tasks` or `settings`, and the `prompts` policy was
literally `using (true) with check (true)` for anonymous callers.

Concretely, anyone who loaded the public site could read every password, read
every task and every personal prompt, and write any status or payment on any
task. The role checks in React were interface conveniences, not authorization.

## What is in place now

- **Supabase Auth** for sign-in. `public.users` links to `auth.users` through
  `auth_user_id`; the password column is dropped in
  `20260732_drop_legacy_passwords.sql`.
- **No credentials in source.** `src/api/supabase.ts` throws at boot when the
  environment variables are missing rather than falling back to a baked-in
  project.
- **Row level security** on `users`, `tasks`, `settings`, `prompts`,
  `task_events` and `ai_usage`. Members select and update only their own tasks.
  Only admins insert tasks or write settings. Nobody deletes tasks — removal is
  soft, through `deleted_at`.
- **Column-level grants on `users`.** `password` is not in the readable list,
  so it stopped being fetchable before it was even dropped.
- **Workflow enforcement in the database.** `enforce_task_transition()` checks
  every status change against `public.task_transitions` for the acting role and
  rejects members writing assignment, review, payment or deletion columns. The
  UI and the trigger read the same table, and `npm run lint` fails if the two
  drift apart.
- **User provisioning moved server-side.** Creating, editing, deactivating and
  removing members runs in the `admin-users` Edge Function under the service
  role, after verifying the caller is an active admin. The browser can no longer
  grant itself a role.
- **No LLM key in the bundle.** AI calls go through the `ai` Edge Function,
  which verifies the caller's JWT and enforces a per-user daily quota.
- **An audit trail.** `task_events` records actor, timestamp, status transition
  and changed fields for every task write.
- **Deactivation preferred over deletion.** Removing a member is still possible
  but asks for their username to be typed; deactivating is reversible and is
  what the interface leads with.

## Required after deployment

1. **Rotate the Supabase anon key.** The old one is in git history.
2. **Reset every password.** They were readable from the public site and may
   have been copied into browser storage or version-1 backup exports.
3. Run the migration sequence in the order given in
   [SUPABASE_SETUP.md](SUPABASE_SETUP.md) — `20260731_enable_rls.sql` revokes
   anonymous access and will lock everyone out if it runs before the Auth build
   is deployed and identities are back-filled.

## Verifying it holds

Signed in as a member, from the browser console. Every one of these must be
refused by the database, not merely hidden by the interface:

```js
// another member's task
supabase.from('tasks').update({ status: 'approved' }).eq('id', someoneElsesTask)
// your own task, but an admin-only column
supabase.from('tasks').update({ payment_status: 'paid' }).eq('id', myTask)
// an illegal transition on your own task
supabase.from('tasks').update({ status: 'approved' }).eq('id', myWorkingTask)
// the column should not exist
supabase.from('users').select('password')
// only public prompts plus your own come back
supabase.from('prompts').select('*')
```

## Remaining limits

- Personal prompts are scoped by policy, but any admin can read them. They are
  private from peers, not from administration.
- The `admin-users` backfill endpoint is gated by a shared secret rather than a
  session. Unset `MIGRATION_SECRET` once the migration is complete.
- Backup export produces a plaintext JSON file containing all task bodies and
  submissions. Treat the downloaded file as sensitive.

## Dependency advisory

`npm audit` reports the React Router RSC-mode CSRF advisory
`GHSA-qwww-vcr4-c8h2`. AGNUS uses only declarative `HashRouter` routes and does
not enable React Server Components, actions, or server-action request handling,
so the vulnerable code path is not reachable. Track the upstream release and
upgrade when a patched compatible version ships.
