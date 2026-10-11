(function initEbayLaptopCatalog(global) {
  "use strict";

  const Core = global.EbayLaptopCore;
  const Dom = global.EbayLaptopDom;

  const MAX_CARDS = 600;
  const BROWSE_CARD_SELECTOR = "li.brwrvr__item-card, ul.brwrvr__item-results > li, li.s-item";
  const FALLBACK_CARD_SELECTOR = ".s-card, .su-card-container, [data-testid*='item-card'], [class*='item-card'], [class*='ItemCard'], article";
  const CARD_SELECTOR = `${BROWSE_CARD_SELECTOR}, ${FALLBACK_CARD_SELECTOR}`;
  // When a mutation is mapped to its card, specific card containers win over generic ones.
  const SPECIFIC_CARD_SELECTOR = "li.brwrvr__item-card, li.s-item, .s-card, .su-card-container, [data-testid*='item-card']";
  const PRODUCT_LINK_PATTERN = /^https:\/\/(?:[a-z0-9-]+\.)*ebay\.com\/p\/[0-9]+/i;
  // eBay fills result grids with "Shop on eBay" placeholders that are not real listings.
  const PLACEHOLDER_TITLE_PATTERN = /^shop\s+on\s+ebay$/i;

  const TIER_CLASSES = ["ebay-helper-tier-green", "ebay-helper-tier-yellow", "ebay-helper-tier-red"];
  const TITLE_CLASSES = ["ebay-helper-title", "ebay-helper-title-green", "ebay-helper-title-yellow", "ebay-helper-title-red"];
  const PRICE_CLASSES = ["ebay-helper-price", "ebay-helper-price-green", "ebay-helper-price-yellow", "ebay-helper-price-red"];
  const FILTERED_ATTRIBUTE = "data-ebay-helper-filtered";

  const PRICE_SELECTOR = [
    ".s-item__price",
    ".s-card__price",
    ".s-card__price--display",
    ".su-card-container__price",
    ".brwrvr__item-card__price",
    "[data-testid*='price']",
    "[itemprop='price']",
    "[aria-label*='$']",
    "[class*='item-price']",
    "[class*='itemPrice']",
    "[class*='price']",
    "[class*='Price']"
  ].join(",");

  const SHIPPING_SELECTOR = [
    ".s-item__shipping",
    ".s-item__logisticsCost",
    ".s-card__shipping",
    ".s-card__delivery",
    ".brwrvr__item-card__shipping",
    "[data-testid*='shipping']",
    "[data-testid*='delivery']",
    "[class*='shipping']",
    "[class*='Shipping']",
    "[class*='logistics']",
    "[class*='delivery']"
  ].join(",");

  const TITLE_SELECTORS = [
    ".s-item__title",
    ".s-card__title",
    ".s-card__title-primary",
    ".s-card__link",
    ".su-card-container__header",
    ".brwrvr__item-card__title",
    "[data-testid*='title']",
    "[class*='item-title']",
    "[class*='itemTitle']",
    "h3",
    "h2",
    "[role='heading']"
  ];

  const SEARCH_LINKS = [
    {
      attribute: "data-ebay-helper-olx",
      className: "ebay-helper-olx-link",
      label: "OLX",
      enabled: () => true,
      query: Core.buildOlxSearchQuery,
      url: Core.buildOlxSearchUrlFromQuery,
      title: (query) => `Знайти на OLX: ${query}`,
      ariaLabel: (query) => `Знайти на OLX: ${query}`
    },
    {
      attribute: "data-ebay-helper-sold",
      className: "ebay-helper-sold-link",
      label: "SOLD",
      enabled: (settings) => settings.showSoldSearch,
      query: Core.buildEbaySoldSearchQuery,
      url: Core.buildEbaySoldSearchUrlFromQuery,
      title: (query) => `Перевірити завершені продажі eBay: ${query}`,
      ariaLabel: (query) => `Завершені продажі eBay: ${query}`
    }
  ];

  function productCards() {
    const browseCards = Array.from(document.querySelectorAll(BROWSE_CARD_SELECTOR));
    if (browseCards.length) return browseCards.slice(0, MAX_CARDS);

    const fallbackCards = Array.from(document.querySelectorAll(FALLBACK_CARD_SELECTOR));
    const candidates = new Set(fallbackCards);
    return fallbackCards
      .filter(card => {
        for (let parent = card.parentElement; parent; parent = parent.parentElement) if (candidates.has(parent)) return false;
        return true;
      })
      .slice(0, MAX_CARDS);
  }

  function cardForNode(element) {
    return element?.closest?.(SPECIFIC_CARD_SELECTOR) || element?.closest?.(CARD_SELECTOR) || null;
  }

  function containsCard(node) {
    return node.nodeType === Node.ELEMENT_NODE && Boolean(node.matches?.(CARD_SELECTOR) || node.querySelector?.(CARD_SELECTOR));
  }

  function findBestItemLink(card) {
    const links = Array.from(card.querySelectorAll("a[href]")).slice(0, 80);
    let best = null;
    let bestScore = -Infinity;

    for (const link of links) {
      const href = String(link.href || "");
      const text = Dom.normalizedText(link);
      const className = String(link.className || "");
      let score = 0;
      if (Core.extractItemId(href)) score += 150;
      if (/\/(?:itm|p)\//i.test(href)) score += 100;
      if (/s-card__link|s-item__link|title/i.test(className)) score += 60;
      if (text.length >= 4 && text.length <= 350) score += 20;
      if (link.querySelector("h2, h3, [role='heading']")) score += 30;
      if (/help|feedback|seller|shipping/i.test(text)) score -= 80;

      if (score > bestScore) {
        best = link;
        bestScore = score;
      }
    }

    return best;
  }

  function hasItemReference(card, link) {
    return Boolean(Core.extractItemId(link?.href)
      || PRODUCT_LINK_PATTERN.test(link?.href || "")
      || card.dataset.itemId
      || card.dataset.itemid);
  }

  function isPlaceholderCard(card) {
    const heading = card.querySelector(".s-card__title, .bsig__title__text, .s-item__title, h3");
    return PLACEHOLDER_TITLE_PATTERN.test(Core.cleanTitle(Dom.normalizedText(heading)));
  }

  function itemKey(card, link, title, price) {
    const explicitId = Core.extractItemId(link?.href)
      || card.getAttribute("data-itemid")
      || card.getAttribute("data-item-id")
      || card.dataset?.itemId;
    if (explicitId) return String(explicitId);

    const source = `${link?.href || ""}|${title}|${price.sourceText}`;
    return `synthetic-${Core.stableHash(source)}`;
  }

  // Search cards split a range into "$A", " to ", "$B" spans; read them together.
  function expandSplitRange(found) {
    const row = found.element.parentElement;
    const parts = row ? Array.from(row.querySelectorAll(".s-card__price")) : [];
    if (parts.length < 2) return found;
    const price = Core.parseUsdPrice(parts.map(part => part.textContent).join(" "));
    return price ? { element: row, anchor: parts[parts.length - 1], price } : found;
  }

  function findPriceElement(card) {
    const candidates = Array.from(card.querySelectorAll(PRICE_SELECTOR)).slice(0, 50);

    let best = null;
    let bestScore = -Infinity;

    for (const element of candidates) {
      if (Dom.isOwned(element)) continue;
      const { price, text } = Dom.priceFromElement(element, card);
      if (!price || text.length > 140) continue;

      const className = String(element.className || "");
      let score = 0;
      if (/s-item__price|s-card__price|container__price|item-card__price/i.test(className)) score += 100;
      if (/item.?price/i.test(className)) score += 50;
      if (/price/i.test(String(element.getAttribute("data-testid") || ""))) score += 80;
      if (element.getAttribute("itemprop") === "price") score += 80;
      if (element.children.length === 0) score += 10;
      if (/shipping|delivery|save|was|previous|discount|coupon/i.test(text)) score -= 80;
      score -= text.length / 20;

      if (score > bestScore) {
        best = { element, price };
        bestScore = score;
      }
    }

    if (best) return expandSplitRange(best);

    const fallback = Array.from(card.querySelectorAll("span, strong, div")).slice(0, 160);
    for (const element of fallback) {
      if (Dom.isOwned(element) || element.children.length > 2) continue;
      const text = Dom.normalizedText(element);
      if (text.length > 60 || /shipping|delivery/i.test(text)) continue;
      const price = Core.parseUsdPrice(text);
      if (price) return { element, price };
    }

    return null;
  }

  function findShipping(card) {
    const candidates = Array.from(card.querySelectorAll(SHIPPING_SELECTOR)).slice(0, 60);

    let best = null;
    let bestScore = -Infinity;

    for (const element of candidates) {
      if (Dom.isOwned(element)) continue;
      const text = Dom.normalizedText(element);
      if (!text || text.length > 180) continue;
      const shipping = Core.parseShippingUsd(text);
      if (!shipping) continue;

      const className = String(element.className || "");
      let score = 0;
      if (/s-item__shipping|s-item__logisticsCost|s-card__shipping|item-card__shipping/i.test(className)) score += 120;
      if (/shipping|logistics/i.test(className)) score += 70;
      if (/shipping/i.test(String(element.getAttribute("data-testid") || ""))) score += 90;
      if (element.children.length === 0) score += 15;
      score -= text.length / 20;

      if (score > bestScore) {
        best = { element, shipping };
        bestScore = score;
      }
    }

    if (best) return best;

    const fallback = Array.from(card.querySelectorAll("span, small, div")).slice(0, 220);
    for (const element of fallback) {
      if (Dom.isOwned(element) || element.children.length > 2) continue;
      const text = Dom.normalizedText(element);
      if (text.length > 100) continue;
      const shipping = Core.parseShippingUsd(text);
      if (shipping) return { element, shipping };
    }

    return null;
  }

  function findTitle(card, link) {
    for (const selector of TITLE_SELECTORS) {
      for (const element of card.querySelectorAll(selector)) {
        const text = Core.cleanTitle(Dom.normalizedText(element));
        if (text.length >= 4 && !PLACEHOLDER_TITLE_PATTERN.test(text)) return { element, text };
      }
    }

    const linkText = Core.cleanTitle(Dom.normalizedText(link));
    const accessibleName = String(link?.getAttribute("aria-label") || "").trim();
    const imageAlt = String(link?.querySelector("img")?.alt || "").trim();
    return {
      element: link || card,
      text: linkText || accessibleName || imageAlt || "Ноутбук eBay"
    };
  }

  function collectResults(cards = productCards()) {
    const results = [];
    for (const card of cards) {
      const link = findBestItemLink(card);
      if (!hasItemReference(card, link) || isPlaceholderCard(card)) { clearCard(card); continue; }
      const priceResult = findPriceElement(card);
      if (!priceResult) { clearCard(card); continue; }
      const titleResult = findTitle(card, link);
      results.push({
        card,
        itemId: itemKey(card, link, titleResult.text, priceResult.price),
        title: titleResult.text,
        titleElement: titleResult.element,
        price: priceResult.price,
        priceElement: priceResult.element,
        priceAnchor: priceResult.anchor || priceResult.element,
        shipping: Dom.shippingInfo(findShipping(card))
      });
    }
    return { cardCount: cards.length, results };
  }

  function ownedElement(card, attribute, itemId) {
    return Array.from(card.querySelectorAll(`[${attribute}]`)).find((element) => element.dataset.itemId === itemId) || null;
  }

  function markOwned(element, attribute, itemId) {
    element.setAttribute(attribute, "true");
    element.dataset.ebayHelperOwned = "true";
    element.dataset.itemId = itemId;
    return element;
  }

  function removeStaleOwnedElements(card, itemId) {
    card.querySelectorAll(`${Dom.OWNED_SELECTOR}[data-item-id]`).forEach((element) => {
      if (element.dataset.itemId !== itemId) element.remove();
    });
  }

  function upsertConvertedPrice(card, previous, result, settings) {
    const { itemId, price, shipping } = result;
    let converted = ownedElement(card, "data-ebay-helper-converted", itemId);
    if (!settings.showConvertedPrice) {
      converted?.remove();
      return null;
    }

    if (!converted) {
      converted = markOwned(document.createElement("span"), "data-ebay-helper-converted", itemId);
      converted.className = "ebay-helper-converted-price";
      previous.insertAdjacentElement("afterend", converted);
    }
    converted.textContent = `(${Core.formatConvertedPrice(price, settings, shipping.usd)})`;
    converted.title = `${Core.formulaTitle(settings)}; ${Core.shippingLabel(shipping, "доставку на сторінці не знайдено, використано $0")}`;
    return converted;
  }

  function upsertSearchLink(card, previous, spec, result, settings) {
    let link = ownedElement(card, spec.attribute, result.itemId);
    if (!spec.enabled(settings)) {
      link?.remove();
      return null;
    }

    if (!link) {
      link = markOwned(Dom.createLink(spec.label, "", spec.className, ""), spec.attribute, result.itemId);
      previous.insertAdjacentElement("afterend", link);
    }
    const query = spec.query(result.title);
    link.href = spec.url(query);
    link.title = spec.title(query);
    link.setAttribute("aria-label", spec.ariaLabel(query));
    return link;
  }

  function decorationsComplete(card, itemId, settings) {
    return (!settings.showConvertedPrice || ownedElement(card, "data-ebay-helper-converted", itemId))
      && SEARCH_LINKS.every(spec => !spec.enabled(settings) || ownedElement(card, spec.attribute, itemId));
  }

  function styleCard(result, settings, settingsRevision, allowFiltering) {
    const { card, itemId, title, titleElement, price, priceElement, shipping } = result;
    const { tier, preferred, excluded } = Core.evaluateListing(title, price, shipping, settings);
    const filtered = allowFiltering && ((settings.hideRed && tier === "red") || (settings.hideExcluded && excluded));
    const signature = JSON.stringify({
      itemId,
      title,
      min: price.minUsd,
      max: price.maxUsd,
      shipping,
      tier,
      preferred,
      excluded,
      filtered,
      settingsRevision
    });

    if (card.dataset.ebayHelperSignature === signature
      && priceElement.classList.contains("ebay-helper-price")
      && titleElement.classList.contains("ebay-helper-title")
      && decorationsComplete(card, itemId, settings)) return;

    removeStaleOwnedElements(card, itemId);
    card.dataset.ebayHelperSignature = signature;
    card.dataset.ebayHelperItemId = itemId;
    card.style.setProperty("--ebay-helper-title-color", settings[`${tier}TitleColor`]);
    card.classList.remove(...TIER_CLASSES, "ebay-helper-preferred", "ebay-helper-excluded");
    card.classList.add("ebay-helper-card", `ebay-helper-tier-${tier}`);
    card.classList.toggle("ebay-helper-preferred", preferred);
    card.classList.toggle("ebay-helper-excluded", excluded);
    card.toggleAttribute(FILTERED_ATTRIBUTE, filtered);

    titleElement.classList.remove(...TITLE_CLASSES);
    priceElement.classList.remove(...PRICE_CLASSES);
    titleElement.classList.add("ebay-helper-title", `ebay-helper-title-${tier}`);
    priceElement.classList.add("ebay-helper-price", `ebay-helper-price-${tier}`);

    let previous = upsertConvertedPrice(card, result.priceAnchor, result, settings) || result.priceAnchor;
    for (const spec of SEARCH_LINKS) previous = upsertSearchLink(card, previous, spec, result, settings) || previous;
  }

  function clearCard(card) {
    card.classList.remove("ebay-helper-card", ...TIER_CLASSES, "ebay-helper-preferred", "ebay-helper-excluded");
    card.removeAttribute(FILTERED_ATTRIBUTE);
    delete card.dataset.ebayHelperSignature;
    delete card.dataset.ebayHelperItemId;
    card.style.removeProperty("--ebay-helper-title-color");
    card.querySelectorAll(".ebay-helper-title").forEach(element => element.classList.remove(...TITLE_CLASSES));
    card.querySelectorAll(".ebay-helper-price").forEach(element => element.classList.remove(...PRICE_CLASSES));
    card.querySelectorAll(Dom.OWNED_SELECTOR).forEach(element => element.remove());
  }

  function clearAll() {
    document.querySelectorAll(".ebay-helper-card").forEach(clearCard);
  }

  function filteredCount() {
    return document.querySelectorAll(`[${FILTERED_ATTRIBUTE}]`).length;
  }

  global.EbayLaptopCatalog = Object.freeze({
    CARD_SELECTOR,
    productCards,
    cardForNode,
    containsCard,
    collectResults,
    styleCard,
    clearAll,
    filteredCount
  });
})(globalThis);
