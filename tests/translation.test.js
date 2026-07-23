"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const translationSource = fs.readFileSync(path.join(__dirname, "..", "translation.js"), "utf8");

function loadTranslation(Translator) {
  const sandbox = { console, Translator, globalThis: null };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(translationSource, sandbox);
  return sandbox.EbayLaptopTranslation;
}

test("creates and reuses Chrome's English to Ukrainian translator", async () => {
  const availabilityCalls = [];
  const createCalls = [];
  const downloadProgress = [];
  const fakeTranslator = { translate: async (text) => `uk:${text}` };
  const Translation = loadTranslation({
    async availability(options) {
      availabilityCalls.push(options);
      return "downloadable";
    },
    async create(options) {
      createCalls.push(options);
      options.monitor({
        addEventListener(type, callback) {
          assert.equal(type, "downloadprogress");
          callback({ loaded: 0.4 });
          callback({ loaded: 1 });
        }
      });
      return fakeTranslator;
    }
  });

  const first = await Translation.getEnglishToUkrainianTranslator((loaded) => downloadProgress.push(loaded));
  const second = await Translation.getEnglishToUkrainianTranslator();

  assert.equal(first, fakeTranslator);
  assert.equal(second, fakeTranslator);
  assert.equal(availabilityCalls.length, 1);
  assert.equal(availabilityCalls[0].sourceLanguage, "en");
  assert.equal(availabilityCalls[0].targetLanguage, "uk");
  assert.equal(createCalls.length, 1);
  assert.deepEqual(downloadProgress, [0.4, 1]);
});

test("translates every visible seller-description fact without changing the original", async () => {
  const Translation = loadTranslation({});
  const original = {
    highlights: ["Fully functional", "Fully functional"],
    battery: ["Battery report shows 90%"],
    power: ["Original power cord"],
    included: ["Lenovo Yoga 7 laptop"],
    notIncluded: ["No box or manuals"],
    specs: [
      { label: "Processor", value: "AMD Ryzen 5 7535U" },
      { label: "Storage", value: "512 GB NVMe SSD" }
    ]
  };
  const untouched = JSON.stringify(original);
  const calls = [];
  const progress = [];
  const translator = {
    async translate(text) {
      calls.push(text);
      return `укр: ${text}`;
    }
  };

  const translated = await Translation.translateSellerDescriptionInfo(
    original,
    translator,
    (value) => progress.push(value)
  );

  assert.equal(JSON.stringify(original), untouched);
  assert.equal(translated.highlights[0], "укр: Fully functional");
  assert.equal(translated.battery[0], "укр: Battery report shows 90%");
  assert.equal(translated.power[0], "укр: Original power cord");
  assert.equal(translated.included[0], "укр: Lenovo Yoga 7 laptop");
  assert.equal(translated.notIncluded[0], "укр: No box or manuals");
  assert.equal(translated.specs[0].label, "укр: Processor");
  assert.equal(translated.specs[1].value, "укр: 512 GB NVMe SSD");
  assert.equal(calls.filter((text) => text === "Fully functional").length, 1);
  assert.equal(progress[0].completed, 0);
  assert.equal(progress[0].total, calls.length);
  assert.equal(progress.at(-1).completed, calls.length);
  assert.equal(progress.at(-1).total, calls.length);
});

test("reports a clear error when Chrome has no built-in translator", async () => {
  const Translation = loadTranslation(undefined);
  await assert.rejects(
    Translation.getEnglishToUkrainianTranslator(),
    (error) => error.code === "api-unavailable"
  );
});
