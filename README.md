# AGNUS Task Management

AGNUS is a bilingual (English/Persian) task workflow for assigning Mercor work,
tracking member and studio verdicts, and recording payments. It is a static
React application backed by Supabase and deployed to GitHub Pages.

## Workflow

1. An admin creates a task and assigns it to an active member.
2. The member claims it, submits a verdict, or discards it.
3. An admin moves submitted work through studio and review.
4. Approved tasks become payable and can be marked paid.
5. Supabase Realtime sends inserts, updates, reassignments, and deletions to
   every open dashboard. A reconnect or window focus also performs a full
   reconciliation so missed events cannot leave the UI stale.

## Windows development

Use Node.js 22 and run these commands from PowerShell:

```powershell
npm ci
Copy-Item .env.example .env
npm run dev
```

Production checks:

```powershell
npm run lint
npm run build
npm audit --omit=dev
```

The application uses `HashRouter`, so GitHub Pages refreshes and deep links work
without server-side rewrites.

## Configuration

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-publishable-key
VITE_ENABLE_LOCAL_FALLBACK=false
```

Keep local fallback disabled in production. When disabled, failed cloud writes
surface an error instead of creating browser-only data that other users can
never receive.

See [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md) for the Realtime and data
integrity migration.

## Architecture

- `src/api`: Supabase access, authentication adapter, local recovery cache, and
  Realtime subscription.
- `src/store`: Zustand session, language, task, member, and UI state.
- `src/pages`: role-specific dashboards and workflow screens.
- `src/components/tasks`: task tables and the workflow detail drawer.
- `src/i18n`: English and Persian strings.

Routes and larger pages are lazy-loaded to keep the initial GitHub Pages bundle
small. Cloud records remain the source of truth; local storage is only a
recovery cache unless the explicit fallback flag is enabled.

## Security boundary

The current database still uses a custom `users` table with password comparison
in the browser. Frontend hardening prevents passwords from entering persisted
session state, task caches, or backup exports, but it cannot provide real
authorization while the browser holds the publishable Supabase key.

Before using AGNUS for sensitive or untrusted data, migrate login and user
provisioning to Supabase Auth (or a trusted server/Edge Function), then enforce
role-aware Row Level Security. The required backend work is detailed in
[docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md).
