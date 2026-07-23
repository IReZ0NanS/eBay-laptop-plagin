(function initEbayLaptopHelper() {
  "use strict";

  const Core = globalThis.EbayLaptopCore;
  const Translation = globalThis.EbayLaptopTranslation;
  if (!Core || !Translation || globalThis.__ebayLaptopHelperLoaded) return;
  globalThis.__ebayLaptopHelperLoaded = true;

  const SETTINGS_KEY = "ebayLaptopHelperSettings";
  const SEEN_KEY = "ebayLaptopHelperSeenItems";
  const INITIALIZED_KEY = "ebayLaptopHelperInitialized";
  const NEW_ITEM_TTL_MS = 24 * 60 * 60 * 1000;
  const SEEN_ITEM_TTL_MS = 60 * 24 * 60 * 60 * 1000;
  const MAX_SEEN_ITEMS = 2500;
  const DESCRIPTION_MESSAGE_TYPE = "EBAY_LAPTOP_HELPER_SELLER_DESCRIPTION";
  const MAX_DESCRIPTION_LENGTH = 100000;

  let settings = Core.sanitizeSettings(Core.DEFAULTS);
  let seenItems = {};
  const sellerDescriptions = new Map();
  const sellerDescriptionTranslations = new Map();
  const sellerDescriptionTranslationModes = new Map();
  const sellerDescriptionTranslationJobs = new Map();
  let initialized = false;
  let ready = false;
  let scanTimer = null;
  let persistTimer = null;
  let scanInProgress = false;

  function normalizedText(element) {
    return String(element?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function productCards() {
    const browseCards = Array.from(document.querySelectorAll([
      "li.brwrvr__item-card",
      "ul.brwrvr__item-results > li",
      "li.s-item"
    ].join(",")));

    if (browseCards.length) return browseCards.slice(0, 600);

    const fallbackCards = Array.from(document.querySelectorAll([
      ".s-card",
      ".su-card-container",
      "[data-testid*='item-card']",
      "[class*='item-card']",
      "[class*='ItemCard']",
      "article"
    ].join(",")));

    return fallbackCards
      .filter((card, index, all) => !all.some((other, otherIndex) => otherIndex < index && other.contains(card)))
      .slice(0, 600);
  }

  function findBestItemLink(card) {
    const links = Array.from(card.querySelectorAll("a[href]")).slice(0, 80);
    let best = null;
    let bestScore = -Infinity;

    for (const link of links) {
      const href = String(link.href || "");
      const text = normalizedText(link);
      const className = String(link.className || "");
      let score = 0;
      if (Core.extractItemId(href)) score += 150;
      if (/\/itm\//i.test(href)) score += 100;
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

  function stableHash(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function itemKey(card, link, title, price) {
    const explicitId = Core.extractItemId(link?.href)
      || card.getAttribute("data-itemid")
      || card.getAttribute("data-item-id")
      || card.dataset?.itemId;
    if (explicitId) return String(explicitId);

    const source = `${link?.href || ""}|${title}|${price.sourceText}`;
    return `synthetic-${stableHash(source)}`;
  }

  function findPriceElement(card) {
    const primarySelectors = [
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
    ];
    const candidates = Array.from(card.querySelectorAll(primarySelectors.join(","))).slice(0, 50);

    let best = null;
    let bestScore = -Infinity;

    for (const element of candidates) {
      if (element.closest("[data-ebay-helper-owned]")) continue;
      const visibleText = normalizedText(element);
      const ariaText = String(element.getAttribute("aria-label") || "");
      const contentValue = String(element.getAttribute("content") || "");
      const text = visibleText || ariaText || contentValue;
      const price = Core.parseUsdPrice(visibleText)
        || Core.parseUsdPrice(ariaText)
        || Core.parseUsdPrice(contentValue ? `$${contentValue}` : "");
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

    if (best) return best;

    const fallback = Array.from(card.querySelectorAll("span, strong, div")).slice(0, 160);
    for (const element of fallback) {
      if (element.closest("[data-ebay-helper-owned]") || element.children.length > 2) continue;
      const text = normalizedText(element);
      if (text.length > 60 || /shipping|delivery/i.test(text)) continue;
      const price = Core.parseUsdPrice(text);
      if (price) return { element, price };
    }

    return null;
  }

  function findShipping(card) {
    const selectors = [
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
    ];
    const candidates = Array.from(card.querySelectorAll(selectors.join(","))).slice(0, 60);

    let best = null;
    let bestScore = -Infinity;

    for (const element of candidates) {
      if (element.closest("[data-ebay-helper-owned]")) continue;
      const text = normalizedText(element);
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
      if (element.closest("[data-ebay-helper-owned]") || element.children.length > 2) continue;
      const text = normalizedText(element);
      if (text.length > 100) continue;
      const shipping = Core.parseShippingUsd(text);
      if (shipping) return { element, shipping };
    }

    return null;
  }

  function findTitle(card, link) {
    const selectors = [
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

    for (const selector of selectors) {
      const candidates = card.querySelectorAll(selector);
      for (const element of candidates) {
        const text = normalizedText(element).replace(/^New Listing\s*/i, "").trim();
        if (text.length >= 4 && !/^shop on ebay$/i.test(text)) return { element, text };
      }
    }

    const linkText = normalizedText(link).replace(/^New Listing\s*/i, "").trim();
    const accessibleName = String(link?.getAttribute("aria-label") || "").trim();
    const imageAlt = String(link?.querySelector("img")?.alt || "").trim();
    return {
      element: link || card,
      text: linkText || accessibleName || imageAlt || "Ноутбук eBay"
    };
  }

  function currentItemPageId() {
    const looksLikeItemPage = /\/itm\//i.test(location.pathname)
      || /[?&](?:item|itemid|item_id|_itemid)=/i.test(location.search);
    return looksLikeItemPage ? Core.extractItemId(location.href) : null;
  }

  function findItemPageTitle() {
    const selectors = [
      "[data-testid='x-item-title'] h1",
      "h1.x-item-title__mainTitle",
      ".x-item-title__mainTitle",
      "h1[itemprop='name']",
      "#mainContent h1",
      "main h1"
    ];

    for (const selector of selectors) {
      const candidates = Array.from(document.querySelectorAll(selector)).slice(0, 8);
      for (const element of candidates) {
        if (element.closest("[data-ebay-helper-owned]")) continue;
        const text = normalizedText(element)
          .replace(/^Details\s+about\s+/i, "")
          .replace(/^New\s+Listing\s*/i, "")
          .trim();
        if (text.length >= 4 && text.length <= 500 && !/^shop\s+on\s+ebay$/i.test(text)) {
          return { element, text };
        }
      }
    }

    return null;
  }

  function findItemPagePrice() {
    const selectors = [
      ".x-price-primary span.ux-textspans",
      ".x-price-primary",
      "[data-testid='x-price-primary']",
      "[data-testid*='price-primary']",
      "[data-testid='x-bin-price']",
      ".x-bin-price__display-price",
      ".x-price-section [itemprop='price']",
      "#mainContent [itemprop='price']",
      "main [itemprop='price']"
    ];

    for (const selector of selectors) {
      const candidates = Array.from(document.querySelectorAll(selector)).slice(0, 12);
      for (const element of candidates) {
        if (element.closest("[data-ebay-helper-owned]")) continue;
        const visibleText = normalizedText(element);
        const ariaText = String(element.getAttribute("aria-label") || "").trim();
        const contentValue = String(element.getAttribute("content") || "").trim();
        const price = Core.parseUsdPrice(visibleText)
          || Core.parseUsdPrice(ariaText)
          || Core.parseUsdPrice(contentValue ? `$${contentValue}` : "");
        if (price) return { element, price };
      }
    }

    return null;
  }

  function findItemPageShipping() {
    const selectors = [
      ".ux-labels-values--shipping",
      ".ux-labels-values--delivery",
      ".x-shipping-minview",
      ".ux-layout-section__item--shipping",
      "[data-testid*='shipping']",
      "[data-testid*='delivery']",
      "#mainContent [class*='shipping']",
      "#mainContent [class*='Shipping']"
    ];

    for (const selector of selectors) {
      const candidates = Array.from(document.querySelectorAll(selector)).slice(0, 30);
      for (const element of candidates) {
        if (element.closest("[data-ebay-helper-owned]")) continue;
        const text = normalizedText(element);
        if (!text || text.length > 500) continue;
        const shipping = Core.parseShippingUsd(text);
        if (shipping) return { element, shipping };
      }
    }

    return null;
  }

  function normalizeSellerDescription(text) {
    return String(text || "")
      .replace(/\r/g, "\n")
      .replace(/[\u00a0\u202f]/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/^\s*Item description from the seller\s*/i, "")
      .trim()
      .slice(0, MAX_DESCRIPTION_LENGTH);
  }

  function findInlineSellerDescription() {
    const selectors = [
      "[data-testid='x-item-description']",
      "[data-testid*='item-description']",
      ".x-item-description",
      ".d-item-description",
      "#desc_div"
    ];
    let best = "";

    for (const selector of selectors) {
      const candidates = Array.from(document.querySelectorAll(selector)).slice(0, 12);
      for (const element of candidates) {
        if (element.closest("[data-ebay-helper-owned]")) continue;
        const text = normalizeSellerDescription(element.innerText || element.textContent || "");
        if (text.length > best.length) best = text;
      }
    }

    return best.length >= 20 ? best : "";
  }

  function sellerDescriptionForItem(itemId) {
    const cached = sellerDescriptions.get(itemId);
    const inline = findInlineSellerDescription();
    if (inline && (!cached || inline.length > cached.length)) {
      rememberSellerDescription(itemId, inline);
      return inline;
    }
    return cached || inline;
  }

  function descriptionSignature(text) {
    const value = String(text || "");
    return `${value.length}|${value.slice(0, 180)}|${value.slice(-180)}`;
  }

  function rememberSellerDescription(itemId, text) {
    const previous = sellerDescriptions.get(itemId);
    sellerDescriptions.set(itemId, text);
    if (previous === text) return;
    sellerDescriptionTranslations.delete(itemId);
    sellerDescriptionTranslationModes.delete(itemId);
    sellerDescriptionTranslationJobs.delete(itemId);
  }

  function isTrustedDescriptionOrigin(origin) {
    try {
      const hostname = new URL(origin).hostname.toLocaleLowerCase();
      return hostname === "ebaydesc.com" || hostname.endsWith(".ebaydesc.com");
    } catch {
      return false;
    }
  }

  function receiveSellerDescription(event) {
    const data = event.data;
    if (!isTrustedDescriptionOrigin(event.origin)) return;
    if (!data || data.source !== "ebay-laptop-helper" || data.type !== DESCRIPTION_MESSAGE_TYPE) return;

    const itemId = String(data.itemId || "");
    if (!/^[0-9]{9,15}$/.test(itemId) || itemId !== currentItemPageId()) return;
    const text = normalizeSellerDescription(data.text);
    if (text.length < 20 || sellerDescriptions.get(itemId) === text) return;

    rememberSellerDescription(itemId, text);
    while (sellerDescriptions.size > 25) sellerDescriptions.delete(sellerDescriptions.keys().next().value);
    scheduleScan(0);
  }

  window.addEventListener("message", receiveSellerDescription);

  function collectItemPageResult(itemId) {
    if (!itemId) return null;
    const titleResult = findItemPageTitle();
    const priceResult = findItemPagePrice();
    if (!titleResult || !priceResult) return null;

    const shippingResult = findItemPageShipping();
    const sellerDescription = sellerDescriptionForItem(itemId);
    const descriptionInfo = Core.extractSellerDescriptionInfo(sellerDescription);
    const shipping = shippingResult
      ? { usd: shippingResult.shipping.usd, isFree: shippingResult.shipping.isFree, known: true }
      : { usd: 0, isFree: false, known: false };

    return {
      itemId,
      title: titleResult.text,
      titleElement: titleResult.element,
      price: priceResult.price,
      priceElement: priceResult.element,
      shipping,
      sellerDescription,
      descriptionInfo,
      risk: Core.assessListingRisk([
        titleResult.text,
        sellerDescription,
        ...descriptionInfo.notIncluded.map((item) => `No ${item}`)
      ].join("\n"))
    };
  }

  function ownedElement(card, attribute, itemId) {
    return Array.from(card.querySelectorAll(`[${attribute}]`)).find((element) => element.dataset.itemId === itemId) || null;
  }

  function removeOwnedElement(card, attribute, itemId) {
    ownedElement(card, attribute, itemId)?.remove();
  }

  function removeStaleOwnedElements(card, itemId) {
    card.querySelectorAll("[data-ebay-helper-owned='true'][data-item-id]").forEach((element) => {
      if (element.dataset.itemId !== itemId) element.remove();
    });
  }

  function formatUsd(value) {
    return new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
  }

  function formatItemPageUsdPrice(price) {
    const min = `$${formatUsd(price.minUsd)}`;
    const max = `$${formatUsd(price.maxUsd)}`;
    return price.isRange ? `${min} – ${max}` : max;
  }

  function itemPageTierLabel(tier) {
    if (tier === "green") return "ЗЕЛЕНА ЗОНА";
    if (tier === "yellow") return "ЖОВТА ЗОНА";
    return "ЧЕРВОНА ЗОНА";
  }

  function appendItemPageRow(container, label, value) {
    const row = document.createElement("div");
    row.className = "ebay-helper-item-row";
    const labelElement = document.createElement("span");
    labelElement.className = "ebay-helper-item-row-label";
    labelElement.textContent = label;
    const valueElement = document.createElement("span");
    valueElement.className = "ebay-helper-item-row-value";
    valueElement.textContent = value;
    row.append(labelElement, valueElement);
    container.append(row);
  }

  function itemPageAction(label, href, className, title) {
    const link = document.createElement("a");
    link.className = className;
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = label;
    link.title = title;
    link.addEventListener("click", (event) => event.stopPropagation());
    return link;
  }

  function clearItemPagePanel() {
    document.getElementById("ebay-laptop-helper-item-panel")?.remove();
  }

  function sellerSpecLabel(label) {
    const key = String(label || "").trim().toLocaleLowerCase();
    const labels = {
      processor: "Процесор",
      cpu: "Процесор",
      graphics: "Графіка",
      gpu: "Графіка",
      memory: "Пам'ять",
      ram: "Пам'ять",
      storage: "Накопичувач",
      display: "Дисплей",
      screen: "Дисплей",
      audio: "Аудіо",
      "operating system": "ОС",
      os: "ОС",
      bios: "BIOS"
    };
    return labels[key] || String(label || "Характеристика").slice(0, 45);
  }

  function usefulDescriptionInfoCount(info) {
    return info.highlights.length
      + info.battery.length
      + info.power.length
      + info.included.length
      + info.notIncluded.length
      + info.specs.length;
  }

  function sellerDescriptionTranslationView(result) {
    const sourceSignature = descriptionSignature(result.sellerDescription);
    const cached = sellerDescriptionTranslations.get(result.itemId);
    const validCache = cached?.sourceSignature === sourceSignature ? cached : null;
    const job = sellerDescriptionTranslationJobs.get(result.itemId);
    const validJob = job?.sourceSignature === sourceSignature ? job : null;
    const translated = sellerDescriptionTranslationModes.get(result.itemId) === "translated" && Boolean(validCache);
    return {
      info: translated ? validCache.info : result.descriptionInfo,
      translated,
      job: validJob
    };
  }

  function setSellerDescriptionTranslationJob(itemId, sourceSignature, state, message) {
    sellerDescriptionTranslationJobs.set(itemId, { sourceSignature, state, message });
    scheduleScan(0);
  }

  function translationErrorMessage(error) {
    if (error?.code === "api-unavailable") {
      return "Переклад недоступний у цій версії Chrome. Оновіть Chrome до версії 138 або новішої.";
    }
    if (error?.code === "language-pair-unavailable") {
      return "Вбудований переклад з англійської на українську недоступний на цьому комп'ютері.";
    }
    return "Не вдалося перекласти опис. Оригінал залишився без змін — спробуйте ще раз.";
  }

  async function toggleSellerDescriptionTranslation(result) {
    const itemId = result.itemId;
    const sourceSignature = descriptionSignature(result.sellerDescription);
    const cached = sellerDescriptionTranslations.get(itemId);
    const validCache = cached?.sourceSignature === sourceSignature ? cached : null;

    if (sellerDescriptionTranslationModes.get(itemId) === "translated" && validCache) {
      sellerDescriptionTranslationModes.set(itemId, "original");
      sellerDescriptionTranslationJobs.delete(itemId);
      scheduleScan(0);
      return;
    }

    if (validCache) {
      sellerDescriptionTranslationModes.set(itemId, "translated");
      sellerDescriptionTranslationJobs.delete(itemId);
      scheduleScan(0);
      return;
    }

    setSellerDescriptionTranslationJob(itemId, sourceSignature, "loading", "Готую перекладач…");
    try {
      const translator = await Translation.getEnglishToUkrainianTranslator((loaded) => {
        const percent = Math.max(0, Math.min(100, Math.round(loaded * 100)));
        setSellerDescriptionTranslationJob(itemId, sourceSignature, "loading", `Завантаження ${percent}%`);
      });
      const translatedInfo = await Translation.translateSellerDescriptionInfo(
        result.descriptionInfo,
        translator,
        ({ completed, total }) => {
          const message = total ? `Перекладаю ${completed}/${total}` : "Перекладаю…";
          setSellerDescriptionTranslationJob(itemId, sourceSignature, "loading", message);
        }
      );

      const currentSignature = descriptionSignature(sellerDescriptions.get(itemId));
      if (itemId !== currentItemPageId() || currentSignature !== sourceSignature) return;
      sellerDescriptionTranslations.set(itemId, { sourceSignature, info: translatedInfo });
      sellerDescriptionTranslationModes.set(itemId, "translated");
      sellerDescriptionTranslationJobs.delete(itemId);
    } catch (error) {
      console.warn("eBay Laptop Helper translation failed", error);
      const currentSignature = descriptionSignature(sellerDescriptions.get(itemId));
      if (itemId !== currentItemPageId() || currentSignature !== sourceSignature) return;
      sellerDescriptionTranslationModes.set(itemId, "original");
      setSellerDescriptionTranslationJob(
        itemId,
        sourceSignature,
        "error",
        translationErrorMessage(error)
      );
      return;
    }
    scheduleScan(0);
  }

  function appendSellerDescriptionInfo(panel, result, translationView) {
    const bar = document.createElement("div");
    bar.className = "ebay-helper-seller-description-bar";
    const heading = document.createElement("div");
    heading.className = "ebay-helper-seller-description-heading";
    heading.textContent = "Item description from the seller";
    bar.append(heading);

    const originalUsefulCount = usefulDescriptionInfoCount(result.descriptionInfo);
    if (result.sellerDescription && originalUsefulCount) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ebay-helper-translation-toggle";
      button.setAttribute("aria-pressed", String(translationView.translated));
      button.disabled = translationView.job?.state === "loading";
      button.textContent = translationView.job?.state === "loading"
        ? translationView.job.message
        : translationView.translated ? "Показати оригінал" : "Перекласти українською";
      button.title = translationView.translated
        ? "Повернути текст продавця мовою оригіналу"
        : "Перекласти витягнуті факти українською за допомогою Chrome";
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        void toggleSellerDescriptionTranslation(result);
      });
      bar.append(button);
    }
    panel.append(bar);

    if (!result.sellerDescription) {
      const notice = document.createElement("div");
      notice.className = "ebay-helper-item-notice ebay-helper-description-loading";
      notice.textContent = "Завантажую ручний опис продавця. Якщо він не з'явиться, прокрутіть сторінку до блоку Item description from the seller.";
      panel.append(notice);
      return;
    }

    if (translationView.job?.state === "error") {
      const notice = document.createElement("div");
      notice.className = "ebay-helper-item-notice ebay-helper-translation-error";
      notice.setAttribute("role", "status");
      notice.textContent = translationView.job.message;
      panel.append(notice);
    }

    const info = translationView.info;
    if (info.highlights.length) appendItemPageRow(panel, "Важливе", info.highlights.join(" "));
    if (info.battery.length) appendItemPageRow(panel, "Батарея", info.battery.join(" "));
    if (info.power.length) appendItemPageRow(panel, "Живлення", info.power.join(" "));
    if (info.included.length) appendItemPageRow(panel, "У комплекті", info.included.join("; "));
    if (info.notIncluded.length) appendItemPageRow(panel, "Не входить", info.notIncluded.join("; "));
    for (const spec of info.specs) appendItemPageRow(panel, sellerSpecLabel(spec.label), spec.value);

    const usefulCount = usefulDescriptionInfoCount(info);
    if (!usefulCount) {
      const notice = document.createElement("div");
      notice.className = "ebay-helper-item-notice";
      notice.textContent = "Опис продавця завантажено, але структурованих фактів про стан, комплект або характеристики не знайдено.";
      panel.append(notice);
    }
  }

  function renderItemPagePanel(result) {
    const maxTotalUah = Core.calculateTotalUah(result.price.maxUsd, settings, result.shipping.usd);
    const tier = Core.classifyTotalUah(maxTotalUah, settings);
    const preferred = Core.matchesKeywords(result.title, settings.preferredKeywords);
    const excluded = Core.matchesKeywords(result.title, settings.excludedKeywords);
    const translationView = sellerDescriptionTranslationView(result);
    const signature = JSON.stringify({
      itemId: result.itemId,
      title: result.title,
      price: result.price,
      shipping: result.shipping,
      sellerDescription: descriptionSignature(result.sellerDescription),
      descriptionInfo: result.descriptionInfo,
      translationView,
      risk: result.risk,
      tier,
      preferred,
      excluded,
      settings
    });
    const existing = document.getElementById("ebay-laptop-helper-item-panel");
    if (existing?.dataset.signature === signature) return;

    const panel = document.createElement("aside");
    panel.id = "ebay-laptop-helper-item-panel";
    panel.dataset.ebayHelperOwned = "true";
    panel.dataset.itemId = result.itemId;
    panel.dataset.signature = signature;
    panel.dataset.tier = tier;
    panel.dataset.riskLevel = result.risk.level;
    panel.setAttribute("aria-label", "Інформація eBay Laptop Helper про товар");

    const header = document.createElement("div");
    header.className = "ebay-helper-item-header";
    const heading = document.createElement("strong");
    heading.textContent = "eBay Laptop Helper";
    const tierBadge = document.createElement("span");
    tierBadge.className = "ebay-helper-item-tier";
    tierBadge.textContent = itemPageTierLabel(tier);
    tierBadge.title = tier === "green"
      ? `Повна ціна до ${Core.formatUah(settings.greenMaxUah)}`
      : tier === "yellow"
        ? `Повна ціна до ${Core.formatUah(settings.yellowMaxUah)}`
        : `Повна ціна вище ${Core.formatUah(settings.yellowMaxUah)}`;
    header.append(heading, tierBadge);
    panel.append(header);

    if (settings.showConvertedPrice) {
      const total = document.createElement("div");
      total.className = "ebay-helper-item-total";
      total.textContent = Core.formatConvertedPrice(result.price, settings, result.shipping.usd);
      total.title = `Формула: ((ціна + доставка) × ${1 + settings.markupPercent / 100} + $${settings.fixedFeeUsd}) × ${settings.usdRate}`;
      panel.append(total);

      const shippingLabel = result.shipping.known
        ? result.shipping.isFree ? "безкоштовна доставка" : `доставка $${formatUsd(result.shipping.usd)}`
        : "доставку не знайдено — у формулі використано $0";
      appendItemPageRow(panel, "Розрахунок", `${formatItemPageUsdPrice(result.price)} + ${shippingLabel}`);

      if (!result.shipping.known) {
        const notice = document.createElement("div");
        notice.className = "ebay-helper-item-notice";
        notice.textContent = "Перевірте доставку вручну: eBay міг ще не показати її для вашого ZIP-коду.";
        panel.append(notice);
      }
    }

    appendSellerDescriptionInfo(panel, result, translationView);

    if (preferred || excluded) {
      const keywordSignals = document.createElement("div");
      keywordSignals.className = "ebay-helper-item-keywords";
      if (preferred) {
        const preferredSignal = document.createElement("span");
        preferredSignal.dataset.kind = "preferred";
        preferredSignal.textContent = "✓ Є бажане слово";
        keywordSignals.append(preferredSignal);
      }
      if (excluded) {
        const excludedSignal = document.createElement("span");
        excludedSignal.dataset.kind = "excluded";
        excludedSignal.textContent = "! Є небажане слово";
        keywordSignals.append(excludedSignal);
      }
      panel.append(keywordSignals);
    }

    if (settings.showRiskBadges) {
      const risk = document.createElement("div");
      risk.className = "ebay-helper-item-risk";
      if (!result.sellerDescription) {
        risk.dataset.level = "medium";
        risk.textContent = "Аналіз ризиків очікує Item description from the seller";
      } else if (result.risk.level === "low") {
        risk.dataset.level = "low";
        risk.textContent = "✓ Явних ризикових слів у назві й описі продавця не знайдено";
      } else {
        risk.dataset.level = result.risk.level;
        const prefix = result.risk.level === "high" ? "РИЗИК" : "УВАГА";
        risk.textContent = `${prefix}: ${result.risk.flags.map((flag) => flag.label).join("; ")}`;
      }
      panel.append(risk);
    }

    const actions = document.createElement("div");
    actions.className = "ebay-helper-item-actions";
    const olxQuery = Core.buildOlxSearchQuery(result.title);
    actions.append(itemPageAction(
      "Знайти на OLX",
      Core.buildOlxSearchUrl(result.title),
      "ebay-helper-item-action ebay-helper-item-action-olx",
      `Знайти на OLX: ${olxQuery}`
    ));
    if (settings.showSoldSearch) {
      const soldQuery = Core.buildEbaySoldSearchQuery(result.title);
      actions.append(itemPageAction(
        "Продані на eBay",
        Core.buildEbaySoldSearchUrl(result.title),
        "ebay-helper-item-action ebay-helper-item-action-sold",
        `Завершені продажі eBay: ${soldQuery}`
      ));
    }
    panel.append(actions);

    const footer = document.createElement("div");
    footer.className = "ebay-helper-item-footer";
    footer.textContent = `Item ID: ${result.itemId}`;
    panel.append(footer);

    let anchor = result.priceElement.closest([
      ".x-price-section",
      ".x-price-primary",
      ".x-buybox__price-section",
      "[data-testid='x-price-primary']",
      "[data-testid*='price-primary']"
    ].join(","));
    if (!anchor || anchor.tagName === "META") anchor = result.priceElement.parentElement;
    if (!anchor?.parentElement) return;

    existing?.remove();
    anchor.insertAdjacentElement("afterend", panel);
  }

  function upsertConvertedPrice(card, priceElement, itemId, price, shipping) {
    if (!settings.showConvertedPrice) {
      removeOwnedElement(card, "data-ebay-helper-converted", itemId);
      return;
    }

    let converted = ownedElement(card, "data-ebay-helper-converted", itemId);
    if (!converted) {
      converted = document.createElement("span");
      converted.dataset.ebayHelperConverted = "true";
      converted.dataset.ebayHelperOwned = "true";
      converted.dataset.itemId = itemId;
      converted.className = "ebay-helper-converted-price";
      priceElement.insertAdjacentElement("afterend", converted);
    }
    converted.textContent = `(${Core.formatConvertedPrice(price, settings, shipping.usd)})`;
    const shippingLabel = shipping.known
      ? shipping.isFree ? "безкоштовна доставка" : `доставка $${formatUsd(shipping.usd)}`
      : "доставку на сторінці не знайдено, використано $0";
    converted.title = `Формула: ((ціна + доставка) × ${1 + settings.markupPercent / 100} + $${settings.fixedFeeUsd}) × ${settings.usdRate}; ${shippingLabel}`;
  }

  function upsertOlxLink(card, priceElement, itemId, title) {
    let link = ownedElement(card, "data-ebay-helper-olx", itemId);
    if (!link) {
      link = document.createElement("a");
      link.dataset.ebayHelperOlx = "true";
      link.dataset.ebayHelperOwned = "true";
      link.dataset.itemId = itemId;
      link.className = "ebay-helper-olx-link";
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "OLX";
      link.addEventListener("click", (event) => event.stopPropagation());
      const converted = ownedElement(card, "data-ebay-helper-converted", itemId);
      (converted || priceElement).insertAdjacentElement("afterend", link);
    }
    const query = Core.buildOlxSearchQuery(title);
    link.href = Core.buildOlxSearchUrl(title);
    link.title = `Знайти на OLX: ${query}`;
    link.setAttribute("aria-label", `Знайти на OLX: ${query}`);
  }

  function upsertSoldLink(card, priceElement, itemId, title) {
    if (!settings.showSoldSearch) {
      removeOwnedElement(card, "data-ebay-helper-sold", itemId);
      return;
    }

    let link = ownedElement(card, "data-ebay-helper-sold", itemId);
    if (!link) {
      link = document.createElement("a");
      link.dataset.ebayHelperSold = "true";
      link.dataset.ebayHelperOwned = "true";
      link.dataset.itemId = itemId;
      link.className = "ebay-helper-sold-link";
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "SOLD";
      link.addEventListener("click", (event) => event.stopPropagation());
      const olxLink = ownedElement(card, "data-ebay-helper-olx", itemId);
      const converted = ownedElement(card, "data-ebay-helper-converted", itemId);
      (olxLink || converted || priceElement).insertAdjacentElement("afterend", link);
    }
    const query = Core.buildEbaySoldSearchQuery(title);
    link.href = Core.buildEbaySoldSearchUrl(title);
    link.title = `Перевірити завершені продажі eBay: ${query}`;
    link.setAttribute("aria-label", `Завершені продажі eBay: ${query}`);
  }

  function upsertRiskBadge(card, titleElement, itemId, risk) {
    if (!settings.showRiskBadges || risk.level === "low") {
      removeOwnedElement(card, "data-ebay-helper-risk", itemId);
      return;
    }

    let badge = ownedElement(card, "data-ebay-helper-risk", itemId);
    if (!badge) {
      badge = document.createElement("span");
      badge.dataset.ebayHelperRisk = "true";
      badge.dataset.ebayHelperOwned = "true";
      badge.dataset.itemId = itemId;
      badge.className = "ebay-helper-risk-badge";
      titleElement.insertAdjacentElement("afterend", badge);
    }
    badge.dataset.level = risk.level;
    badge.textContent = risk.level === "high" ? "РИЗИК" : "УВАГА";
    const details = risk.flags.map((flag) => flag.label).join("; ");
    badge.title = `Знайдено в назві: ${details}. Перевірте опис і фото перед купівлею.`;
    badge.setAttribute("aria-label", `${badge.textContent}: ${details}`);
  }

  function upsertNewBadge(card, titleElement, itemId, isNew) {
    if (!settings.markNewItems || !isNew) {
      removeOwnedElement(card, "data-ebay-helper-new", itemId);
      return;
    }

    let badge = ownedElement(card, "data-ebay-helper-new", itemId);
    if (!badge) {
      badge = document.createElement("span");
      badge.dataset.ebayHelperNew = "true";
      badge.dataset.ebayHelperOwned = "true";
      badge.dataset.itemId = itemId;
      badge.className = "ebay-helper-new-badge";
      badge.textContent = "НОВЕ";
      titleElement.insertAdjacentElement("afterend", badge);
    }
  }

  function styleCard(result, isNew) {
    const { card, itemId, title, titleElement, price, priceElement, shipping } = result;
    const maxTotalUah = Core.calculateTotalUah(price.maxUsd, settings, shipping.usd);
    const tier = Core.classifyTotalUah(maxTotalUah, settings);
    const preferred = Core.matchesKeywords(title, settings.preferredKeywords);
    const excluded = Core.matchesKeywords(title, settings.excludedKeywords);
    const risk = Core.assessListingRisk(title);
    const signature = JSON.stringify({
      itemId,
      title,
      min: price.minUsd,
      max: price.maxUsd,
      shipping,
      tier,
      preferred,
      excluded,
      risk,
      isNew,
      settings
    });

    if (card.dataset.ebayHelperSignature === signature) return;
    removeStaleOwnedElements(card, itemId);
    card.dataset.ebayHelperSignature = signature;
    card.dataset.ebayHelperItemId = itemId;
    card.style.setProperty("--ebay-helper-title-color", settings[`${tier}TitleColor`]);
    card.classList.remove(
      "ebay-helper-tier-green",
      "ebay-helper-tier-yellow",
      "ebay-helper-tier-red",
      "ebay-helper-preferred",
      "ebay-helper-excluded"
    );
    card.classList.add("ebay-helper-card", `ebay-helper-tier-${tier}`);
    if (preferred) card.classList.add("ebay-helper-preferred");
    if (excluded) card.classList.add("ebay-helper-excluded");

    titleElement.classList.remove("ebay-helper-title-green", "ebay-helper-title-yellow", "ebay-helper-title-red");
    priceElement.classList.remove("ebay-helper-price-green", "ebay-helper-price-yellow", "ebay-helper-price-red");
    titleElement.classList.add("ebay-helper-title", `ebay-helper-title-${tier}`);
    priceElement.classList.add("ebay-helper-price", `ebay-helper-price-${tier}`);
    upsertConvertedPrice(card, priceElement, itemId, price, shipping);
    upsertOlxLink(card, priceElement, itemId, title);
    upsertSoldLink(card, priceElement, itemId, title);
    upsertRiskBadge(card, titleElement, itemId, risk);
    upsertNewBadge(card, titleElement, itemId, isNew);
  }

  function cleanSeenItems(now) {
    const recent = Object.entries(seenItems)
      .filter(([, timestamp]) => timestamp === 0 || now - Number(timestamp) <= SEEN_ITEM_TTL_MS)
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .slice(0, MAX_SEEN_ITEMS);
    seenItems = Object.fromEntries(recent);
  }

  function persistSeenSoon() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      chrome.storage.local.set({
        [SEEN_KEY]: seenItems,
        [INITIALIZED_KEY]: true
      });
    }, 400);
  }

  function collectResults() {
    const cards = productCards();
    const results = [];
    for (const card of cards) {
      const link = findBestItemLink(card);
      const priceResult = findPriceElement(card);
      if (!priceResult) continue;
      const shippingResult = findShipping(card);
      const titleResult = findTitle(card, link);
      const itemId = itemKey(card, link, titleResult.text, priceResult.price);
      results.push({
        card,
        itemId,
        title: titleResult.text,
        titleElement: titleResult.element,
        price: priceResult.price,
        priceElement: priceResult.element,
        shipping: shippingResult
          ? { usd: shippingResult.shipping.usd, isFree: shippingResult.shipping.isFree, known: true }
          : { usd: 0, isFree: false, known: false }
      });
    }
    return { cardCount: cards.length, results };
  }

  function updateStatus(cardCount, resultCount, itemPageState = null) {
    let status = document.getElementById("ebay-laptop-helper-status");

    if (resultCount > 0 || itemPageState === "ready" || itemPageState === "disabled") {
      status?.remove();
      return;
    }

    if (!status) {
      status = document.createElement("div");
      status.id = "ebay-laptop-helper-status";
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

  function clearDecorations() {
    document.querySelectorAll(".ebay-helper-card").forEach((card) => {
      card.classList.remove(
        "ebay-helper-card",
        "ebay-helper-tier-green",
        "ebay-helper-tier-yellow",
        "ebay-helper-tier-red",
        "ebay-helper-preferred",
        "ebay-helper-excluded"
      );
      delete card.dataset.ebayHelperSignature;
      delete card.dataset.ebayHelperItemId;
      card.style.removeProperty("--ebay-helper-title-color");
    });
    document.querySelectorAll(".ebay-helper-title").forEach((element) => {
      element.classList.remove("ebay-helper-title", "ebay-helper-title-green", "ebay-helper-title-yellow", "ebay-helper-title-red");
    });
    document.querySelectorAll(".ebay-helper-price").forEach((element) => {
      element.classList.remove("ebay-helper-price", "ebay-helper-price-green", "ebay-helper-price-yellow", "ebay-helper-price-red");
    });
    document.querySelectorAll("[data-ebay-helper-converted], [data-ebay-helper-new], [data-ebay-helper-olx], [data-ebay-helper-sold], [data-ebay-helper-risk]").forEach((element) => element.remove());
    clearItemPagePanel();
    document.getElementById("ebay-laptop-helper-status")?.remove();
  }

  function scan() {
    if (!ready || scanInProgress) return;
    scanInProgress = true;

    try {
      if (!settings.enabled) {
        clearDecorations();
        return;
      }

      let itemPageState = null;
      const itemPageId = currentItemPageId();
      if (itemPageId) {
        if (!settings.showItemPagePanel) {
          clearItemPagePanel();
          itemPageState = "disabled";
        } else {
          const itemPageResult = collectItemPageResult(itemPageId);
          if (itemPageResult) {
            renderItemPagePanel(itemPageResult);
            itemPageState = "ready";
          } else {
            clearItemPagePanel();
            itemPageState = "loading";
          }
        }
      } else {
        clearItemPagePanel();
      }

      const now = Date.now();
      const collected = collectResults();
      const { cardCount, results } = collected;
      updateStatus(cardCount, results.length, itemPageState);
      let seenChanged = false;

      if (!initialized && results.length > 0) {
        for (const result of results) seenItems[result.itemId] = 0;
        initialized = true;
        seenChanged = true;
      } else {
        for (const result of results) {
          if (!Object.prototype.hasOwnProperty.call(seenItems, result.itemId)) {
            seenItems[result.itemId] = now;
            seenChanged = true;
          }
        }
      }

      for (const result of results) {
        const firstSeen = Number(seenItems[result.itemId]);
        const isNew = firstSeen > 0 && now - firstSeen <= NEW_ITEM_TTL_MS;
        styleCard(result, isNew);
      }

      if (seenChanged) {
        cleanSeenItems(now);
        persistSeenSoon();
      }
    } finally {
      scanInProgress = false;
    }
  }

  function scheduleScan(delay = 250) {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, delay);
  }

  const observer = new MutationObserver((mutations) => {
    const onlyHelperChanges = mutations.every((mutation) => {
      const target = mutation.target.nodeType === Node.ELEMENT_NODE
        ? mutation.target
        : mutation.target.parentElement;
      return Boolean(target?.closest?.("[data-ebay-helper-owned='true']"));
    });
    if (!onlyHelperChanges) scheduleScan();
  });

  chrome.storage.local.get([SETTINGS_KEY, SEEN_KEY, INITIALIZED_KEY], (stored) => {
    settings = Core.sanitizeSettings(stored[SETTINGS_KEY]);
    seenItems = stored[SEEN_KEY] && typeof stored[SEEN_KEY] === "object" ? stored[SEEN_KEY] : {};
    initialized = stored[INITIALIZED_KEY] === true;
    ready = true;

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
    scan();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[SETTINGS_KEY]) return;
    settings = Core.sanitizeSettings(changes[SETTINGS_KEY].newValue);
    document.querySelectorAll("[data-ebay-helper-signature]").forEach((card) => {
      delete card.dataset.ebayHelperSignature;
    });
    scheduleScan(0);
  });
})();
