// Proves a tab left open on an old build notices, and does not cry wolf.
//
//   npm run build && node scripts/check-stale-build.mjs
//
// Serves dist/ from a throwaway server so the test can pretend a new version
// was deployed mid-session — which is the only way to exercise this at all,
// since the whole mechanism keys on index.html changing underneath a live tab.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not .pathname: the project path contains a space, and a URL
// keeps it percent-encoded.
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const PORT = 5177;
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2',
};

/** Flipped mid-test to simulate a deploy landing while the tab is open. */
let pretendNewDeploy = false;
const NEW_ENTRY = 'index-NEWHASH.js';

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path === '/' || !extname(path) ? 'index.html' : path.replace(/^\//, '');

  // The pretend new entry has to be loadable, or the reload lands on a blank
  // page and the assertions after it would pass against a dead document.
  // Serving the real chunk under the new name is what a real deploy looks like
  // from the browser's side: a name it has never fetched, that works.
  if (file.endsWith(NEW_ENTRY)) {
    const real = (await readFile(join(DIST, 'index.html'), 'utf8')).match(
      /src="\.\/(assets\/index-[^"]+)"/
    );
    if (real) file = real[1];
  }

  try {
    let body = await readFile(join(DIST, file));
    if (file === 'index.html' && pretendNewDeploy) {
      body = Buffer.from(
        body.toString().replace(/(src=")(\.\/assets\/)index-[^"]+(")/, `$1$2${NEW_ENTRY}$3`)
      );
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
// Bind and browse over 127.0.0.1 rather than `localhost`, and refuse to start
// if the port is taken. `localhost` resolves to ::1 first on Windows, so a
// stray IPv6-only listener on this port — a Vite dev server that auto-
// incremented off 5173, say — would answer the browser while this server sat
// unheard on IPv4, and every assertion would be made against the wrong app.
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(PORT, '127.0.0.1', resolve);
}).catch((error) => {
  console.error(
    error.code === 'EADDRINUSE'
      ? `Port ${PORT} is already in use. Stop whatever is on it and re-run.`
      : error.message
  );
  process.exit(2);
});
const BASE = `http://127.0.0.1:${PORT}/`;

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

const USER = { id: 'u_admin', auth_user_id: 'auth_admin', username: 'admin', email: 'admin@agnus.local', name: 'Sina', role: 'admin', avatar: '', is_active: true, created: new Date().toISOString(), updated: new Date().toISOString() };
const SESSION = {
  access_token: 'stub', token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'stub',
  user: { id: 'auth_admin', aud: 'authenticated', role: 'authenticated', email: USER.email, app_metadata: {}, user_metadata: {} },
};

const browser = await chromium.launch();
try {
const page = await (await browser.newContext()).newPage();
page.on('pageerror', (e) => check(false, `page error: ${e.message}`));

await page.route('**/auth/v1/**', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify(route.request().url().includes('/user') ? SESSION.user : SESSION) })
);
await page.route('**/realtime/v1/**', (route) => route.abort());
await page.route('**/rest/v1/**', (route) => {
  const url = new URL(route.request().url());
  const table = url.pathname.split('/rest/v1/')[1]?.split('?')[0];
  const wantsObject = (route.request().headers()['accept'] || '').includes('vnd.pgrst.object');
  const rows = table === 'users' ? [USER]
    : table === 'settings' ? [{ id: 'settings_1', usd_to_irr_rate: 580000, updated: new Date().toISOString() }]
    : [];
  return route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify(wantsObject ? (rows[0] ?? null) : rows) });
});

await page.goto(`${BASE}#/login`, { waitUntil: 'networkidle' });
await page.fill('#username', 'admin');
await page.fill('#password', 'stub-password');
await page.click('button[type="submit"]');
await page.waitForSelector('.app-main', { timeout: 15000 });

const banner = page.locator('.update-banner');

// Same build: the check runs on load, on focus and on visibility. None of them
// may produce a banner, or the team learns to ignore it.
await page.waitForTimeout(1200);
check(!(await banner.count()), 'no banner while the deployed build matches');
await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await page.waitForTimeout(600);
check(!(await banner.count()), 'still none after the tab is refocused');

// A deploy lands — while the reader is scrolled well down the page, which is
// where somebody who has had the tab open all morning actually is. The banner
// mounts above their viewport, so it has to be sticky or nothing visibly
// changes and the one notification is spent on an empty screen.
await page.evaluate(() => {
  const filler = document.createElement('div');
  filler.style.height = '4000px';
  document.querySelector('.app-main')?.appendChild(filler);
  window.scrollTo(0, 3000);
});
pretendNewDeploy = true;
await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await banner.waitFor({ timeout: 8000 }).catch(() => {});

const appeared = (await banner.count()) === 1;
check(appeared, 'the banner appears once a newer build is deployed');

const box = appeared ? await banner.boundingBox().catch(() => null) : null;
const viewport = page.viewportSize();
check(
  Boolean(box) && box.y >= 0 && box.y + box.height <= viewport.height,
  'it is on screen even for a reader scrolled far down the page',
  box ? `y=${Math.round(box.y)} h=${Math.round(box.height)} viewport=${viewport.height}` : 'no box'
);
await page.evaluate(() => window.scrollTo(0, 0));

// On a phone the sentence and a labelled button cannot share a line. `.btn` is
// white-space: nowrap, so if the text does not claim the whole row the message
// is squeezed into a sliver beside the button — worst in Persian, where the
// label is wider.
await page.setViewportSize({ width: 390, height: 800 });
await page.waitForTimeout(200);
const textBox = appeared ? await banner.locator('.update-banner-text').boundingBox().catch(() => null) : null;
const buttonBox = appeared ? await banner.locator('button').boundingBox().catch(() => null) : null;
check(
  Boolean(textBox && buttonBox) && buttonBox.y >= textBox.y + textBox.height,
  'on a phone the button drops to its own line instead of squeezing the message',
  textBox && buttonBox ? `text h=${Math.round(textBox.width)}w, button y=${Math.round(buttonBox.y)} vs text end ${Math.round(textBox.y + textBox.height)}` : 'no box'
);
await page.setViewportSize({ width: 1280, height: 720 });

// Every await past here is guarded. Under the regression this script exists to
// catch the banner is absent, and an unguarded locator call would reject on
// Playwright's 30s timeout — killing the run with a stack trace instead of
// printing which checks failed.
if (appeared) {
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/stale-build.png` });
  const text = await banner.innerText().catch(() => '');
  check(text.includes('newer version'), 'it says what happened', text.slice(0, 60));

  // Reloading has to defeat the cache that caused this — and, more to the
  // point, has to land on a working page running the new entry. Asserting only
  // that the URL changed would pass just as happily against a blank document.
  await banner.locator('button').click().catch(() => {});
  await page.waitForURL(/_app_refresh=/, { timeout: 8000 }).catch(() => {});
  check(/_app_refresh=/.test(page.url()), 'the reload busts the cache', page.url().slice(0, 90));

  await page.waitForSelector('.app-main', { timeout: 15000 }).catch(() => {});
  check(await page.locator('.app-main').count() === 1, 'the app comes back up after the reload');
  check((await page.locator('.update-banner').count()) === 0,
    'and does not immediately re-flag itself');
  const entry = await page
    .evaluate(() => document.querySelector('script[type="module"][src]')?.src || '')
    .catch(() => '');
  check(entry.includes(NEW_ENTRY), 'the tab is now running the newly deployed entry',
    entry.split('/').pop());
} else {
  console.log('      (skipped the reload checks — there was no banner to click)');
}
} finally {
  await browser.close();
  server.close();
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
