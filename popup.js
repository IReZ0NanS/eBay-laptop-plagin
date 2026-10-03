(function initPopup() {
  "use strict";

  const Core = globalThis.EbayLaptopCore;
  const SETTINGS_KEY = "ebayLaptopHelperSettings";
  const form = document.getElementById("settingsForm");
  const status = document.getElementById("status");
  const controls = ["enabled", "settingsFields", "resetButton", "saveButton"].map(id => document.getElementById(id));
  let loaded = false;
  let writing = false;
  function report(message, error = false) {
    status.textContent = message;
    status.dataset.error = String(error);
  }
  function setBusy(busy) {
    writing = busy;
    controls.forEach(element => { element.disabled = busy || !loaded; });
  }
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
    "showConvertedPrice",
    "showSoldSearch",
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
    const green = document.getElementById("greenMaxUah");
    const yellow = document.getElementById("yellowMaxUah");
    yellow.setCustomValidity(Number(yellow.value) < Number(green.value) ? "Жовта межа має бути не меншою за зелену." : "");
    const values = readFormValues();
    document.getElementById("markupFactor").textContent = (1 + values.markupPercent / 100)
      .toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
    document.getElementById("feePreview").textContent = values.fixedFeeUsd.toLocaleString("uk-UA");
    document.getElementById("ratePreview").textContent = values.usdRate.toLocaleString("uk-UA");
    document.getElementById("examplePreview").textContent = `Наприклад, $300 + $20 доставка → ${Core.formatConvertedPrice({ minUsd: 300, maxUsd: 300, isRange: false }, values, 20)}`;
  }

  form.addEventListener("input", () => {
    updatePreview();
    report("Є незбережені зміни.");
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!loaded || writing) return;
    const values = readFormValues();
    setBusy(true);
    chrome.storage.local.set({ [SETTINGS_KEY]: values }, () => {
      setBusy(false);
      if (chrome.runtime.lastError) {
        report("Не вдалося зберегти: " + chrome.runtime.lastError.message, true);
        return;
      }
      setFormValues(values);
      report("Збережено. Зміни вже застосовано до eBay.");
    });
  });

  document.getElementById("enabled").addEventListener("change", event => {
    if (!loaded || writing) return;
    const enabled = event.target.checked;
    setBusy(true);
    chrome.storage.local.get([SETTINGS_KEY], stored => {
      if (chrome.runtime.lastError) {
        event.target.checked = !enabled;
        setBusy(false);
        report("Не вдалося прочитати налаштування.", true);
        return;
      }
      const values = Core.sanitizeSettings({ ...stored[SETTINGS_KEY], enabled });
      chrome.storage.local.set({ [SETTINGS_KEY]: values }, () => {
        setBusy(false);
        if (chrome.runtime.lastError) event.target.checked = !enabled;
        report(chrome.runtime.lastError ? "Не вдалося змінити стан розширення." : enabled ? "Розширення увімкнено." : "Розширення вимкнено.", Boolean(chrome.runtime.lastError));
      });
    });
  });

  document.getElementById("resetButton").addEventListener("click", () => {
    setFormValues({ ...Core.DEFAULTS, enabled: document.getElementById("enabled").checked });
    report("Типові значення відновлено. Натисніть «Зберегти».");
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
      report("Файл прочитано. Перевірте значення й натисніть «Зберегти».");
    } catch { report("Не вдалося імпортувати файл налаштувань.", true); }
    importFile.value = "";
  });

  chrome.storage.local.get([SETTINGS_KEY], (stored) => {
    if (chrome.runtime.lastError) {
      report("Не вдалося прочитати налаштування. Закрийте меню й відкрийте знову.", true);
      return;
    }
    setFormValues(stored[SETTINGS_KEY] || Core.DEFAULTS);
    loaded = true;
    setBusy(false);
    report("Налаштування завантажено.");
  });
})();
