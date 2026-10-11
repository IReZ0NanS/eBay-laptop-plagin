(function initEbayLaptopItemPanel(global) {
  "use strict";

  const Core = global.EbayLaptopCore;
  const Dom = global.EbayLaptopDom;
  const Inspection = global.EbayLaptopInspection;
  const Translation = global.EbayLaptopTranslation;

  const PANEL_ID = "ebay-laptop-helper-item-panel";
  const DESCRIPTION_MESSAGE_TYPE = "EBAY_LAPTOP_HELPER_SELLER_DESCRIPTION";
  const MAX_DESCRIPTION_LENGTH = 100000;
  const MAX_CACHED_ITEMS = 10;
  const DESCRIPTION_REQUEST_INTERVAL = 2000;

  const TITLE_SELECTORS = [
    "[data-testid='x-item-title'] h1",
    "h1.x-item-title__mainTitle",
    ".x-item-title__mainTitle",
    "h1[itemprop='name']",
    "#mainContent h1",
    "main h1"
  ];

  // Listings in EUR/GBP show eBay's own USD conversion in .x-price-approx.
  const APPROX_PRICE_SELECTOR = ".x-price-approx, [data-testid='x-price-approx']";
  const PRICE_SELECTORS = [
    ".x-price-primary span.ux-textspans",
    ".x-price-primary",
    "[data-testid='x-price-primary']",
    "[data-testid*='price-primary']",
    "[data-testid='x-bin-price']",
    ".x-bin-price__display-price",
    ".x-price-section [itemprop='price']",
    "#mainContent [itemprop='price']",
    "main [itemprop='price']",
    ".x-price-approx__price",
    "[data-testid='x-price-approx']"
  ];

  const PANEL_ANCHOR_SELECTOR = [
    ".x-price-section",
    ".x-price-primary",
    ".x-buybox__price-section",
    "[data-testid='x-price-primary']",
    "[data-testid*='price-primary']",
    APPROX_PRICE_SELECTOR
  ].join(",");

  const SHIPPING_SELECTORS = [
    ".ux-labels-values--shipping",
    ".ux-labels-values--delivery",
    ".x-shipping-minview",
    ".ux-layout-section__item--shipping",
    "[data-testid*='shipping']",
    "[data-testid*='delivery']",
    "#mainContent [class*='shipping']",
    "#mainContent [class*='Shipping']"
  ];

  const DESCRIPTION_SELECTORS = [
    "[data-testid='x-item-description']",
    "[data-testid*='item-description']",
    ".x-item-description",
    ".d-item-description",
    "#desc_div"
  ];

  const SPECIFICS_SELECTOR = "#viTabs_0_is, .x-about-this-item, .ux-layout-section-evo__item--itemSpecifics, .ux-layout-section__item--itemSpecifics, [data-testid='ux-layout-section-evo__item--itemSpecifics']";

  const SELLER_SPEC_LABELS = {
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

  function currentItemPageId() {
    const looksLikeItemPage = /\/itm\//i.test(location.pathname)
      || /[?&](?:item|itemid|item_id|_itemid)=/i.test(location.search);
    return looksLikeItemPage ? Core.extractItemId(location.href) : null;
  }

  function firstMatch(selectors, limit, read) {
    for (const selector of selectors) {
      const candidates = Array.from(document.querySelectorAll(selector)).slice(0, limit);
      for (const element of candidates) {
        if (Dom.isOwned(element)) continue;
        const found = read(element);
        if (found) return found;
      }
    }
    return null;
  }

  function findTitle() {
    return firstMatch(TITLE_SELECTORS, 8, (element) => {
      const text = Core.cleanTitle(Dom.normalizedText(element).replace(/^Details\s+about\s+/i, ""));
      return text.length >= 4 && text.length <= 500 && !/^shop\s+on\s+ebay$/i.test(text) ? { element, text } : null;
    });
  }

  function findPrice() {
    return firstMatch(PRICE_SELECTORS, 12, (element) => {
      const { price } = Dom.priceFromElement(element, document);
      if (!price) return null;
      const approximate = Boolean(element.closest(APPROX_PRICE_SELECTOR));
      const sellerPrice = approximate
        ? Dom.normalizedText(document.querySelector(".x-price-primary__price") || document.querySelector(".x-price-primary"))
        : "";
      return { element, price, approximate, sellerPrice };
    });
  }

  function findShipping() {
    return firstMatch(SHIPPING_SELECTORS, 30, (element) => {
      const text = Dom.normalizedText(element);
      if (!text || text.length > 500) return null;
      const shipping = Core.parseShippingUsd(text);
      return shipping ? { element, shipping } : null;
    });
  }

  function normalizeSellerDescription(text) {
    return String(text || "")
      .replace(/\r/g, "\n")
      .replace(/[  ]/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/^\s*Item description from the seller\s*/i, "")
      .trim()
      .slice(0, MAX_DESCRIPTION_LENGTH);
  }

  function findInlineSellerDescription() {
    let best = "";
    for (const selector of DESCRIPTION_SELECTORS) {
      const candidates = Array.from(document.querySelectorAll(selector)).slice(0, 12);
      for (const element of candidates) {
        if (Dom.isOwned(element)) continue;
        const text = normalizeSellerDescription(element.innerText || element.textContent || "");
        if (text.length > best.length) best = text;
      }
    }
    return best;
  }

  function itemPageSpecifics() {
    const sections = Array.from(document.querySelectorAll(SPECIFICS_SELECTOR));
    const rows = new Set(sections.flatMap(section => Array.from(section.querySelectorAll("dl dt"))));
    if (rows.size) return Array.from(rows).map(label => {
      const value = label.nextElementSibling;
      return value?.tagName === "DD" ? `${Dom.normalizedText(label)}: ${Dom.normalizedText(value)}` : "";
    }).filter(Boolean).join("\n");
    return sections.map(section => section.innerText || section.textContent || "").join("\n");
  }

  function descriptionSignature(text) {
    const value = String(text || "");
    return `${value.length}|${Core.stableHash(value)}`;
  }

  function isTrustedDescriptionOrigin(origin) {
    try {
      const url = new URL(origin);
      const hostname = url.hostname.toLocaleLowerCase();
      return url.protocol === "https:" && (hostname === "ebaydesc.com" || hostname.endsWith(".ebaydesc.com"));
    } catch {
      return false;
    }
  }

  function sellerSpecLabel(label) {
    const key = String(label || "").trim().toLocaleLowerCase();
    return SELLER_SPEC_LABELS[key] || String(label || "Характеристика").slice(0, 45);
  }

  function usefulDescriptionInfoCount(info) {
    return info.highlights.length
      + info.battery.length
      + info.power.length
      + info.included.length
      + info.notIncluded.length
      + info.specs.length;
  }

  function translationErrorMessage(error) {
    if (error?.code === "api-unavailable") {
      return "Вбудований перекладач недоступний у цьому браузері або контексті сторінки. Перевірте оновлення Chrome; оригінал опису залишився.";
    }
    if (error?.code === "language-pair-unavailable") {
      return "Вбудований переклад з англійської на українську недоступний на цьому комп'ютері.";
    }
    return "Не вдалося перекласти опис. Оригінал залишився без змін — спробуйте ще раз.";
  }

  // Ukrainian plural: forms are [1 факт, 2 факти, 5 фактів].
  function plural(count, [one, few, many]) {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return `${count} ${one}`;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} ${few}`;
    return `${count} ${many}`;
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function appendRow(container, label, value, extraClass = "") {
    const row = element("div", `ebay-helper-item-row${extraClass ? ` ${extraClass}` : ""}`);
    const valueElement = element("span", "ebay-helper-item-row-value", value);
    valueElement.title = value;
    row.append(element("span", "ebay-helper-item-row-label", label), valueElement);
    container.append(row);
  }

  function appendNotice(container, text, extraClass = "") {
    const notice = element("div", `ebay-helper-item-notice${extraClass ? ` ${extraClass}` : ""}`, text);
    container.append(notice);
    return notice;
  }

  function createSection(section, summaryText) {
    const details = element("details", "ebay-helper-review");
    details.dataset.section = section;
    details.append(element("summary", "", summaryText));
    return details;
  }

  function button(label, className = "ebay-helper-button") {
    const node = element("button", className, label);
    node.type = "button";
    return node;
  }

  async function copyText(textarea) {
    try {
      await navigator.clipboard.writeText(textarea.value);
    } catch {
      textarea.focus();
      textarea.select();
      document.execCommand("copy");
    }
  }

  const TIER_LABELS = { green: "Зелена зона", yellow: "Жовта зона", red: "Червона зона" };

  function create({ getSettings, requestScan }) {
    const sellerDescriptions = new Map();
    const frameDescriptions = new Set();
    // Per item: the translated facts and full description, the shown mode and a running job.
    const translations = new Map();
    const translationModes = new Map();
    const translationJobs = new Map();
    let lastDescriptionRequest = 0;

    function forgetTranslation(itemId) {
      translations.delete(itemId);
      translationModes.delete(itemId);
      translationJobs.delete(itemId);
    }

    function rememberSellerDescription(itemId, text) {
      const previous = sellerDescriptions.get(itemId);
      sellerDescriptions.set(itemId, text);
      while (sellerDescriptions.size > MAX_CACHED_ITEMS) {
        const oldest = sellerDescriptions.keys().next().value;
        sellerDescriptions.delete(oldest);
        frameDescriptions.delete(oldest);
        forgetTranslation(oldest);
      }
      if (previous !== text) forgetTranslation(itemId);
    }

    function sellerDescriptionForItem(itemId) {
      const cached = sellerDescriptions.get(itemId);
      if (frameDescriptions.has(itemId) && cached) return cached;
      const inline = findInlineSellerDescription();
      if (inline && inline !== cached) {
        rememberSellerDescription(itemId, inline);
        return inline;
      }
      return cached || inline;
    }

    function receiveSellerDescription(event) {
      const settings = getSettings();
      if (!settings.enabled || !settings.showItemPagePanel) return;
      const data = event.data;
      if (!isTrustedDescriptionOrigin(event.origin)) return;
      if (!Array.from(document.querySelectorAll("iframe")).some(frame => frame.contentWindow === event.source)) return;
      if (!data || data.source !== "ebay-laptop-helper" || data.type !== DESCRIPTION_MESSAGE_TYPE) return;

      const itemId = String(data.itemId || "");
      if (!/^[0-9]{9,15}$/.test(itemId) || itemId !== currentItemPageId()) return;
      const text = normalizeSellerDescription(data.text);
      if (!text || sellerDescriptions.get(itemId) === text) return;

      rememberSellerDescription(itemId, text);
      frameDescriptions.add(itemId);
      requestScan(0);
    }

    window.addEventListener("message", receiveSellerDescription);

    function requestDescription(itemId) {
      const now = Date.now();
      if (!getSettings().showItemPagePanel || frameDescriptions.has(itemId) || now - lastDescriptionRequest <= DESCRIPTION_REQUEST_INTERVAL) return;
      lastDescriptionRequest = now;
      document.querySelectorAll("iframe").forEach(frame => {
        try {
          const origin = new URL(frame.src).origin;
          // The frame's src is its destination, not necessarily its current origin:
          // a lazy/loading frame can still be about:blank (inheriting ebay.com).
          // This data-free request may cross that transition. Responses remain
          // restricted to ebaydesc.com, this frame's window and the current item ID.
          if (isTrustedDescriptionOrigin(origin)) frame.contentWindow?.postMessage({ type: "EBAY_HELPER_REQUEST_DESCRIPTION" }, "*");
        } catch {}
      });
    }

    function collect(itemId) {
      const titleResult = findTitle();
      const priceResult = findPrice();
      if (!titleResult || !priceResult) return null;

      const sellerDescription = sellerDescriptionForItem(itemId);
      return {
        itemId,
        title: titleResult.text,
        price: priceResult.price,
        priceElement: priceResult.element,
        approximatePrice: priceResult.approximate,
        sellerPrice: priceResult.sellerPrice,
        shipping: Dom.shippingInfo(findShipping()),
        sellerDescription,
        descriptionInfo: Core.extractSellerDescriptionInfo(sellerDescription),
        inspection: Inspection.inspect([
          { kind: "title", label: "Назва", text: titleResult.text },
          { kind: "specifics", label: "Характеристики eBay", text: itemPageSpecifics() },
          { kind: "description", label: "Опис продавця", text: sellerDescription }
        ])
      };
    }

    function translationView(result) {
      const sourceSignature = descriptionSignature(result.sellerDescription);
      const cached = translations.get(result.itemId);
      const validCache = cached?.sourceSignature === sourceSignature ? cached : null;
      const job = translationJobs.get(result.itemId);
      const translated = translationModes.get(result.itemId) === "translated" && Boolean(validCache);
      return {
        info: translated ? validCache.info : result.descriptionInfo,
        full: translated ? validCache.full : result.sellerDescription,
        translated,
        job: job?.sourceSignature === sourceSignature ? job : null
      };
    }

    function setTranslationJob(itemId, sourceSignature, state, message) {
      translationJobs.set(itemId, { sourceSignature, state, message });
      requestScan(0);
    }

    // One switch translates the extracted facts first, then the full description.
    async function toggleTranslation(result) {
      const itemId = result.itemId;
      const sourceSignature = descriptionSignature(result.sellerDescription);
      const cached = translations.get(itemId);

      if (cached?.sourceSignature === sourceSignature) {
        const translated = translationModes.get(itemId) === "translated";
        translationModes.set(itemId, translated ? "original" : "translated");
        translationJobs.delete(itemId);
        requestScan(0);
        return;
      }

      const isCurrent = () => itemId === currentItemPageId()
        && descriptionSignature(sellerDescriptions.get(itemId)) === sourceSignature;
      const progress = (label) => ({ completed, total }) => {
        setTranslationJob(itemId, sourceSignature, "loading", total ? `${label} ${completed}/${total}` : `${label}…`);
      };

      setTranslationJob(itemId, sourceSignature, "loading", "Готую перекладач…");
      try {
        const translator = await Translation.getEnglishToUkrainianTranslator((loaded) => {
          const percent = Math.max(0, Math.min(100, Math.round(loaded * 100)));
          setTranslationJob(itemId, sourceSignature, "loading", `Завантаження ${percent}%`);
        });
        const info = await Translation.translateSellerDescriptionInfo(result.descriptionInfo, translator, progress("Факти"));
        const full = await Translation.translateText(result.sellerDescription, translator, progress("Опис"));

        if (!isCurrent()) return;
        translations.set(itemId, { sourceSignature, info, full });
        translationModes.set(itemId, "translated");
        translationJobs.delete(itemId);
      } catch (error) {
        console.warn("eBay Laptop Helper translation failed", error);
        if (!isCurrent()) return;
        translationModes.set(itemId, "original");
        setTranslationJob(itemId, sourceSignature, "error", translationErrorMessage(error));
        return;
      }
      requestScan(0);
    }

    function translationButton(result, view) {
      const node = button("", "ebay-helper-button ebay-helper-translation-toggle");
      const loading = view.job?.state === "loading";
      node.setAttribute("aria-pressed", String(view.translated));
      node.disabled = loading;
      node.textContent = loading ? view.job.message : view.translated ? "Оригінал" : "Перекласти";
      node.title = view.translated
        ? "Повернути опис продавця мовою оригіналу"
        : "Перекласти факти й повний опис продавця українською за допомогою Chrome";
      node.addEventListener("click", (event) => {
        event.stopPropagation();
        void toggleTranslation(result);
      });
      return node;
    }

    function appendHeader(panel, result, settings, tier) {
      const header = element("div", "ebay-helper-item-header");
      if (settings.showConvertedPrice) {
        const total = element("div", "ebay-helper-item-total", Core.formatConvertedPrice(result.price, settings, result.shipping.usd));
        total.title = Core.formulaTitle(settings);
        header.append(total);
      } else {
        header.append(element("div", "ebay-helper-item-brand", "eBay Laptop Helper"));
      }
      const tierBadge = element("span", "ebay-helper-item-tier", TIER_LABELS[tier]);
      tierBadge.title = tier === "green"
        ? `Повна ціна до ${Core.formatUah(settings.greenMaxUah)}`
        : tier === "yellow"
          ? `Повна ціна до ${Core.formatUah(settings.yellowMaxUah)}`
          : `Повна ціна вище ${Core.formatUah(settings.yellowMaxUah)}`;
      header.append(tierBadge);
      panel.append(header);

      if (!settings.showConvertedPrice) return;
      const usdPrice = `${result.approximatePrice ? "≈ " : ""}${Core.formatUsdPrice(result.price)}`;
      const sellerPrice = result.sellerPrice ? ` (ціна продавця ${result.sellerPrice})` : "";
      const shipping = Core.shippingLabel(result.shipping, "доставку не знайдено, враховано $0");
      const breakdown = element("div", "ebay-helper-item-breakdown", `${usdPrice}${sellerPrice} + ${shipping}`);
      breakdown.title = `${Core.formulaTitle(settings)}${result.shipping.known ? "" : ". Перевірте доставку вручну: eBay міг ще не показати її для вашого ZIP-коду."}`;
      if (!result.shipping.known) breakdown.dataset.warning = "true";
      panel.append(breakdown);
    }

    function chip(text, kind, title) {
      const node = element("span", "ebay-helper-chip", text);
      node.dataset.kind = kind;
      node.title = title;
      return node;
    }

    function appendKeywordSignals(panel, preferred, excluded) {
      if (!preferred && !excluded) return;
      const signals = element("div", "ebay-helper-chips");
      if (preferred) signals.append(chip("✓ Бажане слово", "preferred", "У назві є слово зі списку бажаних"));
      if (excluded) signals.append(chip("! Небажане слово", "excluded", "У назві є слово зі списку небажаних"));
      panel.append(signals);
    }

    function appendActions(panel, result, settings, view) {
      const actions = element("div", "ebay-helper-item-actions");
      const olxQuery = Core.buildOlxSearchQuery(result.title);
      actions.append(Dom.createLink(
        "OLX",
        Core.buildOlxSearchUrlFromQuery(olxQuery),
        "ebay-helper-item-action ebay-helper-item-action-olx",
        `Знайти на OLX: ${olxQuery}`
      ));
      if (settings.showSoldSearch) {
        const soldQuery = Core.buildEbaySoldSearchQuery(result.title);
        actions.append(Dom.createLink(
          "Продані на eBay",
          Core.buildEbaySoldSearchUrlFromQuery(soldQuery),
          "ebay-helper-item-action ebay-helper-item-action-sold",
          `Завершені продажі eBay: ${soldQuery}`
        ));
      }
      if (result.sellerDescription) actions.append(translationButton(result, view));
      panel.append(actions);
      if (view.job?.state === "error") {
        appendNotice(panel, view.job.message, "ebay-helper-translation-error").setAttribute("role", "status");
      }
    }

    function appendAnalogSearch(panel, result, settings) {
      const search = createSection("search", "✎ Змінити запит пошуку");
      search.classList.add("ebay-helper-search");
      const input = element("input");
      input.type = "text";
      input.setAttribute("aria-label", "Запит для пошуку аналогів");
      input.value = Core.buildEbaySoldSearchQuery(result.title);
      const model = button("Лише модель");
      const config = button("Комплектація");
      const olx = Dom.createLink("OLX", "", "ebay-helper-item-action ebay-helper-item-action-olx", "Пошук за введеним запитом");
      const sold = Dom.createLink("SOLD", "", "ebay-helper-item-action ebay-helper-item-action-sold", "Пошук за введеним запитом");
      const update = () => {
        olx.href = Core.buildOlxSearchUrlFromQuery(input.value);
        sold.href = Core.buildEbaySoldSearchUrlFromQuery(input.value);
      };
      input.addEventListener("input", update);
      model.addEventListener("click", () => { input.value = Core.buildOlxSearchQuery(result.title, false); update(); });
      config.addEventListener("click", () => { input.value = Core.buildEbaySoldSearchQuery(result.title); update(); });
      update();
      const presets = element("div", "ebay-helper-inline");
      presets.append(element("span", "ebay-helper-muted", "Підставити:"), model, config);
      const links = element("div", "ebay-helper-inline");
      links.append(olx);
      if (settings.showSoldSearch) links.append(sold);
      search.append(presets, input, links);
      panel.append(search);
    }

    function appendChecks(panel, result) {
      const inspection = result.inspection;
      for (const conflict of inspection.conflicts) {
        appendNotice(panel, `Суперечність — ${conflict.label}: ` + conflict.values.map(value => `${value.source}: ${value.value}`).join("; "), "ebay-helper-conflict");
      }

      const chips = element("div", "ebay-helper-chips ebay-helper-checks");
      chips.setAttribute("aria-label", "Перевірка перед купівлею");
      for (const check of inspection.checks) {
        chips.append(check.found
          ? chip(`✓ ${check.label}`, "found", "У тексті є згадка — перевірте зміст")
          : chip(`? ${check.label}`, "missing", "Даних немає — варто спитати продавця"));
      }
      panel.append(chips);
    }

    function appendQuestions(panel, result) {
      const questions = result.inspection.questions;
      if (!questions.length) return;
      const details = createSection("questions", `Питання продавцю англійською · ${plural(questions.length, ["пункт", "пункти", "пунктів"])}`);
      const draft = element("textarea");
      draft.rows = Math.min(14, questions.length * 3 + 5);
      draft.setAttribute("aria-label", "Питання продавцю — можна редагувати й скопіювати");
      draft.value = `Hello! I am interested in this laptop (item ${result.itemId}). Could you please clarify:\n\n`
        + questions.map((question, index) => `${index + 1}. ${question}`).join("\n")
        + "\n\nThank you!";
      draft.addEventListener("input", () => { draft.dataset.edited = "true"; });
      const copy = button("Копіювати");
      copy.addEventListener("click", async (event) => {
        event.stopPropagation();
        await copyText(draft);
        copy.textContent = "Скопійовано ✓";
        setTimeout(() => { copy.textContent = "Копіювати"; }, 1500);
      });
      details.append(draft, copy);
      panel.append(details);
    }

    function appendDescription(panel, result, view) {
      if (!result.sellerDescription) {
        appendNotice(panel, "Опис продавця ще завантажується. Якщо він не з'явиться, прокрутіть сторінку до Item description from the seller.", "ebay-helper-description-loading");
        return;
      }

      const info = view.info;
      const keyFacts = element("div", "ebay-helper-key-facts");
      if (info.battery.length) appendRow(keyFacts, "Батарея", info.battery.join(" "));
      if (info.power.length) appendRow(keyFacts, "Живлення", info.power.join(" "));
      if (keyFacts.children.length) panel.append(keyFacts);

      // Battery and charger are already shown above; the section holds everything else.
      const count = usefulDescriptionInfoCount(info) - info.battery.length - info.power.length;
      if (count) {
        const title = keyFacts.children.length ? "Інші факти з опису" : "Факти з опису";
        const facts = createSection("facts", `${title} · ${plural(count, ["факт", "факти", "фактів"])}`);
        if (info.highlights.length) appendRow(facts, "Стан", info.highlights.join(" "));
        if (info.included.length) appendRow(facts, "У комплекті", info.included.join("; "));
        if (info.notIncluded.length) appendRow(facts, "Не входить", info.notIncluded.join("; "));
        for (const spec of info.specs) appendRow(facts, sellerSpecLabel(spec.label), spec.value);
        panel.append(facts);
      }

      const full = createSection("full-description", "Повний опис продавця");
      full.append(element("div", "ebay-helper-full-description", view.full));
      panel.append(full);
    }

    function buildPanel(result, settings, evaluation, view, signature) {
      const panel = element("aside");
      panel.id = PANEL_ID;
      panel.dataset.ebayHelperOwned = "true";
      panel.dataset.itemId = result.itemId;
      panel.dataset.signature = signature;
      panel.dataset.tier = evaluation.tier;
      panel.setAttribute("aria-label", "Інформація eBay Laptop Helper про товар");

      appendHeader(panel, result, settings, evaluation.tier);
      appendKeywordSignals(panel, evaluation.preferred, evaluation.excluded);
      appendActions(panel, result, settings, view);
      appendAnalogSearch(panel, result, settings);
      appendChecks(panel, result);
      appendDescription(panel, result, view);
      appendQuestions(panel, result);
      return panel;
    }

    // Carries open sections, an edited question draft and the edited search query over to a rebuilt panel.
    function restoreState(panel, existing) {
      const previousDetails = Array.from(existing.querySelectorAll("details"));
      panel.querySelectorAll("details").forEach((details) => {
        const previous = previousDetails.find(old => old.dataset.section === details.dataset.section);
        if (!previous) return;
        details.open = previous.open;
        const draft = previous.querySelector("textarea");
        const replacementDraft = details.querySelector("textarea");
        if (draft?.dataset.edited && replacementDraft) {
          replacementDraft.value = draft.value;
          replacementDraft.dataset.edited = "true";
        }
        const input = previous.querySelector("input");
        const replacement = details.querySelector("input");
        if (input && replacement) {
          replacement.value = input.value;
          replacement.dispatchEvent(new Event("input"));
        }
      });
    }

    function renderPanel(result) {
      const settings = getSettings();
      const evaluation = Core.evaluateListing(result.title, result.price, result.shipping, settings);
      const view = translationView(result);
      const signature = JSON.stringify({
        itemId: result.itemId,
        title: result.title,
        price: result.price,
        sellerPrice: result.sellerPrice,
        shipping: result.shipping,
        sellerDescription: descriptionSignature(result.sellerDescription),
        descriptionInfo: result.descriptionInfo,
        inspection: result.inspection,
        view: { translated: view.translated, job: view.job },
        evaluation,
        settings
      });
      const existing = document.getElementById(PANEL_ID);
      if (existing?.dataset.signature === signature) return;

      let anchor = result.priceElement.closest(PANEL_ANCHOR_SELECTOR);
      if (!anchor || anchor.tagName === "META") anchor = result.priceElement.parentElement;
      if (!anchor?.parentElement) return;

      const panel = buildPanel(result, settings, evaluation, view, signature);
      const focused = existing?.contains(document.activeElement) ? document.activeElement : null;
      const focusLabel = focused?.getAttribute("aria-label");
      const selection = focused && "selectionStart" in focused ? [focused.selectionStart, focused.selectionEnd] : null;
      if (existing?.dataset.itemId === result.itemId) restoreState(panel, existing);
      existing?.remove();
      anchor.insertAdjacentElement("afterend", panel);
      if (focusLabel) {
        const replacement = Array.from(panel.querySelectorAll("input, textarea")).find(node => node.getAttribute("aria-label") === focusLabel);
        replacement?.focus({ preventScroll: true });
        if (replacement && selection) replacement.setSelectionRange(...selection);
      }
    }

    function clear() {
      document.getElementById(PANEL_ID)?.remove();
    }

    // Returns the item page state for the status badge: "disabled", "ready" or "loading".
    function render(itemId) {
      if (!getSettings().showItemPagePanel) {
        clear();
        return "disabled";
      }
      const result = collect(itemId);
      requestDescription(itemId);
      if (!result) {
        clear();
        return "loading";
      }
      renderPanel(result);
      return "ready";
    }

    return { render, clear };
  }

  global.EbayLaptopItemPanel = Object.freeze({
    currentItemPageId,
    create
  });
})(globalThis);
