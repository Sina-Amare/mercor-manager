# Supabase setup

Project dashboards:

- [Project dashboard](https://supabase.com/dashboard/project/rybeqpgjilocyzalvrnt)
- [API keys](https://supabase.com/dashboard/project/rybeqpgjilocyzalvrnt/settings/api-keys)

The URL and publishable key belong in `.env`; copy `.env.example` when setting
up a new Windows checkout. Never place a service-role key in a Vite variable or
commit it to the repository.

## Realtime and task integrity

Apply `supabase/migrations/20260728_realtime_task_integrity.sql` in the Supabase
SQL editor. It:

- publishes `public.tasks` through Supabase Realtime;
- prevents duplicate task IDs and usernames, ignoring case and surrounding
  whitespace.

After applying it, verify that `tasks` appears under **Database → Publications
→ supabase_realtime**.

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
