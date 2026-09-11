(function (global) {
  "use strict";
  const fields = { ram: "RAM", storage: "Накопичувач", cpu: "Процесор", gpu: "Відеокарта" };
  function facts(text) {
    const source = String(text || "")
      .replace(/\b(RAM|Memory(?: Size)?|Storage|SSD|HDD|Processor|GPU)\s*:?\s*\n\s*/gi, "$1: ")
      .replace(/[\r\n]+/g, "; ");
    const out = {};
    const cpu = source.match(/\b(?:i[3579][-\s]\d{4,5}[a-z0-9]*|(?:core\s+)?ultra\s+[3579]\s+\d{3}[a-z]*|ryzen\s+[3579](?:\s+pro)?\s+\d{4}[a-z]*|m[1-5](?:\s+(?:pro|max|ultra))?)\b/i);
    const gpu = source.match(/\b(?:rtx|gtx)\s*\d{3,4}(?:\s*ti)?\b/i);
    if (cpu) out.cpu = cpu[0].toUpperCase().replace(/\s+/g, " ").replace(/^CORE /, "").replace(/^(I[3579]) /, "$1-");
    if (gpu) out.gpu = gpu[0].toUpperCase().replace(/\s+/g, " ");
    const ram = source.match(/\b(\d+)\s*GB\s*(?:of\s+)?(?:RAM|DDR[345]|LPDDR[345X]*|memory)\b|\b(?:RAM|memory)\s*:?\s*(\d+)\s*GB\b/i);
    const disk = source.match(/\b(\d+(?:\.\d+)?)\s*(GB|TB)\s*(?:(?:NVMe|PCIe|M\.2)\s+)*(?:SSD|HDD|hard\s+drive|storage)\b|\b(?:storage|SSD|HDD)\s*:?\s*(\d+(?:\.\d+)?)\s*(GB|TB)\b/i);
    if (ram) out.ram = `${Number(ram[1] || ram[2])} GB`;
    if (disk) out.storage = `${Number(disk[1] || disk[3]) * ((disk[2] || disk[4]).toUpperCase() === "TB" ? 1024 : 1)} GB`;
    const capacityText = source.replace(/\b(?:rtx|gtx)\s*\d{3,4}(?:\s*ti)?\s+\d+\s*GB\b/gi, " ");
    const pair = capacityText.match(/\b(\d+)\s*GB\s+(?:[|/,]\s*)?(\d+(?:\.\d+)?)\s*(GB|TB)\b/i);
    if (!out.ram && pair && Number(pair[1]) <= 128 && Number(pair[2]) * (pair[3].toUpperCase() === "TB" ? 1024 : 1) >= 128) out.ram = `${Number(pair[1])} GB`;
    if (/\b(?:no|without|missing)\s+(?:RAM|memory)\b|\b(?:RAM|memory)\s+(?:removed|not included)\b/i.test(source)) out.ram = "Відсутня";
    if (/\b(?:no|without|missing)\s+(?:SSD|HDD|storage|hard drive)\b|\b(?:SSD|HDD|storage)\s+(?:removed|not included)\b/i.test(source)) out.storage = "Відсутній";
    return out;
  }
  function inspect(sources) {
    const parsed = sources.map(source => ({ ...source, facts: facts(source.text) }));
    const conflicts = [];
    for (const [key, label] of Object.entries(fields)) {
      const values = parsed.filter(source => source.facts[key]).map(source => ({ source: source.label, value: source.facts[key] }));
      if (new Set(values.map(value => value.value)).size > 1) conflicts.push({ key, label, values });
    }
    const description = sources.filter(source => source.kind !== "title").map(source => source.text).join("\n");
    const checks = [
      { label: "Стан батареї", found: /\b(?:battery.{0,60}(?:\d+\s*%|health|cycles?|dead|swollen|holds?\s+(?:a\s+)?charge)|cycle count|full charge capacity)\b/i.test(description), question: "Could you share the battery health percentage and cycle count, or a battery report?" },
      { label: "BIOS / MDM / Autopilot", found: /\b(?:bios|uefi).{0,30}(?:password|lock)/i.test(description) && /\b(?:mdm|autopilot|activation lock).{0,30}(?:no|not|free|removed|locked)|\b(?:no|without).{0,15}(?:mdm|autopilot|activation lock)/i.test(description), question: "Is this laptop free of BIOS/UEFI passwords, MDM, Windows Autopilot and activation locks?" },
      { label: "Зарядний пристрій", found: /\b(?:charger|ac adapter|power adapter|power cord)\b/i.test(description), question: "Is a compatible charger included, and what is its wattage?" },
      { label: "Стан екрана", found: /\b(?:screen|display|lcd|pixels).{0,70}(?:crack|damage|spot|line|work|good|perfect)|\b(?:no|without).{0,20}(?:cracks|dead pixels)/i.test(description), question: "Does the screen have any cracks, dead pixels, bright spots or lines?" },
      { label: "Клавіатура й порти", found: /\b(?:keyboard|keys).{0,50}(?:work|test|functional)/i.test(description) && /\bports?.{0,50}(?:work|test|functional)/i.test(description), question: "Have all keys, USB ports and charging ports been tested and confirmed working?" }
    ];
    const questions = checks.filter(check => !check.found).map(check => check.question);
    for (const conflict of conflicts) questions.push(`Could you confirm the actual ${conflict.key.toUpperCase()} configuration? The listing contains conflicting values: ${conflict.values.map(v => v.value).join(" / ")}.`);
    return { conflicts, checks, questions };
  }
  global.EbayLaptopInspection = Object.freeze({ facts, inspect });
})(globalThis);
