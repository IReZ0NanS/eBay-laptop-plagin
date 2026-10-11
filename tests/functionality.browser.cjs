// Offline functional/UI tests in a disposable profile.
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {contentScripts, launchOptions} = require('./browser-helpers.cjs');
const root = path.resolve(__dirname,'..');
const artifacts = path.resolve(process.env.AUDIT_ARTIFACTS || path.join(root,'..','audit-artifacts'));
fs.mkdirSync(artifacts,{recursive:true});
let passed=0;
function ok(label){passed++; console.log('PASS: '+label);}
async function storage(page,settings={}) {
  await page.evaluate(settings=>{
    window.auditStored={ebayLaptopHelperSettings:settings}; window.auditWrites=0; window.auditReads=0; window.auditScans=0;
    window.chrome={runtime:{},storage:{local:{get(keys,callback){auditReads++; callback(structuredClone(auditStored));},set(values,callback){auditWrites++; Object.assign(auditStored,structuredClone(values)); callback?.();}},onChanged:{addListener(fn){window.auditChanged=fn;}}}};
    window.auditSettings = values=>{Object.assign(auditStored.ebayLaptopHelperSettings,values); auditChanged({ebayLaptopHelperSettings:{newValue:structuredClone(auditStored.ebayLaptopHelperSettings)}},'local');};
  },settings);
}
async function install(page) {
  await page.addStyleTag({path:path.join(root,'content.css')});
  for (const name of contentScripts(root)) {
    if (name === 'content.js') await page.addScriptTag({content:fs.readFileSync(path.join(root,name),'utf8').replace('function scan() {','function scan() { globalThis.auditScans++;')});
    else await page.addScriptTag({path:path.join(root,name)});
  }
}
async function wait(page){await page.waitForTimeout(400);}
async function popupPage(context,errors,settings) {
  const popup=await context.newPage(); popup.on('pageerror',e=>errors.push(e.message));
  await popup.setViewportSize({width:392,height:600}); await popup.goto('https://audit.invalid/popup.html');
  await popup.setContent(fs.readFileSync(path.join(root,'popup.html'),'utf8').replace(/<script[\s\S]*?<\/script>/g,''));
  await storage(popup,settings);
  return popup;
}
async function loadPopup(popup) {
  await popup.addStyleTag({path:path.join(root,'popup.css')});
  await popup.addScriptTag({path:path.join(root,'core.js')}); await popup.addScriptTag({path:path.join(root,'popup.js')});
}
(async()=>{
  const browser=await chromium.launch(launchOptions());
  const errors=[];
  try {
    const context=await browser.newContext({viewport:{width:1100,height:900}});
    const page=await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
    await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<main id="mainContent"></main><header id="unrelated"></header>'}));
    await page.goto('https://www.ebay.com/sch/i.html');
    await page.setContent(fs.readFileSync(path.join(root,'tests/fixture.html'),'utf8').replace(/<script[\s\S]*?<\/script>/g,''));
    await storage(page,{markNewItems:true,showRiskBadges:true});
    await install(page);
    await page.waitForSelector('[data-ebay-helper-converted]');
    assert.equal(await page.locator('.ebay-helper-card').count(),3);
    assert.equal(await page.locator('[data-ebay-helper-sold]').count(),3);
    assert.equal(await page.locator('[data-ebay-helper-olx]').count(),3);
    assert.match(await page.locator('[data-ebay-helper-converted]').first().textContent(),/14\s*786/);
    assert.equal(await page.locator('[data-ebay-helper-risk], [data-ebay-helper-new]').count(),0);
    assert.equal(await page.evaluate(()=>auditWrites),0);
    ok('catalog totals, links, old settings and removed features');
    await page.screenshot({path:path.join(artifacts,'catalog.png'),fullPage:true});
    await page.locator('.s-card__price').evaluate(el=>el.textContent='US $100.00'); await wait(page);
    assert.match(await page.locator('[data-ebay-helper-converted]').first().textContent(),/7\s*196/);
    await page.locator('[data-ebay-helper-sold]').first().evaluate(el=>el.remove()); await wait(page);
    assert.equal(await page.locator('[data-ebay-helper-sold]').count(),3);
    ok('dynamic price updates and restoration of removed links');
    await page.locator('meta[itemprop="priceCurrency"]').evaluate(el=>el.setAttribute('content','CAD'));
    await wait(page);
    assert.equal(await page.locator('li').nth(2).locator('[data-ebay-helper-converted]').count(),0);
    ok('CAD metadata is never shown as a USD total');
    await page.evaluate(()=>auditSettings({showConvertedPrice:false,showSoldSearch:false})); await wait(page);
    assert.equal(await page.locator('[data-ebay-helper-converted], [data-ebay-helper-sold]').count(),0);
    await page.evaluate(()=>auditSettings({enabled:false})); await wait(page);
    assert.equal(await page.locator('[data-ebay-helper-owned], .ebay-helper-card').count(),0);
    const scans=await page.evaluate(()=>auditScans);
    await page.locator('.s-card__price').evaluate(el=>el.textContent='US $300.00'); await wait(page);
    assert.equal(await page.evaluate(()=>auditScans),scans);
    await page.evaluate(()=>auditSettings({enabled:true,showConvertedPrice:true,showSoldSearch:true})); await wait(page);
    assert.match(await page.locator('[data-ebay-helper-converted]').first().textContent(),/17\s*316/);
    ok('feature switches and no scans while disabled');
    await page.evaluate(()=>auditSettings({preferredKeywords:'ThinkPad',excludedKeywords:'EliteBook',greenTitleColor:'#123456'})); await wait(page);
    assert.ok(await page.locator('li').first().evaluate(el=>el.classList.contains('ebay-helper-preferred')));
    assert.ok(await page.locator('li').nth(1).evaluate(el=>el.classList.contains('ebay-helper-excluded')));
    assert.equal(await page.locator('li').first().evaluate(el=>el.style.getPropertyValue('--ebay-helper-title-color')),'#c17d00');
    await page.evaluate(()=>auditSettings({greenMaxUah:20000,yellowMaxUah:30000})); await wait(page);
    assert.equal(await page.locator('li').first().evaluate(el=>el.style.getPropertyValue('--ebay-helper-title-color')),'#123456');
    ok('preferred and excluded words, thresholds and custom title colors');
    await page.evaluate(()=>{
      document.querySelector('ul').insertAdjacentHTML('beforeend','<li class="brwrvr__item-card"><div class="brwrvr__item-card__body"><a class="bsig__title__wrapper" href="https://www.ebay.com/p/9048104800"><h3 class="bsig__title__text">Microsoft Surface Pro 7 8GB 256GB SSD</h3></a><span class="bsig__price bsig__price--displayprice">$335.00</span><span class="bsig__logisticsCost">Free international shipping</span></div></li>');
    }); await wait(page);
    const latestCard=page.locator('li').last();
    assert.match(await latestCard.locator('[data-ebay-helper-converted]').textContent(),/18\s*331/);
    assert.match(await latestCard.locator('[data-ebay-helper-converted]').getAttribute('title'),/безкоштовна/);
    ok('current category signals, international free shipping and product links');
    const beforeHidden=await page.evaluate(()=>auditScans);
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true}); document.dispatchEvent(new Event('visibilitychange')); document.querySelector('.s-card__price').textContent='US $250.00';});
    await wait(page); assert.equal(await page.evaluate(()=>auditScans),beforeHidden);
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false}); document.dispatchEvent(new Event('visibilitychange'));});
    await wait(page); assert.match(await page.locator('[data-ebay-helper-converted]').first().textContent(),/14\s*786/);
    ok('hidden tabs suspend work and catch up when shown');
    await page.evaluate(()=>{
      document.querySelector('ul').insertAdjacentHTML('beforeend',
        '<li class="brwrvr__item-card" id="range-card"><div><a href="https://www.ebay.com/itm/223456789015"><div role="heading" class="s-card__title"><span>Lenovo ThinkPad X1 Carbon Gen 9 i7-1185G7 16GB</span><span class="clipped">Opens in a new window or tab</span></div></a>'
        +'<div class="s-card__attribute-row"><span class="s-card__price">$300.00</span><span class="s-card__price"> to </span><span class="s-card__price">$500.00</span></div><div class="s-card__attribute-row">+$20.00 delivery</div></div></li>'
        +'<li class="brwrvr__item-card" id="placeholder-card"><div><a href="https://www.ebay.com/itm/223456789016"><h3 class="bsig__title__text">Shop on eBay</h3></a><span class="bsig__price">$479.99</span></div></li>');
    }); await wait(page);
    assert.match(await page.locator('#range-card [data-ebay-helper-converted]').textContent(),/17\s*572.*27\s*692/);
    assert.equal(await page.locator('#range-card .s-card__attribute-row [data-ebay-helper-converted]').count(),1);
    assert.ok(await page.locator('#range-card').evaluate(el=>el.classList.contains('ebay-helper-tier-yellow')));
    assert.doesNotMatch(await page.locator('#range-card [data-ebay-helper-olx]').getAttribute('href'),/Opens/);
    assert.doesNotMatch(await page.locator('#range-card [data-ebay-helper-sold]').getAttribute('aria-label'),/Opens/);
    assert.equal(await page.locator('#placeholder-card.ebay-helper-card, #placeholder-card [data-ebay-helper-owned]').count(),0);
    ok('split search-page ranges, hidden link text and placeholder cards');
    await page.evaluate(()=>auditSettings({hideRed:true,hideExcluded:true})); await wait(page);
    const excludedCard=page.locator('li').nth(1);
    const badge=page.locator('#ebay-laptop-helper-filter');
    assert.equal(await excludedCard.isVisible(),false);
    assert.match(await badge.textContent(),/Приховано 1/);
    await badge.click();
    assert.equal(await excludedCard.isVisible(),true);
    assert.match(await badge.textContent(),/Показано приховані: 1/);
    await badge.click();
    assert.equal(await excludedCard.isVisible(),false);
    await page.evaluate(()=>auditSettings({yellowMaxUah:25000})); await wait(page);
    assert.equal(await page.locator('#range-card').isVisible(),false);
    assert.match(await badge.textContent(),/Приховано 2/);
    await page.evaluate(()=>auditSettings({hideRed:false,hideExcluded:false,yellowMaxUah:30000})); await wait(page);
    assert.equal(await badge.count(),0);
    assert.equal(await excludedCard.isVisible(),true);
    ok('hiding red and excluded cards with a temporary reveal badge');

    await page.goto('https://www.ebay.com/itm/123456789012');
    await page.setContent(fs.readFileSync(path.join(root,'tests/item-fixture.html'),'utf8').replace(/<script[\s\S]*?<\/script>/g,''));
    await storage(page); await install(page); await page.waitForSelector('#ebay-laptop-helper-item-panel');
    const panel=page.locator('#ebay-laptop-helper-item-panel');
    assert.match(await panel.locator('.ebay-helper-item-total').textContent(),/14\s*786/);
    assert.equal(await panel.locator('details[open]').count(),0);
    assert.equal(await panel.locator('.ebay-helper-item-risk').count(),0);
    const actionsTop=await panel.locator('.ebay-helper-item-actions').evaluate(el=>el.getBoundingClientRect().top);
    const factsTop=await panel.locator('[data-section="facts"]').evaluate(el=>el.getBoundingClientRect().top);
    assert.ok(actionsTop<factsTop);
    await page.screenshot({path:path.join(artifacts,'item-desktop.png'),fullPage:true});
    ok('compact item panel keeps price and comparison actions first');
    await panel.locator('[data-section="search"] summary').click();
    await panel.getByRole('textbox',{name:'Запит для пошуку аналогів'}).fill('Dell Latitude custom search');
    await page.locator('.ux-labels-values--shipping').evaluate(el=>el.textContent='Shipping: US $25.00'); await wait(page);
    assert.equal(await panel.getByRole('textbox',{name:'Запит для пошуку аналогів'}).inputValue(),'Dell Latitude custom search');
    assert.ok(await panel.getByRole('textbox',{name:'Запит для пошуку аналогів'}).evaluate(el=>el===document.activeElement));
    assert.match(await panel.locator('[data-section="search"]').getByRole('link',{name:'SOLD',exact:true}).getAttribute('href'),/Dell%20Latitude%20custom%20search/);
    ok('edited search, focus and links survive panel updates');
    assert.match(await panel.locator('.ebay-helper-item-breakdown').textContent(),/\$249\.99 \+ доставка \$25$/);
    assert.equal(await panel.locator('.ebay-helper-checks .ebay-helper-chip').count(),5);
    assert.match(await panel.locator('[data-section="questions"] summary').textContent(),/2 пункти/);
    await panel.locator('[data-section="questions"] summary').click();
    const draft=panel.getByRole('textbox',{name:'Питання продавцю — можна редагувати й скопіювати'});
    assert.match(await draft.inputValue(),/Hello!/);
    await draft.fill('My own question'); await page.locator('.ux-labels-values--shipping').evaluate(el=>el.textContent='Shipping: US $15.00'); await wait(page);
    assert.equal(await draft.inputValue(),'My own question');
    ok('pre-purchase chips, ready seller questions and preserved drafts');
    await page.evaluate(()=>Object.defineProperty(window,'Translator',{configurable:true,writable:true,value:undefined}));
    await panel.getByRole('button',{name:'Перекласти',exact:true}).click(); await wait(page);
    assert.match(await panel.locator('.ebay-helper-translation-error').last().textContent(),/недоступний/);
    await page.evaluate(()=>{window.Translator={availability:async()=> 'available',create:async()=>({translate:async text=>'UK: '+text})};});
    await panel.getByRole('button',{name:'Перекласти',exact:true}).click();
    await page.waitForSelector('button[aria-pressed="true"]');
    assert.match(await panel.locator('[data-section="facts"]').textContent(),/UK:/);
    assert.match(await panel.locator('.ebay-helper-key-facts').textContent(),/UK:/);
    assert.match(await panel.locator('.ebay-helper-full-description').textContent(),/^UK:/);
    await panel.getByRole('button',{name:'Оригінал',exact:true}).click(); await wait(page);
    assert.doesNotMatch(await panel.locator('[data-section="facts"]').textContent(),/UK:/);
    assert.match(await panel.locator('.ebay-helper-full-description').textContent(),/very little wear/);
    ok('one switch translates facts and the full description, and restores the original');
    await page.setViewportSize({width:360,height:800});
    await page.addStyleTag({content:'body{padding:12px!important} #mainContent{padding:12px!important}'});
    assert.ok(await panel.evaluate(el=>el.getBoundingClientRect().right<=innerWidth));
    await page.screenshot({path:path.join(artifacts,'item-narrow.png'),fullPage:true});
    ok('item panel fits a narrow window');
    await page.evaluate(()=>{
      const section=document.createElement('div'); section.id='viTabs_0_is';
      section.innerHTML='<dl><div class="ux-layout-section-evo__col"><dt>RAM Size</dt><dd>16 GB</dd></div><div class="ux-layout-section-evo__col"><dt>SSD Capacity</dt><dd>1 TB</dd></div></dl>';
      document.querySelector('#mainContent').append(section);
    }); await wait(page);
    assert.match(await panel.locator('.ebay-helper-conflict').first().textContent(),/Характеристики eBay: 16 GB/);
    assert.match(await panel.textContent(),/Характеристики eBay: 1024 GB/);
    ok('current eBay item-specifics markup detects RAM and SSD conflicts');
    await page.evaluate(()=>auditSettings({showItemPagePanel:false})); await wait(page);
    assert.equal(await panel.count(),0);
    ok('item panel switch removes the panel');

    await page.goto('https://www.ebay.com/itm/198056169891');
    await page.setContent(fs.readFileSync(path.join(root,'tests/item-foreign-fixture.html'),'utf8'));
    await storage(page); await install(page); await page.waitForSelector('#ebay-laptop-helper-item-panel');
    const foreignPanel=page.locator('#ebay-laptop-helper-item-panel');
    assert.match(await foreignPanel.locator('.ebay-helper-item-total').textContent(),/17\s*191/);
    assert.match(await foreignPanel.textContent(),/≈ \$290\.08 \(ціна продавця EUR 259\.00\) \+ доставка \$22\.40/);
    assert.equal(await page.locator('#ebay-laptop-helper-status').count(),0);
    ok('EUR listings use eBay approximate USD price and shipping');

    await page.goto('https://www.ebay.com/mye/myebay'); await storage(page); await install(page); await wait(page);
    assert.equal(await page.locator('[data-ebay-helper-owned]').count(),0);
    ok('no waiting badge or scans on account pages');

    const popup=await popupPage(context,errors,{usdRate:44,markNewItems:false,showRiskBadges:false});
    await loadPopup(popup);
    assert.equal(await popup.locator('#usdRate').inputValue(),'44');
    assert.equal(await popup.locator('#markNewItems, #showRiskBadges, #saveButton').count(),0);
    assert.ok(await popup.locator('#resetButton').evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight;}));
    await popup.screenshot({path:path.join(artifacts,'popup.png'),fullPage:true});
    await popup.locator('#usdRate').fill('48');
    await popup.waitForFunction(()=>auditStored.ebayLaptopHelperSettings.usdRate===48);
    assert.match(await popup.locator('#status').textContent(),/Збережено/);
    assert.equal(await popup.evaluate(()=>('markNewItems' in auditStored.ebayLaptopHelperSettings)),false);
    await popup.locator('#hideRed').check();
    await popup.waitForFunction(()=>auditStored.ebayLaptopHelperSettings.hideRed===true);
    await popup.locator('#enabled').uncheck();
    assert.equal(await popup.evaluate(()=>auditStored.ebayLaptopHelperSettings.enabled),false);
    await popup.locator('#resetButton').click();
    assert.match(await popup.locator('#resetButton').textContent(),/ще раз/);
    assert.equal(await popup.locator('#usdRate').inputValue(),'48');
    await popup.locator('#resetButton').click();
    assert.equal(await popup.locator('#usdRate').inputValue(),'46');
    assert.equal(await popup.locator('#enabled').isChecked(),false);
    assert.deepEqual(await popup.evaluate(()=>{const v=auditStored.ebayLaptopHelperSettings; return [v.usdRate,v.hideRed,v.enabled];}),[46,false,false]);
    ok('popup autosave, legacy settings and confirmed reset preserve master switch');
    await popup.getByText('Перенесення налаштувань',{exact:true}).click();
    await popup.locator('#importFile').setInputFiles({name:'settings.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({version:1,settings:{usdRate:51,showSoldSearch:false}}))});
    await popup.waitForFunction(()=>auditStored.ebayLaptopHelperSettings.usdRate===51);
    assert.equal(await popup.locator('#usdRate').inputValue(),'51');
    assert.equal(await popup.evaluate(()=>auditStored.ebayLaptopHelperSettings.showSoldSearch),false);
    await popup.locator('#importFile').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{}')});
    await popup.waitForFunction(()=>document.querySelector('#status').textContent.includes('Не вдалося'));
    assert.equal(await popup.evaluate(()=>auditStored.ebayLaptopHelperSettings.usdRate),51);
    const download=popup.waitForEvent('download'); await popup.locator('#exportButton').click();
    assert.equal((await download).suggestedFilename(),'ebay-helper-settings.json');
    ok('settings import, validation and export');
    await popup.getByText('Кольори та слова у назві',{exact:true}).click();
    await popup.locator('#greenMaxUah').fill('20000'); await popup.locator('#yellowMaxUah').fill('10000');
    const writes=await popup.evaluate(()=>auditWrites);
    await popup.waitForTimeout(700);
    assert.equal(await popup.evaluate(()=>auditWrites),writes);
    assert.notEqual(await popup.evaluate(()=>auditStored.ebayLaptopHelperSettings.yellowMaxUah),10000);
    assert.match(await popup.locator('#status').textContent(),/Не збережено: Жовта межа/);
    assert.match(await popup.locator('#yellowMaxUah').evaluate(el=>el.validationMessage),/Жовта межа/);
    await popup.evaluate(()=>{chrome.storage.local.set=(values,callback)=>{chrome.runtime.lastError={message:'Test write failure'};callback();delete chrome.runtime.lastError;};});
    await popup.locator('#yellowMaxUah').fill('30000');
    await popup.waitForFunction(()=>document.querySelector('#status').textContent.includes('Test write failure'));
    assert.ok(await popup.locator('#yellowMaxUah').isEditable());
    assert.equal(await popup.locator('#yellowMaxUah').inputValue(),'30000');
    ok('invalid thresholds are not saved and failed saves keep editable values');
    const failedPopup=await popupPage(context,errors,{});
    await failedPopup.evaluate(()=>{chrome.storage.local.get=(keys,callback)=>{chrome.runtime.lastError={message:'Test read failure'};callback({});delete chrome.runtime.lastError;};});
    await loadPopup(failedPopup);
    assert.equal(await failedPopup.locator('#resetButton').isEnabled(),false);
    assert.equal(await failedPopup.locator('#usdRate').isEditable(),false);
    assert.match(await failedPopup.locator('#status').textContent(),/Не вдалося прочитати/);
    ok('failed initial settings read cannot overwrite saved preferences');
    assert.deepEqual(errors,[]);
    console.log(`${passed} browser scenarios passed; screenshots: ${artifacts}`);
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
