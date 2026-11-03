// Screenshots of every page at desktop and phone width. Usage: node shots.cjs <baseUrl> <outDir> <path>...
const { chromium } = require('playwright');
(async () => {
  const [base, out, ...paths] = process.argv.slice(2);
  const browser = await chromium.launch();
  for (const [name, vp] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    for (const p of paths) {
      await page.goto(base + p, { waitUntil: 'networkidle' }).catch((e) => errors.push(`${p}: ${e.message}`));
      await page.waitForTimeout(2500);
      const file = `${out}/${name}${p.replace(/[\/?=&]+/g, '_') || '_home'}.png`;
      await page.screenshot({ path: file, fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      console.log(`${name} ${p} -> ${file}${overflow ? '  [HORIZONTAL OVERFLOW]' : ''}`);
    }
    if (errors.length) console.log(`${name} errors:\n  ` + [...new Set(errors)].slice(0, 15).join('\n  '));
    await ctx.close();
  }
  await browser.close();
})();
