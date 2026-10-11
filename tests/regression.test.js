"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
require('../core.js');
require('../inspection.js');
const core = globalThis.EbayLaptopCore;
const inspection = globalThis.EbayLaptopInspection;

test('analog search preserves model after CPU and excludes GPU memory', () => {
  assert.match(core.buildOlxSearchQuery('i5-1145G7 Dell Latitude 5420 16GB 512GB'), /Dell Latitude 5420/);
  const query=core.buildEbaySoldSearchQuery('Lenovo Legion RTX 3060 6GB 16GB RAM 512GB SSD');
  assert.match(query,/16GB 512GB/);
  assert.doesNotMatch(query,/\b6GB\b/);
});
test('facts after Specifications are retained and decimal GHz stays intact', () => {
  const info=core.extractSellerDescriptionInfo('Specifications:\nProcessor: Intel Core i5 4.6 GHz\nBattery is dead.\nScreen has cracks.');
  assert.match(info.battery.join(' '),/dead/);
  assert.match(info.highlights.join(' '),/cracks/);
  assert.match(info.specs[0].value,/4\.6 GHz/);
});
test('conflicting sources are identified without treating missing facts as zero', () => {
  const result=inspection.inspect([{kind:'title',label:'Title',text:'Dell 16GB RAM 512GB SSD'}, {kind:'specifics',label:'eBay',text:'RAM: 8 GB\nStorage: 512 GB'}, {kind:'description',label:'Seller',text:'RAM removed'}]);
  assert.equal(result.conflicts.length,1);
  assert.equal(result.conflicts[0].key,'ram');
  assert.equal(result.conflicts[0].values.length,3);
  assert.ok(result.questions.some(q=>q.includes('RAM')));
  assert.equal(inspection.inspect([{kind:'title',label:'Title',text:'Dell Laptop'}]).conflicts.length,0);
});
test('equivalent storage and CPU spelling do not conflict', () => {
  assert.equal(inspection.inspect([{kind:'title',label:'a',text:'i5-1145G7 1TB SSD'},{kind:'specifics',label:'b',text:'i5 1145G7 1024GB SSD'}]).conflicts.length,0);
});
test('common abbreviated RAM/SSD title and model-only search are recognized', () => {
  assert.equal(inspection.facts('Lenovo Yoga 7 Ryzen 5 7535U 16GB 512GB SSD').ram,'16 GB');
  assert.equal(core.buildOlxSearchQuery('i5-1145G7 Dell Latitude 5420 16GB 512GB',false),'Dell Latitude 5420');
});

test('battery percentage at the end of a sentence counts as supplied information', () => {
  const result = inspection.inspect([{kind:'description',label:'Seller',text:'Battery report shows 90%. Original charger included.'}]);
  assert.equal(result.checks.find(check => check.label === 'Батарея').found, true);
});

test('old settings retain active features and discard retired options', () => {
  const value = core.sanitizeSettings({usdRate:44,markNewItems:true,showRiskBadges:true,showSoldSearch:false});
  assert.equal(value.usdRate,44);
  assert.equal(value.showSoldSearch,false);
  assert.equal('markNewItems' in value,false);
  assert.equal('showRiskBadges' in value,false);
});

test('blank imported numbers use defaults instead of silently becoming zero', () => {
  assert.equal(core.sanitizeSettings({fixedFeeUsd:null}).fixedFeeUsd,30);
  assert.equal(core.sanitizeSettings({markupPercent:''}).markupPercent,10);
  assert.equal(core.sanitizeSettings({fixedFeeUsd:0}).fixedFeeUsd,0);
});

test('USD ranges with a single currency symbol keep both limits', () => {
  const price=core.parseUsdPrice('US $199.00 to 299.00');
  assert.equal(price.minUsd,199);
  assert.equal(price.maxUsd,299);
  assert.equal(price.isRange,true);
});

test('keywords match from the start of a word only', () => {
  assert.equal(core.matchesKeywords('Dell laptop has issues with battery','as is'),false);
  assert.equal(core.matchesKeywords('Sold AS IS for parts','as is'),true);
  assert.equal(core.matchesKeywords('Intel chip','hp'),false);
  assert.equal(core.matchesKeywords('HP EliteBook 840','hp'),true);
  assert.equal(core.matchesKeywords('Lenovo Legion RTX 3060','rtx 30'),true);
  assert.equal(core.matchesKeywords('Screen repaired','repair'),true);
  assert.equal(core.matchesKeywords('Ноутбук Lenovo','ноутбук'),true);
  assert.equal(core.matchesKeywords('C++ (i7) laptop','c++, (i7)'),true);
  assert.equal(core.matchesKeywords('Dell','  , ;'),false);
});

test('hidden eBay link text never reaches titles or searches', () => {
  assert.equal(core.cleanTitle('New Listing Dell Latitude 5420 Opens in a new window or tab'),'Dell Latitude 5420');
  assert.equal(core.buildOlxSearchQuery('Dell Latitude 5420 14" FHD Opens in a new window or tab'),'Dell Latitude 5420');
});

test('foreign-currency listings use eBay approximate USD only', () => {
  assert.equal(core.parseUsdPrice('EUR 259.00 Approximately US $290.08').maxUsd,290.08);
  assert.equal(core.parseUsdPrice('EUR 259.00'),null);
  assert.equal(core.parseUsdPrice('C $299.00'),null);
  assert.equal(core.parseShippingUsd('Shipping: EUR 20.00 (approx US $22.40) eBay International Shipping').usd,22.4);
  assert.equal(core.parseShippingUsd('C $20.00 shipping'),null);
});

test('one or two digits after a single separator are decimals', () => {
  assert.equal(core.parseUsdPrice('$12,5').minUsd,12.5);
  assert.equal(core.parseUsdPrice('$1.5').minUsd,1.5);
  assert.equal(core.parseUsdPrice('$1,299').minUsd,1299);
  assert.equal(core.parseUsdPrice('$1.299,99').minUsd,1299.99);
  assert.equal(core.parseUsdPrice('$1,234,567').minUsd,1234567);
});

test('seller description lines are classified once', () => {
  const info=core.extractSellerDescriptionInfo('Condition: Used, works great. Small scratch on lid.\nSpecifications:\nDisplay: 14" FHD screen\nBattery: 85% health');
  assert.deepEqual(info.highlights,['Used, works great.','Small scratch on lid.']);
  assert.deepEqual(info.battery,['Battery: 85% health']);
  assert.equal(info.specs.length,2);
});

test('a bare RAM/storage pair in a title provides both values', () => {
  assert.deepEqual(inspection.facts('MacBook Air M2 8GB 256GB'),{cpu:'M2',ram:'8 GB',storage:'256 GB'});
  assert.equal(inspection.inspect([{kind:'title',label:'a',text:'Dell 16GB 512GB'},{kind:'specifics',label:'b',text:'SSD Capacity: 1 TB'}]).conflicts[0].key,'storage');
});

test('hiding options are off unless explicitly enabled', () => {
  assert.equal(core.sanitizeSettings({}).hideRed,false);
  assert.equal(core.sanitizeSettings({hideRed:'yes'}).hideRed,false);
  assert.equal(core.sanitizeSettings({hideRed:true,hideExcluded:true}).hideExcluded,true);
});

test('listing evaluation shares tier and keyword signals', () => {
  const settings=core.sanitizeSettings({excludedKeywords:'parts'});
  const result=core.evaluateListing('Dell for parts',{minUsd:900,maxUsd:900},{usd:0},settings);
  assert.deepEqual(result,{tier:'red',preferred:false,excluded:true});
  assert.equal(core.shippingLabel({known:true,isFree:false,usd:12.5}),'доставка $12.50');
  assert.equal(core.buildOlxSearchUrlFromQuery(' Dell 5420 '),'https://www.olx.ua/uk/elektronika/noutbuki-i-aksesuary/noutbuki/q-Dell-5420/');
});
