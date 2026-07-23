(function initEbaySellerDescriptionReader() {
  "use strict";

  if (window.top === window) return;

  const MESSAGE_TYPE = "EBAY_LAPTOP_HELPER_SELLER_DESCRIPTION";
  const MAX_DESCRIPTION_LENGTH = 100000;
  let sendTimer = null;
  let lastSignature = "";

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

  function sendDescription() {
    const itemId = itemIdFromLocation();
    const text = descriptionText();
    if (!itemId || text.length < 20) return;

    const signature = `${itemId}|${text.length}|${text.slice(0, 160)}|${text.slice(-160)}`;
    if (signature === lastSignature) return;
    lastSignature = signature;

    window.top.postMessage({
      source: "ebay-laptop-helper",
      type: MESSAGE_TYPE,
      itemId,
      text
    }, "*");
  }

  function scheduleSend(delay = 250) {
    clearTimeout(sendTimer);
    sendTimer = setTimeout(sendDescription, delay);
  }

  const observer = new MutationObserver(() => scheduleSend());
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => scheduleSend(0), { once: true });
  } else {
    scheduleSend(0);
  }
})();
