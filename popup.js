(function initPopup() {
  "use strict";

  const Core = globalThis.EbayLaptopCore;
  const SETTINGS_KEY = Core.SETTINGS_KEY;
  const SAVE_DELAY = 400;
  const RESET_CONFIRM_TIMEOUT = 3000;
  const form = document.getElementById("settingsForm");
  const status = document.getElementById("status");
  const enabledToggle = document.getElementById("enabled");
  const resetButton = document.getElementById("resetButton");
  const controls = [enabledToggle, document.getElementById("settingsFields"), resetButton];
  let loaded = false;
  let writing = false;
  let pendingWrite = false;
  let saveTimer = null;
  let resetTimer = null;

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
    "showItemPagePanel",
    "hideRed",
    "hideExcluded"
  ];

  function report(message, error = false) {
    status.textContent = message;
    status.dataset.error = String(error);
  }

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

  function invalidFieldMessage() {
    const invalid = form.querySelector(":invalid:not(fieldset)");
    return invalid ? invalid.validationMessage || "Перевірте значення." : "";
  }

  // Writes are serialized; a change made while a write is in flight is saved right after it.
  function save(successMessage = "Збережено. Зміни вже застосовано до eBay.") {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!loaded) return;
    const invalid = invalidFieldMessage();
    if (invalid) {
      report(`Не збережено: ${invalid}`, true);
      return;
    }
    if (writing) {
      pendingWrite = true;
      return;
    }

    writing = true;
    chrome.storage.local.set({ [SETTINGS_KEY]: readFormValues() }, () => {
      writing = false;
      if (chrome.runtime.lastError) {
        pendingWrite = false;
        report("Не вдалося зберегти: " + chrome.runtime.lastError.message, true);
        return;
      }
      if (pendingWrite) {
        pendingWrite = false;
        save(successMessage);
        return;
      }
      report(successMessage);
    });
  }

  function scheduleSave() {
    if (!loaded) return;
    clearTimeout(saveTimer);
    const invalid = invalidFieldMessage();
    if (invalid) {
      saveTimer = null;
      report(`Не збережено: ${invalid}`, true);
      return;
    }
    report("Зберігаю…");
    saveTimer = setTimeout(() => save(), SAVE_DELAY);
  }

  form.addEventListener("input", () => {
    updatePreview();
    scheduleSave();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    save();
  });

  enabledToggle.addEventListener("change", () => {
    save(enabledToggle.checked ? "Розширення увімкнено." : "Розширення вимкнено.");
  });

  // The popup closes as soon as it loses focus; do not lose a change that is still waiting.
  window.addEventListener("pagehide", () => {
    if (saveTimer !== null) save();
  });

  function cancelResetConfirmation() {
    clearTimeout(resetTimer);
    resetTimer = null;
    resetButton.textContent = "Типові значення";
    delete resetButton.dataset.confirm;
  }

  resetButton.addEventListener("click", () => {
    if (!resetButton.dataset.confirm) {
      resetButton.dataset.confirm = "true";
      resetButton.textContent = "Натисніть ще раз для скидання";
      resetTimer = setTimeout(cancelResetConfirmation, RESET_CONFIRM_TIMEOUT);
      return;
    }
    cancelResetConfirmation();
    setFormValues({ ...Core.DEFAULTS, enabled: enabledToggle.checked });
    save("Типові значення відновлено й збережено.");
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
      save("Налаштування імпортовано й збережено.");
    } catch {
      report("Не вдалося імпортувати файл налаштувань.", true);
    }
    importFile.value = "";
  });

  chrome.storage.local.get([SETTINGS_KEY], (stored) => {
    if (chrome.runtime.lastError) {
      report("Не вдалося прочитати налаштування. Закрийте меню й відкрийте знову.", true);
      return;
    }
    setFormValues(stored[SETTINGS_KEY] || Core.DEFAULTS);
    loaded = true;
    controls.forEach(element => { element.disabled = false; });
    report("Зміни зберігаються автоматично.");
  });
})();
