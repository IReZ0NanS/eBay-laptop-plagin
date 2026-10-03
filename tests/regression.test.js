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
  assert.equal(result.checks.find(check => check.label === 'Стан батареї').found, true);
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
