(function initPopup() {
  "use strict";

  const Core = globalThis.EbayLaptopCore;
  const SETTINGS_KEY = "ebayLaptopHelperSettings";
  const form = document.getElementById("settingsForm");
  const status = document.getElementById("status");
  const fields = [
    "enabled",
    "usdRate",
    "markupPercent",
    "fixedFeeUsd",
    "greenMaxUah",
    "yellowMaxUah",
    "greenTitleColor",
    "yellowTitleColor",
    "redTitleColor",
    "preferredKeywords",
    "excludedKeywords",
    "markNewItems",
    "showConvertedPrice",
    "showSoldSearch",
    "showRiskBadges",
    "showItemPagePanel"
  ];

  function setFormValues(values) {
    const safe = Core.sanitizeSettings(values);
    for (const fieldName of fields) {
      const element = document.getElementById(fieldName);
      if (element.type === "checkbox") element.checked = safe[fieldName];
      else element.value = safe[fieldName];
    }
    updatePreview();
  }

  function readFormValues() {
    const raw = {};
    for (const fieldName of fields) {
      const element = document.getElementById(fieldName);
      raw[fieldName] = element.type === "checkbox" ? element.checked : element.value;
    }
    return Core.sanitizeSettings(raw);
  }

  function updatePreview() {
    const values = readFormValues();
    document.getElementById("markupFactor").textContent = (1 + values.markupPercent / 100)
      .toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
    document.getElementById("feePreview").textContent = values.fixedFeeUsd.toLocaleString("uk-UA");
    document.getElementById("ratePreview").textContent = values.usdRate.toLocaleString("uk-UA");
    document.getElementById("examplePreview").textContent = `Наприклад, $300 + $20 доставка → ${Core.formatConvertedPrice({ minUsd: 300, maxUsd: 300, isRange: false }, values, 20)}`;
  }

  form.addEventListener("input", updatePreview);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = readFormValues();
    chrome.storage.local.set({ [SETTINGS_KEY]: values }, () => {
      setFormValues(values);
      status.textContent = "Збережено — сторінка оновиться автоматично.";
      setTimeout(() => { status.textContent = ""; }, 2600);
    });
  });

  document.getElementById("resetButton").addEventListener("click", () => {
    setFormValues(Core.DEFAULTS);
    status.textContent = "Типові значення відновлено. Натисніть «Зберегти».";
  });

  chrome.storage.local.get([SETTINGS_KEY], (stored) => {
    setFormValues(stored[SETTINGS_KEY] || Core.DEFAULTS);
  });
})();
