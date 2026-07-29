// Verifies that src/workflow.ts and the SQL transition table agree.
//
// These two are the same rulebook written twice: React builds its buttons from
// one, Postgres refuses writes based on the other. Drift between them is the
// failure that shows up as "the button is there but the save fails", so it gets
// the one check this logic needs.
//
//   node scripts/check-workflow-parity.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const ts = readFileSync(join(root, 'src/workflow.ts'), 'utf8');
const sql = readFileSync(
  join(root, 'supabase/migrations/20260730_auth_link_and_guardrails.sql'),
  'utf8'
);

// ── src/workflow.ts: { from: 'x', to: 'y', by: BOTH | ADMIN_ONLY, … }
const tsRows = [...ts.matchAll(/\{\s*\n?\s*from:\s*'(\w+)',\s*\n?\s*to:\s*'(\w+)',\s*\n?\s*by:\s*(\w+),/g)]
  .map(([, from, to, by]) => ({
    from,
    to,
    admin: true,
    assignee: by === 'BOTH',
  }));

// ── SQL: ('from', 'to', admin_allowed, assignee_allowed)
const insertBlock = sql.slice(
  sql.indexOf('insert into public.task_transitions'),
  sql.indexOf('grant select on public.task_transitions')
);
const sqlRows = [...insertBlock.matchAll(/\(\s*'(\w+)',\s*'(\w+)',\s*(true|false),\s*(true|false)\)/g)]
  .map(([, from, to, admin, assignee]) => ({
    from,
    to,
    admin: admin === 'true',
    assignee: assignee === 'true',
  }));

const key = (row) => `${row.from} -> ${row.to}`;
const describe = (row) =>
  `${key(row)} [admin=${row.admin} assignee=${row.assignee}]`;

const problems = [];

if (tsRows.length === 0) problems.push('Parsed no transitions out of src/workflow.ts');
if (sqlRows.length === 0) problems.push('Parsed no transitions out of the SQL migration');

const tsByKey = new Map(tsRows.map((row) => [key(row), row]));
const sqlByKey = new Map(sqlRows.map((row) => [key(row), row]));

for (const [k, row] of tsByKey) {
  if (!sqlByKey.has(k)) problems.push(`Only in workflow.ts: ${describe(row)}`);
}
for (const [k, row] of sqlByKey) {
  if (!tsByKey.has(k)) problems.push(`Only in SQL: ${describe(row)}`);
}
for (const [k, tsRow] of tsByKey) {
  const sqlRow = sqlByKey.get(k);
  if (!sqlRow) continue;
  if (tsRow.admin !== sqlRow.admin || tsRow.assignee !== sqlRow.assignee) {
    problems.push(`Role mismatch on ${k}: ts ${describe(tsRow)} vs sql ${describe(sqlRow)}`);
  }
}

// Every status a transition can land on must be somewhere to go from, or a task
// can arrive somewhere with no way out.
const terminalStatuses = new Set(['approved']);
const destinations = new Set(sqlRows.map((row) => row.to));
const origins = new Set(sqlRows.map((row) => row.from));
for (const status of destinations) {
  if (!origins.has(status) && !terminalStatuses.has(status)) {
    problems.push(`Dead end: tasks can reach "${status}" but never leave it`);
  }
}

if (problems.length > 0) {
  console.error('Workflow tables do not match:\n');
  for (const problem of problems) console.error(`  • ${problem}`);
  console.error(`\n${tsRows.length} in workflow.ts, ${sqlRows.length} in SQL.`);
  process.exit(1);
}

console.log(`Workflow tables agree — ${tsRows.length} transitions.`);
