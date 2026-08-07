(function () {
  const chips = Array.isArray(window.REGISTER_CHIPS) ? window.REGISTER_CHIPS : [];
  const THEME_STORAGE_KEY = "register-reference.theme";
  const themeLabels = {
    system: "跟随系统",
    light: "清晰亮色",
    dark: "石墨深色",
    contrast: "高对比",
  };
  const systemThemeMedia = window.matchMedia?.("(prefers-color-scheme: dark)") || null;

  const state = {
    chipIndex: 0,
    pageName: "",
    view: "matrix",
    query: "",
    registerValues: new Map(),
    hoverPinned: false,
    activeHoverAddress: null,
    hoverCloseTimer: null,
    loadMessage: "",
    libraryQuery: "",
    libraryOpen: false,
    libraryStatus: "",
    libraryStatusError: false,
    exportSelection: new Set(),
    exportSelectionInitialized: false,
    noteRegisterKey: null,
    editingNoteId: null,
    noteKind: "note",
    attachmentsStatus: "",
    attachmentsStatusError: false,
    themePreference: "light",
    themeMenuOpen: false,
  };

  let libraryRecords = [];

  const els = {
    chipSelect: document.getElementById("chipSelect"),
    pageSelect: document.getElementById("pageSelect"),
    searchInput: document.getElementById("searchInput"),
    loadYamlButton: document.getElementById("loadYamlButton"),
    loadFolderButton: document.getElementById("loadFolderButton"),
    libraryButton: document.getElementById("libraryButton"),
    attachmentsButton: document.getElementById("attachmentsButton"),
    attachmentsButtonCount: document.getElementById("attachmentsButtonCount"),
    themePicker: document.getElementById("themePicker"),
    themeButton: document.getElementById("themeButton"),
    themeMenu: document.getElementById("themeMenu"),
    themeOptions: Array.from(document.querySelectorAll("[data-theme-option]")),
    yamlFileInput: document.getElementById("yamlFileInput"),
    yamlFolderInput: document.getElementById("yamlFolderInput"),
    chipMeta: document.getElementById("chipMeta"),
    statusBand: document.getElementById("statusBand"),
    matrixView: document.getElementById("matrixView"),
    tableView: document.getElementById("tableView"),
    matrixGrid: document.getElementById("matrixGrid"),
    matrixSummary: document.getElementById("matrixSummary"),
    tableSummary: document.getElementById("tableSummary"),
    tableBody: document.getElementById("registerTableBody"),
    hoverPanel: document.getElementById("hoverPanel"),
    libraryBackdrop: document.getElementById("libraryBackdrop"),
    libraryPanel: document.getElementById("libraryPanel"),
    libraryCloseButton: document.getElementById("libraryCloseButton"),
    librarySummary: document.getElementById("librarySummary"),
    librarySearchInput: document.getElementById("librarySearchInput"),
    libraryImportButton: document.getElementById("libraryImportButton"),
    libraryFolderButton: document.getElementById("libraryFolderButton"),
    libraryList: document.getElementById("libraryList"),
    libraryStatus: document.getElementById("libraryStatus"),
    includeNotesExport: document.getElementById("includeNotesExport"),
    attachmentsDialog: document.getElementById("attachmentsDialog"),
    attachmentsDialogChip: document.getElementById("attachmentsDialogChip"),
    attachmentsDialogCloseButton: document.getElementById("attachmentsDialogCloseButton"),
    attachmentsSummary: document.getElementById("attachmentsSummary"),
    addAttachmentsButton: document.getElementById("addAttachmentsButton"),
    attachmentsList: document.getElementById("attachmentsList"),
    attachmentsStatus: document.getElementById("attachmentsStatus"),
    noteDialog: document.getElementById("noteDialog"),
    noteDialogTitle: document.getElementById("noteDialogTitle"),
    noteDialogRegister: document.getElementById("noteDialogRegister"),
    noteDialogCloseButton: document.getElementById("noteDialogCloseButton"),
    noteList: document.getElementById("noteList"),
    noteForm: document.getElementById("noteForm"),
    noteFormTitle: document.getElementById("noteFormTitle"),
    noteKindControl: document.getElementById("noteKindControl"),
    noteContentInput: document.getElementById("noteContentInput"),
    noteCharacterCount: document.getElementById("noteCharacterCount"),
    noteFormStatus: document.getElementById("noteFormStatus"),
    noteCancelEditButton: document.getElementById("noteCancelEditButton"),
    noteSaveButton: document.getElementById("noteSaveButton"),
    importResultDialog: document.getElementById("importResultDialog"),
    importResultTitle: document.getElementById("importResultTitle"),
    importResultSummary: document.getElementById("importResultSummary"),
    importResultDetails: document.getElementById("importResultDetails"),
    importResultCloseButton: document.getElementById("importResultCloseButton"),
    importResultConfirmButton: document.getElementById("importResultConfirmButton"),
    exportSelectedButton: document.getElementById("exportSelectedButton"),
    categoryOptions: document.getElementById("categoryOptions"),
    viewButtons: Array.from(document.querySelectorAll("[data-view]")),
  };

  function getInvoke() {
    return window.__TAURI__?.core?.invoke || null;
  }

  function isDesktopApp() {
    return typeof getInvoke() === "function";
  }

  function refreshIcons(root = document) {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons({ root, attrs: { "aria-hidden": "true" } });
    }
  }

  function normalizeThemePreference(value) {
    return Object.hasOwn(themeLabels, value) ? value : "light";
  }

  function readStoredTheme() {
    try {
      return normalizeThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
    } catch (_error) {
      return "light";
    }
  }

  function resolvedTheme(preference) {
    if (preference !== "system") return preference;
    return systemThemeMedia?.matches ? "dark" : "light";
  }

  function renderThemePicker() {
    const label = themeLabels[state.themePreference];
    els.themeButton.title = `主题：${label}`;
    els.themeButton.setAttribute("aria-label", `切换主题，当前为${label}`);
    els.themeButton.setAttribute("aria-expanded", String(state.themeMenuOpen));
    els.themeMenu.hidden = !state.themeMenuOpen;
    els.themeOptions.forEach((option) => {
      const active = option.dataset.themeOption === state.themePreference;
      option.classList.toggle("active", active);
      option.setAttribute("aria-checked", String(active));
    });
  }

  function applyTheme(preference, persist = true) {
    state.themePreference = normalizeThemePreference(preference);
    document.documentElement.dataset.theme = resolvedTheme(state.themePreference);
    document.documentElement.dataset.themePreference = state.themePreference;
    if (persist) {
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, state.themePreference);
      } catch (_error) {
        // The selected theme still applies for this session when storage is unavailable.
      }
    }
    renderThemePicker();
  }

  function openThemeMenu() {
    state.themeMenuOpen = true;
    renderThemePicker();
    window.requestAnimationFrame(() => {
      els.themeMenu.querySelector("[aria-checked=\"true\"]")?.focus();
    });
  }

  function closeThemeMenu(restoreFocus = false) {
    if (!state.themeMenuOpen) return;
    state.themeMenuOpen = false;
    renderThemePicker();
    if (restoreFocus) els.themeButton.focus();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatHex(value, minDigits = 2) {
    const n = Number(value || 0);
    return `0x${n.toString(16).toUpperCase().padStart(minDigits, "0")}`;
  }

  function getAddressSpan(reg) {
    return Math.max(1, Number(reg.address_span ?? reg.width ?? 1));
  }

  function getBitWidth(reg) {
    return Math.max(1, Number(reg.bit_width ?? (Number(reg.width || 1) * 8)));
  }

  function formatRange(reg) {
    const start = Number(reg.addr || 0);
    const addressSpan = getAddressSpan(reg);
    const end = start + addressSpan - 1;
    return addressSpan > 1 ? `${formatHex(start)}-${formatHex(end)}` : formatHex(start);
  }

  function getChip() {
    return chips[state.chipIndex] || chips[0] || null;
  }

  function chipId(name, fallback) {
    return String(name || fallback || "chip")
      .replace(/[^0-9A-Za-z_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase() || "chip";
  }

  function getPages(chip) {
    return chip && chip.pages ? chip.pages : {};
  }

  function getPage() {
    const chip = getChip();
    return getPages(chip)[state.pageName] || null;
  }

  function getRegisters() {
    const page = getPage();
    return page && Array.isArray(page.registers) ? page.registers : [];
  }

  function getRegisterKey(reg) {
    const chip = getChip();
    const registerIndex = getRegisters().indexOf(reg);
    return [
      chip?._id || chip?.sensor || "chip",
      state.pageName || "page",
      registerIndex,
      Number(reg.addr || 0),
      reg.name || "register",
      getAddressSpan(reg),
      getBitWidth(reg),
    ].join("::");
  }

  const noteKinds = {
    note: { label: "备注", icon: "sticky-note" },
    warning: { label: "注意", icon: "triangle-alert" },
    todo: { label: "待确认", icon: "circle-help" },
  };

  function getRegisterNotes(reg) {
    const chip = getChip();
    const notes = Array.isArray(chip?._notes) ? chip._notes : [];
    return notes.filter(
      (note) =>
        note.pageName === state.pageName &&
        Number(note.registerAddr) === Number(reg.addr || 0) &&
        note.registerName === reg.name,
    );
  }

  function countPageNotes() {
    return getRegisters().reduce((count, reg) => count + getRegisterNotes(reg).length, 0);
  }

  function renderNoteEditButton(reg) {
    if (!isDesktopApp()) return "";
    const count = getRegisterNotes(reg).length;
    const label = count ? `管理 ${count} 条备注` : "添加备注";
    return `
      <button class="note-edit-button ${count ? "has-notes" : ""}" type="button"
        data-note-register-key="${escapeHtml(getRegisterKey(reg))}" title="${label}" aria-label="${label}">
        <i data-lucide="${count ? "notebook-pen" : "sticky-note"}"></i>
      </button>
    `;
  }

  function renderRegisterNotes(reg) {
    const notes = getRegisterNotes(reg);
    if (!notes.length) return "";
    return `
      <div class="register-notes">
        ${notes
          .map((note) => {
            const kind = noteKinds[note.kind] || noteKinds.note;
            return `
              <div class="register-note ${escapeHtml(note.kind || "note")}">
                <span class="register-note-icon" title="${kind.label}"><i data-lucide="${kind.icon}"></i></span>
                <span>${escapeHtml(note.content)}</span>
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }

  function getRegisterValueText(reg) {
    const key = getRegisterKey(reg);
    if (state.registerValues.has(key)) {
      return state.registerValues.get(key);
    }
    const parsedReset = parseInputValue(reg.reset ?? 0);
    return formatBigIntHex(parsedReset.ok ? parsedReset.value : 0n, getBitWidth(reg));
  }

  function parseBits(bits) {
    const text = String(bits ?? "0");
    if (text.includes(":")) {
      const [hiText, loText] = text.split(":");
      const hi = Number.parseInt(hiText, 10);
      const lo = Number.parseInt(loText, 10);
      return { hi, lo, width: hi - lo + 1 };
    }
    const bit = Number.parseInt(text, 10);
    return { hi: bit, lo: bit, width: 1 };
  }

  function parseInputValue(text) {
    const compact = String(text || "").trim().replace(/_/g, "");
    if (!compact) {
      return { ok: true, value: 0n, message: "" };
    }

    try {
      if (/^0x[0-9a-f]+$/i.test(compact)) {
        return { ok: true, value: BigInt(compact), message: "" };
      }
      if (/^0b[01]+$/i.test(compact)) {
        return { ok: true, value: BigInt(compact), message: "" };
      }
      if (/^[01]+b$/i.test(compact)) {
        return { ok: true, value: BigInt(`0b${compact.slice(0, -1)}`), message: "" };
      }
      if (/^\d+$/.test(compact)) {
        return { ok: true, value: BigInt(compact), message: "" };
      }
    } catch (error) {
      return { ok: false, value: 0n, message: error.message };
    }

    return { ok: false, value: 0n, message: "输入值格式无效" };
  }

  function getRegisterValue(reg) {
    const parsed = parseInputValue(getRegisterValueText(reg));
    const bitWidth = BigInt(getBitWidth(reg));
    const mask = (1n << bitWidth) - 1n;
    return {
      ok: parsed.ok,
      raw: parsed.value,
      value: parsed.value & mask,
      clipped: parsed.value > mask,
      bitWidth: Number(bitWidth),
      message: parsed.message,
    };
  }

  function formatBigIntHex(value, bitWidth) {
    const digits = Math.max(1, Math.ceil(Number(bitWidth || 1) / 4));
    return `0x${value.toString(16).toUpperCase().padStart(digits, "0")}`;
  }

  function formatReset(value, bitWidth) {
    if (value === undefined || value === null) return "";
    const parsed = parseInputValue(value);
    return parsed.ok ? formatBigIntHex(parsed.value, bitWidth) : String(value);
  }

  function extractFieldValue(regValue, field) {
    const { lo, width } = parseBits(field.bits);
    const mask = (1n << BigInt(width)) - 1n;
    return (regValue >> BigInt(lo)) & mask;
  }

  function numericTokenToBigInt(token, fieldWidth) {
    const cleaned = String(token).trim();
    if (/^0x[0-9a-f]+$/i.test(cleaned)) {
      return BigInt(cleaned);
    }
    if (/^[01]+$/i.test(cleaned) && (cleaned.startsWith("0") || (cleaned.length === fieldWidth && fieldWidth <= 3))) {
      return BigInt(`0b${cleaned}`);
    }
    return BigInt(Number.parseInt(cleaned, 10));
  }

  function parseInlineEnums(field) {
    const desc = String(field.desc || "");
    const { width } = parseBits(field.bits);
    const entries = [];

    for (const line of desc.split(/\r?\n/)) {
      const match = line.trim().match(/^((?:0x[0-9a-fA-F]+|[01]+|\d+)(?:\s*[~～-]\s*(?:0x[0-9a-fA-F]+|[01]+|\d+))?)\s*=\s*(.+)$/);
      if (!match) continue;

      const [startToken, endToken] = match[1].split(/\s*[~～-]\s*/);
      try {
        const from = numericTokenToBigInt(startToken, width);
        const to = endToken ? numericTokenToBigInt(endToken, width) : from;
        entries.push({ from, to, desc: match[2].trim() });
      } catch {
        continue;
      }
    }

    return entries;
  }

  function getFieldEnumEntries(field) {
    const entries = [];

    if (field.values && !Array.isArray(field.values) && typeof field.values === "object") {
      for (const [key, desc] of Object.entries(field.values)) {
        try {
          const value = BigInt(key);
          entries.push({ from: value, to: value, desc: String(desc) });
        } catch {
          continue;
        }
      }
    }

    if (Array.isArray(field.values)) {
      for (const item of field.values) {
        try {
          const value = BigInt(item.value);
          entries.push({ from: value, to: value, desc: String(item.desc ?? item.name ?? item.value) });
        } catch {
          continue;
        }
      }
    }

    entries.push(...parseInlineEnums(field));
    return entries;
  }

  function getStructuredEnum(field, value) {
    for (const item of getFieldEnumEntries(field)) {
      if (value >= item.from && value <= item.to) {
        return item.desc;
      }
    }

    return "";
  }

  function formatEnumKey(item) {
    const from = item.from.toString(10);
    const to = item.to.toString(10);
    return item.from === item.to ? from : `${from}~${to}`;
  }

  function renderEnumList(field, currentValue) {
    const enums = getFieldEnumEntries(field);
    if (!enums.length) return "";

    const items = enums
      .map((item) => {
        const active = currentValue >= item.from && currentValue <= item.to;
        return `
          <span class="enum-chip ${active ? "active" : ""}">
            <code>${escapeHtml(formatEnumKey(item))}</code>
            <span>${escapeHtml(item.desc)}</span>
          </span>
        `;
      })
      .join("");

    return `<div class="enum-list">${items}</div>`;
  }

  function stripEnumLines(desc) {
    return String(desc || "")
      .split(/\r?\n/)
      .filter((line) => !line.trim().match(/^(?:0x[0-9a-fA-F]+|[01]+|\d+)(?:\s*[~～-]\s*(?:0x[0-9a-fA-F]+|[01]+|\d+))?\s*=/))
      .join("\n")
      .trim();
  }

  function hasSpecialBehavior(reg) {
    return Boolean(reg.multi_byte || reg.read_clear || reg.no_dump || reg.alias_note || reg.roles);
  }

  function registerMatchesQuery(reg, query) {
    if (!query) return true;
    const target = [
      formatHex(reg.addr),
      reg.name,
      reg.access,
      reg.reset,
      reg.desc,
      reg.alias_note,
      ...(reg.fields || []).flatMap((field) => [field.name, field.bits, field.access, field.reset, field.desc]),
      ...getRegisterNotes(reg).flatMap((note) => [note.content, noteKinds[note.kind]?.label || note.kind]),
    ]
      .join(" ")
      .toLowerCase();
    return target.includes(query);
  }

  function summarizePage() {
    const chip = getChip();
    const page = getPage();
    const regs = getRegisters();
    if (!chip || !page) {
      els.chipMeta.textContent = "未加载芯片";
      els.statusBand.textContent = state.loadMessage || "请选择 YAML 文件或目录";
      return;
    }

    const fieldCount = regs.reduce((sum, reg) => sum + (reg.fields || []).length, 0);
    const noteCount = countPageNotes();
    els.chipMeta.textContent = `${chip.sensor || "Unknown"} · ${chip._source || "内置数据"}`;
    const summary = `${state.pageName} 页 · page_id ${formatHex(page.page_id)} · ${page.access || ""} · ${regs.length} 个寄存器 · ${fieldCount} 个位域${noteCount ? ` · ${noteCount} 条备注` : ""}`;
    els.statusBand.textContent = state.loadMessage ? `${summary} · ${state.loadMessage}` : summary;
  }

  function getAccessClass(regs) {
    const first = regs.find((reg) => reg.access) || {};
    return `access-${String(first.access || "").toLowerCase()}`;
  }

  function buildRegisterIndex(regs) {
    const map = new Map();
    for (const reg of regs) {
      const start = Number(reg.addr || 0);
      const addressSpan = getAddressSpan(reg);
      for (let addr = start; addr < start + addressSpan; addr += 1) {
        if (!map.has(addr)) map.set(addr, []);
        map.get(addr).push(reg);
      }
    }
    return map;
  }

  function renderBadges(reg) {
    const badges = [`<span class="badge ${String(reg.access || "").toLowerCase()}">${escapeHtml(reg.access || "")}</span>`];
    badges.push(`<span class="badge">${getBitWidth(reg)} bit</span>`);
    const reset = formatReset(reg.reset, getBitWidth(reg));
    if (reset) badges.push(`<span class="badge">reset=${escapeHtml(reset)}</span>`);
    if (getAddressSpan(reg) !== Number(reg.width || 1)) {
      badges.push(`<span class="badge">span=${getAddressSpan(reg)}</span>`);
    }
    if (reg.multi_byte) badges.push(`<span class="badge">multi</span>`);
    if (reg.read_clear) badges.push(`<span class="badge warn">read-clear</span>`);
    if (reg.no_dump) badges.push(`<span class="badge warn">no-dump</span>`);
    if (reg.alias_note) badges.push(`<span class="badge">alias</span>`);
    return badges.join("");
  }

  function renderMatrix() {
    const regs = getRegisters();
    const query = state.query.trim().toLowerCase();
    const index = buildRegisterIndex(regs);
    const rowBases = Array.from(new Set(Array.from(index.keys(), (addr) => Math.floor(addr / 16) * 16))).sort((a, b) => a - b);
    const cells = [];

    rowBases.forEach((rowBase, rowIndex) => {
      const previousRow = rowBases[rowIndex - 1];
      if (rowIndex > 0 && rowBase > previousRow + 16) {
        cells.push(`
          <div class="address-gap">
            <span>${formatHex(previousRow + 16)}-${formatHex(rowBase - 1)}</span>
            <span>未定义地址段</span>
          </div>
        `);
      }

      for (let addr = rowBase; addr < rowBase + 16; addr += 1) {
        const related = index.get(addr) || [];
        const matching = related.filter((reg) => registerMatchesQuery(reg, query));
        const hasRegister = related.length > 0;
        const startRegs = related.filter((reg) => Number(reg.addr || 0) === addr);
        const displayRegs = startRegs.length ? startRegs : related;
        const noteCount = startRegs.reduce((count, reg) => count + getRegisterNotes(reg).length, 0);
        const isCoveredOnly = hasRegister && !startRegs.length;
        const special = related.some(hasSpecialBehavior);
        const cellClass = [
          "reg-cell",
          hasRegister ? "has-register" : "empty",
          isCoveredOnly ? "covered-only" : "",
          special ? "has-special" : "",
          noteCount ? "has-note" : "",
          hasRegister ? getAccessClass(related) : "",
          query && hasRegister && !matching.length ? "filtered-out" : "",
        ]
          .filter(Boolean)
          .join(" ");

        const names = displayRegs.slice(0, 2).map((reg) => reg.name).join(" / ");
        const extra = displayRegs.length > 2 ? ` +${displayRegs.length - 2}` : "";
        const dataRegs = hasRegister ? `data-address="${addr}" tabindex="0"` : "";
        const access = hasRegister ? displayRegs[0].access || "" : "";

        cells.push(`
          <div class="${cellClass}" ${dataRegs}>
            <div class="cell-address">
              <strong>${formatHex(addr)}</strong>
              ${hasRegister ? `<span class="access-pill ${escapeHtml(String(access).toLowerCase())}">${escapeHtml(access)}</span>` : ""}
            </div>
            <div class="cell-name">${hasRegister ? escapeHtml(names + extra) : "-"}</div>
            ${noteCount ? `<span class="cell-note-indicator" title="${noteCount} 条备注"><i data-lucide="sticky-note"></i></span>` : ""}
          </div>
        `);
      }
    });

    if (!rowBases.length) {
      cells.push(`<div class="empty-state address-empty">当前页面没有寄存器</div>`);
    }

    const visible = query ? regs.filter((reg) => registerMatchesQuery(reg, query)).length : regs.length;
    els.matrixSummary.textContent = `${visible}/${regs.length} 个寄存器匹配 · ${rowBases.length} 个有效地址行`;
    els.matrixGrid.innerHTML = cells.join("");
    refreshIcons(els.matrixGrid);

    els.matrixGrid.querySelectorAll(".has-register").forEach((cell) => {
      cell.addEventListener("mouseenter", showHoverPanel);
      cell.addEventListener("mouseover", showHoverPanel);
      cell.addEventListener("pointerover", showHoverPanel);
      cell.addEventListener("mousemove", moveHoverPanel);
      cell.addEventListener("pointermove", moveHoverPanel);
      cell.addEventListener("click", showHoverPanel);
      cell.addEventListener("mouseleave", scheduleHideHoverPanel);
      cell.addEventListener("pointerleave", scheduleHideHoverPanel);
      cell.addEventListener("focus", showHoverPanel);
      cell.addEventListener("blur", scheduleHideHoverPanel);
    });
  }

  function renderBitLane(reg, valueInfo) {
    const bitWidth = getBitWidth(reg);
    if (!valueInfo.ok || bitWidth > 64) return "";

    const bits = [];
    for (let bit = bitWidth - 1; bit >= 0; bit -= 1) {
      const set = ((valueInfo.value >> BigInt(bit)) & 1n) === 1n;
      bits.push(`<div class="bit-box ${set ? "set" : ""}"><div>${bit}</div><div>${set ? "1" : "0"}</div></div>`);
    }

    return `<div class="bit-lane-scroll"><div class="bit-lane" style="--bit-count: ${bitWidth}">${bits.join("")}</div></div>`;
  }

  function getRegisterValuePresentation(reg) {
    const valueInfo = getRegisterValue(reg);
    if (!valueInfo.ok) {
      return { className: "invalid", text: valueInfo.message || "输入值格式无效" };
    }

    const decoded = formatBigIntHex(valueInfo.value, valueInfo.bitWidth);
    if (valueInfo.clipped) {
      return { className: "clipped", text: `截取低 ${valueInfo.bitWidth} bit：${decoded}` };
    }
    return { className: "valid", text: `解码：${decoded}` };
  }

  function renderRegisterValueEditor(reg, compact = false) {
    const key = getRegisterKey(reg);
    const presentation = getRegisterValuePresentation(reg);
    return `
      <label class="register-value-editor ${compact ? "compact" : ""}">
        ${compact ? "" : `<span class="register-value-label">寄存器值</span>`}
        <input
          class="register-value-input"
          type="text"
          spellcheck="false"
          value="${escapeHtml(getRegisterValueText(reg))}"
          data-register-key="${escapeHtml(key)}"
          aria-label="${escapeHtml(reg.name || "寄存器")} 的寄存器值"
        >
        <span class="register-value-status ${presentation.className}">${escapeHtml(presentation.text)}</span>
      </label>
    `;
  }

  function renderFieldRows(reg, compact = false) {
    const fields = Array.isArray(reg.fields) ? reg.fields : [];
    if (!fields.length) return `<div class="empty-state">无位域定义</div>`;

    const valueInfo = getRegisterValue(reg);
    if (!valueInfo.ok) {
      return `<div class="empty-state">${escapeHtml(valueInfo.message)}</div>`;
    }

    return fields
      .map((field) => {
        const bits = parseBits(field.bits);
        const fieldValue = extractFieldValue(valueInfo.value, field);
        const isSet = fieldValue !== 0n;
        const meaning = getStructuredEnum(field, fieldValue);
        const desc = stripEnumLines(field.desc || "");
        const valueLabel = `${formatBigIntHex(fieldValue, bits.width)} / ${fieldValue.toString(10)}`;
        const enumList = renderEnumList(field, fieldValue);
        const fieldAccess = field.access ? `<span class="field-access">${escapeHtml(field.access)}</span>` : "";
        const fieldReset = formatReset(field.reset, bits.width);
        return `
          <div class="field-row ${isSet ? "is-set" : ""}">
            <div class="field-name">${escapeHtml(field.name)} ${fieldAccess}</div>
            <div class="field-bits">[${escapeHtml(field.bits)}]${fieldReset ? `<br>reset ${escapeHtml(fieldReset)}` : ""}</div>
            <div class="field-value">${escapeHtml(valueLabel)}</div>
            <div class="field-meaning">
              ${meaning ? `<strong>${escapeHtml(meaning)}</strong>` : `<span class="muted">未匹配枚举</span>`}
              ${enumList}
              ${desc && !compact ? `<div class="field-desc">${escapeHtml(desc).replace(/\n/g, "<br>")}</div>` : ""}
            </div>
          </div>
        `;
      })
      .join("");
  }

  function renderRegisterBlock(reg, compact = false) {
    const valueInfo = getRegisterValue(reg);
    const key = getRegisterKey(reg);
    return `
      <div class="register-block register-display" data-register-key="${escapeHtml(key)}">
        <div class="register-heading">
          <h3>${escapeHtml(reg.name)} <span class="addr-cell">${formatRange(reg)}</span></h3>
          ${renderNoteEditButton(reg)}
        </div>
        <div class="hover-meta">
          ${renderBadges(reg)}
        </div>
        ${renderRegisterValueEditor(reg, false)}
        <div class="register-desc">${escapeHtml(reg.desc || "").replace(/\n/g, "<br>")}</div>
        ${reg.alias_note ? `<div class="register-desc"><span class="badge">alias</span> ${escapeHtml(reg.alias_note)}</div>` : ""}
        ${renderRegisterNotes(reg)}
        <div class="bit-lane-slot">${renderBitLane(reg, valueInfo)}</div>
        <div class="field-list" data-compact="${compact ? "true" : "false"}">${renderFieldRows(reg, compact)}</div>
      </div>
    `;
  }

  function relatedRegsForAddress(addr) {
    const regs = getRegisters();
    return regs.filter((reg) => {
      const start = Number(reg.addr || 0);
      const end = start + getAddressSpan(reg) - 1;
      return addr >= start && addr <= end;
    });
  }

  function renderHoverPanelContent(regs) {
    const modeText = state.hoverPinned ? "锁定" : "预览";
    return `
      <div class="hover-panel-bar">
        <span>${modeText}</span>
        <button class="hover-close" type="button" aria-label="关闭详情窗口">×</button>
      </div>
      ${regs.map((reg) => renderRegisterBlock(reg, true)).join("")}
    `;
  }

  function cancelHoverClose() {
    if (state.hoverCloseTimer) {
      window.clearTimeout(state.hoverCloseTimer);
      state.hoverCloseTimer = null;
    }
  }

  function showHoverPanel(event) {
    cancelHoverClose();

    const addr = Number(event.currentTarget.dataset.address);
    const regs = relatedRegsForAddress(addr);
    if (!regs.length) return;

    const shouldPin = event.type === "click";
    if (state.hoverPinned && !shouldPin) return;

    if (!shouldPin && state.activeHoverAddress === addr && !els.hoverPanel.hidden) {
      moveHoverPanel(event);
      return;
    }

    state.hoverPinned = shouldPin;
    state.activeHoverAddress = addr;
    els.hoverPanel.classList.toggle("pinned", state.hoverPinned);
    els.hoverPanel.innerHTML = renderHoverPanelContent(regs);
    refreshIcons(els.hoverPanel);
    els.hoverPanel.hidden = false;
    els.hoverPanel.setAttribute("tabindex", "-1");
    moveHoverPanel(event, true);

    if (state.hoverPinned) {
      els.hoverPanel.focus({ preventScroll: true });
    }
  }

  function moveHoverPanel(event, force = false) {
    const panel = els.hoverPanel;
    if (panel.hidden) return;
    if (state.hoverPinned && !force) return;

    const x = event.clientX || event.currentTarget.getBoundingClientRect().right;
    const y = event.clientY || event.currentTarget.getBoundingClientRect().top;
    const margin = 14;
    const rect = panel.getBoundingClientRect();
    let left = x + margin;
    let top = y + margin;

    if (left + rect.width > window.innerWidth - margin) {
      left = Math.max(margin, x - rect.width - margin);
    }
    if (top + rect.height > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - rect.height - margin);
    }

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  function hideHoverPanel(force = false) {
    if (state.hoverPinned && !force) return;
    cancelHoverClose();
    state.hoverPinned = false;
    state.activeHoverAddress = null;
    els.hoverPanel.classList.remove("pinned");
    els.hoverPanel.hidden = true;
  }

  function scheduleHideHoverPanel() {
    if (state.hoverPinned) return;
    cancelHoverClose();
    state.hoverCloseTimer = window.setTimeout(() => {
      if (!els.hoverPanel.matches(":hover")) {
        hideHoverPanel(true);
      }
    }, 180);
  }

  function renderTable() {
    const regs = getRegisters();
    const query = state.query.trim().toLowerCase();
    const rows = regs.filter((reg) => registerMatchesQuery(reg, query));

    const noteCount = rows.reduce((count, reg) => count + getRegisterNotes(reg).length, 0);
    els.tableSummary.textContent = `${rows.length}/${regs.length} 个寄存器匹配 · ${noteCount} 条备注 · 每个寄存器独立保存输入值`;

    if (!rows.length) {
      els.tableBody.innerHTML = `<tr><td colspan="6"><div class="empty-state">没有匹配的寄存器</div></td></tr>`;
      return;
    }

    els.tableBody.innerHTML = rows
      .map((reg) => {
        const key = getRegisterKey(reg);
        return `
        <tr class="register-display" data-register-key="${escapeHtml(key)}">
          <td class="addr-cell">${formatRange(reg)}</td>
          <td class="name-cell">
            <div class="name-cell-heading">
              <strong>${escapeHtml(reg.name)}</strong>
              ${renderNoteEditButton(reg)}
            </div>
            <div class="cell-badges">${renderBadges(reg)}</div>
          </td>
          <td>${escapeHtml(reg.access || "")}<br><span class="field-bits">${getBitWidth(reg)} bit</span></td>
          <td class="value-cell">${renderRegisterValueEditor(reg, true)}</td>
          <td class="desc-cell">
            ${escapeHtml(reg.desc || "").replace(/\n/g, "<br>")}
            ${reg.alias_note ? `<div class="field-desc">${escapeHtml(reg.alias_note)}</div>` : ""}
            ${renderRegisterNotes(reg)}
          </td>
          <td class="fields-cell"><div class="field-list" data-compact="false">${renderFieldRows(reg, false)}</div></td>
        </tr>
      `;
      })
      .join("");
    refreshIcons(els.tableBody);
  }

  function findRegisterByKey(key) {
    return getRegisters().find((reg) => getRegisterKey(reg) === key) || null;
  }

  function refreshRegisterValueDisplays(reg, key, sourceInput) {
    const valueText = getRegisterValueText(reg);
    document.querySelectorAll(".register-value-input").forEach((input) => {
      if (input.dataset.registerKey === key && input !== sourceInput) {
        input.value = valueText;
      }
    });

    const presentation = getRegisterValuePresentation(reg);
    const valueInfo = getRegisterValue(reg);
    document.querySelectorAll(".register-display").forEach((container) => {
      if (container.dataset.registerKey !== key) return;

      const status = container.querySelector(".register-value-status");
      if (status) {
        status.className = `register-value-status ${presentation.className}`;
        status.textContent = presentation.text;
      }

      const bitLaneSlot = container.querySelector(".bit-lane-slot");
      if (bitLaneSlot) {
        bitLaneSlot.innerHTML = renderBitLane(reg, valueInfo);
      }

      const fieldList = container.querySelector(".field-list");
      if (fieldList) {
        const compact = fieldList.dataset.compact === "true";
        fieldList.innerHTML = renderFieldRows(reg, compact);
      }
    });
  }

  function handleRegisterValueInput(event) {
    const input = event.target.closest(".register-value-input");
    if (!input) return;

    const key = input.dataset.registerKey;
    const reg = findRegisterByKey(key);
    if (!reg) return;

    state.registerValues.set(key, input.value);
    refreshRegisterValueDisplays(reg, key, input);
  }

  function render() {
    hideHoverPanel(true);
    updateAttachmentsButton();
    summarizePage();
    renderMatrix();
    renderTable();
  }

  function fallbackCategory(record) {
    return record.deviceType === "usb_controller" ? "接口控制器" : "传感器";
  }

  function recordToChip(record) {
    let chip;
    if (record.chipData) {
      chip = record.chipData;
    } else {
      const data = window.parseRegisterYaml(record.yamlText);
      window.assertRegisterYaml(record.yamlText, data);
      chip = normalizeLoadedChip(data, record.sourceName);
    }
    chip._id = record.id;
    chip._libraryId = record.id;
    chip._source = record.sourceName;
    chip._category = record.category || fallbackCategory(record);
    chip._builtin = Boolean(record.builtin);
    chip._notes = Array.isArray(record.notes) ? record.notes : Array.isArray(chip._notes) ? chip._notes : [];
    chip._attachments = Array.isArray(record.attachments) ? record.attachments : [];
    return chip;
  }

  function applyLibraryRecords(records) {
    const previousChipId = getChip()?._libraryId || getChip()?._id || "";
    const previousIds = new Set(libraryRecords.map((record) => record.id));
    libraryRecords = Array.isArray(records) ? records : [];

    if (!state.exportSelectionInitialized) {
      libraryRecords.filter((record) => record.enabled).forEach((record) => state.exportSelection.add(record.id));
      state.exportSelectionInitialized = true;
    } else {
      libraryRecords
        .filter((record) => record.enabled && !previousIds.has(record.id))
        .forEach((record) => state.exportSelection.add(record.id));
    }

    const loaded = [];
    const failures = [];
    for (const record of libraryRecords.filter((item) => item.enabled)) {
      try {
        loaded.push(recordToChip(record));
      } catch (error) {
        failures.push(`${record.sourceName}: ${error.message}`);
      }
    }

    chips.splice(0, chips.length, ...loaded);
    const previousIndex = chips.findIndex((chip) => (chip._libraryId || chip._id) === previousChipId);
    state.chipIndex = previousIndex >= 0 ? previousIndex : 0;
    populateChipSelect();
    populatePageSelect();
    if (failures.length) {
      state.loadMessage = `有 ${failures.length} 个库条目无法解析：${failures.join("；")}`;
    }
    render();
    if (state.libraryOpen) renderLibraryList();
  }

  function createStaticLibraryRecords() {
    return chips.map((chip, index) => {
      const id = chip._id || chipId(chip.sensor, `chip-${index + 1}`);
      return {
        id,
        sensor: chip.sensor || id,
        vendor: chip.vendor || "",
        family: chip.family || "",
        deviceType: chip.device_type || "",
        category: chip._category || (chip.device_type === "usb_controller" ? "接口控制器" : "传感器"),
        enabled: true,
        builtin: true,
        sourceKind: "builtin",
        sourceName: chip._source || `${id}.yaml`,
        sourcePath: null,
        yamlText: "",
        notes: Array.isArray(chip._notes) ? chip._notes : [],
        attachments: [],
        chipData: chip,
      };
    });
  }

  async function initializeLibrary() {
    if (isDesktopApp()) {
      const records = await getInvoke()("list_chips");
      applyLibraryRecords(records);
      return;
    }
    applyLibraryRecords(createStaticLibraryRecords());
  }

  function setLibraryStatus(message, isError = false) {
    state.libraryStatus = message;
    state.libraryStatusError = isError;
    if (!els.libraryStatus) return;
    els.libraryStatus.textContent = message;
    els.libraryStatus.classList.toggle("error", isError);
  }

  function errorMessage(error) {
    if (typeof error === "string") return error;
    return error?.message || String(error);
  }

  function showImportFailures(title, summary, failures) {
    if (!els.importResultDialog || !failures.length) return;
    els.importResultTitle.textContent = title;
    els.importResultSummary.textContent = summary;
    els.importResultDetails.textContent = failures.join("\n\n");
    if (els.importResultDialog.open) els.importResultDialog.close();
    els.importResultDialog.showModal();
    refreshIcons(els.importResultDialog);
  }

  function getActiveNoteRegister() {
    return state.noteRegisterKey ? findRegisterByKey(state.noteRegisterKey) : null;
  }

  function formatNoteTime(value) {
    if (!value) return "";
    const parsed = new Date(`${String(value).replace(" ", "T")}Z`);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString("zh-CN", { hour12: false });
  }

  function applyCurrentChipNotes(notes) {
    const chip = getChip();
    if (!chip) return;
    chip._notes = Array.isArray(notes) ? notes : [];
    const chipId = chip._libraryId || chip._id;
    const record = libraryRecords.find((item) => item.id === chipId);
    if (record) record.notes = chip._notes;
  }

  function updateNoteFormState() {
    const contentLength = els.noteContentInput.value.length;
    els.noteCharacterCount.textContent = `${contentLength}/4000`;
    els.noteSaveButton.disabled = !els.noteContentInput.value.trim();
    els.noteKindControl.querySelectorAll("[data-note-kind]").forEach((button) => {
      const active = button.dataset.noteKind === state.noteKind;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function resetNoteEditor() {
    state.editingNoteId = null;
    state.noteKind = "note";
    els.noteContentInput.value = "";
    els.noteFormTitle.textContent = "添加备注";
    els.noteCancelEditButton.hidden = true;
    els.noteFormStatus.textContent = "";
    els.noteFormStatus.classList.remove("success");
    updateNoteFormState();
  }

  function renderNoteList() {
    const reg = getActiveNoteRegister();
    if (!reg) return;
    const notes = getRegisterNotes(reg);
    els.noteList.innerHTML = notes
      .map((note) => {
        const kind = noteKinds[note.kind] || noteKinds.note;
        return `
          <div class="note-item ${escapeHtml(note.kind || "note")}" data-note-id="${Number(note.id)}">
            <span class="note-item-kind" title="${kind.label}"><i data-lucide="${kind.icon}"></i></span>
            <div class="note-item-content">
              <p>${escapeHtml(note.content)}</p>
              <div class="note-item-meta">${kind.label} · ${escapeHtml(formatNoteTime(note.updatedAt))}</div>
            </div>
            <div class="note-item-actions">
              <button class="icon-button" type="button" data-note-action="edit" title="编辑备注" aria-label="编辑备注">
                <i data-lucide="pencil"></i>
              </button>
              <button class="icon-button danger" type="button" data-note-action="delete" title="删除备注" aria-label="删除备注">
                <i data-lucide="trash-2"></i>
              </button>
            </div>
          </div>
        `;
      })
      .join("");
    refreshIcons(els.noteDialog);
  }

  function openNoteDialog(registerKey) {
    if (!isDesktopApp()) return;
    state.noteRegisterKey = registerKey;
    const reg = getActiveNoteRegister();
    if (!reg) return;
    hideHoverPanel(true);
    els.noteDialogRegister.textContent = `${state.pageName} · ${formatRange(reg)} · ${reg.name}`;
    resetNoteEditor();
    renderNoteList();
    els.noteDialog.showModal();
    refreshIcons(els.noteDialog);
    window.setTimeout(() => els.noteContentInput.focus(), 0);
  }

  function closeNoteDialog() {
    if (els.noteDialog.open) els.noteDialog.close();
    state.noteRegisterKey = null;
    resetNoteEditor();
  }

  function beginNoteEdit(noteId) {
    const reg = getActiveNoteRegister();
    const note = reg && getRegisterNotes(reg).find((item) => Number(item.id) === noteId);
    if (!note) return;
    state.editingNoteId = noteId;
    state.noteKind = note.kind in noteKinds ? note.kind : "note";
    els.noteContentInput.value = note.content;
    els.noteFormTitle.textContent = "编辑备注";
    els.noteCancelEditButton.hidden = false;
    els.noteFormStatus.textContent = "";
    els.noteFormStatus.classList.remove("success");
    updateNoteFormState();
    els.noteContentInput.focus();
    els.noteContentInput.setSelectionRange(els.noteContentInput.value.length, els.noteContentInput.value.length);
  }

  async function saveActiveNote() {
    const reg = getActiveNoteRegister();
    const chip = getChip();
    const content = els.noteContentInput.value.trim();
    if (!reg || !chip || !content || !isDesktopApp()) return;

    els.noteSaveButton.disabled = true;
    els.noteFormStatus.textContent = "正在保存...";
    els.noteFormStatus.classList.remove("success");
    try {
      const notes = await getInvoke()("save_register_note", {
        input: {
          noteId: state.editingNoteId,
          chipId: chip._libraryId || chip._id,
          pageName: state.pageName,
          registerAddr: Number(reg.addr || 0),
          registerName: reg.name,
          kind: state.noteKind,
          content,
        },
      });
      applyCurrentChipNotes(notes);
      resetNoteEditor();
      render();
      renderNoteList();
      els.noteFormStatus.textContent = "已保存";
      els.noteFormStatus.classList.add("success");
      els.noteContentInput.focus();
    } catch (error) {
      els.noteFormStatus.textContent = errorMessage(error);
      updateNoteFormState();
    }
  }

  async function deleteActiveNote(noteId) {
    const chip = getChip();
    if (!chip || !isDesktopApp() || !window.confirm("删除这条备注？")) return;
    try {
      const notes = await getInvoke()("delete_register_note", {
        chipId: chip._libraryId || chip._id,
        noteId,
      });
      applyCurrentChipNotes(notes);
      if (state.editingNoteId === noteId) resetNoteEditor();
      render();
      renderNoteList();
    } catch (error) {
      els.noteFormStatus.textContent = errorMessage(error);
      els.noteFormStatus.classList.remove("success");
    }
  }

  function handleNoteEditButton(event) {
    const button = event.target.closest("[data-note-register-key]");
    if (!button) return false;
    event.preventDefault();
    openNoteDialog(button.dataset.noteRegisterKey);
    return true;
  }

  function getCurrentAttachments() {
    const chip = getChip();
    return Array.isArray(chip?._attachments) ? chip._attachments : [];
  }

  function applyCurrentChipAttachments(attachments) {
    const chip = getChip();
    if (!chip) return;
    chip._attachments = Array.isArray(attachments) ? attachments : [];
    const chipId = chip._libraryId || chip._id;
    const record = libraryRecords.find((item) => item.id === chipId);
    if (record) record.attachments = chip._attachments;
  }

  function updateAttachmentsButton() {
    const chip = getChip();
    const count = getCurrentAttachments().length;
    els.attachmentsButton.hidden = !isDesktopApp() || !chip;
    els.attachmentsButtonCount.hidden = count === 0;
    els.attachmentsButtonCount.textContent = String(count);
    els.attachmentsButton.title = count ? `当前芯片有 ${count} 个附件` : "当前芯片附件";
  }

  function formatFileSize(sizeBytes) {
    const size = Number(sizeBytes);
    if (!Number.isFinite(size) || size < 0) return "";
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
    if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
    return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  function attachmentIcon(fileName) {
    const extension = String(fileName || "").split(".").pop().toLowerCase();
    if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "heic"].includes(extension)) return "image";
    if (["pdf", "md", "markdown", "txt", "rtf", "doc", "docx"].includes(extension)) return "file-text";
    return "file";
  }

  function setAttachmentsStatus(message, isError = false) {
    state.attachmentsStatus = message;
    state.attachmentsStatusError = isError;
    els.attachmentsStatus.textContent = message;
    els.attachmentsStatus.classList.toggle("error", isError);
  }

  function renderAttachmentsDialog() {
    const chip = getChip();
    const attachments = getCurrentAttachments();
    if (!chip) return;
    els.attachmentsDialogChip.textContent = chip.sensor || chip._id || "当前芯片";
    const available = attachments.filter((attachment) => attachment.exists).length;
    const totalSize = attachments.reduce((sum, attachment) => sum + Number(attachment.sizeBytes || 0), 0);
    const sizeLabel = attachments.length ? formatFileSize(totalSize) : "";
    els.attachmentsSummary.textContent = `${attachments.length} 个附件${attachments.length !== available ? ` · ${attachments.length - available} 个文件不可用` : ""}${sizeLabel ? ` · ${sizeLabel}` : ""}`;
    els.attachmentsList.innerHTML = attachments.length
      ? attachments
          .map((attachment) => {
            const size = formatFileSize(attachment.sizeBytes);
            const metadata = attachment.exists ? size || "本地文件" : "文件不存在或已经移动";
            return `
              <div class="attachment-row ${attachment.exists ? "" : "missing"}" data-attachment-id="${Number(attachment.id)}">
                <span class="attachment-file-icon"><i data-lucide="${attachmentIcon(attachment.fileName)}"></i></span>
                <div class="attachment-file-info">
                  <button class="attachment-open-button" type="button" data-attachment-action="open" ${attachment.exists ? "" : "disabled"}
                    title="打开 ${escapeHtml(attachment.fileName)}">${escapeHtml(attachment.fileName)}</button>
                  <div class="attachment-path" title="${escapeHtml(attachment.filePath)}">${escapeHtml(attachment.filePath)}</div>
                  <div class="attachment-meta">${escapeHtml(metadata)}</div>
                </div>
                <div class="attachment-actions">
                  <button class="icon-button" type="button" data-attachment-action="open" title="使用默认应用打开" aria-label="使用默认应用打开" ${attachment.exists ? "" : "disabled"}>
                    <i data-lucide="external-link"></i>
                  </button>
                  <button class="icon-button" type="button" data-attachment-action="reveal" title="在文件管理器中显示" aria-label="在文件管理器中显示" ${attachment.exists ? "" : "disabled"}>
                    <i data-lucide="folder-open"></i>
                  </button>
                  <button class="icon-button danger" type="button" data-attachment-action="delete" title="移除附件关联" aria-label="移除附件关联">
                    <i data-lucide="trash-2"></i>
                  </button>
                </div>
              </div>
            `;
          })
          .join("")
      : `<div class="empty-state">暂无附件</div>`;
    setAttachmentsStatus(state.attachmentsStatus, state.attachmentsStatusError);
    refreshIcons(els.attachmentsDialog);
  }

  async function openAttachmentsDialog() {
    if (!isDesktopApp() || !getChip()) return;
    if (els.noteDialog.open) closeNoteDialog();
    setAttachmentsStatus("");
    renderAttachmentsDialog();
    els.attachmentsDialog.showModal();
    refreshIcons(els.attachmentsDialog);
    const chip = getChip();
    try {
      const attachments = await getInvoke()("list_chip_attachments", { chipId: chip._libraryId || chip._id });
      applyCurrentChipAttachments(attachments);
      updateAttachmentsButton();
      renderAttachmentsDialog();
    } catch (error) {
      setAttachmentsStatus(errorMessage(error), true);
    }
  }

  function closeAttachmentsDialog() {
    if (els.attachmentsDialog.open) els.attachmentsDialog.close();
    setAttachmentsStatus("");
  }

  async function addAttachments() {
    const chip = getChip();
    if (!chip || !isDesktopApp()) return;
    setAttachmentsStatus("正在选择文件...");
    try {
      const report = await getInvoke()("add_chip_attachments", { chipId: chip._libraryId || chip._id });
      applyCurrentChipAttachments(report.attachments);
      if (report.canceled) {
        setAttachmentsStatus("");
      } else if (report.failures.length) {
        setAttachmentsStatus(`已添加 ${report.added} 个，失败 ${report.failures.length} 个：${report.failures.join("；")}`, true);
      } else if (report.added === 0) {
        setAttachmentsStatus("所选文件已经关联");
      } else {
        setAttachmentsStatus(`已添加 ${report.added} 个附件`);
      }
      updateAttachmentsButton();
      renderAttachmentsDialog();
    } catch (error) {
      setAttachmentsStatus(errorMessage(error), true);
    }
  }

  async function handleAttachmentAction(event) {
    const action = event.target.closest("[data-attachment-action]");
    const row = event.target.closest("[data-attachment-id]");
    const chip = getChip();
    if (!action || !row || !chip || action.disabled) return;
    const attachmentId = Number(row.dataset.attachmentId);
    const attachment = getCurrentAttachments().find((item) => Number(item.id) === attachmentId);
    if (!attachment) return;
    const chipId = chip._libraryId || chip._id;

    try {
      if (action.dataset.attachmentAction === "delete") {
        if (!window.confirm("移除这个附件关联？原文件不会被删除。")) return;
        const attachments = await getInvoke()("delete_chip_attachment", { chipId, attachmentId });
        applyCurrentChipAttachments(attachments);
        setAttachmentsStatus(`已移除 ${attachment.fileName}，原文件未删除`);
        updateAttachmentsButton();
        renderAttachmentsDialog();
        return;
      }
      const command = action.dataset.attachmentAction === "reveal" ? "reveal_chip_attachment" : "open_chip_attachment";
      await getInvoke()(command, { chipId, attachmentId });
      setAttachmentsStatus(command === "reveal_chip_attachment" ? "已在文件管理器中显示" : `已打开 ${attachment.fileName}`);
    } catch (error) {
      setAttachmentsStatus(errorMessage(error), true);
    }
  }

  function renderLibraryList() {
    const query = state.libraryQuery.trim().toLowerCase();
    const filtered = libraryRecords.filter((record) =>
      [record.sensor, record.vendor, record.family, record.category, record.sourceName]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
    const enabledCount = libraryRecords.filter((record) => record.enabled).length;
    const selectedCount = libraryRecords.filter((record) => state.exportSelection.has(record.id)).length;
    const categories = Array.from(new Set(libraryRecords.map((record) => record.category).filter(Boolean))).sort((a, b) => a.localeCompare(b));

    els.librarySummary.textContent = `${libraryRecords.length} 个芯片 · ${enabledCount} 个显示 · ${selectedCount} 个待导出`;
    els.categoryOptions.innerHTML = categories.map((category) => `<option value="${escapeHtml(category)}"></option>`).join("");
    els.libraryList.innerHTML = filtered.length
      ? filtered
          .map((record) => {
            const sourceLabel = record.builtin ? "内置" : record.sourceKind === "linked" ? "关联目录" : "已导入";
            const sourceDetail = record.sourcePath || record.sourceName || "";
            return `
              <div class="library-row ${record.enabled ? "" : "is-disabled"}" data-chip-id="${escapeHtml(record.id)}">
                <label class="check-control" title="纳入导出">
                  <input type="checkbox" data-library-action="export" ${state.exportSelection.has(record.id) ? "checked" : ""} aria-label="导出 ${escapeHtml(record.sensor)}">
                </label>
                <div class="library-chip-name" title="${escapeHtml(record.sensor)}">
                  <strong>${escapeHtml(record.sensor)}</strong>
                  <span>${escapeHtml(record.vendor || record.family || record.deviceType || "未提供厂商信息")}</span>
                </div>
                <input class="category-input" data-library-action="category" list="categoryOptions" value="${escapeHtml(record.category || fallbackCategory(record))}" aria-label="${escapeHtml(record.sensor)} 的分类">
                <label class="check-control" title="在主界面显示">
                  <input type="checkbox" data-library-action="enabled" ${record.enabled ? "checked" : ""} aria-label="显示 ${escapeHtml(record.sensor)}">
                </label>
                <div class="library-source" title="${escapeHtml(sourceDetail)}">
                  <strong>${sourceLabel}</strong>
                  <span>${escapeHtml(record.sourceName || "")}</span>
                </div>
                ${record.builtin ? "<span></span>" : `<button class="icon-button danger" type="button" data-library-action="delete" title="删除 ${escapeHtml(record.sensor)}" aria-label="删除 ${escapeHtml(record.sensor)}"><i data-lucide="trash-2"></i></button>`}
              </div>
            `;
          })
          .join("")
      : `<div class="empty-state">没有匹配的芯片</div>`;

    els.exportSelectedButton.disabled = selectedCount === 0 || !isDesktopApp();
    els.exportSelectedButton.title = isDesktopApp() ? "" : "独立 HTML 导出需要桌面版";
    setLibraryStatus(state.libraryStatus, state.libraryStatusError);
    refreshIcons(els.libraryPanel);
  }

  function openLibrary() {
    state.libraryOpen = true;
    els.libraryBackdrop.hidden = false;
    document.body.classList.add("library-open");
    renderLibraryList();
    window.setTimeout(() => els.librarySearchInput.focus(), 0);
  }

  function closeLibrary() {
    state.libraryOpen = false;
    els.libraryBackdrop.hidden = true;
    document.body.classList.remove("library-open");
    els.libraryButton.focus({ preventScroll: true });
  }

  function populateChipSelect() {
    const groups = new Map();
    chips.forEach((chip, index) => {
      const category = chip._category || "未分类";
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push({ chip, index });
    });
    els.chipSelect.innerHTML = Array.from(groups.entries())
      .map(
        ([category, items]) => `
          <optgroup label="${escapeHtml(category)}">
            ${items.map(({ chip, index }) => `<option value="${index}">${escapeHtml(chip.sensor || chip._id || `Chip ${index + 1}`)}</option>`).join("")}
          </optgroup>
        `,
      )
      .join("");
    els.chipSelect.disabled = chips.length === 0;
    els.chipSelect.value = String(Math.min(state.chipIndex, Math.max(0, chips.length - 1)));
  }

  function populatePageSelect() {
    const pages = Object.keys(getPages(getChip()));
    if (!pages.includes(state.pageName)) {
      state.pageName = pages[0] || "";
    }
    els.pageSelect.innerHTML = pages.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");
    els.pageSelect.value = state.pageName;
  }

  function normalizeLoadedChip(data, fileName) {
    if (!data || typeof data !== "object") {
      throw new Error("YAML 顶层必须是对象");
    }
    if (!data.pages || typeof data.pages !== "object") {
      throw new Error("缺少 pages");
    }

    const normalized = data;
    normalized._source = fileName;
    normalized._id = chipId(normalized.sensor, fileName.replace(/\.[^.]+$/, ""));
    return normalized;
  }

  function upsertChip(chip) {
    const existing = chips.findIndex((item) => item._source === chip._source || item._id === chip._id);
    if (existing >= 0) {
      chips[existing] = chip;
      return existing;
    }
    chips.push(chip);
    return chips.length - 1;
  }

  function readFileText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error(`无法读取 ${file.name}`));
      reader.readAsText(file, "utf-8");
    });
  }

  async function loadYamlFiles(fileList) {
    const files = Array.from(fileList || []).filter((file) => /\.(ya?ml)$/i.test(file.name));
    if (!files.length) {
      state.loadMessage = "未选择 YAML 文件";
      render();
      return;
    }

    let selectedIndex = state.chipIndex;
    let desktopRecords = null;
    const failures = [];
    let loaded = 0;

    for (const file of files) {
      try {
        if (typeof window.parseRegisterYaml !== "function") {
          throw new Error("前端 YAML 解析器未加载");
        }
        if (typeof window.assertRegisterYaml !== "function") {
          throw new Error("YAML 规范校验器未加载");
        }
        const text = await readFileText(file);
        const sourceName = file.webkitRelativePath || file.name;
        const data = window.parseRegisterYaml(text);
        window.assertRegisterYaml(text, data);
        const chip = normalizeLoadedChip(data, sourceName);
        if (isDesktopApp()) {
          desktopRecords = await getInvoke()("import_yaml", {
            sourceName,
            yamlText: text,
            category: null,
          });
        } else {
          selectedIndex = upsertChip(chip);
          const existingRecord = libraryRecords.findIndex((record) => record.id === chip._id);
          const record = {
            id: chip._id,
            sensor: chip.sensor || chip._id,
            vendor: chip.vendor || "",
            family: chip.family || "",
            deviceType: chip.device_type || "",
            category: chip._category || (chip.device_type === "usb_controller" ? "接口控制器" : "传感器"),
            enabled: true,
            builtin: false,
            sourceKind: "imported",
            sourceName,
            sourcePath: null,
            yamlText: text,
            notes: [],
            attachments: [],
            chipData: chip,
          };
          if (existingRecord >= 0) libraryRecords[existingRecord] = record;
          else libraryRecords.push(record);
        }
        loaded += 1;
      } catch (error) {
        failures.push(`${file.name}: ${errorMessage(error)}`);
      }
    }

    if (desktopRecords) {
      applyLibraryRecords(desktopRecords);
      const importedIndex = chips.findIndex((chip) => chip._source === (files.at(-1)?.webkitRelativePath || files.at(-1)?.name));
      state.chipIndex = importedIndex >= 0 ? importedIndex : state.chipIndex;
    } else {
      state.chipIndex = selectedIndex;
    }
    state.loadMessage = failures.length
      ? `已加载 ${loaded} 个，失败 ${failures.length} 个：${failures.join("；")}`
      : `已加载 ${loaded} 个 YAML`;
    populateChipSelect();
    populatePageSelect();
    render();
    if (state.libraryOpen) {
      setLibraryStatus(state.loadMessage, failures.length > 0);
      renderLibraryList();
    }
    if (failures.length) {
      showImportFailures(
        loaded ? "部分 YAML 未导入" : "YAML 未导入",
        `已接受 ${loaded} 个，拒绝 ${failures.length} 个。请修正规范问题后重新导入。`,
        failures,
      );
    }
  }

  async function importDirectory() {
    if (!isDesktopApp()) {
      els.yamlFolderInput.click();
      return;
    }

    setLibraryStatus("正在读取目录...");
    if (state.libraryOpen) renderLibraryList();
    try {
      const report = await getInvoke()("import_yaml_directory", { category: null });
      if (!report.folder) {
        setLibraryStatus("已取消目录导入");
        if (state.libraryOpen) renderLibraryList();
        return;
      }
      const records = await getInvoke()("list_chips");
      state.loadMessage = report.failures.length
        ? `目录导入 ${report.imported} 个，失败 ${report.failures.length} 个`
        : `目录导入 ${report.imported} 个 YAML`;
      setLibraryStatus(state.loadMessage, report.failures.length > 0);
      applyLibraryRecords(records);
      if (report.failures.length) {
        showImportFailures(
          "部分 YAML 未导入",
          `目录中已接受 ${report.imported} 个，拒绝 ${report.failures.length} 个。`,
          report.failures,
        );
      }
    } catch (error) {
      const message = errorMessage(error);
      setLibraryStatus(message, true);
      showImportFailures("目录导入失败", "目录未能完成导入。", [message]);
      if (state.libraryOpen) renderLibraryList();
    }
  }

  async function handleLibraryChange(event) {
    const control = event.target.closest("[data-library-action]");
    const row = event.target.closest("[data-chip-id]");
    if (!control || !row) return;
    const record = libraryRecords.find((item) => item.id === row.dataset.chipId);
    if (!record) return;
    const action = control.dataset.libraryAction;

    if (action === "export") {
      if (control.checked) state.exportSelection.add(record.id);
      else state.exportSelection.delete(record.id);
      renderLibraryList();
      return;
    }

    try {
      if (action === "enabled") {
        record.enabled = control.checked;
        if (isDesktopApp()) {
          await getInvoke()("set_chip_enabled", { chipId: record.id, enabled: record.enabled });
        }
        applyLibraryRecords(libraryRecords);
        setLibraryStatus(`${record.sensor} 已${record.enabled ? "显示" : "隐藏"}`);
      } else if (action === "category") {
        const category = control.value.trim();
        if (!category) throw new Error("分类不能为空");
        record.category = category;
        if (isDesktopApp()) {
          await getInvoke()("set_chip_category", { chipId: record.id, category });
        }
        applyLibraryRecords(libraryRecords);
        setLibraryStatus(`${record.sensor} 已归入 ${category}`);
      }
      renderLibraryList();
    } catch (error) {
      setLibraryStatus(error.message || String(error), true);
      if (isDesktopApp()) {
        const records = await getInvoke()("list_chips");
        applyLibraryRecords(records);
      }
      renderLibraryList();
    }
  }

  async function handleLibraryClick(event) {
    const button = event.target.closest("[data-library-action=\"delete\"]");
    const row = event.target.closest("[data-chip-id]");
    if (!button || !row) return;
    const record = libraryRecords.find((item) => item.id === row.dataset.chipId);
    if (!record || record.builtin) return;

    try {
      if (isDesktopApp()) {
        await getInvoke()("delete_chip", { chipId: record.id });
        applyLibraryRecords(await getInvoke()("list_chips"));
      } else {
        applyLibraryRecords(libraryRecords.filter((item) => item.id !== record.id));
      }
      state.exportSelection.delete(record.id);
      setLibraryStatus(`${record.sensor} 已删除`);
      renderLibraryList();
    } catch (error) {
      setLibraryStatus(error.message || String(error), true);
      renderLibraryList();
    }
  }

  async function exportSelectedChips() {
    const chipIds = libraryRecords
      .filter((record) => state.exportSelection.has(record.id))
      .map((record) => record.id);
    if (!chipIds.length || !isDesktopApp()) return;

    setLibraryStatus("正在生成独立 HTML...");
    renderLibraryList();
    try {
      const outputPath = await getInvoke()("export_standalone_html", {
        chipIds,
        includeNotes: els.includeNotesExport.checked,
      });
      setLibraryStatus(outputPath ? `已导出到 ${outputPath}` : "已取消导出");
    } catch (error) {
      setLibraryStatus(error.message || String(error), true);
    }
    renderLibraryList();
  }

  function setView(view) {
    state.view = view;
    els.matrixView.classList.toggle("hidden", view !== "matrix");
    els.tableView.classList.toggle("hidden", view !== "table");
    els.viewButtons.forEach((button) => button.classList.toggle("active", button.dataset.view === view));
    hideHoverPanel(true);
  }

  function bindEvents() {
    els.themeButton.addEventListener("click", () => {
      if (state.themeMenuOpen) closeThemeMenu();
      else openThemeMenu();
    });
    els.themeMenu.addEventListener("click", (event) => {
      const option = event.target.closest("[data-theme-option]");
      if (!option) return;
      applyTheme(option.dataset.themeOption);
      closeThemeMenu(true);
    });
    els.themeMenu.addEventListener("keydown", (event) => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const currentIndex = els.themeOptions.indexOf(document.activeElement);
      let nextIndex = currentIndex;
      if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = els.themeOptions.length - 1;
      else if (event.key === "ArrowDown") nextIndex = (currentIndex + 1) % els.themeOptions.length;
      else nextIndex = (currentIndex - 1 + els.themeOptions.length) % els.themeOptions.length;
      els.themeOptions[nextIndex].focus();
    });
    document.addEventListener("click", (event) => {
      if (state.themeMenuOpen && !els.themePicker.contains(event.target)) closeThemeMenu();
    });
    const handleSystemThemeChange = () => {
      if (state.themePreference === "system") applyTheme("system", false);
    };
    if (systemThemeMedia?.addEventListener) systemThemeMedia.addEventListener("change", handleSystemThemeChange);
    else systemThemeMedia?.addListener?.(handleSystemThemeChange);

    els.loadYamlButton.addEventListener("click", () => {
      els.yamlFileInput.click();
    });

    els.loadFolderButton.addEventListener("click", () => {
      importDirectory();
    });

    els.libraryButton.addEventListener("click", openLibrary);
    els.attachmentsButton.addEventListener("click", openAttachmentsDialog);
    els.attachmentsDialogCloseButton.addEventListener("click", closeAttachmentsDialog);
    els.attachmentsDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeAttachmentsDialog();
    });
    els.addAttachmentsButton.addEventListener("click", addAttachments);
    els.attachmentsList.addEventListener("click", handleAttachmentAction);
    els.libraryCloseButton.addEventListener("click", closeLibrary);
    els.importResultCloseButton.addEventListener("click", () => els.importResultDialog.close());
    els.importResultConfirmButton.addEventListener("click", () => els.importResultDialog.close());
    els.noteDialogCloseButton.addEventListener("click", closeNoteDialog);
    els.noteDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeNoteDialog();
    });
    els.noteKindControl.addEventListener("click", (event) => {
      const button = event.target.closest("[data-note-kind]");
      if (!button) return;
      state.noteKind = button.dataset.noteKind;
      els.noteFormStatus.textContent = "";
      els.noteFormStatus.classList.remove("success");
      updateNoteFormState();
    });
    els.noteContentInput.addEventListener("input", () => {
      els.noteFormStatus.textContent = "";
      els.noteFormStatus.classList.remove("success");
      updateNoteFormState();
    });
    els.noteForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await saveActiveNote();
    });
    els.noteCancelEditButton.addEventListener("click", () => {
      resetNoteEditor();
      els.noteContentInput.focus();
    });
    els.noteList.addEventListener("click", async (event) => {
      const action = event.target.closest("[data-note-action]");
      const item = event.target.closest("[data-note-id]");
      if (!action || !item) return;
      const noteId = Number(item.dataset.noteId);
      if (action.dataset.noteAction === "edit") beginNoteEdit(noteId);
      if (action.dataset.noteAction === "delete") await deleteActiveNote(noteId);
    });
    els.libraryImportButton.addEventListener("click", () => els.yamlFileInput.click());
    els.libraryFolderButton.addEventListener("click", importDirectory);
    els.exportSelectedButton.addEventListener("click", exportSelectedChips);
    els.librarySearchInput.addEventListener("input", () => {
      state.libraryQuery = els.librarySearchInput.value;
      renderLibraryList();
    });
    els.libraryList.addEventListener("change", handleLibraryChange);
    els.libraryList.addEventListener("click", handleLibraryClick);
    els.libraryBackdrop.addEventListener("click", (event) => {
      if (event.target === els.libraryBackdrop) closeLibrary();
    });

    els.yamlFileInput.addEventListener("change", async () => {
      await loadYamlFiles(els.yamlFileInput.files);
      els.yamlFileInput.value = "";
    });

    els.yamlFolderInput.addEventListener("change", async () => {
      await loadYamlFiles(els.yamlFolderInput.files);
      els.yamlFolderInput.value = "";
    });

    els.chipSelect.addEventListener("change", () => {
      closeNoteDialog();
      closeAttachmentsDialog();
      state.chipIndex = Number(els.chipSelect.value);
      state.loadMessage = "";
      populatePageSelect();
      render();
    });

    els.pageSelect.addEventListener("change", () => {
      closeNoteDialog();
      state.pageName = els.pageSelect.value;
      state.loadMessage = "";
      render();
    });

    els.searchInput.addEventListener("input", () => {
      state.query = els.searchInput.value.trim().toLowerCase();
      render();
    });

    els.viewButtons.forEach((button) => {
      button.addEventListener("click", () => setView(button.dataset.view));
    });

    els.hoverPanel.addEventListener("mouseenter", cancelHoverClose);
    els.hoverPanel.addEventListener("pointerenter", cancelHoverClose);
    els.hoverPanel.addEventListener("mouseleave", scheduleHideHoverPanel);
    els.hoverPanel.addEventListener("pointerleave", scheduleHideHoverPanel);
    els.hoverPanel.addEventListener("input", handleRegisterValueInput);
    els.hoverPanel.addEventListener("click", (event) => {
      if (handleNoteEditButton(event)) return;
      if (event.target.closest(".hover-close")) {
        hideHoverPanel(true);
      }
    });

    els.tableBody.addEventListener("input", handleRegisterValueInput);
    els.tableBody.addEventListener("click", handleNoteEditButton);

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        if (state.themeMenuOpen) {
          closeThemeMenu(true);
          return;
        }
        if (els.noteDialog.open || els.attachmentsDialog.open || els.importResultDialog.open) return;
        if (state.libraryOpen) closeLibrary();
        else hideHoverPanel(true);
      }
    });

    window.addEventListener("scroll", () => hideHoverPanel(false), { passive: true });
    window.addEventListener("resize", () => hideHoverPanel(true));
  }

  function init() {
    applyTheme(readStoredTheme(), false);
    bindEvents();
    populateChipSelect();
    populatePageSelect();
    setView("matrix");
    render();
    refreshIcons();
    initializeLibrary().catch((error) => {
      state.loadMessage = `芯片库加载失败：${error.message || String(error)}`;
      setLibraryStatus(state.loadMessage, true);
      render();
    });
  }

  init();
})();
