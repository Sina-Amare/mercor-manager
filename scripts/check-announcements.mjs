// Drives the real app against stubbed Supabase responses. Database semantics
// are verified separately by SQL probes; this checks the client wiring and UI.
//
//   npm run dev
//   node scripts/check-announcements.mjs            # assertions only
//   SHOTS=screenshots node scripts/check-announcements.mjs   # …and capture
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const shoot = (page, name) =>
  SHOTS ? page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }) : Promise.resolve();

const BASE = 'http://localhost:5173';
const iso = (d = 0) => new Date(Date.now() - d * 86400000).toISOString();

const USERS = [
  { id: 'u_admin', auth_user_id: 'auth_admin', username: 'admin', email: 'admin@agnus.local', name: 'Sina', role: 'admin', avatar: '', is_active: true, created: iso(90), updated: iso(2) },
  { id: 'u_nasi', auth_user_id: 'auth_nasi', username: 'nasi', email: 'nasi@agnus.local', name: 'Nasim', role: 'member', avatar: '', is_active: true, created: iso(80), updated: iso(3) },
  { id: 'u_mine', auth_user_id: 'auth_mine', username: 'mine', email: 'mine@agnus.local', name: 'Arman', role: 'member', avatar: '', is_active: true, created: iso(60), updated: iso(5) },
];

const SETTINGS = [{ id: 'settings_1', usd_to_irr_rate: 890000, updated: iso(1) }];

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

function makeStore() {
  return [
    { id: 'ann_all', body: 'Everyone: please upload before Friday.', level: 'warning', target_user_id: null, created_by: 'u_admin', created: iso(2), updated: iso(2) },
    { id: 'ann_nasi', body: 'سلام نسیم، لطفاً تسک‌های SWF را اول انجام بده.', level: 'info', target_user_id: 'u_nasi', created_by: 'u_admin', created: iso(1), updated: iso(1) },
    { id: 'ann_mine', body: 'Arman only: check your payment details.', level: 'critical', target_user_id: 'u_mine', created_by: 'u_admin', created: iso(3), updated: iso(3) },
  ];
}

/** Mirrors the row level security policy so the stub cannot be more generous. */
function visibleTo(rows, actor) {
  if (actor.role === 'admin') return rows;
  return rows.filter((r) => !r.target_user_id || r.target_user_id === actor.id);
}

async function stub(page, actor, store) {
  const session = {
    access_token: 'stub', token_type: 'bearer', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'stub',
    user: { id: actor.auth_user_id, aud: 'authenticated', role: 'authenticated', email: actor.email, app_metadata: {}, user_metadata: {} },
  };

  await page.route('**/auth/v1/**', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(route.request().url().includes('/user') ? session.user : session),
    })
  );
  await page.route('**/realtime/v1/**', (route) => route.abort());
  await page.route('**/functions/v1/**', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
  );

  await page.route('**/rest/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const table = url.pathname.split('/rest/v1/')[1]?.split('?')[0];
    const wantsObject = (request.headers()['accept'] || '').includes('vnd.pgrst.object');
    const json = (rows, status = 200) =>
      route.fulfill({
        status, contentType: 'application/json',
        body: JSON.stringify(wantsObject ? (rows[0] ?? null) : rows),
      });

    // maybeSingle() errors when more than one row comes back, so the `eq`
    // filters PostgREST puts in the query string have to be honoured.
    const applyFilters = (rows) =>
      rows.filter((row) =>
        [...url.searchParams.entries()].every(([key, value]) =>
          !value.startsWith('eq.') || !(key in row) ? true : String(row[key]) === value.slice(3)
        )
      );

    if (table === 'users') return json(applyFilters(USERS));
    if (table === 'settings') return json(SETTINGS);
    if (table === 'tasks' || table === 'task_events' || table === 'prompts') return json([]);

    if (table === 'announcements') {
      const idFilter = (url.searchParams.get('id') || '').replace(/^eq\./, '');
      if (request.method() === 'POST') {
        const row = { created: new Date().toISOString(), updated: new Date().toISOString(), ...JSON.parse(request.postData() || '{}') };
        store.push(row);
        return json([row], 201);
      }
      if (request.method() === 'PATCH') {
        const patch = JSON.parse(request.postData() || '{}');
        const row = store.find((r) => r.id === idFilter);
        if (!row) return json([]);
        Object.assign(row, patch, { updated: new Date().toISOString() });
        return json([row]);
      }
      if (request.method() === 'DELETE') {
        // findIndex gives -1 when nothing matches and splice(-1, 1) removes the
        // LAST row, so a wrong id used to look like a successful delete.
        const index = store.findIndex((r) => r.id === idFilter);
        if (index < 0) return json([]);
        const [row] = store.splice(index, 1);
        return json([row]);
      }
      return json(visibleTo(store, actor));
    }
    return json([]);
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

const browser = await chromium.launch();
const admin = USERS[0];
const nasi = USERS[1];

// ── Member: the banner stack ────────────────────────────────────────────────
{
  const store = makeStore();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => check(false, `page error: ${e.message}`));
  await stub(page, nasi, store);
  await signIn(page, nasi);
  await page.waitForSelector('.announcement-stack', { timeout: 10000 });

  const banners = page.locator('.announcement-stack .announcement');
  check((await banners.count()) === 2, 'Nasim sees exactly two notices', `${await banners.count()}`);

  const texts = await page.locator('.announcement-text').allInnerTexts();
  check(!texts.join(' ').includes('Arman only'), "Arman's notice never reaches Nasim");
  check(texts[0].includes('نسیم'), 'the notice addressed to her is first', texts[0]?.slice(0, 30));

  await shoot(page, 'announcements-member-en');
  const first = banners.first();
  check(await first.locator('.announcement-tag').isVisible(), 'it is tagged "For you"');
  check((await first.getAttribute('dir')) === 'auto', 'the banner carries dir="auto"');
  // The whole banner, not just the paragraph: this is what puts the coloured
  // rule and the icon at the start of the sentence rather than the page.
  const dir = await first.evaluate((el) => getComputedStyle(el).direction);
  check(dir === 'rtl', 'a Persian notice resolves RTL inside the English interface', dir);
  const tagDir = await first.locator('.announcement-tag').evaluate((el) => getComputedStyle(el).direction);
  check(tagDir === 'ltr', 'the English tag inside it stays LTR', tagDir);

  const secondDir = await banners.nth(1).evaluate((el) => getComputedStyle(el).direction);
  check(secondDir === 'ltr', 'the English notice stays LTR beside it', secondDir);
  check(!(await banners.nth(1).locator('.announcement-tag').count()), 'the team-wide one is not tagged');

  // Dismiss the personal one; the team-wide one must stay, across a reload.
  await first.locator('.announcement-dismiss').click();
  await page.waitForTimeout(200);
  check((await banners.count()) === 1, 'dismissing one leaves the other', `${await banners.count()}`);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.announcement-stack', { timeout: 10000 });
  check((await banners.count()) === 1, 'the dismissal survives a reload', `${await banners.count()}`);

  // Editing it brings it back.
  store.find((r) => r.id === 'ann_nasi').updated = new Date().toISOString();
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.announcement-stack', { timeout: 10000 });
  check((await banners.count()) === 2, 'an edited notice returns for someone who closed it', `${await banners.count()}`);

  await context.close();
}

// ── Admin: compose, target, edit, delete ────────────────────────────────────
{
  const store = makeStore();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => check(false, `page error: ${e.message}`));
  await stub(page, admin, store);
  await signIn(page, admin);

  const adminBanners = page.locator('.announcement-stack .announcement');
  check((await adminBanners.count()) === 1, "an admin's own banner is only what is addressed to them", `${await adminBanners.count()}`);

  await page.goto(`${BASE}/#/settings`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#announcement-audience', { timeout: 10000 });

  const options = await page.locator('#announcement-audience option').allInnerTexts();
  check(options.join('/') === 'Everyone/Nasim/Arman',
    'the picker offers Everyone plus each active member, not the author', options.join(' / '));

  check((await page.locator('.announcement-row').count()) === 3, 'all three live notices are listed');
  const audiences = await page.locator('.announcement-row-audience').allInnerTexts();
  check(audiences.some((a) => a.includes('Nasim')) && audiences.some((a) => a.includes('Everyone')),
    'each row names who it reaches', audiences.join(' / '));

  // Target one person.
  await page.selectOption('#announcement-audience', 'u_nasi');
  await page.fill('#announcement-text', 'Nasim, please redo task 12.');
  check((await page.locator('.form-hint').innerText()).includes('Only Nasim'),
    'the hint names the single recipient');
  check((await page.locator('.announcement-actions .btn-primary').innerText()).includes('Send to Nasim'),
    'the publish button names the recipient');
  check(await page.locator('.announcement-preview .announcement-tag').isVisible(),
    'the preview shows the "For you" tag');
  await shoot(page, 'announcements-admin-en');

  await page.click('.announcement-actions .btn-primary');
  await page.waitForSelector('.modal, .confirm-dialog, [role="dialog"]', { timeout: 5000 });
  const dialog = page.locator('[role="dialog"], .modal').first();
  check((await dialog.innerText()).includes('Nasim'), 'the confirmation names the recipient');
  await dialog.locator('button').filter({ hasText: /confirm|send|publish|yes/i }).last().click();
  await page.waitForTimeout(600);
  check((await page.locator('.announcement-row').count()) === 4, 'the new notice appears in the list',
    `${await page.locator('.announcement-row').count()}`);
  check(store.some((r) => r.body === 'Nasim, please redo task 12.' && r.target_user_id === 'u_nasi'),
    'it was written with the right target');

  // Edit it.
  const newRow = page.locator('.announcement-row').filter({ hasText: 'redo task 12' });
  await newRow.locator('button[title="Edit this announcement"]').click();
  check((await page.locator('#announcement-audience').inputValue()) === 'u_nasi',
    'editing restores the audience');
  await page.fill('#announcement-text', 'Nasim, please redo task 12 and 13.');
  await page.click('.announcement-actions .btn-primary');
  await page.waitForTimeout(600);
  check(store.some((r) => r.body === 'Nasim, please redo task 12 and 13.'), 'the edit saved without a confirmation');

  // Delete it.
  await page.locator('.announcement-row').filter({ hasText: 'redo task 12' })
    .locator('button[title="Take it down"]').click();
  await page.waitForTimeout(600);
  check((await page.locator('.announcement-row').count()) === 3, 'deleting removes the row',
    `${await page.locator('.announcement-row').count()}`);

  await context.close();
}

// ── Persian interface, English notice ───────────────────────────────────────
{
  const store = makeStore();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => check(false, `page error: ${e.message}`));
  await stub(page, nasi, store);
  await signIn(page, nasi, 'fa');
  await page.waitForSelector('.announcement-stack', { timeout: 10000 });

  const pageDir = await page.evaluate(() => document.documentElement.dir);
  check(pageDir === 'rtl', 'the Persian interface is RTL', pageDir);

  const english = page.locator('.announcement').filter({ hasText: 'upload before Friday' });
  const dir = await english.evaluate((el) => getComputedStyle(el).direction);
  check(dir === 'ltr', 'an English notice stays LTR inside the Persian interface', dir);

  const persian = page.locator('.announcement').filter({ hasText: 'نسیم' });
  const persianDir = await persian.evaluate((el) => getComputedStyle(el).direction);
  check(persianDir === 'rtl', 'the Persian notice resolves RTL', persianDir);
  check((await page.locator('.announcement-tag').first().innerText()).includes('برای شما'),
    'the tag is translated');
  await shoot(page, 'announcements-member-fa');

  await context.close();
}

await browser.close();
console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
