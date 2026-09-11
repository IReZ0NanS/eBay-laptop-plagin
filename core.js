(function initEbayLaptopCore(global) {
  "use strict";

  const DEFAULTS = Object.freeze({
    enabled: true,
    usdRate: 46,
    markupPercent: 10,
    fixedFeeUsd: 30,
    greenMaxUah: 15000,
    yellowMaxUah: 25000,
    greenTitleColor: "#14853b",
    yellowTitleColor: "#c17d00",
    redTitleColor: "#c62828",
    preferredKeywords: "",
    excludedKeywords: "parts, repair, broken, as is, for parts",
    markNewItems: true,
    showConvertedPrice: true,
    showSoldSearch: true,
    showRiskBadges: true,
    showItemPagePanel: true
  });

  function boundedNumber(value, fallback, min, max) {
    const number = Number(value);
    return Number.isFinite(number) && number >= min && number <= max
      ? number
      : fallback;
  }

  function sanitizeColor(value, fallback) {
    const color = String(value || "").trim();
    return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : fallback;
  }

  function sanitizeSettings(input) {
    const source = input && typeof input === "object" ? input : {};
    const greenMaxUah = boundedNumber(source.greenMaxUah, DEFAULTS.greenMaxUah, 0, 10000000);
    const yellowMaxUah = Math.max(
      greenMaxUah,
      boundedNumber(source.yellowMaxUah, DEFAULTS.yellowMaxUah, 0, 10000000)
    );

    return {
      enabled: source.enabled !== false,
      usdRate: boundedNumber(source.usdRate, DEFAULTS.usdRate, 0.01, 1000),
      markupPercent: boundedNumber(source.markupPercent, DEFAULTS.markupPercent, 0, 500),
      fixedFeeUsd: boundedNumber(source.fixedFeeUsd, DEFAULTS.fixedFeeUsd, 0, 100000),
      greenMaxUah,
      yellowMaxUah,
      greenTitleColor: sanitizeColor(source.greenTitleColor, DEFAULTS.greenTitleColor),
      yellowTitleColor: sanitizeColor(source.yellowTitleColor, DEFAULTS.yellowTitleColor),
      redTitleColor: sanitizeColor(source.redTitleColor, DEFAULTS.redTitleColor),
      preferredKeywords: typeof source.preferredKeywords === "string"
        ? source.preferredKeywords.trim()
        : DEFAULTS.preferredKeywords,
      excludedKeywords: typeof source.excludedKeywords === "string"
        ? source.excludedKeywords.trim()
        : DEFAULTS.excludedKeywords,
      markNewItems: source.markNewItems !== false,
      showConvertedPrice: source.showConvertedPrice !== false,
      showSoldSearch: source.showSoldSearch !== false,
      showRiskBadges: source.showRiskBadges !== false,
      showItemPagePanel: source.showItemPagePanel !== false
    };
  }

  function parseLocalizedNumber(rawValue) {
    let value = String(rawValue || "").replace(/[\s\u00a0\u202f]/g, "");
    if (!value) return null;

    const commaIndex = value.lastIndexOf(",");
    const dotIndex = value.lastIndexOf(".");

    if (commaIndex !== -1 && dotIndex !== -1) {
      if (commaIndex > dotIndex) {
        value = value.replace(/\./g, "").replace(",", ".");
      } else {
        value = value.replace(/,/g, "");
      }
    } else if (commaIndex !== -1) {
      const decimalDigits = value.length - commaIndex - 1;
      value = decimalDigits === 2
        ? value.replace(",", ".")
        : value.replace(/,/g, "");
    } else if (dotIndex !== -1) {
      const decimalDigits = value.length - dotIndex - 1;
      if (decimalDigits !== 2) value = value.replace(/\./g, "");
    }

    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  function parseUsdPrice(text) {
    const sourceText = String(text || "")
      .replace(/[\u00a0\u202f]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!sourceText) return null;

    // eBay may show Canadian/Australian dollars and other currencies. The user
    // formula is USD-only, so those prices are intentionally not converted.
    if (/(?:\bC\s*\$|\bCA\s*\$|\bAU\s*\$|\bA\s*\$|\bNZ\s*\$|CAD|AUD|GBP|EUR|£|€)/i.test(sourceText)) {
      return null;
    }

    const amounts = [];
    const pricePattern = /(?:US\s*\$|U\.S\.\s*\$|USD\s*|\$)\s*([0-9][0-9\s.,]*)/gi;
    let match;

    while ((match = pricePattern.exec(sourceText)) !== null && amounts.length < 3) {
      const number = parseLocalizedNumber(match[1]);
      if (number !== null && !amounts.includes(number)) amounts.push(number);
    }

    if (!amounts.length) return null;

    const hasRangeLanguage = /\b(?:to|through)\b|[-–—]/i.test(sourceText);
    const range = hasRangeLanguage && amounts.length > 1 ? amounts.slice(0, 2) : [amounts[0]];
    return {
      minUsd: Math.min(...range),
      maxUsd: Math.max(...range),
      isRange: range.length > 1,
      sourceText
    };
  }

  function parseShippingUsd(text) {
    const sourceText = String(text || "")
      .replace(/[\u00a0\u202f]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!sourceText || !/\b(?:shipping|delivery|postage)\b/i.test(sourceText)) return null;

    if (/\bfree\s+(?:shipping|delivery|postage)\b|\b(?:shipping|delivery|postage)\s*:?\s*free\b/i.test(sourceText)) {
      return { usd: 0, isFree: true, sourceText };
    }

    // Ignore non-US dollar amounts instead of treating every "$" as USD.
    if (/(?:\bC\s*\$|\bCA\s*\$|\bAU\s*\$|\bA\s*\$|\bNZ\s*\$|CAD|AUD|GBP|EUR|£|€)/i.test(sourceText)) {
      return null;
    }

    const amountPattern = "([0-9][0-9\\s.,]*)";
    const usdPattern = "(?:US\\s*\\$|U\\.S\\.\\s*\\$|USD\\s*|\\$)";
    const labelPattern = "(?:shipping|delivery|postage)";
    const patterns = [
      new RegExp(`${usdPattern}\\s*${amountPattern}[^a-z0-9]{0,12}${labelPattern}`, "i"),
      new RegExp(`${labelPattern}[^$0-9]{0,28}${usdPattern}\\s*${amountPattern}`, "i")
    ];

    for (const pattern of patterns) {
      const match = sourceText.match(pattern);
      const number = match ? parseLocalizedNumber(match[1]) : null;
      if (number !== null) return { usd: number, isFree: false, sourceText };
    }

    return null;
  }

  function calculateTotalUah(usdPrice, settings, shippingUsd = 0) {
    const safe = sanitizeSettings(settings);
    const safePrice = Number(usdPrice);
    const safeShipping = Number(shippingUsd);
    const price = Number.isFinite(safePrice) ? safePrice : 0;
    const shipping = Number.isFinite(safeShipping) && safeShipping >= 0 ? safeShipping : 0;
    return ((price + shipping) * (1 + safe.markupPercent / 100) + safe.fixedFeeUsd) * safe.usdRate;
  }

  function classifyTotalUah(totalUah, settings) {
    const safe = sanitizeSettings(settings);
    if (totalUah <= safe.greenMaxUah) return "green";
    if (totalUah <= safe.yellowMaxUah) return "yellow";
    return "red";
  }

  function formatUah(value) {
    return `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 }).format(value)} грн`;
  }

  function formatConvertedPrice(price, settings, shippingUsd = 0) {
    const min = calculateTotalUah(price.minUsd, settings, shippingUsd);
    const max = calculateTotalUah(price.maxUsd, settings, shippingUsd);
    return price.isRange ? `≈ ${formatUah(min)} – ${formatUah(max)}` : `≈ ${formatUah(max)}`;
  }

  function buildOlxSearchQuery(title, includeProcessor = true) {
    let query = String(title || "")
      .replace(/^\s*new listing\s*/i, "")
      .replace(/[([{]\s*#?\d+\s*[)\]}]/g, " ")
      .replace(/#\d+\b/g, " ")
      .replace(/^\s*(?:lot\s+(?:of\s+)?)?\d{1,3}\s*[x×]?\s+(?=(?:acer|apple|asus|dell|fujitsu|gigabyte|hp|lenovo|microsoft|msi|panasonic|razer|samsung|sony|toshiba)\b)/i, "")
      .replace(/\b(?:free|fast)\s+shipping\b/gi, " ")
      .replace(/\b(?:seller\s+)?refurbished\b/gi, " ")
      .replace(/\b(?:grade|condition)\s*[abc][+-]?\b/gi, " ")
      .replace(/\b(?:read(?: the)? description|see description)\b/gi, " ")
      .replace(/\b(?:lot(?:\s+of)?|laptops?|notebooks?|ultrabooks?|computers?|pcs?)\b/gi, " ")
      .replace(/\b(?:for\s+parts|parts\s+only|as\s+is|no\s+charger|no\s+battery|no\s+os)\b/gi, " ")
      .replace(/\b(?:windows\s*(?:10|11)?(?:\s+pro)?|win\s*(?:10|11)|chrome\s*os)\b/gi, " ")
      .replace(/\b\d+(?:\.\d+)?\s*(?:gb|tb)\b/gi, " ")
      .replace(/\b\d{1,2}(?:\.\d)?\s*(?:inch(?:es)?|in\.?|[\"″])/gi, " ")
      .replace(/\b(?:\d{3,4}\s*[x×]\s*\d{3,4}|4k|2k|1080p|1440p|2160p|hd|fhd|qhd|uhd|ips|oled|touchscreen|touch)\b/gi, " ")
      .replace(/\b(?:ram|memory|ssd|hdd|nvme|emmc|ddr[345]|pcie)\b/gi, " ")
      .replace(/\b(?:nvidia\s+)?(?:geforce\s+)?(?:rtx|gtx)\s*\d{3,4}(?:\s*ti)?\b/gi, " ")
      .replace(/\b(?:amd\s+)?radeon\s+(?:rx\s*)?\d{3,4}[a-z]*\b/gi, " ")
      .replace(/[|•]+/g, " ")
      .replace(/[;,]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const processorPattern = /\b(?:(?:intel\s+)?core\s+ultra\s+[3579]\s+\d{3,5}[a-z0-9]{0,4}|(?:intel\s+)?core\s+i[3579](?:[-\s]\d{3,5}[a-z0-9]{0,4})?|i[3579]-\d{3,5}[a-z0-9]{0,4}|(?:amd\s+)?ryzen\s+[3579](?:\s+pro)?\s+\d{3,5}[a-z0-9]{0,4}|(?:intel\s+)?(?:celeron|pentium)\s+[a-z]?\d{3,5}[a-z0-9]{0,3}|(?:apple\s+)?m[1-5](?:\s+(?:pro|max|ultra))?|(?:qualcomm\s+)?snapdragon\s+x\s+(?:elite|plus))\b/i;
    const processor = query.match(processorPattern);
    if (processor && typeof processor.index === "number") {
      const tail = query.slice(processor.index + processor[0].length);
      if (!/\b(?:acer|apple|asus|dell|hp|lenovo|microsoft|msi|razer|samsung|toshiba)\b/i.test(tail)) {
        query = query.slice(0, processor.index + processor[0].length).trim();
      }
    }

    if (!includeProcessor && processor) query = query.replace(processor[0], " ").replace(/\s+/g, " ").trim();
    return (query || "ноутбук").slice(0, 140).trim();
  }

  function buildOlxSearchUrl(title) {
    const pathQuery = encodeURIComponent(buildOlxSearchQuery(title)).replace(/%20/g, "-");
    return `https://www.olx.ua/uk/elektronika/noutbuki-i-aksesuary/noutbuki/q-${pathQuery}/`;
  }

  function buildEbaySoldSearchQuery(title) {
    const source = String(title || "");
    const baseQuery = buildOlxSearchQuery(source);
    const additions = [];

    // The OLX query intentionally stops after the processor. For sold eBay
    // comparisons, keep the first two capacities as the usual RAM/SSD pair.
    const capacitySource = source.replace(/\b(?:rtx|gtx|radeon(?:\s+rx)?)\s*\d{3,4}[a-z]*(?:\s*ti)?\s+\d+\s*gb\b/gi, " ");
    const capacities = capacitySource.match(/\b\d+(?:\.\d+)?\s*(?:gb|tb)\b/gi) || [];
    for (const capacity of capacities) {
      const normalized = capacity.replace(/\s+/g, "").toUpperCase();
      if (!additions.some((value) => value.toUpperCase() === normalized)) additions.push(normalized);
      if (additions.length === 2) break;
    }

    const gpu = source.match(/\b(?:(?:nvidia\s+)?(?:geforce\s+)?(?:rtx|gtx)\s*\d{3,4}(?:\s*ti)?|(?:amd\s+)?radeon\s+(?:rx\s*)?\d{3,4}[a-z]*)\b/i);
    if (gpu) additions.push(gpu[0].replace(/\s+/g, " ").trim());

    return [baseQuery, ...additions]
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180);
  }

  function buildEbaySoldSearchUrl(title) {
    const query = encodeURIComponent(buildEbaySoldSearchQuery(title));
    return `https://www.ebay.com/sch/i.html?_nkw=${query}&_sacat=177&LH_Sold=1&LH_Complete=1&_sop=13`;
  }

  function assessListingRisk(text) {
    const source = String(text || "")
      .replace(/[\u00a0\u202f]/g, " ")
      // Seller descriptions often explicitly confirm the absence of defects.
      // Remove those positive phrases before applying keyword-based warnings.
      .replace(/\bno\s+cracks?\s+or\s+dead\s+pixels?\b/gi, " ")
      .replace(/\b(?:no|without)\s+(?:visible\s+)?(?:cracks?|dead\s+pixels?|liquid\s+damage|water\s+damage)\b/gi, " ");
    const rules = [
      { code: "parts", severity: "high", label: "На запчастини", pattern: /\b(?:for\s+parts|parts\s+only|parts\s+or\s+repair|not\s+working)\b/i },
      { code: "power", severity: "high", label: "Не вмикається", pattern: /\b(?:does\s+not\s+turn\s+on|no\s+power(?!\s+(?:adapter|supply|cord))|does\s+not\s+power\s+on|won['’]?t\s+(?:power|turn)\s+on|dead\s+unit)\b/i },
      {
        code: "locks",
        severity: "high",
        label: "Можливе блокування",
        pattern: /\b(?:(?:bios|uefi|firmware|admin|icloud|activation|mdm)\s*(?:lock(?:ed)?|password)|(?:lock(?:ed)?|password)\s*(?:bios|uefi|firmware|admin|icloud|activation|mdm)|computrace|autopilot\s+lock(?:ed)?)\b/i,
        excludePattern: /\b(?:no|without)\s+(?:bios|uefi|firmware|admin|icloud|activation|mdm)\s+(?:lock|password)\b/i
      },
      { code: "broken", severity: "high", label: "Зламаний / as is", pattern: /\b(?:broken|as[\s-]+is|liquid\s+damage(?:d)?|water\s+damage(?:d)?)\b/i },
      { code: "untested", severity: "medium", label: "Не протестований", pattern: /\b(?:untested|not\s+tested|unable\s+to\s+test|unknown\s+condition)\b/i },
      { code: "description", severity: "medium", label: "Перевір опис", pattern: /\b(?:read\s+(?:the\s+)?description|see\s+description)\b/i },
      { code: "storage", severity: "medium", label: "Без накопичувача", pattern: /\b(?:no|missing|without)\s+(?:ssd|hdd|hard\s+drive|storage)\b/i },
      { code: "memory", severity: "medium", label: "Без RAM", pattern: /\b(?:no|missing|without)\s+(?:ram|memory)\b/i },
      { code: "swollen", severity: "high", label: "Здута батарея", pattern: /\b(?:(?:swollen|swelling|bloated)\s+battery|battery\s+(?:is\s+)?(?:swollen|swelling|bloated))\b/i },
      { code: "battery", severity: "medium", label: "Проблема з батареєю", pattern: /\b(?:(?:no|missing|without|bad|dead)\s+battery|battery\s+(?:swollen|swelling|bloated|dead|bad|issue|fault|not\s+included|does\s+not\s+hold\s+(?:a\s+)?charge))\b/i },
      { code: "display", severity: "medium", label: "Дефект екрана", pattern: /\b(?:screen\s+(?:issue|damage|crack(?:ed)?|lines?)|cracked\s+screen|dead\s+pixels?|white\s+spots?|lcd\s+(?:issue|damage|lines?))\b/i },
      { code: "hinge", severity: "medium", label: "Проблема з петлями", pattern: /\b(?:broken|damaged|loose)\s+hinge(?:s)?\b|\bhinge(?:s)?\s+(?:broken|damaged|loose)\b/i },
      { code: "keyboard", severity: "medium", label: "Проблема з клавіатурою", pattern: /\b(?:missing\s+keys?|keyboard\s+(?:issue|fault|not\s+working)|keys?\s+not\s+working)\b/i },
      { code: "charger", severity: "medium", label: "Без зарядного", pattern: /\b(?:no|missing|without)\s+(?:charger|ac\s+adapter|power\s+adapter)\b/i },
      { code: "returns", severity: "medium", label: "Без повернення", pattern: /\b(?:no\s+returns?|final\s+sale)\b/i },
      { code: "lot", severity: "medium", label: "Лот із кількох пристроїв", pattern: /\b(?:lot\s+of\s+\d+|\d+\s*[x×]\s+(?:laptops?|notebooks?|computers?|pcs?))\b/i }
    ];

    const clauses = source.split(/(?:[.!?;\n]+|\bbut\b|\bhowever\b)/i).map(s => s.trim()).filter(Boolean);
    const flags = rules.flatMap(rule => {
      const evidence = clauses.find(clause => {
        const checked = clause
          .replace(/\b(?:no|without)\s+(?:bios|uefi|firmware|admin|icloud|activation|mdm)\s+(?:lock(?:ed)?|password)\b/gi, " ")
          .replace(/\b(?:no|without)\s+broken\s+parts\b/gi, " ")
          .replace(/\b(?:not|never)\s+(?:broken|damaged|cracked)\b/gi, " ");
        return rule.pattern.test(checked);
      });
      if (rule.code === "battery" && /\b(?:swollen|swelling|bloated)\b/i.test(evidence || "")) return [];
      return evidence ? [{ code: rule.code, severity: rule.severity, label: rule.label, evidence }] : [];
    });
    const level = flags.some((flag) => flag.severity === "high")
      ? "high"
      : flags.length ? "medium" : "low";

    return { level, flags };
  }

  function extractSellerDescriptionInfo(text) {
    const source = String(text || "")
      .replace(/\r/g, "\n")
      .replace(/[\u00a0\u202f]/g, " ");
    const lines = source
      .split(/\n+/)
      .map((line) => line.replace(/^[\s\-*•●▪]+|\s+$/g, "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .filter((line) => !/^(?:item description from the seller|about this item|seller assumes all responsibility for this listing|see full description)$/i.test(line));

    const result = {
      highlights: [],
      battery: [],
      power: [],
      included: [],
      notIncluded: [],
      specs: []
    };

    function addUnique(list, value, limit = 8) {
      const cleaned = String(value || "").replace(/\s+/g, " ").trim();
      if (!cleaned || cleaned.length > 700 || list.length >= limit) return;
      const normalized = cleaned.toLocaleLowerCase();
      if (!list.some((item) => String(item).toLocaleLowerCase() === normalized)) list.push(cleaned);
    }

    function sentences(value) {
      const matches = String(value || "").split(/(?<=[.!?])\s+(?=[A-Z])/);
      return matches.map((sentence) => sentence.trim()).filter(Boolean);
    }

    function classifyImportantText(value) {
      for (const fragment of sentences(value)) {
        if (/\b(?:battery|cycle\s+count|full\s+charge\s+capacity|design\s+capacity)\b/i.test(fragment)) {
          addUnique(result.battery, fragment, 5);
        }
        if (/\b(?:charger|power\s+cord|power\s+supply|ac\s+adapter|power\s+adapter)\b/i.test(fragment)) {
          addUnique(result.power, fragment, 5);
        }
        if (/\b(?:fully\s+functional|function(?:al|ality)|works?|working|wear|scratch(?:es|ed)?|scuff(?:s|ed)?|dent(?:s|ed)?|damage(?:d)?|crack(?:s|ed)?|dead\s+pixels?|keyboard|trackpad|touchpad|touchscreen|hinge|fingerprint|webcam|camera|speaker(?:s)?|display|screen|port(?:s)?)\b/i.test(fragment)) {
          addUnique(result.highlights, fragment, 8);
        }
      }
    }

    function sectionHeading(line) {
      const normalized = line.replace(/[\u2018\u2019]/g, "'");
      const patterns = [
        { section: "specs", pattern: /^(?:specifications?|specs)\s*:?\s*(.*)$/i },
        { section: "included", pattern: /^(?:what'?s\s+included|what\s+is\s+included|included|in\s+the\s+box)\s*:?\s*(.*)$/i },
        { section: "notIncluded", pattern: /^(?:what'?s\s+not\s+included|what\s+is\s+not\s+included|not\s+included|not\s+in\s+the\s+box)\s*:?\s*(.*)$/i }
      ];
      for (const candidate of patterns) {
        const match = normalized.match(candidate.pattern);
        if (match) return { section: candidate.section, remainder: match[1].trim() };
      }
      return null;
    }

    function addSpecValue(label, value) {
      if (result.specs.length >= 14) return false;
      const cleanLabel = String(label || "").trim();
      const cleanValue = String(value || "").trim();
      if (!cleanLabel || !cleanValue) return false;
      const signature = `${cleanLabel}: ${cleanValue}`.toLocaleLowerCase();
      if (!result.specs.some((spec) => `${spec.label}: ${spec.value}`.toLocaleLowerCase() === signature)) {
        result.specs.push({ label: cleanLabel, value: cleanValue });
      }
      return true;
    }

    function addSpec(line) {
      const match = line.match(/^([^:]{2,45}):\s*(.+)$/);
      if (!match) return false;
      const label = match[1].trim();
      const value = match[2].trim();
      const signature = `${label}: ${value}`.toLocaleLowerCase();
      if (!result.specs.some((spec) => `${spec.label}: ${spec.value}`.toLocaleLowerCase() === signature)) {
        addSpecValue(label, value);
      }
      return true;
    }

    let pendingSpecLabel = "";
    function consumeSectionLine(section, line) {
      if (!line) return;
      if (section === "specs") {
        const labelOnly = line.match(/^([^:]{2,45}):$/);
        if (labelOnly) {
          pendingSpecLabel = labelOnly[1].trim();
          return;
        }
        if (pendingSpecLabel && !line.includes(":")) {
          addSpecValue(pendingSpecLabel, line);
          pendingSpecLabel = "";
          return;
        }
        pendingSpecLabel = "";
        addSpec(line);
        return;
      }
      if (section === "included") addUnique(result.included, line, 10);
      if (section === "notIncluded") addUnique(result.notIncluded, line, 10);
      classifyImportantText(line);
    }

    let section = null;
    for (const line of lines) {
      classifyImportantText(line);
      const heading = sectionHeading(line);
      if (heading) {
        section = heading.section;
        consumeSectionLine(section, heading.remainder);
        continue;
      }

      const conditionMatch = line.match(/^condition\s*:\s*(.+)$/i);
      if (conditionMatch) {
        section = null;
        classifyImportantText(conditionMatch[1]);
        continue;
      }

      if (/^(?:shipping|returns?|payment|warranty|terms|contact)(?:\s+(?:policy|information))?\s*:/i.test(line)) section = null;
      if (!section && /^(?:processor|cpu|graphics|gpu|memory|ram|storage|display|screen|bios|operating system)\s*:/i.test(line)) addSpec(line);
      if (section) {
        consumeSectionLine(section, line);
      } else {
        classifyImportantText(line);
      }
    }

    return result;
  }

  function keywordList(value) {
    return String(value || "")
      .split(/[,;\n]/)
      .map((keyword) => keyword.trim().toLocaleLowerCase())
      .filter(Boolean);
  }

  function matchesKeywords(title, keywords) {
    const normalizedTitle = String(title || "").toLocaleLowerCase();
    return keywordList(keywords).some((keyword) => normalizedTitle.includes(keyword));
  }

  function extractItemId(url) {
    const value = String(url || "");
    const pathMatch = value.match(/\/itm\/(?:[^/?#]+\/)?([0-9]{9,15})(?:[/?#]|$)/i);
    if (pathMatch) return pathMatch[1];

    const queryMatch = value.match(/[?&](?:item|itemid|item_id|_itemid)=([0-9]{9,15})(?:[&#]|$)/i);
    return queryMatch ? queryMatch[1] : null;
  }

  global.EbayLaptopCore = Object.freeze({
    DEFAULTS,
    sanitizeSettings,
    parseLocalizedNumber,
    parseUsdPrice,
    parseShippingUsd,
    calculateTotalUah,
    classifyTotalUah,
    formatUah,
    formatConvertedPrice,
    buildOlxSearchQuery,
    buildOlxSearchUrl,
    buildEbaySoldSearchQuery,
    buildEbaySoldSearchUrl,
    assessListingRisk,
    extractSellerDescriptionInfo,
    keywordList,
    matchesKeywords,
    extractItemId
  });
})(globalThis);
