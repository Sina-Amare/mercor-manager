// Permanently deleting tasks from the recycle bin, driven through the real UI.
//
//   npm run dev
//   node scripts/check-recycle-purge.mjs
//
// The policy itself is proved against the live database by a SQL probe — most
// importantly that a task which is not already in the bin cannot be deleted at
// all. This covers the screen: that the confirmation says what will happen,
// that emptying the bin has to be typed out, and that the list is driven by
// what the server actually removed rather than by what was asked.
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:5173';
const iso = (d = 0) => new Date(Date.now() - d * 86400000).toISOString();

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

const USERS = [
  { id: 'u_admin', auth_user_id: 'auth_admin', username: 'admin', email: 'admin@agnus.local', name: 'Sina', role: 'admin', avatar: '', is_active: true, created: iso(90), updated: iso(2), can_reply_announcements: false },
  { id: 'u_nasi', auth_user_id: 'auth_nasi', username: 'nasi', email: 'nasi@agnus.local', name: 'Nastaran', role: 'member', avatar: '', is_active: true, created: iso(80), updated: iso(3), can_reply_announcements: false },
];

const task = (over) => ({
  id: `task_${Math.random().toString(16).slice(2, 10)}`,
  task_id: `task_${Math.random().toString(16).slice(2, 18)}`,
  body: 'probe', assigned_to: 'u_nasi', status: 'assigned',
  member_verdict: '', member_verdict_date: '', admin_verdict: '', admin_verdict_date: '',
  admin_notes: '', submission_prompt: '', submission_dsp: '', submission_final_answer: '',
  submission_notes: '', studio_result: '', payment_status: 'not_applicable',
  payment_amount_usd: 0, payment_date: '', deleted_at: null, deleted_by: null,
  created: iso(9), updated: iso(1), ...over,
});

function makeTasks() {
  return [
    task({ id: 'task_live', task_id: 'task_live0000000000000000000001' }),
    task({ id: 'task_bin_a', task_id: 'task_bin000000000000000000000a', deleted_at: iso(3), deleted_by: 'u_admin' }),
    task({ id: 'task_bin_b', task_id: 'task_bin000000000000000000000b', deleted_at: iso(2), deleted_by: 'u_admin' }),
    task({ id: 'task_bin_c', task_id: 'task_bin000000000000000000000c', deleted_at: iso(1), deleted_by: 'u_admin' }),
  ];
}

async function stub(page, actor, tasks) {
  const session = {
    access_token: 'stub', token_type: 'bearer', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'stub',
    user: { id: actor.auth_user_id, aud: 'authenticated', role: 'authenticated', email: actor.email, app_metadata: {}, user_metadata: {} },
  };
  await page.route('**/auth/v1/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(route.request().url().includes('/user') ? session.user : session) })
  );
  await page.route('**/realtime/v1/**', (route) => route.abort());
  await page.route('**/functions/v1/**', (route) => route.fulfill({ status: 503, body: '{}' }));

  await page.route('**/rest/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const table = url.pathname.split('/rest/v1/')[1]?.split('?')[0];
    const wantsObject = (request.headers()['accept'] || '').includes('vnd.pgrst.object');
    const json = (rows, status = 200) =>
      route.fulfill({ status, contentType: 'application/json',
        body: JSON.stringify(wantsObject ? (rows[0] ?? null) : rows) });

    if (table === 'users') {
      return json(USERS.filter((row) =>
        [...url.searchParams.entries()].every(([key, value]) =>
          !value.startsWith('eq.') || !(key in row) ? true : String(row[key]) === value.slice(3)
        )
      ));
    }
    if (table === 'settings') return json([{ id: 'settings_1', usd_to_irr_rate: 580000, updated: iso(1) }]);
    if (table !== 'tasks') return json([]);

    const deletedFilter = url.searchParams.get('deleted_at');

    if (request.method() === 'DELETE') {
      const ids = (url.searchParams.get('id') || '').replace(/^in\.\(/, '').replace(/\)$/, '')
        .split(',').map((value) => value.replace(/^"|"$/g, '')).filter(Boolean);
      // The delete policy: only rows already in the bin, ever. The stub refuses
      // the same rows the database refuses, so a client that forgets the guard
      // fails here instead of appearing to work.
      const removable = tasks.filter(
        (row) => ids.includes(row.id) && row.deleted_at !== null
      );
      for (const row of removable) tasks.splice(tasks.indexOf(row), 1);
      return json(removable.map((row) => ({ id: row.id })));
    }

    if (deletedFilter === 'not.is.null') {
      return json(tasks.filter((row) => row.deleted_at !== null));
    }
    if (deletedFilter === 'is.null') {
      return json(tasks.filter((row) => row.deleted_at === null));
    }
    return json(tasks);
  });
}

async function signIn(page, actor, language = 'en') {
  await page.addInitScript((lang) => {
    localStorage.setItem('agnus-language', JSON.stringify({ state: { language: lang }, version: 0 }));
  }, language);
  await page.goto(`${BASE}/#/login`, { waitUntil: 'networkidle', timeout: 20000 });
  await page.fill('#username', actor.username);
  await page.fill('#password', 'stub-password');
  await page.click('button[type="submit"]');
  await page.waitForSelector('.app-main', { timeout: 15000 });
}

const admin = USERS[0];
const browser = await chromium.launch();

try {
  const tasks = makeTasks();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => check(false, `page error: ${e.message}`));
  await stub(page, admin, tasks);
  await signIn(page, admin);
  await page.goto(`${BASE}/#/recycle-bin`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.recycle-bin-table', { timeout: 15000 });

  const rows = page.locator('.recycle-bin-table tbody tr');
  check(await rows.count() === 3, 'the bin lists the recycled tasks only', `${await rows.count()}`);

  const boxes = page.locator('.recycle-bin-table tbody input[type="checkbox"]');
  check(await boxes.count() === 3, 'every row can be selected');
  check(!(await page.locator('.bulk-bar').count()), 'and nothing is offered until one is');

  // ── Delete a selection ────────────────────────────────────────────────────
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await page.waitForTimeout(200);
  check(await page.locator('.bulk-bar').count() === 1, 'selecting shows the bulk bar');
  check((await page.locator('.bulk-bar-count').innerText()).startsWith('2'),
    'counting what is selected', await page.locator('.bulk-bar-count').innerText());

  await page.click('.bulk-bar .btn-danger');
  await page.waitForSelector('[role="alertdialog"]', { timeout: 5000 });
  const dialog = page.locator('[role="alertdialog"]');
  const dialogText = await dialog.innerText();
  check(/cannot be undone/i.test(dialogText), 'the confirmation says it cannot be undone');
  check(/free to upload again/i.test(dialogText),
    'and says the Task IDs come free — the reason for doing it');
  check((await dialog.locator('.confirm-list li').count()) === 2,
    'listing exactly what will go', `${await dialog.locator('.confirm-list li').count()}`);
  check(!(await dialog.locator('.confirm-type-to-confirm input').count()),
    'a small selection does not need to be typed out');

  await dialog.locator('.btn-danger').click();
  await page.waitForTimeout(1200);
  check(tasks.filter((row) => row.deleted_at !== null).length === 1,
    'the rows are gone from the database',
    `${tasks.filter((row) => row.deleted_at !== null).length} left`);
  check(tasks.some((row) => row.id === 'task_live'), 'and the live task was never touched');
  check(await rows.count() === 1, 'the table shows what is left', `${await rows.count()}`);
  check(!(await page.locator('.bulk-bar').count()), 'the selection is cleared');

  // ── Empty the whole bin ───────────────────────────────────────────────────
  await page.click('.recycle-bin-header-actions .btn-danger-outline');
  await page.waitForSelector('[role="alertdialog"]', { timeout: 5000 });
  const typed = page.locator('[role="alertdialog"] .confirm-type-to-confirm input');
  check(await typed.count() === 1, 'emptying the whole bin has to be typed out');
  const confirmButton = page.locator('[role="alertdialog"] .btn-danger');
  check(await confirmButton.isDisabled(), 'and is refused until it is');

  await typed.fill('EMPTY');
  await page.waitForTimeout(200);
  check(!(await confirmButton.isDisabled()), 'typing the word arms it');
  await confirmButton.click();
  await page.waitForTimeout(1200);
  check(tasks.filter((row) => row.deleted_at !== null).length === 0, 'the bin is empty');
  check(tasks.length === 1 && tasks[0].id === 'task_live',
    'and the live task is still there', tasks.map((row) => row.id).join(','));
  check(await page.locator('.data-table-empty').count() === 1, 'the page says so');

  await context.close();
} finally {
  await browser.close();
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
