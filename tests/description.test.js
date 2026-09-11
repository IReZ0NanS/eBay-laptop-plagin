"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const descriptionSource = fs.readFileSync(path.join(__dirname, "..", "description.js"), "utf8");

test("reads the ebaydesc iframe and posts the seller description to the item page", () => {
  let posted = null;
  const topWindow = {
    postMessage(data, targetOrigin) {
      posted = { data, targetOrigin };
    }
  };
  const frameWindow = { top: topWindow, addEventListener() {} };
  const sandbox = {
    URL,
    window: frameWindow,
    location: {
      href: "https://vi.vipr.ebaydesc.com/ws/eBayISAPI.dll?ViewItemDescV4&item=800390980621",
      pathname: "/ws/eBayISAPI.dll"
    },
    document: {
      referrer: "https://www.ebay.com/itm/800390980621",
      readyState: "complete",
      documentElement: {},
      body: {
        innerText: "Battery report shows 90%.\nOriginal power cord included."
      }
    },
    MutationObserver: class MutationObserver {
      observe() {}
    },
    clearTimeout() {},
    setTimeout(callback) {
      callback();
      return 1;
    }
  };

  vm.runInNewContext(descriptionSource, sandbox);

  assert.equal(posted.data.source, "ebay-laptop-helper");
  assert.equal(posted.data.type, "EBAY_LAPTOP_HELPER_SELLER_DESCRIPTION");
  assert.equal(posted.data.itemId, "800390980621");
  assert.match(posted.data.text, /Battery report shows 90%/);
  assert.equal(posted.targetOrigin, "https://www.ebay.com");
});

test("recovers short descriptions without referrer only for a trusted parent request", () => {
  const posted = [];
  const events = {};
  const parent = { postMessage(data, origin) { posted.push({ data, origin }); } };
  const sandbox = {
    URL,
    window: { top: parent, addEventListener(type, fn) { events[type] = fn; } },
    location: { href: "https://vi.vipr.ebaydesc.com/?item=123456789012", pathname: "/" },
    document: { referrer: "", readyState: "complete", documentElement: {}, body: { innerText: "MDM locked" } },
    MutationObserver: class { observe() {} },
    clearTimeout() {}, setTimeout(callback) { callback(); return 1; }
  };
  vm.runInNewContext(descriptionSource, sandbox);
  assert.equal(posted.length, 0);
  events.message({ source: parent, origin: "https://other.example", data: { type: "EBAY_HELPER_REQUEST_DESCRIPTION" } });
  assert.equal(posted.length, 0);
  events.message({ source: parent, origin: "https://www.ebay.com", data: { type: "EBAY_HELPER_REQUEST_DESCRIPTION" } });
  assert.equal(posted.length, 1);
  assert.equal(posted[0].data.text, "MDM locked");
  assert.equal(posted[0].origin, "https://www.ebay.com");
});
