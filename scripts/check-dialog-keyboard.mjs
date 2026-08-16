// Drives the real Prompts and task-workspace pages against stubbed Supabase
// responses, covering what the other scripts do not: the hand-rolled modals
// keep keyboard focus inside, Escape cancels, focus is returned to the control
// that opened the dialog, the tablists answer to arrow keys, and a locked
// stage tab is still reachable by keyboard to explain itself.
//
//   npm run dev
//   node scripts/check-dialog-keyboard.mjs

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

const PROMPTS = [
  { id: 'p_alpha', title: 'Alpha opener', body: 'Open with this.', visibility: 'public', owner_id: null, created_by: 'u_admin', created: iso(10), updated: iso(2) },
  { id: 'p_beta', title: 'Beta pretext', body: 'Frame it like that.', visibility: 'public', owner_id: null, created_by: 'u_admin', created: iso(9), updated: iso(1) },
];

// in_studio: Submission and Studio are unlocked, Review and Payment are locked.
const TASKS = [
  { id: 't_one', task_id: 'TSK-101', body: 'Do the thing.', assigned_to: 'u_nasi', status: 'in_studio', member_verdict: 'swf', member_verdict_date: iso(3), admin_verdict: '', admin_verdict_date: '', admin_notes: '', submission_prompt: '', submission_dsp: '', submission_final_answer: '', submission_notes: '', studio_result: '', payment_status: 'not_applicable', payment_amount_usd: 0, payment_date: '', deleted_at: null, deleted_by: null, created: iso(6), updated: iso(1) },
];

async function stub(page, actor) {
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

    // Filters are honored because this postgrest-js settles maybeSingle in the
    // browser: an eq query that ignores its filter returns two rows, and two
    // rows is a client-side PGRST116 no matter what the stub responds with.
    const applyFilters = (rows) =>
      rows.filter((row) =>
        [...url.searchParams.entries()].every(([key, value]) =>
          !value.startsWith('eq.') || !(key in row) ? true : String(row[key]) === value.slice(3)
        )
      );

    if (table === 'users') return json(applyFilters(USERS));
    if (table === 'settings') return json([{ id: 'settings_1', usd_to_irr_rate: 580000, updated: iso(1) }]);
    if (table === 'prompts') return json(PROMPTS);
    if (table === 'tasks') return json(TASKS);
    if (table === 'task_events') return json([]);
    return json([]);
  });
}

async function signIn(page, actor, hash) {
  await page.addInitScript(() => {
    localStorage.setItem('agnus-language', JSON.stringify({ state: { language: 'en' }, version: 0 }));
  });
  await page.goto(`${BASE}/#/login`, { waitUntil: 'networkidle', timeout: 20000 });
  await page.fill('#username', actor.username);
  await page.fill('#password', 'stub-password');
  await page.click('button[type="submit"]');
  await page.waitForSelector('.app-main', { timeout: 15000 });
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle' });
}

const admin = USERS[0];
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => check(false, `page error: ${e.message}`));
  await stub(page, admin);

  // ── Prompts: the editor modal ────────────────────────────────────────────
  await signIn(page, admin, '#/prompts');
  await page.waitForSelector('.prompts-grid', { timeout: 15000 });

  const openButton = page.locator('.page-header button.btn-primary').first();
  await openButton.focus();
  const openElement = await page.evaluate(() => document.activeElement?.textContent || '');
  await openButton.click();
  await page.waitForSelector('.prompt-editor-modal', { timeout: 5000 });

  check(
    (await page.evaluate(() => document.activeElement?.id)) === 'prompt-title',
    'the editor opens with focus on its first field, not on Cancel'
  );

  await page.keyboard.press('Shift+Tab');
  check(
    await page.evaluate(() => {
      const modal = document.querySelector('.prompt-editor-modal');
      return modal?.contains(document.activeElement);
    }),
    'Shift+Tab from the first field wraps to the modal\u2019s last control, not the page behind it',
    await page.evaluate(() => `${document.activeElement?.tagName} ${document.activeElement?.textContent}`)
  );

  await page.keyboard.press('Escape');
  await page.waitForSelector('.prompt-editor-modal', { state: 'detached', timeout: 5000 });
  check(true, 'Escape closes the editor');
  check(
    (await page.evaluate(() => document.activeElement?.textContent)) === openElement,
    'focus goes back to the button that opened the editor'
  );

  // But Escape must not throw away a half-typed prompt.
  await openButton.click();
  await page.waitForSelector('.prompt-editor-modal', { timeout: 5000 });
  await page.fill('#prompt-title', 'Half-typed');
  await page.keyboard.press('Escape');
  check(
    (await page.locator('.prompt-editor-modal').count()) === 1,
    'Escape does not discard a typed draft'
  );
  check(
    (await page.inputValue('#prompt-title')) === 'Half-typed',
    'and the typed text is still intact'
  );
  await page.fill('#prompt-title', '');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.prompt-editor-modal', { state: 'detached', timeout: 5000 });
  check(true, 'Escape closes the editor once it is pristine again');

  // ── Prompts: the delete modal ────────────────────────────────────────────
  const deleteButton = page.locator('.prompt-card .prompt-delete-button').first();
  await deleteButton.click();
  await page.waitForSelector('.prompt-delete-modal', { timeout: 5000 });
  check(
    await page.evaluate(() => {
      const modal = document.querySelector('.prompt-delete-modal');
      return Boolean(modal) && modal.contains(document.activeElement);
    }),
    'the delete dialog starts with focus inside itself'
  );
  await page.keyboard.press('Escape');
  await page.waitForSelector('.prompt-delete-modal', { state: 'detached', timeout: 5000 });
  check(true, 'Escape cancels the delete dialog');
  check((await page.locator('.prompt-card').count()) === PROMPTS.length, 'and the prompt is still there');

  // ── Prompts: arrow keys move the tablist ─────────────────────────────────
  const tab = (name) => page.locator(`.prompts-tab:has-text("${name}")`);
  await tab('Shared').focus();
  await page.keyboard.press('ArrowRight');
  check(
    (await page.evaluate(() => document.activeElement?.textContent || '')).includes('My prompts'),
    'ArrowRight moves the tablist to the personal tab'
  );

  // ── Workspace: locked tabs are focusable and explain themselves ──────────
  await page.goto(`${BASE}/#/task/t_one`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.stage-tabs', { timeout: 15000 });

  const reviewTab = page.locator('#stage-tab-review');
  check(
    (await reviewTab.getAttribute('aria-disabled')) === 'true',
    'a locked stage tab says aria-disabled rather than vanishing from the tab order'
  );
  await reviewTab.focus();
  check(
    await page.evaluate(() => document.activeElement?.id === 'stage-tab-review'),
    'a locked stage tab can receive keyboard focus'
  );
  check(
    Boolean(await reviewTab.getAttribute('title')),
    'and carries its unlock reason where a screen reader can reach it',
    await reviewTab.getAttribute('title')
  );

  const studioTab = page.locator('#stage-tab-studio');
  await studioTab.focus();
  await page.keyboard.press('ArrowRight');
  check(
    await page.evaluate(() => document.activeElement?.id === 'stage-tab-payment'),
    'arrow keys skip the locked Review tab and land on the next unlocked one'
  );
} finally {
  await browser.close();
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
