"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const coreSource = fs.readFileSync(path.join(__dirname, "..", "core.js"), "utf8");
const sandbox = {
  Intl,
  console,
  globalThis: null
};
sandbox.globalThis = sandbox;
vm.runInNewContext(coreSource, sandbox);
const Core = sandbox.EbayLaptopCore;

test("parses standard and localized USD prices", () => {
  assert.equal(Core.parseUsdPrice("US $249.99").minUsd, 249.99);
  assert.equal(Core.parseUsdPrice("$1,299.00").minUsd, 1299);
  assert.equal(Core.parseUsdPrice("$249,99").minUsd, 249.99);
});

test("parses a price range", () => {
  const range = Core.parseUsdPrice("$1,299.00 to $1,499.00");
  assert.equal(range.minUsd, 1299);
  assert.equal(range.maxUsd, 1499);
  assert.equal(range.isRange, true);
});

test("does not convert non-USD currencies", () => {
  assert.equal(Core.parseUsdPrice("C $299.00"), null);
  assert.equal(Core.parseUsdPrice("AU $299.00"), null);
  assert.equal(Core.parseUsdPrice("EUR 299.00"), null);
  assert.equal(Core.parseUsdPrice("£299.00"), null);
});

test("uses the requested default formula", () => {
  assert.equal(Core.calculateTotalUah(300, Core.DEFAULTS), 16560);
  assert.equal(Core.calculateTotalUah(300, Core.DEFAULTS, 20), 17572);
});

test("parses shipping shown on an eBay card", () => {
  assert.equal(Core.parseShippingUsd("+$14.95 shipping").usd, 14.95);
  assert.equal(Core.parseShippingUsd("Shipping: US $24.99").usd, 24.99);
  assert.equal(Core.parseShippingUsd("Free shipping").usd, 0);
  assert.equal(Core.parseShippingUsd("Estimated delivery Tue, Jul 28"), null);
  assert.equal(Core.parseShippingUsd("C $20.00 shipping"), null);
});

test("builds a focused OLX search URL", () => {
  assert.equal(
    Core.buildOlxSearchQuery("New Listing Dell Latitude 5420 i5-1145G7 16GB | Grade B Free Shipping"),
    "Dell Latitude 5420 i5-1145G7"
  );
  assert.match(Core.buildOlxSearchUrl("Dell Latitude 5420"), /^https:\/\/www\.olx\.ua\/uk\/.*q-Dell-Latitude-5420\/$/);
});

test("keeps only the laptop model and processor for OLX", () => {
  assert.equal(
    Core.buildOlxSearchQuery("14 Lenovo Thinkpad T14   Gen 6 Core Ultra 5 225U 32GB 512GB (#300)"),
    "Lenovo Thinkpad T14 Gen 6 Core Ultra 5 225U"
  );
  assert.equal(
    Core.buildOlxSearchQuery('LOT OF 5 Dell Latitude 7420 Laptop 14\" FHD Core i7-1185G7 16GB RAM 512GB NVMe SSD'),
    "Dell Latitude 7420 Core i7-1185G7"
  );
  assert.equal(
    Core.buildOlxSearchQuery("HP EliteBook 840 G8 Notebook PC Intel Core i5 1145G7 16GB 256GB SSD Windows 11 Pro"),
    "HP EliteBook 840 G8 Intel Core i5 1145G7"
  );
});

test("builds a focused sold-listings search with useful configuration", () => {
  const title = "Dell Latitude 5420 i5-1145G7 16GB RAM 512GB NVMe SSD Windows 11 Pro";
  assert.equal(
    Core.buildEbaySoldSearchQuery(title),
    "Dell Latitude 5420 i5-1145G7 16GB 512GB"
  );
  const url = Core.buildEbaySoldSearchUrl(title);
  assert.match(url, /^https:\/\/www\.ebay\.com\/sch\/i\.html\?/);
  assert.match(url, /LH_Sold=1/);
  assert.match(url, /LH_Complete=1/);
});

test("keeps a discrete GPU in the sold-listings search", () => {
  assert.equal(
    Core.buildEbaySoldSearchQuery("Lenovo Legion 5 Ryzen 7 5800H 16GB 1TB RTX 3060"),
    "Lenovo Legion 5 Ryzen 7 5800H 16GB 1TB RTX 3060"
  );
});

test("extracts useful facts from the seller description", () => {
  const description = `
Condition: This unit has very little wear with only very few scratches on it. The unit is fully functional — keyboard, trackpad, touchscreen, hinge, and fingerprint reader all work properly, and the display shows no cracks or dead pixels. Battery is in decent shape — battery report shows 90%. Boots cleanly into a freshly installed Windows 11 Home.

Specifications:
Processor: AMD Ryzen 5 7535U – 6 cores / 12 threads, up to 4.6 GHz Boost, 16 MB total cache (Rembrandt)
Graphics: AMD Radeon 600M series (integrated)
Memory: 8 GB LPDDR5 (Quad-channel)
Storage: 512 GB WD NVMe SSD
Display: 16" touchscreen, 360° convertible hinge
Operating System: Windows 11 Home, build 26200 (clean install, at OOBE)
BIOS: LCCN25WW (04/30/2025)

What's included:
Lenovo Yoga 7 16" laptop
Original power cord

What's not included:
No box, no manuals, no recovery media
`;
  const info = Core.extractSellerDescriptionInfo(description);

  assert.match(info.highlights.join(" "), /fully functional/i);
  assert.match(info.battery.join(" "), /90%/);
  assert.match(info.power.join(" "), /original power cord/i);
  assert.equal(info.included.length, 2);
  assert.match(info.notIncluded.join(" "), /no box/i);
  assert.equal(info.specs.find((spec) => spec.label === "Processor").value.includes("Ryzen 5 7535U"), true);
  assert.equal(info.specs.find((spec) => spec.label === "Storage").value.includes("512 GB"), true);
  assert.equal(info.specs.find((spec) => spec.label === "Operating System").value.includes("Windows 11 Home"), true);


});

test("sanitizes configurable title colors", () => {
  const colors = Core.sanitizeSettings({
    greenTitleColor: "#12AB34",
    yellowTitleColor: "not-a-color",
    redTitleColor: "#abcdef"
  });
  assert.equal(colors.greenTitleColor, "#12ab34");
  assert.equal(colors.yellowTitleColor, Core.DEFAULTS.yellowTitleColor);
  assert.equal(colors.redTitleColor, "#abcdef");
});

test("classifies totals by configurable thresholds", () => {
  assert.equal(Core.classifyTotalUah(15000, Core.DEFAULTS), "green");
  assert.equal(Core.classifyTotalUah(15001, Core.DEFAULTS), "yellow");
  assert.equal(Core.classifyTotalUah(25001, Core.DEFAULTS), "red");
});

test("keeps the helper enabled unless the user turns it off", () => {
  assert.equal(Core.sanitizeSettings({}).enabled, true);
  assert.equal(Core.sanitizeSettings({ enabled: false }).enabled, false);
  assert.equal(Core.sanitizeSettings({}).showSoldSearch, true);
  assert.equal(Core.sanitizeSettings({ showSoldSearch: false }).showSoldSearch, false);
  assert.equal(Core.sanitizeSettings({}).showItemPagePanel, true);
  assert.equal(Core.sanitizeSettings({ showItemPagePanel: false }).showItemPagePanel, false);
});

test("matches comma-separated title keywords", () => {
  assert.equal(Core.matchesKeywords("Lenovo ThinkPad T14", "ThinkPad, EliteBook"), true);
  assert.equal(Core.matchesKeywords("Lenovo ThinkPad T14", "MacBook, EliteBook"), false);
});

test("extracts an item ID from both common eBay URL forms", () => {
  assert.equal(
    Core.extractItemId("https://www.ebay.com/itm/123456789012?hash=abc"),
    "123456789012"
  );
  assert.equal(
    Core.extractItemId("https://www.ebay.com/itm/Lenovo-ThinkPad/123456789012?hash=abc"),
    "123456789012"
  );
  assert.equal(
    Core.extractItemId("https://www.ebay.com/viewitem?itemId=123456789012"),
    "123456789012"
  );
});
