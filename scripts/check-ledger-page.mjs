// Drives the real Weekly ledger page against stubbed Supabase responses.
//
//   npm run dev
//   node scripts/check-ledger-page.mjs
//   SHOTS=screenshots node scripts/check-ledger-page.mjs   # …and capture
//
// The arithmetic itself is checked directly by check-weekly-ledger.mjs and
// against the live database by a SQL probe. This covers what neither can: that
// the typed meter reaches the calculation, that what is displayed is what gets
// written, and that a member cannot reach the page at all.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://127.0.0.1:5173';
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const iso = (d = 0) => new Date(Date.now() - d * 86400000).toISOString();

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

const USERS = [
  { id: 'u_admin', auth_user_id: 'auth_admin', username: 'admin', email: 'admin@agnus.local', name: 'Sina', role: 'admin', avatar: '', is_active: true, created: iso(90), updated: iso(2), can_reply_announcements: false },
  { id: 'u_nasi', auth_user_id: 'auth_nasi', username: 'nasi', email: 'nasi@agnus.local', name: 'Nastaran', role: 'member', avatar: '', is_active: true, created: iso(80), updated: iso(3), can_reply_announcements: false },
  { id: 'u_milad', auth_user_id: 'auth_milad', username: 'overtrue', email: 'overtrue@agnus.local', name: 'Milad', role: 'member', avatar: '', is_active: true, created: iso(70), updated: iso(4), can_reply_announcements: false },
];

function makeLedger() {
  return { weeks: [], projects: [], members: [], bonuses: [] };
}

async function stub(page, actor, ledger) {
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

    const applyFilters = (rows) =>
      rows.filter((row) =>
        [...url.searchParams.entries()].every(([key, value]) =>
          !value.startsWith('eq.') || !(key in row) ? true : String(row[key]) === value.slice(3)
        )
      );

    if (table === 'users') return json(applyFilters(USERS));
    if (table === 'settings') return json([{ id: 'settings_1', usd_to_irr_rate: 580000, updated: iso(1) }]);
    if (table === 'tasks' || table === 'task_events' || table === 'prompts'
      || table === 'prompt_pins' || table === 'announcements' || table === 'announcement_replies') {
      return json([]);
    }

    // The four ledger tables. Everything here is admin-only in the real
    // policies, so the stub refuses a non-admin outright rather than being
    // more generous than the database.
    const bucket = {
      work_weeks: 'weeks',
      work_week_projects: 'projects',
      work_week_members: 'members',
      work_week_bonuses: 'bonuses',
    }[table];
    if (bucket) {
      if (actor.role !== 'admin') {
        return route.fulfill({ status: 403, contentType: 'application/json',
          body: JSON.stringify({ code: '42501', message: 'row-level security' }) });
      }
      const keyOf = (row) =>
        bucket === 'weeks' ? row.id
        : bucket === 'projects' ? `${row.week_id}:${row.project}`
        : bucket === 'members' ? `${row.week_id}:${row.user_id}:${row.project}`
        : row.id;

      if (request.method() === 'POST') {
        const payload = JSON.parse(request.postData() || '[]');
        for (const row of Array.isArray(payload) ? payload : [payload]) {
          const index = ledger[bucket].findIndex((existing) => keyOf(existing) === keyOf(row));
          if (index >= 0) ledger[bucket][index] = { ...ledger[bucket][index], ...row };
          else ledger[bucket].push({ created: iso(0), ...row });
        }
        return json(Array.isArray(payload) ? payload : [payload], 201);
      }
      if (request.method() === 'PATCH') {
        const patch = JSON.parse(request.postData() || '{}');
        const id = (url.searchParams.get('id') || '').replace(/^eq\./, '');
        const row = ledger[bucket].find((candidate) => candidate.id === id);
        if (!row) return json([]);
        Object.assign(row, patch);
        return json([row]);
      }
      if (request.method() === 'DELETE') {
        const id = (url.searchParams.get('id') || '').replace(/^eq\./, '');
        const index = ledger[bucket].findIndex((candidate) => candidate.id === id);
        if (index < 0) return json([]);
        return json(ledger[bucket].splice(index, 1));
      }
      return json(ledger[bucket]);
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

const admin = USERS[0];
const member = USERS[1];
const browser = await chromium.launch();

try {
  // ── The admin's page ──────────────────────────────────────────────────────
  const ledger = makeLedger();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => check(false, `page error: ${e.message}`));
  await stub(page, admin, ledger);
  await signIn(page, admin);

  check(await page.locator('a[href$="#/ledger"]').count() === 1,
    'the sidebar offers the ledger to an admin');

  await page.goto(`${BASE}/#/ledger`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.ledger-calendar', { timeout: 15000 });

  // A month is laid out as Friday-to-Thursday rows, so every row is 7 days and
  // the first column really is a Friday.
  const rows = page.locator('.ledger-week-row');
  check(await rows.count() >= 4, 'the calendar shows the weeks of the month', `${await rows.count()}`);
  check(await rows.first().locator('.ledger-day').count() === 7, 'each week row is seven days');
  const firstWeekday = (await page.locator('.ledger-calendar-weekdays span').first().innerText()).trim();
  check(/^fri/i.test(firstWeekday), 'the week starts on Friday', firstWeekday);

  // Opening a week creates it — the admin never has to "add" one.
  await page.waitForTimeout(1200);
  check(ledger.weeks.length === 1, 'opening a week creates it', `${ledger.weeks.length}`);
  check(/^\d{4}-\d{2}-\d{2}$/.test(ledger.weeks[0]?.starts_on || ''),
    'keyed on a date', ledger.weeks[0]?.starts_on);
  check(ledger.projects.length === 2, 'with a row for each project', `${ledger.projects.length}`);
  const agnusSeed = ledger.projects.find((row) => row.project === 'agnus');
  const chromiumSeed = ledger.projects.find((row) => row.project === 'chromium');
  check(agnusSeed?.hours_per_task === 2 && agnusSeed?.usd_per_task === 4,
    'AGNUS seeded at 2 hours and $4', `${agnusSeed?.hours_per_task}h $${agnusSeed?.usd_per_task}`);
  check(chromiumSeed?.hours_per_task === 4 && chromiumSeed?.usd_per_task === 8,
    'Chromium seeded at 4 hours and $8', `${chromiumSeed?.hours_per_task}h $${chromiumSeed?.usd_per_task}`);

  // ── The example from the brief, typed in ──────────────────────────────────
  await page.fill('#agnus-tasks', '3');
  await page.fill('#agnus-start', '191');
  await page.fill('#agnus-end', '195:20');
  await page.waitForTimeout(400);

  const figure = async (project, label) => {
    const card = page.locator('.ledger-project').filter({ hasText: project });
    const items = card.locator('.ledger-figures > div');
    for (let i = 0; i < (await items.count()); i += 1) {
      const dt = (await items.nth(i).locator('dt').innerText()).trim();
      if (dt === label) return (await items.nth(i).locator('dd').innerText()).trim();
    }
    return '';
  };

  check((await figure('AGNUS', 'Worth this week')).startsWith('6'),
    'three AGNUS tasks are worth six hours', await figure('AGNUS', 'Worth this week'));
  check((await figure('AGNUS', 'Logged')).startsWith('4.33'),
    '191 to 195:20 is 4.33 hours logged', await figure('AGNUS', 'Logged'));
  check((await figure('AGNUS', 'Still owed')).startsWith('1.67'),
    'and 1.67 hours still have to be logged', await figure('AGNUS', 'Still owed'));

  // Hours owed from before are added on top, which is the whole point of the field.
  await page.fill('#agnus-carry', '5');
  await page.waitForTimeout(300);
  check((await figure('AGNUS', 'Must be logged')).startsWith('11'),
    'hours carried in are added to what must be logged',
    await figure('AGNUS', 'Must be logged'));

  // A backwards meter is called out rather than shown as negative hours.
  await page.fill('#agnus-end', '10:00');
  await page.waitForTimeout(300);
  check(await page.locator('.ledger-warning').count() > 0, 'a meter that went backwards is flagged');
  await page.fill('#agnus-end', '195:20');
  await page.waitForTimeout(300);

  if (SHOTS) await page.screenshot({ path: `${SHOTS}/ledger-en.png`, fullPage: true });

  // ── What is shown is what gets written ────────────────────────────────────
  await page.click('.ledger-save-row .btn-primary');
  await page.waitForTimeout(1500);
  const savedAgnus = ledger.projects.find((row) => row.project === 'agnus');
  check(savedAgnus?.tasks_done === 3, 'the task count was written', `${savedAgnus?.tasks_done}`);
  check(savedAgnus?.tracker_start_minutes === 191 * 60,
    'the typed meter became minutes', `${savedAgnus?.tracker_start_minutes}`);
  check(savedAgnus?.tracker_end_minutes === 195 * 60 + 20,
    'and so did the second reading', `${savedAgnus?.tracker_end_minutes}`);
  check(Number(savedAgnus?.carry_in_hours) === 5, 'along with the carried hours',
    `${savedAgnus?.carry_in_hours}`);

  // The meter boxes must still hold the readings after a save. They used to
  // empty, because the draft kept the pre-save values, which left the panel
  // permanently dirty and armed a second Save that wrote NULL over what had
  // just been stored.
  check((await page.inputValue('#agnus-start')) === '191:00',
    'the meter still reads back after saving', await page.inputValue('#agnus-start'));
  check((await figure('AGNUS', 'Logged')).startsWith('4.33'),
    'and the hours do not revert to unknown', await figure('AGNUS', 'Logged'));
  check(await page.locator('.ledger-save-row .btn-primary').isDisabled(),
    'Save goes quiet again once everything is stored');

  await page.click('.ledger-save-row .btn-primary').catch(() => {});
  await page.waitForTimeout(800);
  check(ledger.projects.find((row) => row.project === 'agnus')?.tracker_start_minutes === 191 * 60,
    'a second Save cannot blank the stored reading',
    `${ledger.projects.find((row) => row.project === 'agnus')?.tracker_start_minutes}`);

  // Text that is not a reading must not be written as "no reading recorded".
  await page.fill('#agnus-start', 'about 200');
  await page.waitForTimeout(300);
  check(await page.locator('.ledger-save-row .btn-primary').isDisabled(),
    'an unreadable meter blocks the save rather than storing NULL');
  await page.fill('#agnus-start', '191');
  await page.waitForTimeout(300);

  // ── People and bonuses ────────────────────────────────────────────────────
  const peopleRows = page.locator('.card', { hasText: 'People' }).locator('tbody tr');
  check(await peopleRows.count() === 3, 'every active person has a row', `${await peopleRows.count()}`);

  await page.locator('.ledger-bonus-form input[type="number"]').fill('7.5');
  await page.locator('.ledger-bonus-form input[type="text"]').fill('tricky one');
  await page.locator('.ledger-bonus-form button').click();
  await page.waitForTimeout(1200);
  check(ledger.bonuses.length === 1, 'a bonus is written immediately', `${ledger.bonuses.length}`);
  check(Number(ledger.bonuses[0]?.amount_usd) === 7.5, 'with its amount', `${ledger.bonuses[0]?.amount_usd}`);
  check(await page.locator('.ledger-bonus').count() === 1, 'and is listed');

  await page.locator('.ledger-bonus button').click();
  await page.waitForTimeout(1200);
  check(ledger.bonuses.length === 0, 'removing it takes it away again');

  await context.close();

  // ── A member must not reach it at all ─────────────────────────────────────
  const memberContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const memberPage = await memberContext.newPage();
  await stub(memberPage, member, makeLedger());
  await signIn(memberPage, member);
  check(!(await memberPage.locator('a[href$="#/ledger"]').count()),
    'a member is not offered the ledger');
  await memberPage.goto(`${BASE}/#/ledger`, { waitUntil: 'networkidle' });
  await memberPage.waitForTimeout(800);
  check(!(await memberPage.locator('.ledger-calendar').count()),
    'and is redirected away from the route');
  await memberContext.close();

  // ── Persian ───────────────────────────────────────────────────────────────
  const faContext = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
  const faPage = await faContext.newPage();
  faPage.on('pageerror', (e) => check(false, `page error (fa): ${e.message}`));
  await stub(faPage, admin, makeLedger());
  await signIn(faPage, admin, 'fa');
  await faPage.goto(`${BASE}/#/ledger`, { waitUntil: 'networkidle' });
  await faPage.waitForSelector('.ledger-calendar', { timeout: 15000 });

  check((await faPage.evaluate(() => document.documentElement.dir)) === 'rtl',
    'the Persian page is right-to-left');
  const day = (await faPage.locator('.ledger-day').first().innerText()).trim();
  check(/[۰-۹]/.test(day), 'calendar days are Persian digits', day);
  const dayFont = await faPage.locator('.ledger-day').first()
    .evaluate((el) => getComputedStyle(el).fontFamily);
  check(/vazir/i.test(dayFont), 'in a face that has Persian digit glyphs', dayFont.slice(0, 44));

  // The grid is a Gregorian month, so it must not be labelled with the Jalali
  // month name — an August grid titled «مرداد» names a different month.
  const faTitle = (await faPage.locator('.ledger-calendar-title .card-title').innerText()).trim();
  const enMonth = new Date().toLocaleDateString('fa-IR-u-ca-gregory', {
    month: 'long', year: 'numeric',
  });
  check(faTitle === enMonth, 'the month is named on the calendar the grid is built from',
    `${faTitle} vs ${enMonth}`);

  const faWeekday = (await faPage.locator('.ledger-calendar-weekdays span').first().innerText()).trim();
  check(faWeekday.includes('جمعه'), 'and the week still starts on Friday', faWeekday);
  if (SHOTS) await faPage.screenshot({ path: `${SHOTS}/ledger-fa.png`, fullPage: true });
  await faContext.close();
} finally {
  await browser.close();
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
