// Re-checks the live database's access rules. Run after any migration that
// touches policies, grants or the Auth config.
//
//   SUPABASE_ACCESS_TOKEN=sbp_… node scripts/check-db-security.mjs
//
// Not part of `npm run lint`: it talks to production and needs a credential no
// build should hold. Every probe runs inside one DO block that ends in RAISE,
// so nothing it does is committed.
import process from 'node:process';

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = process.env.SUPABASE_PROJECT_REF || 'rybeqpgjilocyzalvrnt';

if (!TOKEN) {
  console.error('Set SUPABASE_ACCESS_TOKEN (Supabase → Account → Access Tokens).');
  process.exit(2);
}

const api = (path, init) =>
  fetch(`https://api.supabase.com/v1/projects/${REF}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...init?.headers },
  });

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

// ── Advisors ────────────────────────────────────────────────────────────────
// Leaked-password protection needs a Pro plan, so it is expected to stay open.
const EXPECTED_OPEN = new Set(['auth_leaked_password_protection']);

const advisors = await (await api('/advisors/security')).json();
const unexpected = (advisors.lints || []).filter((l) => !EXPECTED_OPEN.has(l.name));
check(unexpected.length === 0, 'security advisor reports nothing new',
  unexpected.map((l) => `${l.level} ${l.name}`).join('; '));

// ── Auth configuration ──────────────────────────────────────────────────────
const auth = await (await api('/config/auth')).json();
check(auth.disable_signup === true, 'self-registration is disabled',
  auth.disable_signup === true ? '' : 'anyone can create an Auth account');
check(auth.password_min_length >= 8, 'minimum password length is at least 8',
  `is ${auth.password_min_length}`);

// ── Access probes ───────────────────────────────────────────────────────────
// A member id is needed to prove the app still works; any active one will do.
const sql = (query) =>
  api('/database/query', { method: 'POST', body: JSON.stringify({ query }) });

const memberRes = await sql(
  `select auth_user_id from public.users where role = 'member' and is_active and auth_user_id is not null limit 1;`
);
const [member] = await memberRes.json();
if (!member) {
  console.error('No active member with a linked Auth identity — cannot probe.');
  process.exit(2);
}

const probe = `
do $$
declare n bigint; tid text; out text := '';
begin
  perform set_config('role', 'anon', true);
  begin
    select count(*) into n from public.task_transitions;
    out := out || 'anon-transitions=' || n || ';';
  exception when insufficient_privilege then out := out || 'anon-transitions=denied;'; end;
  begin
    select count(*) into n from public.users;
    out := out || 'anon-users=' || n || ';';
  exception when insufficient_privilege then out := out || 'anon-users=denied;'; end;
  begin
    select count(*) into n from public.prompts;
    out := out || 'anon-prompts=' || n || ';';
  exception when insufficient_privilege then out := out || 'anon-prompts=denied;'; end;
  reset role;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}', true);
  select count(*) into n from public.users;    out := out || 'stranger-users=' || n || ';';
  select count(*) into n from public.prompts;  out := out || 'stranger-prompts=' || n || ';';
  select count(*) into n from public.settings; out := out || 'stranger-settings=' || n || ';';
  select count(*) into n from public.tasks;    out := out || 'stranger-tasks=' || n || ';';
  reset role;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    '{"sub":"${member.auth_user_id}","role":"authenticated"}', true);
  select count(*) into n from public.tasks; out := out || 'member-tasks=' || n || ';';
  select id into tid from public.tasks where deleted_at is null limit 1;
  if tid is not null then
    update public.tasks set submission_notes = coalesce(submission_notes, '') || ' probe' where id = tid;
    out := out || 'member-own-write=ok;';
    begin
      update public.tasks set payment_status = 'paid' where id = tid;
      out := out || 'member-payment-write=allowed;';
    exception when others then out := out || 'member-payment-write=refused;'; end;
  end if;
  begin
    insert into public.task_transitions values ('assigned','approved',true,true);
    out := out || 'member-rulebook-write=allowed;';
  exception when others then out := out || 'member-rulebook-write=refused;'; end;
  reset role;

  raise exception 'PROBE %', out;
end $$;`;

const raw = await (await sql(probe)).text();
const found = /PROBE ([^"\\]*)/.exec(raw);
if (!found) {
  console.error(`Probe did not report back:\n${raw}`);
  process.exit(2);
}
const results = Object.fromEntries(
  found[1].split(';').filter(Boolean).map((pair) => pair.split('='))
);

check(results['anon-transitions'] === 'denied', 'anon cannot read the transition rulebook', results['anon-transitions']);
check(results['anon-users'] === 'denied', 'anon cannot read users', results['anon-users']);
check(results['anon-prompts'] === 'denied', 'anon cannot read prompts', results['anon-prompts']);
for (const table of ['users', 'prompts', 'settings', 'tasks']) {
  check(results[`stranger-${table}`] === '0', `a signed-in stranger sees no ${table}`, results[`stranger-${table}`]);
}
check(Number(results['member-tasks']) > 0, 'a member still reads their own tasks', results['member-tasks']);
check(results['member-own-write'] === 'ok', 'a member can still save their own work');
check(results['member-payment-write'] === 'refused', 'a member cannot write payment fields');
check(results['member-rulebook-write'] === 'refused', 'a member cannot rewrite the rulebook');

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
