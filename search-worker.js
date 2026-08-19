/* global Fuse */
(function () {
  if (typeof importScripts === "function" && typeof Fuse === "undefined") importScripts("vendor/fuse.min.js");

  let documents = [];
  let fuse = null;

  const text = (value) => value === undefined || value === null ? "" : String(value);
  const join = (...values) => values.flat(Infinity).map(text).map((value) => value.trim()).filter(Boolean).join("\n");
  const normalize = (value) => text(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

  function translationPage(chip, pageName) {
    return (chip._translations || []).flatMap((translation) => translation?.translations?.pages || [])
      .filter((page) => page?.name === pageName);
  }

  function translationRegister(pages, name) {
    return pages.flatMap((page) => page?.registers || []).filter((register) => register?.name === name);
  }

  function translationField(registers, field) {
    return registers.flatMap((register) => register?.fields || [])
      .filter((item) => item?.name === field?.name && text(item?.bits) === text(field?.bits));
  }

  function enumItems(values) {
    if (Array.isArray(values)) return values.map((item) => ({
      value: text(item?.value), name: text(item?.name), desc: text(item?.desc), condition: text(item?.condition),
    }));
    if (values && typeof values === "object") {
      return Object.entries(values).map(([value, desc]) => ({ value, name: "", desc: text(desc), condition: "" }));
    }
    return [];
  }

  function translatedEnum(fields, source) {
    return join(fields.flatMap((field) => enumItems(field?.values))
      .filter((item) => item.value === source.value && (!item.condition || item.condition === source.condition))
      .map((item) => join(item.name, item.desc, item.condition)));
  }

  function locator(register) {
    if (register?.addr !== undefined && register?.addr !== null) {
      const number = Number(register.addr);
      return Number.isFinite(number) ? `0x${number.toString(16).toUpperCase()}` : text(register.addr);
    }
    const encoding = register?.encoding || {};
    if (encoding.address !== undefined) {
      const number = Number(encoding.address);
      if (Number.isFinite(number)) return `0x${number.toString(16).toUpperCase()}`;
    }
    return Object.entries(encoding).map(([key, value]) => `${key}=${value}`).join(", ");
  }

  function addDocument(base, data) {
    documents.push({
      kind: data.kind,
      chipId: base.id,
      chipName: base.sensor,
      category: base.category,
      enabled: base.enabled,
      pageName: data.pageName || "",
      registerIndex: Number.isInteger(data.registerIndex) ? data.registerIndex : null,
      registerName: data.registerName || "",
      registerLocator: data.registerLocator || "",
      fieldName: data.fieldName || "",
      fieldBits: data.fieldBits || "",
      access: data.access || "",
      title: data.title || "",
      aliases: data.aliases || "",
      sourceText: data.sourceText || "",
      translatedText: data.translatedText || "",
    });
  }

  function buildDocuments(chips, summaries) {
    documents = [];
    const summaryMap = new Map((summaries || []).map((item) => [item.id, item]));
    for (const chip of chips || []) {
      const id = chip._libraryId || chip._id || chip.sensor;
      const summary = summaryMap.get(id) || {};
      const base = {
        id,
        sensor: chip.sensor || id,
        category: chip._category || summary.category || "未分类",
        enabled: summary.enabled !== false,
      };
      const translatedRoots = (chip._translations || []).map((item) => item?.translations || {});
      addDocument(base, {
        kind: "chip", title: base.sensor, aliases: join(chip.vendor, chip.family, base.category),
        sourceText: join(chip.device_type, chip.description),
        translatedText: join(translatedRoots.map((root) => root.description)),
      });
      for (const [pageName, page] of Object.entries(chip.pages || {})) {
        const pageTranslations = translationPage(chip, pageName);
        addDocument(base, {
          kind: "page", pageName, title: pageName, aliases: page?.title, access: page?.access,
          sourceText: join(page?.desc),
          translatedText: join(pageTranslations.map((item) => item.desc)),
        });
        (page?.registers || []).forEach((register, registerIndex) => {
          const name = register?.name || "";
          const registerTranslations = translationRegister(pageTranslations, name);
          const registerLocator = locator(register);
          const registerAccess = text(register?.access);
          const aliases = join(register?.aliases, register?.groups,
            (register?.accessors || []).flatMap((item) => [item.name, item.kind, item.instruction, item.condition]));
          addDocument(base, {
            kind: "register", pageName, registerIndex, registerName: name, registerLocator,
            title: name, aliases, access: registerAccess,
            sourceText: join(register?.desc, register?.condition, register?.execution_state,
              register?.alias_note, register?.no_dump_reason),
            translatedText: join(registerTranslations.map((item) =>
              join(item.desc, item.condition, item.alias_note, item.no_dump_reason))),
          });
          (register?.fields || []).forEach((field) => {
            const fields = translationField(registerTranslations, field);
            const fieldName = field?.name || "";
            const fieldBits = text(field?.bits);
            const fieldAccess = text(field?.access) || registerAccess;
            addDocument(base, {
              kind: "field", pageName, registerIndex, registerName: name, registerLocator,
              fieldName, fieldBits, title: fieldName, aliases: fieldBits, access: fieldAccess,
              sourceText: join(field?.reset_info, field?.condition, field?.reserved, field?.desc),
              translatedText: join(fields.map((item) => join(item.desc, item.condition, item.reset_info))),
            });
            enumItems(field?.values).forEach((item) => addDocument(base, {
              kind: "enum", pageName, registerIndex, registerName: name, registerLocator,
              fieldName, fieldBits, title: item.name || item.value,
              aliases: join(item.value, item.name, fieldName), access: fieldAccess,
              sourceText: join(item.desc, item.condition),
              translatedText: translatedEnum(fields, item),
            }));
          });
        });
      }
      for (const note of chip._notes || []) {
        addDocument(base, {
          kind: "note", pageName: note.pageName, registerName: note.registerName,
          registerLocator: note.registerKey, title: note.registerName, aliases: note.kind,
          sourceText: note.content,
        });
      }
    }
    fuse = new Fuse(documents, {
      includeScore: true,
      ignoreLocation: true,
      threshold: 0.42,
      minMatchCharLength: 1,
      keys: [
        { name: "title", weight: 0.42 },
        { name: "aliases", weight: 0.24 },
        { name: "registerLocator", weight: 0.16 },
        { name: "translatedText", weight: 0.11 },
        { name: "sourceText", weight: 0.07 },
      ],
    });
  }

  function queryTokens(query) {
    const tokens = [];
    let current = "";
    let quote = "";
    for (const character of text(query)) {
      if (character === "\"" || character === "'") {
        if (quote === character) quote = "";
        else if (!quote) quote = character;
        else current += character;
      } else if (/\s/u.test(character) && !quote) {
        if (current) tokens.push(current);
        current = "";
      } else current += character;
    }
    if (current) tokens.push(current);
    return tokens;
  }

  function canonicalType(value) {
    const types = {
      register: "register", reg: "register", "寄存器": "register",
      field: "field", bitfield: "field", "位域": "field",
      enum: "enum", value: "enum", "枚举": "enum",
      description: "description", desc: "description", text: "description", "说明": "description",
      note: "note", "备注": "note", chip: "chip", "芯片": "chip",
      page: "page", category: "page", "分类": "page",
    };
    return types[text(value).trim().toLowerCase()] || "";
  }

  function canonicalAccess(value) {
    const normalized = normalize(value);
    const aliases = {
      read: "ro", readonly: "ro", ro: "ro", write: "wo", writeonly: "wo", wo: "wo",
      readwrite: "rw", rw: "rw", writeonce: "w1", w1: "w1",
    };
    return aliases[normalized] || normalized;
  }

  function canonicalAddress(value) {
    const source = text(value).trim();
    const digits = source.replace(/^0x/iu, "");
    if (!digits || !/^[0-9a-f]+$/iu.test(digits) || !/[0-9]/u.test(digits)) return "";
    try {
      return `0x${BigInt(`0x${digits}`).toString(16).toUpperCase()}`;
    } catch (_error) {
      return "";
    }
  }

  function canonicalBits(value) {
    let source = text(value).trim();
    if (source.startsWith("[") && source.endsWith("]")) source = source.slice(1, -1);
    const values = source.split(":");
    if (values.length === 1 && /^\d+$/u.test(values[0].trim())) return String(Number(values[0]));
    if (values.length !== 2 || values.some((item) => !/^\d+$/u.test(item.trim()))) return "";
    const [high, low] = values.map(Number);
    if (high < low) return "";
    return high === low ? String(high) : `${high}:${low}`;
  }

  function parseQuery(query) {
    const parsed = { text: "", words: [], filters: [], issues: [] };
    const textTokens = [];
    for (const token of queryTokens(query)) {
      const separator = token.indexOf(":");
      if (separator < 0) {
        textTokens.push(token);
        continue;
      }
      const rawKey = token.slice(0, separator);
      const rawValue = token.slice(separator + 1);
      if (!/^[a-z]+$/iu.test(rawKey)) {
        textTokens.push(token);
        continue;
      }
      const key = rawKey.toLowerCase();
      if (!["chip", "type", "access", "addr", "bits"].includes(key)) {
        parsed.issues.push({ token, message: `不支持筛选项 ${rawKey}:，可用 chip/type/access/addr/bits` });
        continue;
      }
      if (!rawValue.trim()) {
        parsed.issues.push({ token, message: `筛选项 ${rawKey}: 缺少值` });
        continue;
      }
      let value = rawValue.trim();
      let message = "";
      if (key === "type") {
        value = canonicalType(rawValue);
        if (!value) message = "type: 支持 register、field、enum、description、note、chip、page";
      } else if (key === "addr") {
        value = canonicalAddress(rawValue);
        if (!value) message = "addr: 需要十六进制地址，例如 addr:0xE000ED00";
      } else if (key === "bits") {
        value = canonicalBits(rawValue);
        if (!value) message = "bits: 需要位号或高位:低位，例如 bits:31:28";
      } else if (key === "access") value = canonicalAccess(rawValue);
      if (message) parsed.issues.push({ token, message });
      else parsed.filters.push({ key, value, token });
    }
    parsed.text = textTokens.join(" ").trim();
    parsed.words = parsed.text.split(/[^\p{L}\p{N}]+/gu).map((word) => word.trim().toLowerCase()).filter(Boolean);
    if (!parsed.words.length && parsed.text) parsed.words.push(parsed.text.toLowerCase());
    return parsed;
  }

  function filterValues(parsed, key) {
    return parsed.filters.filter((filter) => filter.key === key).map((filter) => filter.value);
  }

  function canonicalLocatorEncoding(value) {
    const compact = text(value).trim().toLowerCase().replace(/\s+/gu, "");
    const display = compact.split("_");
    if (display.length === 5 && /^s\d+$/u.test(display[0]) && /^c\d+$/u.test(display[2]) && /^c\d+$/u.test(display[3])) {
      return `aarch64:${display[0].slice(1)}:${display[1]}:${display[2].slice(1)}:${display[3].slice(1)}:${display[4]}`;
    }
    const pairs = Object.fromEntries(compact.split(",").map((part) => part.split("=")).filter((pair) => pair.length === 2));
    if (pairs.scheme === "aarch64_sysreg" && ["op0", "op1", "crn", "crm", "op2"].every((key) => pairs[key] !== undefined)) {
      return `aarch64:${pairs.op0}:${pairs.op1}:${pairs.crn}:${pairs.crm}:${pairs.op2}`;
    }
    if (["aarch32_cp15", "aarch32_coproc"].includes(pairs.scheme)
      && pairs.coproc !== undefined && (pairs.opc1 ?? pairs.op1) !== undefined
      && pairs.crn !== undefined && pairs.crm !== undefined && (pairs.opc2 ?? pairs.op2) !== undefined) {
      return `aarch32:${pairs.coproc}:${pairs.opc1 ?? pairs.op1}:${pairs.crn}:${pairs.crm}:${pairs.opc2 ?? pairs.op2}`;
    }
    return "";
  }

  function locatorAddress(value) {
    return /^0x/iu.test(text(value).trim()) ? canonicalAddress(value) : "";
  }

  function fieldBitsMatch(value, expected) {
    return text(value).split(",").map(canonicalBits).includes(expected);
  }

  function abbreviation(word) {
    return ({
      address: "addr", error: "err", configuration: "cfg", control: "ctrl", status: "sts",
      interrupt: "int", enable: "en", disable: "dis", transmit: "tx", receive: "rx",
      buffer: "buf", valid: "vld",
    })[word] || word;
  }

  function identifierVariants(parsed) {
    const normalized = normalize(parsed.text);
    const abbreviated = parsed.words.map(abbreviation).join("");
    return [...new Set([normalized, abbreviated].filter(Boolean))];
  }

  function identifierMatch(value, variants) {
    const normalized = normalize(value);
    for (const variant of variants) {
      if (normalized.startsWith(variant)) return 1;
      if (normalized.includes(variant)) return 0.9;
    }
    return 0;
  }

  function textMatchTerms(source, parsed) {
    const lowercase = text(source).toLowerCase();
    const phrase = parsed.text.toLowerCase();
    if (phrase && lowercase.includes(phrase)) return [parsed.text];
    if (parsed.words.length && parsed.words.every((word) => lowercase.includes(word.toLowerCase()))) return [...parsed.words];
    return [];
  }

  function accessMatches(value, expected) {
    return canonicalAccess(value) === expected || text(value).split(/[\s,;]+/u).some((part) => canonicalAccess(part) === expected);
  }

  function rowMatchesFilters(item, parsed) {
    const types = filterValues(parsed, "type");
    if (types.length && !types.every((expected) => expected === "description"
      ? Boolean(item.sourceText || item.translatedText) : item.kind === expected)) return false;
    if (!filterValues(parsed, "chip").every((expected) =>
      normalize(item.chipName).includes(normalize(expected)) || normalize(item.chipId).includes(normalize(expected)))) return false;
    if (!filterValues(parsed, "access").every((expected) => accessMatches(item.access, expected))) return false;
    if (!filterValues(parsed, "addr").every((expected) => locatorAddress(item.registerLocator) === expected)) return false;
    if (!filterValues(parsed, "bits").every((expected) => fieldBitsMatch(item.fieldBits, expected))) return false;
    if (!types.length && filterValues(parsed, "addr").length && item.kind !== "register") return false;
    if (!types.length && filterValues(parsed, "bits").length && item.kind !== "field") return false;
    return true;
  }

  function normalizedDamerau(left, right) {
    if (left === right) return 1;
    if (!left.length || !right.length) return 0;
    const matrix = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
    for (let index = 0; index <= left.length; index += 1) matrix[index][0] = index;
    for (let index = 0; index <= right.length; index += 1) matrix[0][index] = index;
    for (let row = 1; row <= left.length; row += 1) {
      for (let column = 1; column <= right.length; column += 1) {
        const cost = left[row - 1] === right[column - 1] ? 0 : 1;
        matrix[row][column] = Math.min(
          matrix[row - 1][column] + 1,
          matrix[row][column - 1] + 1,
          matrix[row - 1][column - 1] + cost,
        );
        if (row > 1 && column > 1 && left[row - 1] === right[column - 2] && left[row - 2] === right[column - 1]) {
          matrix[row][column] = Math.min(matrix[row][column], matrix[row - 2][column - 2] + cost);
        }
      }
    }
    return 1 - matrix[left.length][right.length] / Math.max(left.length, right.length);
  }

  function makeSnippet(value, terms) {
    const compact = text(value).replace(/\s+/gu, " ").trim();
    if (!compact) return "";
    const term = terms.find((item) => compact.toLowerCase().includes(item.toLowerCase())) || "";
    const index = term ? compact.toLowerCase().indexOf(term.toLowerCase()) : 0;
    const start = Math.max(0, index - 48);
    const end = Math.min(compact.length, index + term.length + 96);
    return `${start ? "…" : ""}${compact.slice(start, end)}${end < compact.length ? "…" : ""}`;
  }

  function evaluate(item, parsed, currentChipId, recentChipIds) {
    if (!rowMatchesFilters(item, parsed)) return null;
    const normalizedQuery = normalize(parsed.text);
    const normalizedTitle = normalize(item.title);
    const variants = identifierVariants(parsed);
    const aliases = item.aliases.split("\n").map((alias) => alias.trim()).filter(Boolean);
    const exactAlias = aliases.find((alias) => normalize(alias) === normalizedQuery) || "";
    const addressIntent = canonicalAddress(parsed.text)
      && (/^0x/iu.test(parsed.text.trim()) || (parsed.text.trim().length >= 3 && /\d/u.test(parsed.text)))
      ? canonicalAddress(parsed.text) : "";
    const bitsIntent = canonicalBits(parsed.text)
      && (parsed.text.includes(":") || /^\[.*\]$/u.test(parsed.text) || /^\d+$/u.test(parsed.text))
      ? canonicalBits(parsed.text) : "";
    const systemIntent = canonicalLocatorEncoding(parsed.text);
    const translatedTerms = textMatchTerms(item.translatedText, parsed);
    const sourceTerms = textMatchTerms(item.sourceText, parsed);
    const fuzzy = normalizedQuery && normalizedTitle ? normalizedDamerau(normalizedQuery, normalizedTitle) : 0;
    const typeFilter = filterValues(parsed, "type")[0];
    let match;
    if (!parsed.text) {
      const address = filterValues(parsed, "addr")[0];
      const bits = filterValues(parsed, "bits")[0];
      if (address) match = [0, 1, "address", "identifier", [address], item.registerLocator];
      else if (bits) match = [1, 1, "bits", "identifier", [bits], item.fieldBits];
      else if (typeFilter === "description") match = item.translatedText
        ? [4, 1, "translated_description", "zh-CN", [], item.translatedText]
        : [4, 1, "source_description", "source", [], item.sourceText];
      else if (item.kind === "note") match = [5, 1, "note", "note", [], item.sourceText];
      else match = [item.kind === "enum" ? 3 : 2, 1, "filter", "identifier", [], ""];
    } else if (item.kind === "register" && addressIntent && addressIntent === locatorAddress(item.registerLocator)) {
      match = [0, 1, "address", "identifier", [parsed.text], item.registerLocator];
    } else if (item.kind === "register" && systemIntent && systemIntent === canonicalLocatorEncoding(item.registerLocator)) {
      match = [0, 1, "system_encoding", "identifier", [parsed.text], item.registerLocator];
    } else if (item.kind === "register" && normalizedTitle === normalizedQuery) {
      match = [0, 1, "register_name", "identifier", [parsed.text], ""];
    } else if (item.kind === "register" && exactAlias) {
      match = [0, 1, "alias", "identifier", [parsed.text], exactAlias];
    } else if (item.kind === "field" && normalizedTitle === normalizedQuery) {
      match = [1, 1, "field_name", "identifier", [parsed.text], ""];
    } else if (item.kind === "field" && bitsIntent && fieldBitsMatch(item.fieldBits, bitsIntent)) {
      match = [1, 1, "bits", "identifier", [parsed.text], item.fieldBits];
    } else if (item.kind === "enum" && normalizedTitle === normalizedQuery) {
      match = [3, 1, "enum_name", "identifier", [parsed.text], ""];
    } else if (item.kind === "enum" && exactAlias) {
      match = [3, 1, "enum_value", "identifier", [parsed.text], exactAlias];
    } else if (["register", "field", "chip", "page"].includes(item.kind) && identifierMatch(item.title, variants)) {
      match = [2, identifierMatch(item.title, variants), "name", "identifier", [...parsed.words], ""];
    } else if (item.kind === "register" && aliases.some((alias) => identifierMatch(alias, variants))) {
      match = [2, 0.85, "alias", "identifier", [...parsed.words], aliases.find((alias) => identifierMatch(alias, variants))];
    } else if (item.kind === "enum" && identifierMatch(item.title, variants)) {
      match = [3, 0.9, "enum_name", "identifier", [...parsed.words], ""];
    } else if (translatedTerms.length && item.kind !== "note") {
      match = [4, 1, "translated_description", "zh-CN", translatedTerms, item.translatedText];
    } else if (sourceTerms.length && item.kind !== "note") {
      match = [4, 1, "source_description", "source", sourceTerms, item.sourceText];
    } else if (item.kind === "note" && sourceTerms.length) {
      match = [5, 1, "note", "note", sourceTerms, item.sourceText];
    } else if (["register", "field"].includes(item.kind) && fuzzy >= 0.72) {
      match = [6, fuzzy, "fuzzy_name", "identifier", [], ""];
    } else return null;
    const [tier, quality, matchKind, matchLanguage, matchTerms, matchedSource] = match;
    if (typeFilter === "description" && tier !== 4) return null;
    return {
      ...item,
      snippet: makeSnippet(matchedSource, matchTerms),
      matchLanguage,
      resultType: tier === 4 ? "description" : item.kind,
      matchKind,
      matchTerms,
      section: tier <= 3 ? "entities" : tier <= 5 ? "text" : "suggestions",
      _tier: tier,
      _quality: quality,
      _currentChip: item.chipId === currentChipId,
      _recentChipRank: recentChipIds.indexOf(item.chipId) < 0 ? Number.MAX_SAFE_INTEGER : recentChipIds.indexOf(item.chipId),
    };
  }

  function search(query, currentChipId, limit, recentChipIds = []) {
    const parsed = parseQuery(query);
    if (parsed.issues.length) return { results: [], filters: parsed.filters, issues: parsed.issues, suggestion: "" };
    if (!parsed.text && !parsed.filters.length) return { results: [], filters: [], issues: [], suggestion: "" };
    const candidates = new Set();
    const rawAddress = canonicalAddress(parsed.text);
    const address = rawAddress && (/^0x/iu.test(parsed.text.trim()) || (parsed.text.trim().length >= 3 && /\d/u.test(parsed.text)))
      ? rawAddress : filterValues(parsed, "addr")[0];
    const rawBits = canonicalBits(parsed.text);
    const bits = rawBits && (parsed.text.includes(":") || /^\[.*\]$/u.test(parsed.text) || /^\d+$/u.test(parsed.text))
      ? rawBits : filterValues(parsed, "bits")[0];
    const system = canonicalLocatorEncoding(parsed.text);
    const structuredIntent = Boolean(address || bits || system);
    if (parsed.text && fuse && !structuredIntent) {
      for (const result of fuse.search(parsed.text, { limit: Math.min(900, Math.max(limit * 8, 200)) })) candidates.add(result.item);
    } else if (!parsed.text) {
      for (const item of documents.slice(0, 1200)) candidates.add(item);
    }
    if (address || bits || system || !parsed.text) {
      for (const item of documents) {
        if ((address && locatorAddress(item.registerLocator) === address)
          || (bits && fieldBitsMatch(item.fieldBits, bits))
          || (system && canonicalLocatorEncoding(item.registerLocator) === system)
          || (!parsed.text && rowMatchesFilters(item, parsed))) candidates.add(item);
      }
    }
    let suggestion = { quality: 0, title: "" };
    if (!candidates.size && parsed.text) {
      for (const item of documents.filter((candidate) => ["register", "field"].includes(candidate.kind)).slice(0, 2000)) {
        const quality = normalizedDamerau(normalize(parsed.text), normalize(item.title));
        if (quality > suggestion.quality) suggestion = { quality, title: item.title };
      }
    }
    const results = [];
    for (const item of candidates) {
      if (parsed.text && ["register", "field"].includes(item.kind)) {
        const quality = normalizedDamerau(normalize(parsed.text), normalize(item.title));
        if (quality > suggestion.quality) suggestion = { quality, title: item.title };
      }
      const result = evaluate(item, parsed, currentChipId, recentChipIds);
      if (result) results.push(result);
    }
    results.sort((left, right) => left._tier - right._tier
      || right._quality - left._quality
      || Number(right._currentChip) - Number(left._currentChip)
      || left._recentChipRank - right._recentChipRank
      || left.chipName.localeCompare(right.chipName)
      || left.pageName.localeCompare(right.pageName)
      || left.registerName.localeCompare(right.registerName));
    const strongCount = results.filter((result) => result.section === "entities").length;
    let textCount = 0;
    const capped = results.filter((result) => result.section !== "text" || ++textCount <= (strongCount ? 30 : limit))
      .slice(0, Math.min(100, Math.max(1, limit)))
      .map((result) => {
        const output = { ...result };
        delete output._tier;
        delete output._quality;
        delete output._currentChip;
        delete output._recentChipRank;
        return output;
      });
    return {
      results: capped,
      filters: parsed.filters,
      issues: [],
      suggestion: !capped.length && suggestion.quality >= 0.62 ? suggestion.title : "",
    };
  }

  self.onmessage = (event) => {
    const message = event.data || {};
    if (message.type === "init") {
      buildDocuments(message.chips, message.summaries);
      self.postMessage({ type: "ready", documentCount: documents.length });
      return;
    }
    if (message.type === "search") {
      self.postMessage({
        type: "results",
        requestId: message.requestId,
        response: search(
          message.query || "",
          message.currentChipId || "",
          Math.min(100, message.limit || 100),
          message.recentChipIds || [],
        ),
      });
    }
  };
})();
