// Every sidebar link must stay readable in every state it can be in.
//
//   npm run dev
//   node scripts/check-sidebar-legibility.mjs
//
// Written after a queue flagged "waiting on you" went black-on-black the moment
// it was selected: `.queue-link.is-waiting` and `.sidebar-link.active` are both
// two-class selectors, so they tied on specificity and the later one won, and
// --color-text-primary happens to be the exact same hex as
// --color-sidebar-active. Nothing about that is visible in review — so measure
// it instead, across every link rather than the one that broke.
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:5173';
const MIN_CONTRAST = 4.5; // WCAG AA for normal text.

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

const iso = (d = 0) => new Date(Date.now() - d * 86400000).toISOString();

const USERS = [
  { id: 'u_admin', auth_user_id: 'auth_admin', username: 'admin', email: 'admin@agnus.local', name: 'Sina', role: 'admin', avatar: '', is_active: true, created: iso(90), updated: iso(2) },
  { id: 'u_nasi', auth_user_id: 'auth_nasi', username: 'nasi', email: 'nasi@agnus.local', name: 'Nastaran', role: 'member', avatar: '', is_active: true, created: iso(80), updated: iso(3) },
];

const task = (over) => ({
  id: 'task_' + Math.random().toString(16).slice(2, 10),
  task_id: 'task_' + Math.random().toString(16).slice(2, 18),
  body: 'probe', assigned_to: 'u_nasi', status: 'working',
  member_verdict: '', member_verdict_date: '', admin_verdict: '', admin_verdict_date: '',
  admin_notes: '', submission_prompt: '', submission_dsp: '', submission_final_answer: '',
  submission_notes: '', studio_result: '', payment_status: 'not_applicable',
  payment_amount_usd: 0, payment_date: '', deleted_at: null, deleted_by: null,
  created: iso(9), updated: iso(1), ...over,
});

// At least one task in every queue, so no link is skipped for being empty and
// every `needsAction` queue is genuinely in its waiting state.
const TASKS = [
  task({ status: 'assigned' }), task({ status: 'working' }), task({ status: 'swf', member_verdict: 'swf' }),
  task({ status: 'swof', member_verdict: 'swof' }), task({ status: 'member_discarded' }),
  task({ status: 'on_hold' }), task({ status: 'in_studio' }), task({ status: 'in_review' }),
  task({ status: 'sent_back' }), task({ status: 'admin_discarded' }),
  task({ status: 'approved', payment_status: 'pending', payment_amount_usd: 20 }),
  task({ status: 'approved', payment_status: 'paid', payment_amount_usd: 20, payment_date: iso(1) }),
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
  await page.route('**/rest/v1/**', (route) => {
    const url = new URL(route.request().url());
    const table = url.pathname.split('/rest/v1/')[1]?.split('?')[0];
    const wantsObject = (route.request().headers()['accept'] || '').includes('vnd.pgrst.object');
    const filtered = (rows) =>
      rows.filter((row) =>
        [...url.searchParams.entries()].every(([key, value]) =>
          !value.startsWith('eq.') || !(key in row) ? true : String(row[key]) === value.slice(3)
        )
      );
    const rows =
      table === 'users' ? filtered(USERS)
      : table === 'settings' ? [{ id: 'settings_1', usd_to_irr_rate: 580000, updated: iso(1) }]
      : table === 'tasks' ? (url.searchParams.get('deleted_at')?.startsWith('not.is') ? [] : TASKS)
      : [];
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(wantsObject ? (rows[0] ?? null) : rows) });
  });
}

// Contrast is measured on what is actually painted, so the check cannot be
// fooled by a transparent background inheriting something legible.
function measure(el) {
  const parse = (value) => {
    const n = (value.match(/[\d.]+/g) || []).map(Number);
    return { r: n[0] ?? 0, g: n[1] ?? 0, b: n[2] ?? 0, a: n[3] ?? 1 };
  };
  const lum = ({ r, g, b }) => {
    const f = (c) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const label =
    el.querySelector('.queue-label, span:not(.sidebar-link-badge):not(.queue-dot)') || el;
  const fg = parse(getComputedStyle(label).color);
  let node = el;
  let bg = { r: 255, g: 255, b: 255, a: 1 };
  while (node) {
    const candidate = parse(getComputedStyle(node).backgroundColor);
    if (candidate.a > 0.5) {
      bg = candidate;
      break;
    }
    node = node.parentElement;
  }
  const pair = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return {
    ratio: Math.round(((pair[0] + 0.05) / (pair[1] + 0.05)) * 100) / 100,
    text: (label.textContent || '').trim().slice(0, 24),
    fg: getComputedStyle(label).color,
  };
}

const browser = await chromium.launch();

for (const actor of USERS) {
  for (const language of ['en', 'fa']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await context.newPage();
    page.on('pageerror', (e) => check(false, `page error: ${e.message}`));
    await stub(page, actor);
    await page.addInitScript((lang) => {
      localStorage.setItem('agnus-language', JSON.stringify({ state: { language: lang }, version: 0 }));
    }, language);

    await page.goto(`${BASE}/#/login`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.fill('#username', actor.username);
    await page.fill('#password', 'stub-password');
    await page.click('button[type="submit"]');
    await page.waitForSelector('.app-main', { timeout: 15000 });

    const links = page.locator('.sidebar-nav .sidebar-link');
    const total = await links.count();
    check(total > 0, `${actor.role}/${language}: sidebar has links`, `${total}`);

    let worst = { ratio: 99, text: '', where: '' };
    let waitingSeen = 0;

    for (let i = 0; i < total; i += 1) {
      const link = links.nth(i);
      const cls = (await link.getAttribute('class')) || '';
      if (cls.includes('is-waiting')) waitingSeen += 1;

      // Resting state.
      const resting = await link.evaluate(measure);
      if (resting.ratio < worst.ratio) worst = { ...resting, where: 'resting' };

      // Selected state — the one that broke. Clicking navigates, so re-locate.
      const href = await link.getAttribute('href');
      if (!href) continue;
      await page.goto(`${BASE}/${href.replace(/^.*#/, '#')}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(120);
      const active = page.locator('.sidebar-nav .sidebar-link.active').first();
      if (!(await active.count())) continue;
      const selected = await active.evaluate(measure);
      if (selected.ratio < worst.ratio) worst = { ...selected, where: 'selected' };
    }

    check(worst.ratio >= MIN_CONTRAST,
      `${actor.role}/${language}: every link readable in both states`,
      `worst ${worst.ratio}:1 on "${worst.text}" (${worst.where}, ${worst.fg})`);
    check(waitingSeen > 0,
      `${actor.role}/${language}: a "waiting on you" queue was actually exercised`,
      `${waitingSeen} flagged`);

    await context.close();
  }
}

await browser.close();
console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
