// Drives the real Prompts page against stubbed Supabase responses.
//
//   npm run dev
//   node scripts/check-prompt-pins.mjs
//
// The stub restates the pin policies rather than being permissive — it refuses
// a write whose user_id is not the signed-in account, and never returns another
// member's rows — so a page that pins on somebody else's behalf, or shows
// somebody else's pins, fails here instead of quietly working. The policies
// themselves are proved against the live database by a separate SQL probe.
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:5173';
const iso = (d = 0) => new Date(Date.now() - d * 86400000).toISOString();

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

const USERS = [
  { id: 'u_nasi', auth_user_id: 'auth_nasi', username: 'nasi', email: 'nasi@agnus.local', name: 'Nastaran', role: 'member', avatar: '', is_active: true, created: iso(80), updated: iso(3), can_reply_announcements: false },
  { id: 'u_admin', auth_user_id: 'auth_admin', username: 'admin', email: 'admin@agnus.local', name: 'Sina', role: 'admin', avatar: '', is_active: true, created: iso(90), updated: iso(2), can_reply_announcements: false },
];

const PROMPTS = [
  { id: 'p_alpha', title: 'Alpha opener', body: 'Alpha body', visibility: 'public', owner_id: null, created_by: 'u_admin', created: iso(30), updated: iso(3) },
  { id: 'p_beta', title: 'Beta pretext', body: 'Beta body', visibility: 'public', owner_id: null, created_by: 'u_admin', created: iso(20), updated: iso(2) },
  { id: 'p_gamma', title: 'Gamma framing', body: 'Gamma body', visibility: 'public', owner_id: null, created_by: 'u_admin', created: iso(10), updated: iso(1) },
  // A personal one, so the strip's personal-badge branch is actually rendered
  // and pinning across both tabs is exercised.
  { id: 'p_mine', title: 'My own note', body: 'Private body', visibility: 'personal', owner_id: 'u_nasi', created_by: 'u_nasi', created: iso(4), updated: iso(4) },
];

function makePins() {
  // One belongs to somebody else and must never be visible or reachable.
  return [{ user_id: 'u_mine', prompt_id: 'p_alpha', sort_order: 0, created: iso(5) }];
}

async function stub(page, actor, pins) {
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
    const denied = () =>
      route.fulfill({ status: 403, contentType: 'application/json',
        body: JSON.stringify({ code: '42501', message: 'new row violates row-level security policy' }) });

    const applyFilters = (rows) =>
      rows.filter((row) =>
        [...url.searchParams.entries()].every(([key, value]) =>
          !value.startsWith('eq.') || !(key in row) ? true : String(row[key]) === value.slice(3)
        )
      );

    if (table === 'users') return json(applyFilters(USERS));
    if (table === 'settings') return json([{ id: 'settings_1', usd_to_irr_rate: 580000, updated: iso(1) }]);
    if (table === 'prompts') return json(PROMPTS);
    if (table === 'tasks' || table === 'task_events' || table === 'announcements' || table === 'announcement_replies') {
      return json([]);
    }

    if (table === 'prompt_pins') {
      const mine = () => pins.filter((p) => p.user_id === actor.id);
      if (request.method() === 'POST') {
        const payload = JSON.parse(request.postData() || '[]');
        const rows = Array.isArray(payload) ? payload : [payload];
        // The insert/update policies: only ever as yourself.
        if (rows.some((row) => row.user_id !== actor.id)) return denied();
        for (const row of rows) {
          const existing = pins.find(
            (p) => p.user_id === row.user_id && p.prompt_id === row.prompt_id
          );
          if (existing) Object.assign(existing, row);
          else pins.push({ created: new Date().toISOString(), ...row });
        }
        return json(rows, 201);
      }
      const keyed = () => ({
        userId: (url.searchParams.get('user_id') || '').replace(/^eq\./, ''),
        promptId: (url.searchParams.get('prompt_id') || '').replace(/^eq\./, ''),
      });

      // The reorder is N updates, not one upsert, precisely so that a row which
      // no longer exists is a zero-row no-op instead of being re-created. The
      // stub has to model that or the test cannot tell the two apart.
      if (request.method() === 'PATCH') {
        // A real round trip is a few hundred milliseconds. Answering instantly
        // hides every ordering bug that only exists while a write is in
        // flight — including clicks arriving faster than the server replies.
        await new Promise((resolve) => setTimeout(resolve, 400));
        const { userId, promptId } = keyed();
        if (userId !== actor.id) return denied();
        const row = pins.find((p) => p.user_id === userId && p.prompt_id === promptId);
        if (!row) return json([]);
        Object.assign(row, JSON.parse(request.postData() || '{}'));
        return json([row]);
      }
      if (request.method() === 'DELETE') {
        const { userId, promptId } = keyed();
        if (userId !== actor.id) return json([]);
        const index = pins.findIndex((p) => p.user_id === userId && p.prompt_id === promptId);
        if (index < 0) return json([]);
        return json(pins.splice(index, 1));
      }
      // Ordered the way the query asks, and scoped the way the policy scopes.
      return json([...mine()].sort((a, b) => a.sort_order - b.sort_order || a.created.localeCompare(b.created)));
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
  await page.goto(`${BASE}/#/prompts`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.prompts-grid', { timeout: 15000 });
}

const nasi = USERS[0];
const browser = await chromium.launch();
try {
  const pins = makePins();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => check(false, `page error: ${e.message}`));
  await stub(page, nasi, pins);
  await signIn(page, nasi);

  const strip = page.locator('.prompts-pinned');
  const items = page.locator('.prompts-pinned-item');
  const names = () => items.locator('.prompts-pinned-name').allInnerTexts();

  check(!(await strip.count()), "another member's pin is neither shown nor counted");
  check(await page.locator('.prompt-pin-button').count() === 3, 'every prompt card offers a pin');

  const cardPin = (title) =>
    page.locator('.prompt-card').filter({ hasText: title }).locator('.prompt-pin-button');

  await cardPin('Beta pretext').click();
  await strip.waitFor({ timeout: 8000 }).catch(() => {});
  check(await items.count() === 1, 'pinning one shows the strip', `${await items.count()}`);

  await cardPin('Gamma framing').click();
  await page.waitForTimeout(400);
  await cardPin('Alpha opener').click();
  await page.waitForTimeout(400);
  check(await items.count() === 3, 'and pinning appends rather than jumping the queue',
    (await names()).join(' / '));
  check((await names()).join('|') === 'Beta pretext|Gamma framing|Alpha opener',
    'in the order they were pinned', (await names()).join(' / '));

  const ranks = await page.locator('.prompts-pinned-rank').allInnerTexts();
  check(ranks.join('') === '123', 'numbered 1, 2, 3', ranks.join(','));

  // The cards below have to follow the pin order too — otherwise the arrows
  // rearrange a strip while the list you actually read ignores them.
  const cardTitles = () => page.locator('.prompt-card h2').allInnerTexts();
  check((await cardTitles()).slice(0, 3).join('|') === (await names()).join('|'),
    'the cards below lead with the pinned ones, in the same order',
    (await cardTitles()).slice(0, 3).join(' / '));
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/prompt-pins.png` });

  // The ends cannot move past themselves.
  const upAt = (i) => items.nth(i).locator('button[title="Move up"]');
  const downAt = (i) => items.nth(i).locator('button[title="Move down"]');
  check(await upAt(0).isDisabled(), 'the first pin cannot move up');
  check(await downAt(2).isDisabled(), 'the last pin cannot move down');

  // Third to first, one step at a time.
  await upAt(2).click();
  await page.waitForTimeout(500);
  check((await names()).join('|') === 'Beta pretext|Alpha opener|Gamma framing',
    'moving up swaps with the one above', (await names()).join(' / '));
  await upAt(1).click();
  await page.waitForTimeout(500);
  check((await names()).join('|') === 'Alpha opener|Beta pretext|Gamma framing',
    'and again puts it first', (await names()).join(' / '));
  check(pins.filter((p) => p.user_id === 'u_nasi').sort((a, b) => a.sort_order - b.sort_order)
    .map((p) => p.prompt_id).join('|') === 'p_alpha|p_beta|p_gamma',
    'the order was written through, not just re-rendered',
    pins.filter((p) => p.user_id === 'u_nasi').map((p) => `${p.prompt_id}:${p.sort_order}`).join(' '));

  await downAt(0).click();
  await page.waitForTimeout(500);
  check((await names()).join('|') === 'Beta pretext|Alpha opener|Gamma framing',
    'moving down is the inverse', (await names()).join(' / '));

  // Unpinning from the strip, and from the card.
  await items.nth(1).locator('button[title="Remove pin"]').click();
  await page.waitForTimeout(500);
  check((await names()).join('|') === 'Beta pretext|Gamma framing',
    'unpinning from the strip removes exactly that one', (await names()).join(' / '));

  await cardPin('Beta pretext').click();
  await page.waitForTimeout(500);
  check((await names()).join('|') === 'Gamma framing',
    'and the card button unpins what it pinned', (await names()).join(' / '));

  check(pins.some((p) => p.user_id === 'u_mine'), "and none of it touched the other member's pin");

  // A pin whose prompt this browser cannot see is still real, and reordering
  // what you can see must not renumber over it or lose it.
  pins.push({ user_id: 'u_nasi', prompt_id: 'p_vanished', sort_order: 9, created: iso(1) });
  await cardPin('Alpha opener').click();
  await page.waitForTimeout(500);
  check((await names()).join('|') === 'Gamma framing|Alpha opener',
    'a pin with no loaded prompt stays out of the strip', (await names()).join(' / '));
  await downAt(0).click();
  await page.waitForTimeout(500);
  // The reorder has to carry the hidden pin too, not just the visible two.
  // Sending only what is on screen leaves it stranded at its old number and
  // drops it from local state, so the next pin is numbered against a list that
  // is missing a row. Proof it was carried: it lands on the end, contiguous
  // with the visible ones, instead of keeping the 9 it was seeded with.
  const mine = pins.filter((p) => p.user_id === 'u_nasi');
  const hiddenOrder = mine.find((p) => p.prompt_id === 'p_vanished')?.sort_order;
  check(hiddenOrder === mine.length - 1,
    'the reorder rewrites every pin, including one it cannot show',
    mine.map((p) => `${p.prompt_id}:${p.sort_order}`).join(' '));

  // The other laptop unpins something while this tab holds a stale list. A
  // reorder must renumber what is left, not re-create what was removed — an
  // upsert would take the INSERT branch here and silently undo the unpin.
  const gone = pins.findIndex((p) => p.user_id === 'u_nasi' && p.prompt_id === 'p_vanished');
  pins.splice(gone, 1);
  await downAt(0).click();
  await page.waitForTimeout(600);
  check(!pins.some((p) => p.prompt_id === 'p_vanished'),
    'a pin removed on another device is not resurrected by reordering here',
    pins.filter((p) => p.user_id === 'u_nasi').map((p) => p.prompt_id).join(' '));
  check((await names()).length === 2,
    'and the reorder still went through for the pins that remain', (await names()).join(' / '));

  // Walking a pin up the list is several clicks in about a second. Every one of
  // them has to count: a press that lands while the previous write is still in
  // flight used to be dropped on the floor, and the arrows stay enabled, so the
  // button looked live while doing nothing.
  await cardPin('Beta pretext').click();
  await page.waitForTimeout(700);
  const before = await names();
  const last = before.length - 1;
  // No wait between them: the second lands while the first write is still out.
  await items.nth(last).locator('button[title="Move up"]').click({ noWaitAfter: true });
  await page.waitForTimeout(120);
  await items.nth(last - 1).locator('button[title="Move up"]').click({ noWaitAfter: true });
  await page.waitForTimeout(4000);
  const after = await names();
  check(after[last - 2] === before[last],
    'two quick arrow clicks both count, not just the first',
    `${before.join(' / ')}  ->  ${after.join(' / ')}`);

  // Keyboard reordering has to leave focus somewhere usable, or walking a pin
  // up the list means tabbing in from the top of the page after every step.
  await page.locator('[data-pin-control="p_alpha:-1"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  const focused = await page.evaluate(() => {
    const el = document.activeElement;
    return { tag: el?.tagName, control: el?.getAttribute?.('data-pin-control') || null };
  });
  check(focused.tag === 'BUTTON' && Boolean(focused.control),
    'focus stays on a move button after a keyboard reorder',
    `${focused.tag} ${focused.control}`);

  const announced = await page.locator('.prompts-pinned .sr-only[role="status"]').innerText();
  check(/position/i.test(announced) && announced.trim().length > 0,
    'and the move is announced rather than silent', announced.trim().slice(0, 60));

  // A pin can be on a personal prompt, and the strip spans both tabs — that is
  // the reason it sits above them rather than inside one.
  await page.click('.prompts-tab:has-text("My prompts")');
  await page.waitForTimeout(300);
  await cardPin('My own note').click();
  await page.waitForTimeout(500);
  check((await names()).includes('My own note'), 'a personal prompt can be pinned too',
    (await names()).join(' / '));
  const badges = await page.locator('.prompts-pinned-item .prompt-scope-personal').count();
  check(badges === 1, 'and it is marked personal in the strip', `${badges}`);

  await page.click('.prompts-tab:has-text("Shared prompts")');
  await page.waitForTimeout(300);
  check((await names()).includes('My own note'),
    'the strip survives switching tabs — it is not built from the filtered list');

  // The same reason: searching filters the grid, never the pins.
  await page.fill('.prompts-search input', 'zzzzz-no-match');
  await page.waitForTimeout(400);
  check(await page.locator('.prompt-card').count() === 0, 'a search with no matches empties the grid');
  check((await names()).length > 0, 'and leaves the pinned strip alone', (await names()).join(' / '));
  await page.fill('.prompts-search input', '');
  await page.waitForTimeout(300);

  // Unpin from the strip itself, so this keeps working however many are pinned.
  for (let i = 0; i < 8; i += 1) {
    const remove = items.first().locator('button[title="Remove pin"]');
    if (!(await remove.count())) break;
    await remove.click();
    await page.waitForTimeout(600);
  }
  check(!(await strip.count()), 'the strip disappears when the last visible pin goes',
    `${await items.count()} left`);

  await context.close();

  // ── Persian ───────────────────────────────────────────────────────────────
  // Every other user-visible integer in the app goes through formatNumber, so a
  // Latin "1" in the rank badge next to a sidebar badge reading ۱ is the kind of
  // thing only a Persian reader notices.
  const faPins = makePins();
  const faContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const faPage = await faContext.newPage();
  faPage.on('pageerror', (e) => check(false, `page error (fa): ${e.message}`));
  await stub(faPage, nasi, faPins);
  await signIn(faPage, nasi, 'fa');

  await faPage.locator('.prompt-card').filter({ hasText: 'Alpha opener' })
    .locator('.prompt-pin-button').click();
  await faPage.waitForSelector('.prompts-pinned-item', { timeout: 8000 });
  const rank = (await faPage.locator('.prompts-pinned-rank').first().innerText()).trim();
  check(rank === '۱', 'the rank is a Persian digit in the Persian interface', rank);

  const rankFont = await faPage.locator('.prompts-pinned-rank').first()
    .evaluate((el) => getComputedStyle(el).fontFamily);
  check(/vazir/i.test(rankFont), 'in a face that has Persian digit glyphs', rankFont.slice(0, 60));

  const pageDir = await faPage.evaluate(() => document.documentElement.dir);
  check(pageDir === 'rtl', 'and the page is right-to-left', pageDir);
  if (process.env.SHOTS) await faPage.screenshot({ path: `${process.env.SHOTS}/prompt-pins-fa.png` });

  await faContext.close();
} finally {
  await browser.close();
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
