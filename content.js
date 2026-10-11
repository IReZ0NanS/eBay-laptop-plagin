(function initEbayLaptopHelper() {
  "use strict";

  const Core = globalThis.EbayLaptopCore;
  const Dom = globalThis.EbayLaptopDom;
  const Catalog = globalThis.EbayLaptopCatalog;
  const ItemPanel = globalThis.EbayLaptopItemPanel;
  if (!Core || !Dom || !Catalog || !ItemPanel || globalThis.__ebayLaptopHelperLoaded) return;
  globalThis.__ebayLaptopHelperLoaded = true;

  const STATUS_ID = "ebay-laptop-helper-status";
  const FILTER_BADGE_ID = "ebay-laptop-helper-filter";
  const REVEAL_CLASS = "ebay-helper-reveal-filtered";
  const ITEM_PAGE_REGIONS = "#mainContent, main, .x-item-description, #viTabs_0_is, .x-about-this-item, iframe";

  let settings = Core.sanitizeSettings(Core.DEFAULTS);
  let ready = false;
  let scanTimer = null;
  let scanInProgress = false;
  const dirtyCards = new Set();
  let fullScanNeeded = true;
  let lastPageUrl = location.href;
  let lastCardCount = 0;
  let lastResultCount = 0;
  let settingsRevision = 0;
  let retryTimers = [];
  // Hidden cards can be shown again until the page is reloaded; this is not saved.
  let revealFiltered = false;

  const itemPanel = ItemPanel.create({
    getSettings: () => settings,
    requestScan: (delay) => scheduleScan(delay)
  });

  function supportedPage() {
    return /^\/(?:itm\/|sch\/|b\/|viewitem(?:\/|$))/i.test(location.pathname);
  }

  function updateStatus(cardCount, resultCount, itemPageState = null) {
    let status = document.getElementById(STATUS_ID);

    if (resultCount > 0 || itemPageState === "ready" || itemPageState === "disabled") {
      status?.remove();
      return;
    }

    if (!status) {
      status = document.createElement("div");
      status.id = STATUS_ID;
      status.dataset.ebayHelperOwned = "true";
      status.setAttribute("role", "status");
      document.body.append(status);
    }

    const state = itemPageState === "loading" || cardCount > 0 ? "warning" : "waiting";
    const text = itemPageState === "loading"
      ? "eBay Helper: очікую ціну та дані товару"
      : cardCount > 0
        ? `eBay Helper: знайдено ${cardCount} карток, ціни ще завантажуються`
        : "eBay Helper: очікую товари";

    if (status.dataset.state !== state) status.dataset.state = state;
    if (status.textContent !== text) status.textContent = text;
  }

  function updateFilterBadge() {
    const count = Catalog.filteredCount();
    let badge = document.getElementById(FILTER_BADGE_ID);
    if (!count) {
      badge?.remove();
      return;
    }

    if (!badge) {
      badge = document.createElement("button");
      badge.type = "button";
      badge.id = FILTER_BADGE_ID;
      badge.dataset.ebayHelperOwned = "true";
      badge.addEventListener("click", (event) => {
        event.stopPropagation();
        revealFiltered = !revealFiltered;
        updateFilterBadge();
      });
      document.body.append(badge);
    }

    document.documentElement.classList.toggle(REVEAL_CLASS, revealFiltered);
    const text = revealFiltered ? `Показано приховані: ${count} · сховати` : `Приховано ${count} · показати`;
    if (badge.textContent !== text) badge.textContent = text;
    badge.setAttribute("aria-pressed", String(revealFiltered));
    badge.title = "Картки, приховані за налаштуваннями eBay Laptop Helper";
  }

  function clearDecorations() {
    Catalog.clearAll();
    itemPanel.clear();
    document.getElementById(STATUS_ID)?.remove();
    document.getElementById(FILTER_BADGE_ID)?.remove();
  }

  function scan() {
    if (!ready || scanInProgress || document.hidden) return;
    if (location.href !== lastPageUrl) {
      lastPageUrl = location.href;
      fullScanNeeded = true;
      clearDecorations();
    }
    scanInProgress = true;

    try {
      if (!settings.enabled || !supportedPage()) {
        clearDecorations();
        return;
      }

      const itemPageId = ItemPanel.currentItemPageId();
      const itemPageState = itemPageId ? itemPanel.render(itemPageId) : null;
      if (!itemPageId) itemPanel.clear();

      const cards = fullScanNeeded ? Catalog.productCards() : Array.from(dirtyCards).filter(card => card.isConnected);
      const collected = Catalog.collectResults(cards);
      if (fullScanNeeded) {
        lastCardCount = collected.cardCount;
        lastResultCount = collected.results.length;
      }
      fullScanNeeded = false;
      dirtyCards.clear();
      updateStatus(lastCardCount, lastResultCount, itemPageState);
      // Similar-item carousels on a product page are coloured but never hidden.
      for (const result of collected.results) Catalog.styleCard(result, settings, settingsRevision, !itemPageId);
      updateFilterBadge();
    } finally {
      // Every mutation queued during the scan is our own work and must not trigger another scan.
      observer.takeRecords();
      scanInProgress = false;
    }
  }

  function scheduleScan(delay = 250) {
    if (!ready || !settings.enabled || document.hidden || !supportedPage()) return;
    if (scanTimer !== null && delay !== 0) return;
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => { scanTimer = null; scan(); }, delay);
  }

  function isOwnedNode(node) {
    return node.nodeType === Node.ELEMENT_NODE && Boolean(node.matches?.(Dom.OWNED_SELECTOR));
  }

  function containsItemPageRegion(node) {
    return node.nodeType === Node.ELEMENT_NODE
      && Boolean(node.matches?.(ITEM_PAGE_REGIONS) || node.querySelector?.(ITEM_PAGE_REGIONS));
  }

  const observer = new MutationObserver((mutations) => {
    if (!settings.enabled || document.hidden || !supportedPage()) return;
    const onItemPage = Boolean(ItemPanel.currentItemPageId());
    let relevant = false;
    for (const mutation of mutations) {
      // Lazy images swap src while scrolling; only description iframes matter.
      if (mutation.type === "attributes" && mutation.attributeName === "src" && mutation.target.tagName !== "IFRAME") continue;
      const target = mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target.parentElement;
      if (Dom.isOwned(target)) continue;
      const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
      // Removed helper elements are restored, so only pure additions of our own nodes are skipped.
      if (nodes.length && !mutation.removedNodes.length && nodes.every(isOwnedNode)) continue;
      const card = Catalog.cardForNode(target);
      if (card) { dirtyCards.add(card); relevant = true; continue; }
      if (onItemPage && target?.closest?.(ITEM_PAGE_REGIONS)) relevant = true;
      if (nodes.some(node => Catalog.containsCard(node) || containsItemPageRegion(node))) {
        fullScanNeeded = true;
        relevant = true;
      }
    }
    if (relevant) scheduleScan();
  });

  function syncObservation() {
    observer.disconnect();
    clearTimeout(scanTimer);
    scanTimer = null;
    retryTimers.forEach(clearTimeout);
    retryTimers = [];
    dirtyCards.clear();
    if (!settings.enabled || document.hidden || !supportedPage()) return;
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["content", "aria-label", "href", "src"] });
    fullScanNeeded = true;
    scheduleScan(0);
    if (ItemPanel.currentItemPageId() && settings.showItemPagePanel) {
      retryTimers = [2200, 5000].map(delay => setTimeout(() => scheduleScan(0), delay));
    }
  }

  document.addEventListener("visibilitychange", syncObservation);
  window.addEventListener("popstate", syncObservation);
  window.addEventListener("pageshow", syncObservation);

  chrome.storage.local.get([Core.SETTINGS_KEY], (stored) => {
    settings = Core.sanitizeSettings(stored[Core.SETTINGS_KEY]);
    ready = true;
    syncObservation();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[Core.SETTINGS_KEY]) return;
    settings = Core.sanitizeSettings(changes[Core.SETTINGS_KEY].newValue);
    // The revision is part of every card signature, so all cards are restyled.
    settingsRevision++;
    if (!settings.enabled) clearDecorations();
    syncObservation();
  });
})();
