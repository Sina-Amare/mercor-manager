import { chromium } from 'playwright';
import { createHmac } from 'node:crypto';

const SITE = 'https://sina-amare.github.io/mercor-manager/';
const REF = 'rybeqpgjilocyzalvrnt';
const SECRET = 'ecW/cabgQ8ED7Ec8n/wo+vYeJg2q08igAXUbBQWZ73oJCjg6yE5EuOJ973/r2HdoE1Ez6HVzFDd75PMct+Gmyg==';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const h = b64({ alg: 'HS256', typ: 'JWT' });
const p = b64({
  sub: '27ce4595-c47e-4129-b7b1-70bed771a99f',
  role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 1800,
});
const access = `${h}.${p}.${createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`;
const session = {
  access_token: access, token_type: 'bearer', expires_in: 1800, expires_at: now + 1800,
  refresh_token: 'none',
  user: {
    id: '27ce4595-c47e-4129-b7b1-70bed771a99f', aud: 'authenticated',
    role: 'authenticated', email: 'admin@agnus.local', app_metadata: {}, user_metadata: {},
  },
};

async function open(browser, label) {
  const page = await (await browser.newContext()).newPage();
  page.on('websocket', (ws) => {
    console.log(`  [${label}] websocket -> ${ws.url().split('?')[0]}`);
    ws.on('framereceived', (f) => {
      const s = String(f.payload);
      if (s.includes('prompt_pins')) console.log(`  [${label}] frame: ${s.slice(0, 160)}`);
    });
    ws.on('socketerror', (e) => console.log(`  [${label}] ws error ${e}`));
    ws.on('close', () => console.log(`  [${label}] ws closed`));
  });
  await page.addInitScript(([ref, s]) => {
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(s));
  }, [REF, session]);
  await page.goto(`${SITE}#/prompts`, { waitUntil: 'domcontentloaded', timeout: 40000 });
  await page.waitForSelector('.prompts-grid', { timeout: 25000 });
  return page;
}

const names = (page) => page.locator('.prompts-pinned-name').allInnerTexts();

const browser = await chromium.launch();
const a = await open(browser, 'A');
const b = await open(browser, 'B');
await a.waitForTimeout(4000);

console.log('A pinned:', (await names(a)).join(' | '));
console.log('B pinned:', (await names(b)).join(' | '));

console.log('\n--- A reorders; B must follow WITHOUT reloading ---');
const upB = a.locator('.prompts-pinned-item').nth(1).locator('button[title="Move up"]');
if (await upB.count()) {
  await upB.click();
  await a.waitForTimeout(6000);
  console.log('A after move:', (await names(a)).join(' | '));
  console.log('B after move:', (await names(b)).join(' | '), '  <-- should match A');
} else {
  console.log('nothing pinned to reorder');
}

console.log('\n--- A pins a third; B must show it ---');
const third = a.locator('.prompt-card').nth(3).locator('.prompt-pin-button');
await third.click();
await a.waitForTimeout(6000);
console.log('A after pin:', (await names(a)).join(' | '));
console.log('B after pin:', (await names(b)).join(' | '), '  <-- should match A');

await browser.close();
