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
- **Row level security** on `users`, `tasks`, `settings`, `prompts` and
  `task_events`. Members select and update only their own tasks.
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

## Second pass — what the advisor found afterwards

Supabase emailed a critical alert on 3 August 2026. Two live holes, both
verified against the running project before and after the fix, both closed by
`20260737_close_public_access.sql`.

**`public.task_transitions` was world-writable.** The table was created by
`20260730_auth_link_and_guardrails.sql`, *after* the migration that revoked
anonymous access, so it silently inherited Supabase's default `grant all on
tables to anon` and never had RLS enabled. Anyone holding the publishable key
could read it, and — worse — `INSERT`, `UPDATE`, `DELETE` and `TRUNCATE` it.
Deleting its rows makes `enforce_task_transition()` reject every status change
in the panel; inserting a row widens what a member is allowed to do. Measured
before the fix: `anon` read all 38 rows.

**Self-registration was open.** `disable_signup` was `false`, and `users_select`,
`settings_select` and `prompts_select` were written `using (true)` — meaning any
`authenticated` role, and a Supabase Auth account is not an AGNUS account.
Anyone could register through `/auth/v1/signup` and read the whole roster, every
shared prompt and the settings row. Measured before the fix, with a session
whose `sub` matched no `public.users` row: 4 users, 7 prompts, 1 settings row.
Now 0, 0, 0 — every policy tests `private.current_app_user_id() is not null`
first, and self-signup is off, so admin provisioning is the only way in.

Also closed in the same migration:

- **Identity helpers moved to schema `private`.** In `public` they were
  published as `/rest/v1/rpc/is_admin` and `/rest/v1/rpc/current_app_user_id`.
  They answer only about the caller, so nothing leaked, but an authorization
  primitive has no business being an endpoint. PostgREST exposes `public` and
  `graphql_public` only.
- **Trigger functions are no longer callable over REST**, and the three that
  carried a mutable `search_path` now pin it.
- **Grants cut to what the client actually uses.** `anon` holds nothing;
  `authenticated` lost `TRUNCATE` everywhere, which matters because `TRUNCATE`
  bypasses row level security entirely.
- **Default privileges in `public` revoked from `anon`** — the root cause. A
  table added later now starts closed rather than inheriting a `grant all`
  nobody notices.
- Auth: self-signup disabled, minimum password length raised 6 → 8 to match
  `MIN_PASSWORD_LENGTH` in the `admin-users` function.
- Advisor performance lints: covering indexes on `tasks.assigned_to`,
  `task_events.actor_id` and `prompts.created_by`; the duplicate
  `users_auth_user_id_idx` dropped; `settings_write` split into
  `settings_insert` / `settings_update` so `SELECT` is not matched by two
  permissive policies.

The security advisor now reports one item, below.

## Remaining limits

- Personal prompts are scoped by policy, but any admin can read them. They are
  private from peers, not from administration.
- The `admin-users` backfill endpoint is gated by a shared secret rather than a
  session. `MIGRATION_SECRET` is unset, so that path is closed.
- Backup export produces a plaintext JSON file containing all task bodies and
  submissions. Treat the downloaded file as sensitive.
- **Leaked-password protection is off** and cannot be turned on: checking
  passwords against HaveIBeenPwned requires a Pro plan, and the API refuses it
  with a 402 on Free. This is the one item the security advisor still reports.
  Until the project is upgraded, the minimum length of 8 is the only automatic
  check — choosing passwords that are not reused elsewhere is manual.

## Re-checking it

`scripts/check-db-security.mjs` re-runs the whole thing against the live
project: the Supabase advisors, then direct probes as `anon`, as a signed-in
stranger with no AGNUS row, and as a real member. It needs a Supabase personal
access token:

```bash
SUPABASE_ACCESS_TOKEN=sbp_… node scripts/check-db-security.mjs
```

It is deliberately not part of `npm run lint` — it talks to production and
needs a credential no build should hold.

## Dependency advisory

`npm audit` reports the React Router RSC-mode CSRF advisory
`GHSA-qwww-vcr4-c8h2`. AGNUS uses only declarative `HashRouter` routes and does
not enable React Server Components, actions, or server-action request handling,
so the vulnerable code path is not reachable. Track the upstream release and
upgrade when a patched compatible version ships.

## The JWT signing secret was disclosed, and retired

On 5 August 2026 a temporary debug script carrying the project's legacy HS256
JWT secret was committed to this public repository (`88de6da`) and removed one
commit later. Removal from the tree does not remove it from history, so the
secret was treated as disclosed.

It was exploitable, not theoretically: a token forged with it and presented to
PostgREST returned the full `public.users` roster, because a signed
`authenticated` JWT satisfies every policy that asks who the caller is.

The project already signed sessions with an **ES256** key; the HS256 key was
only `previously_used`, kept to verify older tokens — which is exactly why the
forged token was still accepted. Revoking it ends that:

```
forged token, before revoke -> 200  [{"id":"user_admin","role":"admin"}, …]
forged token, after revoke  -> 401  PGRST301 No suitable key was found to decode the JWT
```

Nobody was signed out — live sessions are ES256, and refresh tokens are opaque
rows rather than JWTs.

Two things had to move first, because both rode on the legacy key:

- The **frontend** already used the modern `sb_publishable_…` key. Verified
  against the deployed bundle before revoking, not assumed.
- The **`admin-users` function** received `SUPABASE_SERVICE_ROLE_KEY`, a legacy
  HS256 JWT. It now prefers `AGNUS_SECRET_KEY` (a modern `sb_secret_…` key set
  with `supabase secrets set`) and falls back to the old variable. Redeployed
  and verified before the revoke, and again after.

The blob is still reachable at that commit until the history is rewritten. That
is worth doing, but it is no longer what protects the project — the key is dead.
