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
      if (chrome.runtime.lastError) {
        status.textContent = "Не вдалося зберегти: " + chrome.runtime.lastError.message;
        return;
      }
      setFormValues(values);
      status.textContent = "Збережено — сторінка оновиться автоматично.";
      setTimeout(() => { status.textContent = ""; }, 2600);
    });
  });

  document.getElementById("enabled").addEventListener("change", event => {
    const enabled = event.target.checked;
    chrome.storage.local.get([SETTINGS_KEY], stored => {
      if (chrome.runtime.lastError) { status.textContent = "Не вдалося прочитати налаштування."; return; }
      const values = Core.sanitizeSettings({ ...stored[SETTINGS_KEY], enabled });
      chrome.storage.local.set({ [SETTINGS_KEY]: values }, () => {
        status.textContent = chrome.runtime.lastError ? "Не вдалося змінити стан розширення." : enabled ? "Розширення увімкнено." : "Розширення вимкнено.";
      });
    });
  });

  document.getElementById("resetButton").addEventListener("click", () => {
    setFormValues(Core.DEFAULTS);
    status.textContent = "Типові значення відновлено. Натисніть «Зберегти».";
  });

  document.getElementById("exportButton").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ version: 1, settings: readFormValues() }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "ebay-helper-settings.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  const importFile = document.getElementById("importFile");
  document.getElementById("importButton").addEventListener("click", () => importFile.click());
  importFile.addEventListener("change", async () => {
    const file = importFile.files[0];
    if (!file) return;
    try {
      if (file.size > 100000) throw new Error("Завеликий файл");
      const imported = JSON.parse(await file.text());
      if (imported.version !== 1 || !imported.settings || typeof imported.settings !== "object" || Array.isArray(imported.settings)) throw new Error("Невідомий формат");
      setFormValues(imported.settings);
      status.textContent = "Налаштування прочитано. Перевірте значення й натисніть «Зберегти».";
    } catch { status.textContent = "Не вдалося імпортувати файл налаштувань."; }
    importFile.value = "";
  });

  chrome.storage.local.get([SETTINGS_KEY], (stored) => {
    setFormValues(stored[SETTINGS_KEY] || Core.DEFAULTS);
  });
})();
