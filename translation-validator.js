(function () {
  const FORMAT = "register-reference-translation";
  const DATA_ROOTS = new Set(["architecture", "controllers", "sensors", "soc"]);
  const LOCALE_PATTERN = /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2}|-\d{3})?$/;

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
  }

  function isTranslationDocument(value) {
    return isObject(value) && value.format === FORMAT;
  }

  function scalarKey(value) {
    if (typeof value === "number" && Number.isInteger(value)) return `integer:${BigInt(value)}`;
    if (typeof value !== "string") return `${typeof value}:${String(value)}`;
    const text = value.trim();
    try {
      if (/^[+-]?\d+$/.test(text)) return `integer:${BigInt(text)}`;
      if (/^0x[0-9a-f]+$/i.test(text) || /^0b[01]+$/i.test(text)) return `integer:${BigInt(text)}`;
    } catch (_error) {
      // Preserve unusual selectors as text so the validator can report no match.
    }
    return `string:${text}`;
  }

  function sourceValues(values) {
    if (Array.isArray(values)) return values.filter(isObject).filter((item) => hasOwn(item, "value"));
    if (isObject(values)) return Object.entries(values).map(([value, desc]) => ({ value, desc }));
    return [];
  }

  function validDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  }

  function sha256Fallback(text) {
    const bytes = new TextEncoder().encode(text);
    const words = [];
    const bitLength = bytes.length * 8;
    for (const byte of bytes) words.push(byte);
    words.push(0x80);
    while (words.length % 64 !== 56) words.push(0);
    const high = Math.floor(bitLength / 0x100000000);
    const low = bitLength >>> 0;
    for (let shift = 24; shift >= 0; shift -= 8) words.push((high >>> shift) & 0xff);
    for (let shift = 24; shift >= 0; shift -= 8) words.push((low >>> shift) & 0xff);

    const rotr = (value, shift) => (value >>> shift) | (value << (32 - shift));
    const primes = [];
    for (let number = 2; primes.length < 64; number += 1) {
      if (primes.every((prime) => number % prime !== 0)) primes.push(number);
    }
    const constants = primes.map((prime) => Math.floor((Math.cbrt(prime) % 1) * 0x100000000) >>> 0);
    const hash = primes.slice(0, 8).map((prime) => Math.floor((Math.sqrt(prime) % 1) * 0x100000000) >>> 0);
    const schedule = new Uint32Array(64);
    for (let offset = 0; offset < words.length; offset += 64) {
      for (let index = 0; index < 16; index += 1) {
        const start = offset + index * 4;
        schedule[index] = ((words[start] << 24) | (words[start + 1] << 16) | (words[start + 2] << 8) | words[start + 3]) >>> 0;
      }
      for (let index = 16; index < 64; index += 1) {
        const s0 = rotr(schedule[index - 15], 7) ^ rotr(schedule[index - 15], 18) ^ (schedule[index - 15] >>> 3);
        const s1 = rotr(schedule[index - 2], 17) ^ rotr(schedule[index - 2], 19) ^ (schedule[index - 2] >>> 10);
        schedule[index] = (schedule[index - 16] + s0 + schedule[index - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = hash;
      for (let index = 0; index < 64; index += 1) {
        const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const choice = (e & f) ^ (~e & g);
        const temp1 = (h + s1 + choice + constants[index] + schedule[index]) >>> 0;
        const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const majority = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (s0 + majority) >>> 0;
        h = g;
        g = f;
        f = e;
        e = (d + temp1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (temp1 + temp2) >>> 0;
      }
      [a, b, c, d, e, f, g, h].forEach((value, index) => {
        hash[index] = (hash[index] + value) >>> 0;
      });
    }
    return hash.map((value) => value.toString(16).padStart(8, "0")).join("");
  }

  async function sha256Hex(text) {
    if (window.crypto?.subtle) {
      const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    }
    return sha256Fallback(text);
  }

  function validateTranslationDocument(document, source, options = {}) {
    const errors = [];
    let translatedTextCount = 0;
    const error = (path, message) => errors.push(`${path}: ${message}`);

    function object(value, path) {
      if (!isObject(value)) {
        error(path, "必须是 mapping/object");
        return null;
      }
      return value;
    }

    function array(value, path) {
      if (!Array.isArray(value)) {
        error(path, "必须是 list/array");
        return null;
      }
      return value;
    }

    function allowedKeys(value, allowed, path) {
      if (!isObject(value)) return;
      Object.keys(value).forEach((key) => {
        if (!allowed.has(key)) error(`${path}.${key}`, "未知字段");
      });
    }

    function requiredText(value, key, path) {
      if (!hasOwn(value, key) || typeof value[key] !== "string" || !value[key].trim()) {
        error(`${path}.${key}`, "必须是非空字符串");
        return null;
      }
      return value[key];
    }

    function translatedText(value, key, sourceValue, path) {
      if (!hasOwn(value, key)) return;
      if (typeof value[key] !== "string" || !value[key].trim()) {
        error(`${path}.${key}`, "必须是非空译文");
        return;
      }
      if (typeof sourceValue !== "string" || !sourceValue.trim()) {
        error(`${path}.${key}`, "英文源中没有可翻译的对应文本");
        return;
      }
      translatedTextCount += 1;
    }

    function selectByCondition(candidates, item, path) {
      if (!hasOwn(item, "source_condition")) return candidates;
      if (typeof item.source_condition !== "string" || !item.source_condition.trim()) {
        error(`${path}.source_condition`, "必须是非空英文条件");
        return [];
      }
      return candidates.filter((candidate) => candidate.condition === item.source_condition);
    }

    function validateValueTranslations(itemsValue, sourceValue, path) {
      const items = array(itemsValue, path);
      if (!items) return;
      const available = sourceValues(sourceValue);
      const seen = new Set();
      items.forEach((rawItem, index) => {
        const itemPath = `${path}[${index}]`;
        const item = object(rawItem, itemPath);
        if (!item) return;
        const before = translatedTextCount;
        allowedKeys(item, new Set(["value", "source_condition", "desc", "condition"]), itemPath);
        if (!hasOwn(item, "value")) {
          error(`${itemPath}.value`, "缺少选择器");
          return;
        }
        let candidates = available.filter((candidate) => scalarKey(candidate.value) === scalarKey(item.value));
        candidates = selectByCondition(candidates, item, itemPath);
        const selector = `${scalarKey(item.value)}@${item.source_condition || ""}`;
        if (seen.has(selector)) error(itemPath, "枚举选择器重复");
        seen.add(selector);
        if (candidates.length !== 1) {
          error(itemPath, candidates.length ? "枚举选择器不唯一，请添加 source_condition" : "英文源中不存在该枚举选择器");
          return;
        }
        translatedText(item, "desc", candidates[0].desc, itemPath);
        translatedText(item, "condition", candidates[0].condition, itemPath);
        if (translatedTextCount === before) error(itemPath, "没有包含任何译文");
      });
    }

    function validateFieldTranslations(itemsValue, sourceRegister, path) {
      const items = array(itemsValue, path);
      if (!items) return;
      const fields = Array.isArray(sourceRegister.fields) ? sourceRegister.fields : [];
      const seen = new Set();
      items.forEach((rawItem, index) => {
        const itemPath = `${path}[${index}]`;
        const item = object(rawItem, itemPath);
        if (!item) return;
        const before = translatedTextCount;
        allowedKeys(item, new Set(["name", "bits", "source_condition", "desc", "condition", "reset_info", "values"]), itemPath);
        const name = requiredText(item, "name", itemPath);
        const bits = requiredText(item, "bits", itemPath);
        if (!name || !bits) return;
        let candidates = fields.filter((field) => field.name === name && String(field.bits) === bits);
        candidates = selectByCondition(candidates, item, itemPath);
        const selector = `${name}@${bits}@${item.source_condition || ""}`;
        if (seen.has(selector)) error(itemPath, "位域选择器重复");
        seen.add(selector);
        if (candidates.length !== 1) {
          error(itemPath, candidates.length ? "位域选择器不唯一，请添加 source_condition" : "英文源中不存在该位域选择器");
          return;
        }
        const selected = candidates[0];
        translatedText(item, "desc", selected.desc, itemPath);
        translatedText(item, "condition", selected.condition, itemPath);
        translatedText(item, "reset_info", selected.reset_info, itemPath);
        if (hasOwn(item, "values")) validateValueTranslations(item.values, selected.values, `${itemPath}.values`);
        if (translatedTextCount === before) error(itemPath, "没有包含任何译文");
      });
    }

    function validateRegisterTranslations(itemsValue, sourcePage, path) {
      const items = array(itemsValue, path);
      if (!items) return;
      const registers = Array.isArray(sourcePage.registers) ? sourcePage.registers : [];
      const seen = new Set();
      items.forEach((rawItem, index) => {
        const itemPath = `${path}[${index}]`;
        const item = object(rawItem, itemPath);
        if (!item) return;
        const before = translatedTextCount;
        allowedKeys(item, new Set(["name", "desc", "condition", "alias_note", "no_dump_reason", "fields"]), itemPath);
        const name = requiredText(item, "name", itemPath);
        if (!name) return;
        if (seen.has(name)) error(itemPath, "寄存器选择器重复");
        seen.add(name);
        const candidates = registers.filter((register) => register.name === name);
        if (candidates.length !== 1) {
          error(itemPath, candidates.length ? "英文源页面中的寄存器名不唯一" : "英文源页面中不存在该寄存器");
          return;
        }
        const selected = candidates[0];
        ["desc", "condition", "alias_note", "no_dump_reason"].forEach((key) => translatedText(item, key, selected[key], itemPath));
        if (hasOwn(item, "fields")) validateFieldTranslations(item.fields, selected, `${itemPath}.fields`);
        if (translatedTextCount === before) error(itemPath, "没有包含任何译文");
      });
    }

    const root = object(document, "file");
    const sourceRoot = object(source, "source");
    if (!root || !sourceRoot) return { valid: false, errors };
    allowedKeys(root, new Set([
      "translation_schema_version", "format", "source_locale", "locale", "source_file",
      "source_sha256", "metadata", "translations",
    ]), "file");
    if (root.translation_schema_version !== 1) error("file.translation_schema_version", "必须为 1");
    if (root.format !== FORMAT) error("file.format", `必须为 ${FORMAT}`);
    const sourceLocale = requiredText(root, "source_locale", "file");
    const locale = requiredText(root, "locale", "file");
    const sourceFile = requiredText(root, "source_file", "file");
    const sourceSha256 = requiredText(root, "source_sha256", "file");
    if (sourceLocale && !LOCALE_PATTERN.test(sourceLocale)) error("file.source_locale", "必须是规范语言标签，例如 en");
    if (locale && !LOCALE_PATTERN.test(locale)) error("file.locale", "必须是规范语言标签，例如 zh-CN");
    if (sourceLocale && locale && sourceLocale === locale) error("file.locale", "必须与 source_locale 不同");
    if (sourceFile) {
      const rootName = sourceFile.split("/")[0];
      if (!DATA_ROOTS.has(rootName) || sourceFile.includes("..") || sourceFile.startsWith("/")) {
        error("file.source_file", "必须指向 architecture、controllers、sensors 或 soc 下的寄存器 YAML");
      }
    }
    if (sourceSha256 && !/^[0-9a-f]{64}$/.test(sourceSha256)) error("file.source_sha256", "必须是 64 位小写 SHA-256");
    if (options.sourceSha256 && sourceSha256 !== options.sourceSha256) {
      error("file.source_sha256", "与英文源文件不匹配；请复核并更新译文");
    }

    const metadata = object(root.metadata, "file.metadata");
    if (metadata) {
      allowedKeys(metadata, new Set(["status", "coverage", "method", "translator", "updated", "reviewer", "reviewed_at", "notes"]), "file.metadata");
      const status = requiredText(metadata, "status", "file.metadata");
      const coverage = requiredText(metadata, "coverage", "file.metadata");
      const method = requiredText(metadata, "method", "file.metadata");
      requiredText(metadata, "translator", "file.metadata");
      const updated = requiredText(metadata, "updated", "file.metadata");
      if (status && !["draft", "reviewed"].includes(status)) error("file.metadata.status", "必须为 draft 或 reviewed");
      if (coverage && !["partial", "complete"].includes(coverage)) error("file.metadata.coverage", "必须为 partial 或 complete");
      if (method && !["ai", "human", "ai-assisted"].includes(method)) error("file.metadata.method", "必须为 ai、human 或 ai-assisted");
      if (updated && !validDate(updated)) error("file.metadata.updated", "必须是有效 YYYY-MM-DD 日期");
      if (hasOwn(metadata, "notes") && (typeof metadata.notes !== "string" || !metadata.notes.trim())) {
        error("file.metadata.notes", "存在时必须是非空字符串");
      }
      if (status === "reviewed") {
        requiredText(metadata, "reviewer", "file.metadata");
        const reviewedAt = requiredText(metadata, "reviewed_at", "file.metadata");
        if (reviewedAt && !validDate(reviewedAt)) error("file.metadata.reviewed_at", "必须是有效 YYYY-MM-DD 日期");
      }
    }

    const translations = object(root.translations, "file.translations");
    if (!translations) return { valid: false, errors };
    allowedKeys(translations, new Set(["sensor", "family", "who_am_i", "pages"]), "file.translations");
    translatedText(translations, "sensor", sourceRoot.sensor, "file.translations");
    translatedText(translations, "family", sourceRoot.family, "file.translations");
    if (hasOwn(translations, "who_am_i")) {
      const identity = object(translations.who_am_i, "file.translations.who_am_i");
      if (identity) {
        allowedKeys(identity, new Set(["values"]), "file.translations.who_am_i");
        if (hasOwn(identity, "values")) validateValueTranslations(identity.values, sourceRoot.who_am_i?.values, "file.translations.who_am_i.values");
      }
    }
    if (hasOwn(translations, "pages")) {
      const pages = array(translations.pages, "file.translations.pages");
      const seen = new Set();
      pages?.forEach((rawPage, index) => {
        const pagePath = `file.translations.pages[${index}]`;
        const page = object(rawPage, pagePath);
        if (!page) return;
        const before = translatedTextCount;
        allowedKeys(page, new Set(["name", "title", "access", "desc", "registers"]), pagePath);
        const name = requiredText(page, "name", pagePath);
        if (!name) return;
        if (seen.has(name)) error(pagePath, "页面选择器重复");
        seen.add(name);
        const sourcePage = sourceRoot.pages?.[name];
        if (!isObject(sourcePage)) {
          error(pagePath, "英文源中不存在该页面");
          return;
        }
        if (hasOwn(page, "title")) {
          if (typeof page.title !== "string" || !page.title.trim()) error(`${pagePath}.title`, "必须是非空译文");
          else translatedTextCount += 1;
        }
        translatedText(page, "access", sourcePage.access, pagePath);
        translatedText(page, "desc", sourcePage.desc, pagePath);
        if (hasOwn(page, "registers")) validateRegisterTranslations(page.registers, sourcePage, `${pagePath}.registers`);
        if (translatedTextCount === before) error(pagePath, "没有包含任何译文");
      });
    }
    if (translatedTextCount === 0) error("file.translations", "至少需要一条面向用户的译文");
    return { valid: errors.length === 0, errors };
  }

  async function assertRegisterTranslationYaml(text, data, sourceText, sourceData) {
    const sourceSha256 = await sha256Hex(sourceText);
    const report = validateTranslationDocument(data, sourceData, { sourceSha256 });
    if (report.valid) return report;
    const shown = report.errors.slice(0, 12).map((message) => `错误：${message}`);
    if (report.errors.length > shown.length) shown.push(`另有 ${report.errors.length - shown.length} 项未显示`);
    throw new Error(`翻译 YAML 规范校验未通过（${report.errors.length} 个错误）\n${shown.join("\n")}`);
  }

  window.isRegisterTranslationDocument = isTranslationDocument;
  window.sha256RegisterYaml = sha256Hex;
  window.validateRegisterTranslationYaml = validateTranslationDocument;
  window.assertRegisterTranslationYaml = assertRegisterTranslationYaml;
})();
