# AGNUS Task Management

AGNUS is a bilingual (English/Persian) workflow for assigning Mercor work,
tracking member and studio verdicts, recording payments, and sharing reusable
team and personal prompts. It is a static React application backed by Supabase
and deployed to GitHub Pages.

## The workflow

A task moves through six visible stages, and every step has a way back.

```text
Assigned → Working → Verdict → Studio → Review → Final
                       │                   ├─ Approved → paid
                       │                   ├─ Sent back → Working
   SWF ⇄ SWOF ⇄ Discarded                  └─ Rejected
   (corrected in place)
```

1. An admin uploads a task and assigns it to an active member.
2. The member claims it, drafts the shared submission fields while working, and
   records a verdict: **SWF** (submitted with flaw — the outcome the work aims
   for), **SWOF** (no flaw found), or discarded.
3. An admin pulls it into Studio, tests it, writes the required note, and sends
   it to Review.
4. Review approves, sends back, or rejects. Approving opens the task for
   payment in USD, displayed alongside rials.

**Verdicts are facts, not positions.** SWF and SWOF can be corrected in either
direction, by an admin or by the assigned member, without winding the task
backwards and losing the submission. `src/workflow.ts` holds all 38 transitions;
`public.task_transitions` holds the same table, and the database refuses
anything that is not in it.

**Reversibility over confirmation.** An action confirms only when it is
irreversible, affects another person, or moves money. Everything else acts
immediately and offers Undo on the toast — claiming a task, recording or
correcting a verdict, stepping back, restoring from the recycle bin. What does
ask: discarding, approving, sending back, rejecting, reassigning, marking paid,
changing the exchange rate, granting admin, and importing a backup (which asks
you to type the word).

Every change is recorded in `task_events` with who, when, and from what — the
history panel on each task shows it.

## Windows development

Node.js 22, from PowerShell:

```powershell
npm ci
Copy-Item .env.example .env   # then fill in your Supabase project values
npm run dev
```

Production checks:

```powershell
npm run lint      # oxlint + workflow/SQL parity check
npm run build
npm audit --omit=dev
```

The application uses `HashRouter`, so GitHub Pages refreshes and deep links work
without server-side rewrites.

## Architecture

- `src/workflow.ts` — the transition table, effects, stages and editing rights.
  Everything the UI offers is derived from here.
- `src/api` — Supabase access, auth, the `admin-users` client, and the
  Realtime subscriptions.
- `src/store` — Zustand session, language, task, member and UI state.
- `src/components/tasks/workspace` — the task screen: pinned task context beside
  Submission / Studio / Review / Payment stage tabs, plus the history feed.
- `src/components/shared/ConfirmDialog.tsx` — the one confirmation component,
  with focus trapping and optional type-to-confirm.
- `src/i18n` — English and Persian, kept at exact key parity.
- `supabase/migrations` — schema, RLS, the workflow guardrail trigger, audit.
- `supabase/functions` — `admin-users`, the only path that writes to users.

Routes and larger pages are lazy-loaded. Supabase is the only source of truth;
a failed write raises an error rather than being reported as saved.

## Security

Login goes through Supabase Auth, roles are enforced by row level security, and
the workflow rules are enforced by a database trigger rather than by React
alone. Members can read and change only their own tasks and cannot touch
assignment, review, payment or deletion columns at all.

If you are upgrading an existing deployment, the cutover has a required order
and a mandatory credential rotation — see
[docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md) and
[docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md).

