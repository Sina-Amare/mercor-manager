// Answering an announcement, from both sides.
//
//   npm run dev
//   node scripts/check-announcement-replies.mjs
//
// The stub restates the select AND insert policies rather than being
// permissive, so a component that offers the reply box to the wrong person, or
// posts against an announcement addressed to somebody else, fails here instead
// of quietly appearing to work. The policies themselves are proved against the
// live database by the DO-block probe in the pull request, not by this file —
// this only checks that the interface agrees with them.
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:5173';
const iso = (d = 0) => new Date(Date.now() - d * 86400000).toISOString();

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

const user = (over) => ({
  id: 'u_x', auth_user_id: 'auth_x', username: 'x', email: 'x@agnus.local', name: 'X',
  role: 'member', avatar: '', is_active: true, created: iso(90), updated: iso(2),
  can_reply_announcements: false, ...over,
});

const ADMIN = user({ id: 'u_admin', auth_user_id: 'auth_admin', username: 'admin', email: 'admin@agnus.local', name: 'Sina', role: 'admin' });
const REPLIER = user({ id: 'u_nasi', auth_user_id: 'auth_nasi', username: 'nasi', email: 'nasi@agnus.local', name: 'Nastaran', can_reply_announcements: true });
const SILENT = user({ id: 'u_mine', auth_user_id: 'auth_mine', username: 'mine', email: 'mine@agnus.local', name: 'Arman' });
const USERS = [ADMIN, REPLIER, SILENT];

const makeState = () => ({
  announcements: [
    { id: 'ann_all', body: 'Who can take Friday?', level: 'warning', target_user_id: null, created_by: 'u_admin', created: iso(2), updated: iso(2) },
    // Addressed to Arman: the case the whole feature exists for, and the one a
    // permissive stub would let Nastaran answer.
    { id: 'ann_mine', body: 'Arman, check your payment details.', level: 'info', target_user_id: 'u_mine', created_by: 'u_admin', created: iso(3), updated: iso(3) },
  ],
  replies: [
    { id: 'arep_other', announcement_id: 'ann_all', author_id: 'u_mine', body: "Arman's private answer", created: iso(1) },
  ],
});

// The three checks the insert policy makes, restated here so a component that
// offers the box to the wrong person fails loudly instead of quietly working.
const mayReply = (actor) => actor.role === 'admin' || actor.can_reply_announcements === true;
const mayReplyTo = (state, actor, announcementId) => {
  const a = state.announcements.find((x) => x.id === announcementId);
  return Boolean(a) && (a.target_user_id === null || a.target_user_id === actor.id);
};

/** Exactly what the select policy allows, so the stub cannot be more generous. */
const visibleReplies = (state, actor) =>
  actor.role === 'admin' ? state.replies : state.replies.filter((r) => r.author_id === actor.id);

async function stub(page, actor, state) {
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

  // The permission is written by the Edge Function under the service role.
  await page.route('**/functions/v1/admin-users', async (route) => {
    const payload = JSON.parse(route.request().postData() || '{}');
    const target = USERS.find((u) => u.id === payload.id);
    if (target && typeof payload.can_reply_announcements === 'boolean') {
      target.can_reply_announcements = payload.can_reply_announcements;
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(target) });
  });

  await page.route('**/rest/v1/**', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const table = url.pathname.split('/rest/v1/')[1]?.split('?')[0];
    const wantsObject = (request.headers()['accept'] || '').includes('vnd.pgrst.object');
    const json = (rows, status = 200) =>
      route.fulfill({ status, contentType: 'application/json',
        body: JSON.stringify(wantsObject ? (rows[0] ?? null) : rows) });
    const filtered = (rows) =>
      rows.filter((row) =>
        [...url.searchParams.entries()].every(([key, value]) =>
          !value.startsWith('eq.') || !(key in row) ? true : String(row[key]) === value.slice(3)
        )
      );

    if (table === 'users') return json(filtered(USERS));
    if (table === 'settings') return json([{ id: 'settings_1', usd_to_irr_rate: 580000, updated: iso(1) }]);
    if (table === 'tasks' || table === 'task_events' || table === 'prompts') return json([]);
    if (table === 'announcements') return json(state.announcements);

    if (table === 'announcement_replies') {
      const id = (url.searchParams.get('id') || '').replace(/^eq\./, '');
      if (request.method() === 'POST') {
        const row = { created: new Date().toISOString(), ...JSON.parse(request.postData() || '{}') };
        // Refuse exactly what the insert policy refuses.
        if (!mayReply(actor) || row.author_id !== actor.id || !mayReplyTo(state, actor, row.announcement_id)) {
          return route.fulfill({ status: 403, contentType: 'application/json',
            body: JSON.stringify({ code: '42501', message: 'new row violates row-level security policy' }) });
        }
        state.replies.push(row);
        return json([row], 201);
      }
      if (request.method() === 'DELETE') {
        // findIndex returns -1 when nothing matches, and splice(-1, 1) removes
        // the LAST row — which made "withdrawing removes it" pass even if the
        // client deleted the wrong id, or no id at all.
        const index = state.replies.findIndex(
          (r) => r.id === id && (actor.role === 'admin' || r.author_id === actor.id)
        );
        if (index < 0) return json([]);
        const [row] = state.replies.splice(index, 1);
        return json([row]);
      }
      return json(visibleReplies(state, actor));
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
const state = makeState();
try {

// ── A member who has not been granted the permission ────────────────────────
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => check(false, `page error: ${e.message}`));
  await stub(page, SILENT, state);
  await signIn(page, SILENT);
  await page.waitForSelector('.announcement', { timeout: 10000 });

  const banners = await page.locator('.announcement-stack .announcement').count();
  check(banners === 2, 'Arman sees the team notice and the one addressed to him', `${banners}`);
  check(!(await page.locator('.announcement-reply-open').count()),
    'a member without the permission is offered no reply box');
  check(await page.locator('.announcement-dismiss').count() === banners,
    'and can dismiss every one of them — nothing is being asked of him',
    `${await page.locator('.announcement-dismiss').count()} of ${banners}`);
  // They wrote one earlier; it is still theirs to see and withdraw.
  check(await page.locator('.announcement-reply').count() === 1,
    'an answer written before the permission was taken away is still shown');
  await context.close();
}

// ── A member who has ────────────────────────────────────────────────────────
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => check(false, `page error: ${e.message}`));
  await stub(page, REPLIER, state);
  await signIn(page, REPLIER);
  await page.waitForSelector('.announcement', { timeout: 10000 });

  const text = (await page.locator('.announcement-stack').innerText().catch(() => '')) || '';
  check(!text.includes("Arman's private answer"), "a colleague's answer never reaches this browser");
  check(!text.includes('check your payment details'),
    "and neither does a notice addressed to him — even though she may reply");

  check(await page.locator('.announcement-reply-open').count() === 1,
    'exactly one reply button: her own notice, not his',
    `${await page.locator('.announcement-reply-open').count()}`);
  check(!(await page.locator('.announcement-dismiss').count()),
    'and dismissing is withheld until they answer — the banner is the only way to');

  await page.click('.announcement-reply-open');
  await page.fill('.announcement-reply-input', 'من می‌توانم جمعه را بردارم.');
  await page.click('.announcement-reply-actions .btn-primary');
  await page.waitForSelector('.announcement-reply', { timeout: 8000 });
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/reply-member.png' });

  check(state.replies.some((r) => r.author_id === 'u_nasi' && r.body.includes('جمعه')),
    'the answer was written with the right author');
  const mine = page.locator('.announcement-reply').filter({ hasText: 'جمعه' });
  const dir = await mine.locator('.announcement-reply-body').evaluate((el) => getComputedStyle(el).direction);
  check(dir === 'rtl', 'a Persian answer renders right-to-left inside an English notice', dir);
  check(await page.locator('.announcement-reply').count() === 1,
    'only their own answer is listed');
  check(await page.locator('.announcement-dismiss').count() === 1,
    'having answered, dismissing is available again');

  // Withdrawing.
  await page.locator('.announcement-reply .btn-ghost-danger').click();
  await page.waitForTimeout(600);
  check(!state.replies.some((r) => r.author_id === 'u_nasi'), 'withdrawing removes it');
  await context.close();
}

// ── The admin ───────────────────────────────────────────────────────────────
{
  state.replies.push({ id: 'arep_n', announcement_id: 'ann_all', author_id: 'u_nasi', body: 'I can take Friday.', created: iso(0) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => check(false, `page error: ${e.message}`));
  await stub(page, ADMIN, state);
  await signIn(page, ADMIN);
  await page.goto(`${BASE}/#/settings`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.announcement-row', { timeout: 10000 });

  const counter = page.locator('.announcement-row-replies');
  check(await counter.count() === 1, 'the announcement row shows a reply count');
  check((await counter.innerText()).includes('2'), 'counting every answer, not just one',
    await counter.innerText().catch(() => ''));

  await counter.click();
  await page.waitForSelector('.announcement-answer', { timeout: 5000 });
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/reply-admin.png', fullPage: true });
  const answers = await page.locator('.announcement-answer').allInnerTexts();
  check(answers.length === 2, 'both answers are listed', `${answers.length}`);
  check(answers.join(' ').includes('Nastaran') && answers.join(' ').includes('Arman'),
    'each answer names who wrote it');

  // The permission toggle.
  const rows = page.locator('.data-table tbody tr');
  const nasiRow = rows.filter({ hasText: 'Nastaran' });
  const toggle = nasiRow.locator('.permission-toggle');
  check(await toggle.getAttribute('aria-checked') === 'true', 'Nastaran is shown as allowed');
  await toggle.click();
  await page.waitForTimeout(600);
  check(REPLIER.can_reply_announcements === false, 'clicking it withdraws the permission');
  check(await toggle.getAttribute('aria-checked') === 'false', 'and the switch reflects that');

  // Both halves, so this cannot pass by the column or the feature disappearing.
  check(await rows.locator('.permission-toggle').count() === 2,
    'every member row has a toggle', `${await rows.locator('.permission-toggle').count()}`);
  const adminRow = rows.filter({ hasText: '@admin' });
  check(!(await adminRow.locator('.permission-toggle').count()),
    'and the admin row has none — they always may');

  // An admin may reply too, which the Settings table promises with "Always".
  await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.announcement', { timeout: 10000 });
  check(await page.locator('.announcement-reply-open').count() > 0,
    'an admin is offered the reply box the table promises them');

  await context.close();
}
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
