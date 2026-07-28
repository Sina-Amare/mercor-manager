# Security audit

## Current boundary

AGNUS is a client-only GitHub Pages application. It currently authenticates by
reading a matching row from `public.users` and comparing the stored password in
the browser. A publishable Supabase key is intentionally public, so client-side
route checks and Zustand roles are user-interface controls, not authorization.

This means true role enforcement cannot be fixed in React alone. If anonymous
clients can read passwords or write tables, anyone who knows the public project
configuration can bypass the UI.

## Frontend protections now in place

- Missing passwords and inactive accounts cannot log in.
- Password-bearing database rows are reduced to public user fields before they
  enter Zustand, local storage, or backup exports.
- Legacy local password storage is removed unless explicit local fallback is
  enabled.
- Cloud write failures are no longer reported as successful local-only changes.
- Persisted sessions are revalidated against the current active user record.
- Admins cannot remove or demote their own active account in the UI.

These measures reduce accidental exposure and inconsistent state. They do not
replace backend authorization.

## Required backend migration

Before production use with sensitive data:

1. Create Supabase Auth identities for each user.
2. Link `public.users.id` to `auth.users.id` and remove the password column.
3. Move admin user creation and password reset to a trusted Edge Function or
   server using the service-role key.
4. Enable RLS on `users`, `tasks`, and `settings`.
5. Allow members to select only their own tasks and update only permitted
   workflow fields/transitions.
6. Allow admins through a role claim or secured profile lookup.
7. Restrict Realtime delivery with the same RLS policies.
8. Rotate all existing passwords because they were previously readable by the
   browser and may have been copied into local storage or version-1 backups.

Do not enable restrictive RLS before the application has been moved to
Supabase Auth; the present custom session is not visible to PostgreSQL and would
lock legitimate users out along with attackers.

## Dependency advisory

`npm audit` currently reports the React Router RSC-mode CSRF advisory
`GHSA-qwww-vcr4-c8h2`. AGNUS uses only declarative `HashRouter` routes and does
not enable React Server Components, actions, or server-action request handling,
so the vulnerable code path is not used. At the time of this audit,
`react-router-dom` has no release that resolves this advisory without
reintroducing older high-severity router advisories. Track the upstream release
and upgrade as soon as a patched compatible version is published.
