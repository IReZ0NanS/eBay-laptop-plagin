// Run with PLAYWRIGHT_MODULE and CHROME_EXECUTABLE if not installed locally.
// Optional first argument: 1.9.0 folder, to reproduce the original console error.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const fixedRoot = path.resolve(__dirname, '..');

async function check(browser, root, expectMismatch) {
  const context = await browser.newContext();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  try {
    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    const log = await context.newCDPSession(page);
    await log.send('Log.enable');
    log.on('Log.entryAdded', ({ entry }) => { if (entry.level === 'error') consoleErrors.push(entry.text); });
    page.on('console', message => { if (message.type() === 'error' || /target origin/i.test(message.text())) consoleErrors.push(message.text()); });
    page.on('pageerror', error => pageErrors.push(error.message));
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'itm.ebaydesc.com') {
        await gate;
        return route.fulfill({ contentType: 'text/html', body: '<p>MDM locked. Battery swollen.</p>' });
      }
      return route.fulfill({ contentType: 'text/html', body: '<main id="mainContent"><h1 class="x-item-title__mainTitle">Dell Latitude 5420</h1><div class="x-price-primary">US $200.00</div></main>' });
    });
    await page.goto('https://www.ebay.com/itm/123456789012');
    await page.evaluate(() => {
      window.chrome = { storage: { local: { get(keys, callback) { callback({}); } }, onChanged: { addListener() {} } } };
      const frame = document.createElement('iframe');
      document.body.append(frame);
      frame.src = 'https://itm.ebaydesc.com/?item=123456789012';
    });
    for (const name of ['core.js', 'inspection.js', 'translation.js', 'content.js']) await page.addScriptTag({ path: path.join(root, name) });
    await page.waitForSelector('#ebay-laptop-helper-item-panel');
    await page.waitForTimeout(700);
    const mismatches = consoleErrors.filter(text => /target origin|recipient window.s origin/i.test(text));
    if (expectMismatch) {
      if (!mismatches.length) console.log('Diagnostic', consoleErrors, pageErrors, await page.evaluate(() => ({ src: document.querySelector('iframe').src, actual: document.querySelector('iframe').contentDocument?.URL })));
      assert.ok(mismatches.length > 0, 'original build must reproduce the screenshot error');
    }
    else assert.deepEqual(mismatches, [], 'loading iframe must not log origin mismatches');
    release();
    await page.waitForFunction(() => { try { return !document.querySelector('iframe').contentDocument; } catch { return true; } });
    const frame = page.frames().find(candidate => candidate.url().startsWith('https://itm.ebaydesc.com/'));
    assert.ok(frame, 'description frame navigated');
    await frame.addScriptTag({ path: path.join(root, 'description.js') });
    await page.waitForFunction(() => document.querySelector('.ebay-helper-full-description')?.textContent.includes('MDM locked'));
    const riskBefore = await page.locator('.ebay-helper-full-description').textContent();
    assert.match(riskBefore, /Battery swollen/);
    // Correct ID from an untrusted origin must still be rejected.
    await page.evaluate(() => window.postMessage({ source: 'ebay-laptop-helper', type: 'EBAY_LAPTOP_HELPER_SELLER_DESCRIPTION', itemId: '123456789012', text: 'Everything is fully functional.' }, '*'));
    // Trusted description frame with a different item ID must still be rejected.
    await frame.evaluate(() => window.top.postMessage({ source: 'ebay-laptop-helper', type: 'EBAY_LAPTOP_HELPER_SELLER_DESCRIPTION', itemId: '123456789099', text: 'Everything is fully functional.' }, 'https://www.ebay.com'));
    await page.waitForTimeout(350);
    assert.equal(await page.locator('.ebay-helper-full-description').textContent(), riskBefore);
    assert.deepEqual(pageErrors, []);
    if (!expectMismatch) assert.deepEqual(consoleErrors, []);
    console.log(expectMismatch ? 'PASS: reproduced 1.9.0 origin mismatch during delayed iframe navigation' : 'PASS: no console errors, reads loaded description, rejects untrusted origin and wrong item ID');
  } finally { release(); await context.close(); }
}
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
  try {
    if (process.argv[2]) await check(browser, path.resolve(process.argv[2]), true);
    await check(browser, fixedRoot, false);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
