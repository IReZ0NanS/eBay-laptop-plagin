"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
require('../core.js');
require('../inspection.js');
const core = globalThis.EbayLaptopCore;
const inspection = globalThis.EbayLaptopInspection;

test('negation cannot hide another lock; real hazards retain evidence', () => {
  for (const source of ['No BIOS password. MDM locked.', 'No BIOS password, MDM locked.']) {
    const risk = core.assessListingRisk(source);
    assert.equal(risk.level, 'high');
    assert.match(risk.flags.find(f=>f.code==='locks').evidence, /MDM locked/);
  }
  assert.equal(core.assessListingRisk('Does not turn on').level,'high');
  assert.equal(core.assessListingRisk('Battery swollen').level,'high');
  assert.equal(core.assessListingRisk('No broken parts').level,'low');
});
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

function historyHarness(initial={}) {
  let listener;
  const state=structuredClone(initial);
  let now=1000000000;
  const DateMock=class extends Date { static now(){return now;} };
  const chrome={storage:{local:{async get(keys){return Object.fromEntries(keys.filter(k=>k in state).map(k=>[k,structuredClone(state[k])]));},async set(value){Object.assign(state,structuredClone(value));}}},runtime:{onMessage:{addListener(fn){listener=fn;}}}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../background.js'),'utf8'),{chrome,Date:DateMock,Promise,console});
  return {state, advance(ms){now+=ms;}, observe(scope,items){return new Promise(resolve=>listener({type:'EBAY_HELPER_OBSERVE',scope,items},{tab:{id:1},url:'https://www.ebay.com/sch/i.html'},resolve));}};
}
test('15-second refresh keeps baseline old, new lot marked, price changes recorded', async()=>{
  const h=historyHarness();
  const a={id:'123456789012',price:300};
  assert.equal((await h.observe('laptops',[a])).items[a.id].firstSeen,0);
  h.advance(15000);
  const b={id:'123456789013',price:200};
  const next=await h.observe('laptops',[b,a]);
  assert.equal(next.items[a.id].firstSeen,0);
  assert.ok(next.items[b.id].firstSeen>0);
  h.advance(15000);
  const again=await h.observe('laptops',[b,{...a,price:250}]);
  assert.equal(again.items[b.id].firstSeen,next.items[b.id].firstSeen);
  assert.equal(again.items[a.id].previousPrice,300);
  assert.equal(again.items[a.id].price,250);
});
test('concurrent tabs retain both discoveries and scope baselines do not flood NEW',async()=>{
  const h=historyHarness();
  await h.observe('laptops',[{id:'123456789010',price:200}]);
  await Promise.all([h.observe('laptops',[{id:'123456789011',price:210}]),h.observe('laptops',[{id:'123456789012',price:220}])]);
  assert.equal(Object.keys(h.state.ebayLaptopHelperHistoryV2.items).length,3);
  const next=await h.observe('other search',[{id:'123456789013',price:230}]);
  assert.equal(next.items['123456789013'].firstSeen,0);
});
test('old installation history migrates without losing fresh arrivals',async()=>{
  const h=historyHarness({ebayLaptopHelperInitialized:true,ebayLaptopHelperSeenItems:{'123456789012':0}});
  const result=await h.observe('laptops',[{id:'123456789012',price:100},{id:'123456789013',price:200}]);
  assert.equal(result.items['123456789012'].firstSeen,0);
  assert.ok(result.items['123456789013'].firstSeen>0);
});
