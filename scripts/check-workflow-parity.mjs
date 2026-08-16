// Verifies that src/workflow.ts and the SQL transition table agree.
//
// These two are the same rulebook written twice: React builds its buttons from
// one, Postgres refuses writes based on the other. Drift between them is the
// failure that shows up as "the button is there but the save fails", so it gets
// the one check this logic needs.
//
//   node scripts/check-workflow-parity.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const ts = readFileSync(join(root, 'src/workflow.ts'), 'utf8');

// ── src/workflow.ts: { from: 'x', to: 'y', by: BOTH | ADMIN_ONLY, … }
const tsRows = [...ts.matchAll(/\{\s*\n?\s*from:\s*'(\w+)',\s*\n?\s*to:\s*'(\w+)',\s*\n?\s*by:\s*(\w+),/g)]
  .map(([, from, to, by]) => ({
    from,
    to,
    admin: true,
    assignee: by === 'BOTH',
  }));

// ── SQL: ('from', 'to', admin_allowed, assignee_allowed)
//
// Every migration is scanned in filename order, not just the one that first
// seeded the table: a later migration that adds rows is as much a part of the
// rulebook as the original. A bare `delete from public.task_transitions`
// resets what has been collected so far, so a rewrite is read as a rewrite
// rather than merged with the rows it replaced. (A selective DELETE with a
// WHERE clause is not interpreted — if one ever appears, this script needs a
// human's attention anyway.)
let sqlRows = [];
for (const file of readdirSync(join(root, 'supabase/migrations')).filter((name) => name.endsWith('.sql')).sort()) {
  const sql = readFileSync(join(root, 'supabase/migrations', file), 'utf8');
  if (!sql.includes('task_transitions')) continue;

  if (/delete\s+from\s+public\.task_transitions\s*;/i.test(sql)) {
    sqlRows = [];
  }

  let cursor = 0;
  while (true) {
    const at = sql.indexOf('insert into public.task_transitions', cursor);
    if (at === -1) break;
    const end = sql.indexOf(';', at);
    const block = sql.slice(at, end === -1 ? undefined : end);
    sqlRows.push(
      ...[...block.matchAll(/\(\s*'(\w+)',\s*'(\w+)',\s*(true|false),\s*(true|false)\)/g)].map(
        ([, from, to, admin, assignee]) => ({
          from,
          to,
          admin: admin === 'true',
          assignee: assignee === 'true',
        })
      )
    );
    cursor = end === -1 ? sql.length : end;
  }
}

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
