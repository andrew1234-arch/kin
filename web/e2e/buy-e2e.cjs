// Browser e2e: window buy through KinRouter (tokens vaulted), then claim after the lock. LOCAL stack only.
const { chromium } = require('playwright');
(async () => {
  const [base, rpc, account, slug, out] = process.argv.slice(2);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(({ rpc, account }) => {
    const call = async (method, params) => {
      const r = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const j = await r.json();
      if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code });
      return j.result;
    };
    window.ethereum = { isMetaMask: true, on() {}, removeListener() {},
      async request({ method, params }) {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [account];
        return call(method, params ?? []);
      } };
  }, { rpc, account });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('page error:', e.message));
  await page.goto(`${base}/launch/${slug}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.getByRole('menuitem').first().click();
  await page.getByText(/Window open for/).waitFor({ timeout: 90000 });
  console.log('window open');
  await page.getByPlaceholder(/ETH, up to/).fill('0.005');
  await page.getByRole('button', { name: 'Buy' }).click();
  await page.getByText('Confirmed').waitFor({ timeout: 30000 });
  await page.waitForTimeout(6000);
  const vault = await page.locator('dt:has-text("In the vault") + dd').innerText();
  const spent = await page.locator('dt:has-text("Entity spent") + dd').innerText();
  console.log(`buy confirmed; entity spent ${spent}; in the vault ${vault}`);
  await page.screenshot({ path: out.replace('.png', '-window.png'), fullPage: true });
  const claim = page.getByRole('button', { name: 'Claim from the vault' });
  await claim.waitFor({ timeout: 240000 });
  await claim.click();
  await page.waitForFunction(() => /Confirmed/.test(document.body.innerText) && !/Confirming/.test(document.body.innerText), null, { timeout: 30000 });
  await page.waitForTimeout(6000);
  console.log(`claimed; in the vault now ${await page.locator('dt:has-text("In the vault") + dd').innerText()}`);
  await page.screenshot({ path: out, fullPage: true });
  await browser.close();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
