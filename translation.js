(function initEbayLaptopTranslation(global) {
  "use strict";

  const LANGUAGE_PAIR = Object.freeze({
    sourceLanguage: "en",
    targetLanguage: "uk"
  });

  let translator = null;
  let translatorPromise = null;

  function translationError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function reportProgress(callback, value) {
    if (typeof callback !== "function") return;
    try {
      callback(value);
    } catch {
      // UI progress must never interrupt the translation itself.
    }
  }

  async function getEnglishToUkrainianTranslator(onDownloadProgress) {
    if (translator) return translator;
    if (translatorPromise) return translatorPromise;

    const TranslatorApi = global.Translator;
    if (!TranslatorApi
      || typeof TranslatorApi.availability !== "function"
      || typeof TranslatorApi.create !== "function") {
      throw translationError("api-unavailable", "Chrome Translator API is unavailable");
    }

    translatorPromise = (async () => {
      const availability = await TranslatorApi.availability(LANGUAGE_PAIR);
      if (availability === "unavailable") {
        throw translationError("language-pair-unavailable", "English to Ukrainian translation is unavailable");
      }

      const created = await TranslatorApi.create({
        ...LANGUAGE_PAIR,
        monitor(monitor) {
          monitor.addEventListener("downloadprogress", (event) => {
            const loaded = Number(event.loaded);
            reportProgress(onDownloadProgress, Number.isFinite(loaded) ? loaded : 0);
          });
        }
      });

      if (!created || typeof created.translate !== "function") {
        throw translationError("creation-failed", "Chrome did not create a translator");
      }
      translator = created;
      return translator;
    })().catch((error) => {
      translatorPromise = null;
      throw error;
    });

    return translatorPromise;
  }

  function normalizedDescriptionInfo(info) {
    const source = info && typeof info === "object" ? info : {};
    const stringList = (value) => Array.isArray(value)
      ? value.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    const specs = Array.isArray(source.specs)
      ? source.specs
        .map((spec) => ({
          label: String(spec?.label || "").trim(),
          value: String(spec?.value || "").trim()
        }))
        .filter((spec) => spec.label && spec.value)
      : [];

    return {
      highlights: stringList(source.highlights),
      battery: stringList(source.battery),
      power: stringList(source.power),
      included: stringList(source.included),
      notIncluded: stringList(source.notIncluded),
      specs
    };
  }

  async function translateSellerDescriptionInfo(info, activeTranslator, onProgress) {
    if (!activeTranslator || typeof activeTranslator.translate !== "function") {
      throw translationError("invalid-translator", "A translator with a translate method is required");
    }

    const source = normalizedDescriptionInfo(info);
    const values = [
      ...source.highlights,
      ...source.battery,
      ...source.power,
      ...source.included,
      ...source.notIncluded,
      ...source.specs.flatMap((spec) => [spec.label, spec.value])
    ];
    const uniqueValues = Array.from(new Set(values));
    const translatedValues = new Map();

    reportProgress(onProgress, { completed: 0, total: uniqueValues.length });
    for (let index = 0; index < uniqueValues.length; index += 1) {
      const original = uniqueValues[index];
      const translatedValue = String(await activeTranslator.translate(original) || "").trim();
      translatedValues.set(original, translatedValue || original);
      reportProgress(onProgress, { completed: index + 1, total: uniqueValues.length });
    }

    const translated = (value) => translatedValues.get(value) || value;
    return {
      highlights: source.highlights.map(translated),
      battery: source.battery.map(translated),
      power: source.power.map(translated),
      included: source.included.map(translated),
      notIncluded: source.notIncluded.map(translated),
      specs: source.specs.map((spec) => ({
        label: translated(spec.label),
        value: translated(spec.value)
      }))
    };
  }

  global.EbayLaptopTranslation = Object.freeze({
    LANGUAGE_PAIR,
    getEnglishToUkrainianTranslator,
    translateSellerDescriptionInfo
  });
})(globalThis);
