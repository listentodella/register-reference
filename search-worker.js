/* global Fuse */
(function () {
  if (typeof importScripts === "function" && typeof Fuse === "undefined") importScripts("vendor/fuse.min.js");
  let documents = [];
  let fuse = null;

  const text = (value) => value === undefined || value === null ? "" : String(value);
  const join = (...values) => values.flat(Infinity).map(text).map((value) => value.trim()).filter(Boolean).join("\n");
  const normalize = (value) => text(value).toLowerCase().replace(/[_\-\s]+/g, "");

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
      value: text(item?.value), desc: join(item?.name, item?.desc), condition: text(item?.condition),
    }));
    if (values && typeof values === "object") {
      return Object.entries(values).map(([value, desc]) => ({ value, desc: text(desc), condition: "" }));
    }
    return [];
  }

  function translatedEnum(fields, source) {
    return join(fields.flatMap((field) => enumItems(field?.values))
      .filter((item) => item.value === source.value && (!item.condition || item.condition === source.condition))
      .map((item) => join(item.desc, item.condition)));
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
      const chipSource = join(chip.sensor, chip.vendor, chip.family, chip.device_type, chip.description, base.category);
      const chipTranslation = join(translatedRoots.map((root) => join(root.sensor, root.vendor, root.family, root.description)));
      addDocument(base, {
        kind: "chip", title: base.sensor, aliases: join(chip.vendor, chip.family, base.category),
        sourceText: chipSource, translatedText: chipTranslation,
      });
      for (const [pageName, page] of Object.entries(chip.pages || {})) {
        const pageTranslations = translationPage(chip, pageName);
        const pageSource = join(page?.title, page?.access, page?.desc);
        const pageTranslation = join(pageTranslations.map((item) => join(item.title, item.access, item.desc)));
        addDocument(base, {
          kind: "page", pageName, title: pageName, aliases: page?.title,
          sourceText: pageSource, translatedText: pageTranslation,
        });
        (page?.registers || []).forEach((register, registerIndex) => {
          const name = register?.name || "";
          const registerTranslations = translationRegister(pageTranslations, name);
          const registerLocator = locator(register);
          const aliases = join(register?.aliases, register?.groups,
            (register?.accessors || []).flatMap((item) => [item.name, item.kind, item.instruction, item.condition]));
          addDocument(base, {
            kind: "register", pageName, registerIndex, registerName: name, registerLocator,
            title: name, aliases,
            sourceText: join(name, registerLocator, aliases, register?.access, register?.reset,
              register?.desc, register?.condition, register?.execution_state, register?.alias_note, register?.no_dump_reason),
            translatedText: join(registerTranslations.map((item) =>
              join(item.desc, item.condition, item.alias_note, item.no_dump_reason))),
          });
          (register?.fields || []).forEach((field) => {
            const fields = translationField(registerTranslations, field);
            const fieldName = field?.name || "";
            const fieldBits = text(field?.bits);
            addDocument(base, {
              kind: "field", pageName, registerIndex, registerName: name, registerLocator,
              fieldName, fieldBits, title: fieldName, aliases: fieldBits,
              sourceText: join(fieldName, fieldBits, field?.access, field?.reset,
                field?.reset_info, field?.condition, field?.reserved, field?.desc),
              translatedText: join(fields.map((item) => join(item.desc, item.condition, item.reset_info))),
            });
            enumItems(field?.values).forEach((item) => addDocument(base, {
              kind: "enum", pageName, registerIndex, registerName: name, registerLocator,
              fieldName, fieldBits, title: item.value, aliases: fieldName,
              sourceText: join(item.value, item.desc, item.condition),
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

  function makeSnippet(value, query) {
    const compact = text(value).replace(/\s+/g, " ").trim();
    const index = compact.toLowerCase().indexOf(query.toLowerCase());
    if (index < 0) return compact.slice(0, 148);
    const start = Math.max(0, index - 48);
    const end = Math.min(compact.length, index + query.length + 96);
    return `${start ? "…" : ""}${compact.slice(start, end)}${end < compact.length ? "…" : ""}`;
  }

  function search(query, currentChipId, limit) {
    if (!fuse || !query.trim()) return [];
    const normalizedQuery = normalize(query);
    return fuse.search(query, { limit: Math.min(400, Math.max(limit * 4, 100)) }).map(({ item, score }) => {
      const normalizedTitle = normalize(item.title);
      const normalizedAliases = normalize(item.aliases);
      const exact = normalizedTitle === normalizedQuery || normalize(item.registerLocator) === normalizedQuery;
      const prefix = normalizedTitle.startsWith(normalizedQuery);
      const contains = normalizedTitle.includes(normalizedQuery) || normalizedAliases.includes(normalizedQuery);
      const translated = item.translatedText.toLowerCase().includes(query.toLowerCase());
      const source = item.sourceText.toLowerCase().includes(query.toLowerCase());
      let rank = exact ? 1000 : prefix ? 900 : contains ? 820 : translated ? 570 : source ? 550 : 500 - (score || 0) * 300;
      if (item.chipId === currentChipId) rank += 35;
      if (item.kind === "register") rank += 24;
      else if (item.kind === "field") rank += 18;
      const snippetSource = translated ? item.translatedText : source ? item.sourceText : item.aliases || item.sourceText;
      return {
        ...item,
        snippet: makeSnippet(snippetSource, query),
        matchLanguage: translated ? "zh-CN" : source ? "source" : "identifier",
        score: rank,
      };
    }).sort((left, right) => right.score - left.score).slice(0, limit);
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
        results: search(message.query || "", message.currentChipId || "", Math.min(100, message.limit || 100)),
      });
    }
  };
})();
