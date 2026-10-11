(function initEbayLaptopDom(global) {
  "use strict";

  const Core = global.EbayLaptopCore;
  const OWNED_SELECTOR = "[data-ebay-helper-owned='true']";

  function normalizedText(element) {
    return String(element?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function isOwned(element) {
    return Boolean(element?.closest?.(OWNED_SELECTOR));
  }

  function metadataCurrency(element, fallbackScope) {
    const scope = element.closest("[itemscope]") || fallbackScope;
    const currency = scope.querySelector("[itemprop='priceCurrency']");
    return String(currency?.getAttribute("content") || currency?.textContent || "").trim().toUpperCase();
  }

  // Reads a USD price from visible text, aria-label or metadata that declares USD.
  function priceFromElement(element, scope) {
    const visibleText = normalizedText(element);
    const ariaText = String(element.getAttribute("aria-label") || "").trim();
    const contentValue = String(element.getAttribute("content") || "").trim();
    const price = Core.parseUsdPrice(visibleText)
      || Core.parseUsdPrice(ariaText)
      || (contentValue && metadataCurrency(element, scope) === "USD" ? Core.parseUsdPrice(`$${contentValue}`) : null);
    return { price, text: visibleText || ariaText || contentValue };
  }

  function shippingInfo(found) {
    return found
      ? { usd: found.shipping.usd, isFree: found.shipping.isFree, known: true }
      : { usd: 0, isFree: false, known: false };
  }

  function createLink(label, href, className, title) {
    const link = document.createElement("a");
    link.className = className;
    if (href) link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = label;
    if (title) link.title = title;
    link.addEventListener("click", (event) => event.stopPropagation());
    return link;
  }

  global.EbayLaptopDom = Object.freeze({
    OWNED_SELECTOR,
    normalizedText,
    isOwned,
    priceFromElement,
    shippingInfo,
    createLink
  });
})(globalThis);
