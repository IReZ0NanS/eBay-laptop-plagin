// Isolated, offline browser benchmark. No personal Chrome profile is used.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const source = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const instrumented = source.replace('function scan() {', 'function scan() { globalThis.auditScans++; const auditStart=performance.now();')
  .replace('      scanInProgress = false;', '      scanInProgress = false; globalThis.auditScanDurations.push(performance.now()-auditStart);')
  .replace('function collectResults() {', 'function collectResults(cards = productCards()) {')
  .replace('const cards = productCards();', '')
  .replace('for (const card of cards) {', 'for (const card of cards) { globalThis.auditCards++;');
(async () => {
  const browser = await chromium.launch({headless:true, ...(process.env.CHROME_EXECUTABLE ? {executablePath:process.env.CHROME_EXECUTABLE} : {})});
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.fulfill({contentType:'text/html', body:'<main><ul id="results"></ul></main><header id="unrelated"></header>'}));
    await page.goto('https://www.ebay.com/sch/i.html?_nkw=laptop');
    await page.evaluate(() => {
      window.auditScanDurations=[]; window.auditScans = 0; window.auditCards = 0; window.auditWrites = 0;
      window.chrome = {runtime:{sendMessage(message, callback){auditWrites++; callback({items:{}});}},storage:{local:{get(keys,callback){callback({ebayLaptopHelperSettings:{markNewItems:false,showRiskBadges:false}});}},onChanged:{addListener(){}}}};
      document.querySelector('#results').innerHTML = Array.from({length:600},(_,i)=>`<li class="s-item"><a class="s-item__link" href="https://www.ebay.com/itm/${123456789000+i}"><h3 class="s-item__title">Dell Latitude 5420 i5-1145G7 16GB 512GB SSD</h3></a><span class="s-item__price">US $${200+i}.00</span><span class="s-item__shipping">Free shipping</span></li>`).join('');
    });
    for (const name of ['core.js','inspection.js','translation.js']) await page.addScriptTag({path:path.join(root,name)});
    await page.evaluate(code => {const t=performance.now(); (0,eval)(code); return performance.now()-t;},instrumented);
    await page.waitForTimeout(800);
    const initial=await page.evaluate(()=>auditScanDurations.reduce((total,value)=>total+value,0));
    const baseline = await page.evaluate(()=>({scans:auditScans,cards:auditCards,writes:auditWrites}));
    const session = await page.context().newCDPSession(page);
    await session.send('Performance.enable');
    const metrics = async()=>Object.fromEntries((await session.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
    const before = await metrics();
    await page.evaluate(()=>{document.querySelector('.s-item__price').textContent='US $175.00';});
    await page.waitForTimeout(800);
    const changed = await page.evaluate(()=>({scans:auditScans,cards:auditCards,writes:auditWrites}));
    const after = await metrics();
    for(let i=0;i<5;i++){await page.evaluate(i=>{document.querySelector('#unrelated').textContent=String(i);},i); await page.waitForTimeout(300);}
    const unrelated=await page.evaluate(()=>({scans:auditScans,cards:auditCards,writes:auditWrites}));
    const idleBefore=await metrics(); await page.waitForTimeout(1000); const idleAfter=await metrics();
    console.log(JSON.stringify({root,initialMs:+initial.toFixed(2),baseline,onePriceChange:{scans:changed.scans-baseline.scans,cards:changed.cards-baseline.cards,writes:changed.writes-baseline.writes,scriptMs:+((after.ScriptDuration-before.ScriptDuration)*1000).toFixed(2)},fiveHeaderChanges:{scans:unrelated.scans-changed.scans,cards:unrelated.cards-changed.cards,writes:unrelated.writes-changed.writes},idleScriptMs:+((idleAfter.ScriptDuration-idleBefore.ScriptDuration)*1000).toFixed(2)},null,2));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
