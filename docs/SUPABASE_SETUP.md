# Supabase setup

Project dashboards:

- [Project dashboard](https://supabase.com/dashboard/project/rybeqpgjilocyzalvrnt)
- [API keys](https://supabase.com/dashboard/project/rybeqpgjilocyzalvrnt/settings/api-keys)

The URL and publishable key belong in `.env`; copy `.env.example` when setting
up a new Windows checkout. Never place a service-role key in a Vite variable or
commit it to the repository.

## Database migrations

Apply these files in filename order through the Supabase SQL editor:

1. `supabase/migrations/20260728_realtime_task_integrity.sql`
2. `supabase/migrations/20260729_prompts_workspace.sql`

Together they:

- publish `public.tasks` and `public.prompts` through Supabase Realtime;
- prevent duplicate task IDs and usernames, ignoring case and surrounding
  whitespace;
- create the shared and per-user prompt library with ownership, timestamps,
  validation, and cleanup when a user is deleted.

After applying them, verify that `tasks` and `prompts` appear under
**Database → Publications → supabase_realtime**.

The application subscribes after authentication and reconciles the full task
list after every connection or reconnect. Inserts are upserted into the Zustand
store, so the creating admin does not see duplicates when their own Realtime
event returns.

## Production behavior

Keep this value in the deployed environment:

```env
VITE_ENABLE_LOCAL_FALLBACK=false
```

With fallback disabled, failed inserts, updates, imports, and deletes produce an
error toast and leave the visible cloud state unchanged. This avoids the former
failure mode where one browser reported success for data that only existed in
its local storage.

## Authentication

Realtime data integrity is separate from authorization. The current custom
users-table login is not sufficient for role-aware RLS. Complete the backend
authentication migration described in `docs/SECURITY_AUDIT.md` before storing
sensitive data or allowing untrusted users.

Until that authentication migration is complete, personal prompts are scoped
to their owner in the AGNUS interface but cannot be treated as secret data:
the legacy publishable-key backend cannot enforce the custom user identity in
Row Level Security.
