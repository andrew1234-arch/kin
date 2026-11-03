// Browser e2e of the wallet flow against the LOCAL stack: an injected EIP-1193 provider forwards to
// anvil, whose dev account is unlocked, so personal_sign works without a key in the page.
const { chromium } = require('playwright');
(async () => {
  const [base, rpc, account, out] = process.argv.slice(2);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(({ rpc, account }) => {
    const call = async (method, params) => {
      const r = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const j = await r.json();
      if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code });
      return j.result;
    };
    window.ethereum = {
      isMetaMask: true,
      on() {}, removeListener() {},
      async request({ method, params }) {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [account];
        if (method === 'wallet_requestPermissions' || method === 'wallet_getPermissions') return [{ parentCapability: 'eth_accounts' }];
        return call(method, params ?? []);
      },
    };
  }, { rpc, account });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/launch/demo-open', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.getByRole('menuitem').first().click();
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByText('Registered.').waitFor({ timeout: 15000 });
  console.log('register: OK');
  await page.fill('#reason', 'Browser e2e: this wallet was funded from my own exchange account');
  await page.getByRole('button', { name: 'Sign and file dispute' }).click();
  await page.getByText('Dispute filed.').waitFor({ timeout: 15000 });
  console.log('dispute: OK');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out, fullPage: true });
  if (errors.length) console.log('page errors:', errors);
  await browser.close();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
