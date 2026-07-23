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
  const frameWindow = { top: topWindow };
  const sandbox = {
    window: frameWindow,
    location: {
      href: "https://vi.vipr.ebaydesc.com/ws/eBayISAPI.dll?ViewItemDescV4&item=800390980621",
      pathname: "/ws/eBayISAPI.dll"
    },
    document: {
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
  assert.equal(posted.targetOrigin, "*");
});
