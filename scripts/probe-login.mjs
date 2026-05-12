import { chromium } from '../web/Front/customapp/node_modules/playwright/index.mjs';

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
await p.goto('https://neoleadge.pythagore-init.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await p.waitForLoadState('networkidle', { timeout: 15000 }).catch(()=>{});
console.log('URL:', p.url());
console.log('TITLE:', await p.title());
const emailInputs = await p.locator('input[type="email"]').count();
const passwordInputs = await p.locator('input[type="password"]').count();
const textInputs = await p.locator('input[type="text"]').count();
const submitButtons = await p.locator('button[type="submit"]').count();
console.log('email:', emailInputs, 'password:', passwordInputs, 'text:', textInputs, 'submit:', submitButtons);
const allButtons = await p.locator('button').elementHandles();
const labels = [];
for (const h of allButtons.slice(0, 12)) labels.push((await h.innerText().catch(() => '')).trim());
console.log('buttons:', JSON.stringify(labels));
const inputs = await p.locator('input').elementHandles();
const inputInfo = [];
for (const h of inputs.slice(0, 6)) {
  const attrs = await h.evaluate((el) => ({
    type: el.type, name: el.name, id: el.id, placeholder: el.placeholder, autocomplete: el.autocomplete,
  }));
  inputInfo.push(attrs);
}
console.log('inputs:', JSON.stringify(inputInfo, null, 2));
await p.screenshot({ path: './scripts/probe-login.png' });
await b.close();
