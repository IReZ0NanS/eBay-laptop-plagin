(function initEbaySellerDescriptionReader() {
  "use strict";

  if (window.top === window) return;

  const MESSAGE_TYPE = "EBAY_LAPTOP_HELPER_SELLER_DESCRIPTION";
  const MAX_DESCRIPTION_LENGTH = 100000;
  let sendTimer = null;
  let lastSignature = "";
  let active = true;

  function itemIdFromLocation() {
    const queryMatch = location.href.match(/[?&](?:item|itemid|item_id|_itemid)=([0-9]{9,15})(?:[&#]|$)/i);
    if (queryMatch) return queryMatch[1];
    const pathMatch = location.pathname.match(/(?:^|\/)([0-9]{9,15})(?:[/?#]|$)/);
    return pathMatch ? pathMatch[1] : null;
  }

  function descriptionText() {
    const text = String(document.body?.innerText || document.body?.textContent || "")
      .replace(/\r/g, "\n")
      .replace(/[\u00a0\u202f]/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return text.slice(0, MAX_DESCRIPTION_LENGTH);
  }

  function sendDescription(force = false, requestedOrigin = "") {
    if (!active || document.hidden) return;
    const itemId = itemIdFromLocation();
    const text = descriptionText();
    if (!itemId || !text) return;

    const signature = `${itemId}|${text}`;
    if (!force && signature === lastSignature) return;

    let targetOrigin;
    try {
      targetOrigin = requestedOrigin || new URL(document.referrer).origin;
      if (!/^https:\/\/(?:[a-z0-9-]+\.)*ebay\.com$/i.test(targetOrigin)) return;
    } catch { return; }
    window.top.postMessage({
      source: "ebay-laptop-helper",
      type: MESSAGE_TYPE,
      itemId,
      text
    }, targetOrigin);
    lastSignature = signature;
  }

  function scheduleSend(delay = 250) {
    if (!active || document.hidden) return;
    if (sendTimer !== null) return;
    sendTimer = setTimeout(() => { sendTimer = null; sendDescription(); }, delay);
  }

  window.addEventListener("message", event => {
    if (event.source !== window.top || event.data?.type !== "EBAY_HELPER_REQUEST_DESCRIPTION") return;
    if (!/^https:\/\/(?:[a-z0-9-]+\.)*ebay\.com$/i.test(event.origin)) return;
    sendDescription(true, event.origin);
  });

  const observer = new MutationObserver(() => scheduleSend());
  function syncObservation() {
    observer.disconnect?.();
    clearTimeout(sendTimer);
    sendTimer = null;
    if (!active || document.hidden) return;
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    scheduleSend(0);
  }
  const storage = globalThis.chrome?.storage;
  if (storage?.local) {
    active = false;
    storage.local.get(["ebayLaptopHelperSettings"], stored => {
      if (chrome.runtime.lastError) return;
      const settings = stored.ebayLaptopHelperSettings || {};
      active = settings.enabled !== false && settings.showItemPagePanel !== false;
      syncObservation();
    });
    storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes.ebayLaptopHelperSettings) return;
      const settings = changes.ebayLaptopHelperSettings.newValue || {};
      active = settings.enabled !== false && settings.showItemPagePanel !== false;
      syncObservation();
    });
  } else syncObservation();
  document.addEventListener?.("visibilitychange", syncObservation);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => scheduleSend(0), { once: true });
  } else {
    scheduleSend(0);
  }
})();
