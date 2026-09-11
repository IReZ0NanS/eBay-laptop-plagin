/* A single writer prevents parallel auto-refresh tabs overwriting history. */
"use strict";
const HISTORY_KEY = "ebayLaptopHelperHistoryV2";
const DAY = 86400000;
let queue = Promise.resolve();
async function observeBatch(message) {
  const now = Date.now();
  const stored = await chrome.storage.local.get([HISTORY_KEY, "ebayLaptopHelperSeenItems", "ebayLaptopHelperInitialized"]);
  const history = stored[HISTORY_KEY] || { items: {}, scopes: {} };
  const scope = String(message.scope || "default").slice(0, 2000);
  const initialScope = !history.scopes[scope];
  const migrated = !stored[HISTORY_KEY] && stored.ebayLaptopHelperInitialized === true;
  if (!stored[HISTORY_KEY]) {
    for (const [id, value] of Object.entries(stored.ebayLaptopHelperSeenItems || {})) {
      if (/^[0-9]{9,15}$/.test(id)) history.items[id] = { firstSeen: Number(value) || 0, lastSeen: now };
    }
  }
  const result = {};
  for (const input of (message.items || []).slice(0, 600)) {
    const id = String(input.id || "");
    if (!/^[0-9]{9,15}$/.test(id)) continue;
    let record = history.items[id];
    if (!record) record = { firstSeen: initialScope && !migrated ? 0 : now, lastSeen: now };
    const price = Number(input.price);
    if (Number.isFinite(price) && price >= 0) {
      if (Number.isFinite(record.price) && record.price !== price) {
        record.previousPrice = record.price;
        record.changedAt = now;
      }
      record.price = price;
    }
    record.lastSeen = now;
    history.items[id] = record;
    result[id] = { ...record };
  }
  if (Object.keys(result).length) history.scopes[scope] = now;
  // Keep last-seen history for 180 days; bound storage for long-running use.
  history.items = Object.fromEntries(Object.entries(history.items)
    .filter(([, record]) => now - record.lastSeen < 180 * DAY)
    .sort((a, b) => b[1].lastSeen - a[1].lastSeen).slice(0, 50000));
  history.scopes = Object.fromEntries(Object.entries(history.scopes).sort((a,b) => b[1]-a[1]).slice(0, 300));
  await chrome.storage.local.set({ [HISTORY_KEY]: history });
  return { items: result };
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== "EBAY_HELPER_OBSERVE") return;
  if (!sender.tab || !/^https:\/\/(?:[a-z0-9-]+\.)*ebay\.com\//i.test(sender.url || "")) return;
  const job = queue.then(() => observeBatch(message));
  queue = job.catch(() => {});
  job.then(respond, error => respond({ error: String(error.message || error) }));
  return true;
});
