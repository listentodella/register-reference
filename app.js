(function () {
  const chips = Array.isArray(window.REGISTER_CHIPS) ? window.REGISTER_CHIPS : [];
  const THEME_STORAGE_KEY = "register-reference.theme";
  const NAVIGATION_STATE_KEY = "registerReferenceNavigation";
  const themeLabels = {
    system: "跟随系统",
    light: "清晰亮色",
    dark: "石墨深色",
    rusty: "Rusty 锈钢",
    contrast: "高对比",
  };
  const systemThemeMedia = window.matchMedia?.("(prefers-color-scheme: dark)") || null;

  const state = {
    chipIndex: 0,
    pageName: "",
    view: "matrix",
    query: "",
    registerValues: new Map(),
    activeHoverAddress: null,
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
    radixValue: 0n,
    radixBitWidth: 32,
    radixSigned: false,
    radixShiftCounts: { left: 1, right: 1 },
    radixInputErrors: new Set(),
    radixFields: [],
    radixFieldInputErrors: new Set(),
    radixActiveFieldKey: "",
    radixFieldSelection: null,
    radixStatus: "",
    radixPosition: null,
    radixSize: null,
    radixDrag: null,
    radixResize: null,
    calculatorCommands: [],
    calculatorHistoryIndex: 0,
    calculatorDraft: "",
    calculatorLastResult: null,
    themePreference: "light",
    themeMenuOpen: false,
    systemOverviewSnapshot: null,
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
    matrixViewButton: document.getElementById("matrixViewButton"),
    matrixView: document.getElementById("matrixView"),
    tableView: document.getElementById("tableView"),
    systemOverviewBackButton: document.getElementById("systemOverviewBackButton"),
    matrixGrid: document.getElementById("matrixGrid"),
    matrixTitle: document.getElementById("matrixTitle"),
    matrixSummary: document.getElementById("matrixSummary"),
    tableSummary: document.getElementById("tableSummary"),
    tableBody: document.getElementById("registerTableBody"),
    registerLocatorHeader: document.getElementById("registerLocatorHeader"),
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
    radixToolButton: document.getElementById("radixToolButton"),
    radixDialog: document.getElementById("radixDialog"),
    radixDialogDragHandle: document.getElementById("radixDialogDragHandle"),
    radixDialogCloseButton: document.getElementById("radixDialogCloseButton"),
    radixResizeHandles: Array.from(document.querySelectorAll("[data-radix-resize]")),
    radixWidthControl: document.getElementById("radixWidthControl"),
    radixSignedControl: document.getElementById("radixSignedControl"),
    radixValueStatus: document.getElementById("radixValueStatus"),
    radixInputs: document.getElementById("radixInputs"),
    radixBytes: document.getElementById("radixBytes"),
    radixBits: document.getElementById("radixBits"),
    radixComposer: document.getElementById("radixComposer"),
    radixComposerScroll: document.getElementById("radixComposerScroll"),
    radixFieldList: document.getElementById("radixFieldList"),
    radixFieldsResetButton: document.getElementById("radixFieldsResetButton"),
    radixShiftInputs: {
      left: document.getElementById("radixShiftLeftInput"),
      right: document.getElementById("radixShiftRightInput"),
    },
    radixOperations: document.getElementById("radixOperations"),
    calculatorHistory: document.getElementById("calculatorHistory"),
    calculatorForm: document.getElementById("calculatorForm"),
    calculatorInput: document.getElementById("calculatorInput"),
    calculatorClearButton: document.getElementById("calculatorClearButton"),
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

  function isSystemChip(chip = getChip()) {
    return chip?.register_space?.kind === "arm_system";
  }

  function hasSystemMmioAddress(reg) {
    if (reg?.addr === undefined || reg?.addr === null || reg?.addr === "") return false;
    const address = Number(reg.addr);
    return Number.isFinite(address) && address >= 0;
  }

  function encodingComponent(value, prefix = "") {
    if (value === undefined || value === null || value === "") return "?";
    return `${prefix}${String(value).replace(/^0[bB]/, "")}`;
  }

  function formatSystemEncoding(reg) {
    const encoding = reg?.encoding || {};
    if (encoding.scheme === "aarch64_sysreg") {
      return [
        encodingComponent(encoding.op0, "S"),
        encodingComponent(encoding.op1),
        encodingComponent(encoding.crn, "C"),
        encodingComponent(encoding.crm, "C"),
        encodingComponent(encoding.op2),
      ].join("_");
    }
    if (["aarch32_cp15", "aarch32_coproc"].includes(encoding.scheme)) {
      return [
        encodingComponent(encoding.coproc, "p"),
        encodingComponent(encoding.opc1 ?? encoding.op1),
        encodingComponent(encoding.crn ?? encoding.crd, encoding.crd !== undefined ? "CRd=" : "c"),
        encodingComponent(encoding.crm, "c"),
        encodingComponent(encoding.opc2 ?? encoding.op2),
      ].filter((value) => value !== "?").join(", ");
    }
    const values = Object.entries(encoding)
      .filter(([key]) => key !== "scheme")
      .map(([key, value]) => `${key}=${value}`);
    return values.join(", ") || reg?.name || "system register";
  }

  function getPersistentRegisterIdentity(reg) {
    if (!isSystemChip()) return `mmio:${Number(reg.addr || 0)}:${reg.name || "register"}`;
    if (hasSystemMmioAddress(reg)) return `mmio:${Number(reg.addr)}:${reg.name || "register"}`;
    const encoding = reg?.encoding || {};
    const order = ["op0", "op1", "crn", "crm", "crd", "op2", "coproc", "opc1", "opc2", "r", "m", "m1", "reg", "selector"];
    const values = order.filter((key) => encoding[key] !== undefined).map((key) => `${key}=${encoding[key]}`);
    return `${encoding.scheme || "arm_system"}:${values.join(":")}:${reg.name || "register"}`;
  }

  function getNavigationChipId(chip = getChip()) {
    return String(chip?._libraryId || chip?._id || chip?.sensor || state.chipIndex);
  }

  function isAppNavigationState(value) {
    return Boolean(value && value[NAVIGATION_STATE_KEY] === true);
  }

  function createNavigationState(overrides = {}) {
    return {
      [NAVIGATION_STATE_KEY]: true,
      chipId: getNavigationChipId(),
      chipIndex: state.chipIndex,
      pageName: state.pageName,
      view: state.view,
      query: state.query,
      scrollY: Math.max(0, Math.round(window.scrollY)),
      focusIdentity: "",
      fromSystemOverview: false,
      ...overrides,
    };
  }

  function replaceNavigationState(overrides = {}) {
    try {
      window.history.replaceState(createNavigationState(overrides), "");
    } catch (_error) {
      // Some embedded webviews can disable same-document history without affecting the viewer.
    }
  }

  function pushNavigationState(overrides = {}) {
    try {
      window.history.pushState(createNavigationState(overrides), "");
    } catch (_error) {
      return false;
    }
    return true;
  }

  function revealSystemRegister(identity, { focus = false } = {}) {
    const target = getDisplayRegisters().find((item) => getPersistentRegisterIdentity(item) === identity);
    const targetKey = target ? getRegisterKey(target) : "";
    const row = Array.from(els.tableBody.querySelectorAll(".register-display"))
      .find((item) => item.dataset.registerKey === targetKey);
    if (!row) return;
    row.classList.add("is-target");
    row.tabIndex = -1;
    row.scrollIntoView({ block: "center" });
    if (focus) row.focus({ preventScroll: true });
    window.setTimeout(() => row.classList.remove("is-target"), 1800);
  }

  function restoreNavigationState(navigation) {
    if (!isAppNavigationState(navigation)) return;

    const chipIndex = chips.findIndex((chip) => getNavigationChipId(chip) === navigation.chipId);
    if (chipIndex >= 0) state.chipIndex = chipIndex;
    else if (Number.isInteger(navigation.chipIndex) && chips[navigation.chipIndex]) state.chipIndex = navigation.chipIndex;

    state.pageName = String(navigation.pageName || "");
    state.view = navigation.view === "table" ? "table" : "matrix";
    state.query = String(navigation.query || "");
    els.searchInput.value = state.query;
    populateChipSelect();
    populatePageSelect();
    render();
    if (state.view === "matrix" && isSystemChip()) state.systemOverviewSnapshot = navigation;

    window.requestAnimationFrame(() => {
      if (state.view === "table" && navigation.focusIdentity) {
        revealSystemRegister(navigation.focusIdentity);
        return;
      }
      window.scrollTo({ top: Math.max(0, Number(navigation.scrollY) || 0), left: 0, behavior: "auto" });
    });
  }

  function formatRange(reg) {
    if (isSystemChip() && !hasSystemMmioAddress(reg)) return formatSystemEncoding(reg);
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

  function addressRange(reg) {
    const start = Number(reg.addr || 0);
    return { start, end: start + getAddressSpan(reg) - 1 };
  }

  function rangesOverlap(left, right) {
    const a = addressRange(left);
    const b = addressRange(right);
    return a.start <= b.end && b.start <= a.end;
  }

  function extractResetSegment(reg, lo, width, fieldReset) {
    if (fieldReset !== undefined && fieldReset !== null) return fieldReset;
    if (reg.reset === undefined || reg.reset === null) return undefined;
    const parsed = parseInputValue(reg.reset);
    if (!parsed.ok) return undefined;
    const mask = (1n << BigInt(width)) - 1n;
    return formatBigIntHex((parsed.value >> BigInt(lo)) & mask, width);
  }

  function buildAggregateDisplaySegments(reg, sourceIndex, occupiedAddresses) {
    const bitWidth = getBitWidth(reg);
    const addressSpan = getAddressSpan(reg);
    const bitsPerAddress = bitWidth / addressSpan;
    const available = new Set();
    for (let offset = 0; offset < addressSpan; offset += 1) {
      const addr = Number(reg.addr || 0) + offset;
      if (!occupiedAddresses.has(addr)) available.add(addr);
    }
    if (!available.size) return [];

    const segments = [];
    const fields = Array.isArray(reg.fields) ? reg.fields : [];
    if (Number.isInteger(bitsPerAddress) && bitsPerAddress > 0) {
      fields.forEach((field, fieldIndex) => {
        const bits = parseBits(field.bits);
        if (
          !Number.isFinite(bits.hi) ||
          !Number.isFinite(bits.lo) ||
          bits.lo < 0 ||
          bits.hi < bits.lo ||
          bits.lo % bitsPerAddress !== 0 ||
          (bits.hi + 1) % bitsPerAddress !== 0
        ) {
          return;
        }

        const lowUnit = bits.lo / bitsPerAddress;
        const highUnit = (bits.hi + 1) / bitsPerAddress - 1;
        const firstOffset = reg.byte_order === "big" ? addressSpan - 1 - highUnit : lowUnit;
        const lastOffset = reg.byte_order === "big" ? addressSpan - 1 - lowUnit : highUnit;
        const start = Number(reg.addr || 0) + firstOffset;
        const end = Number(reg.addr || 0) + lastOffset;
        const addresses = Array.from({ length: end - start + 1 }, (_item, index) => start + index);
        if (start < Number(reg.addr || 0) || end >= Number(reg.addr || 0) + addressSpan) return;
        if (!addresses.every((addr) => available.has(addr))) return;

        addresses.forEach((addr) => available.delete(addr));
        const localBits = bits.width === 1 ? "0" : `${bits.width - 1}:0`;
        segments.push({
          addr: start,
          name: field.name || `FIELD_${fieldIndex}`,
          access: field.access || reg.access,
          width: Math.max(1, Math.ceil(bits.width / 8)),
          bit_width: bits.width,
          address_span: addresses.length,
          byte_order: reg.byte_order,
          reset: extractResetSegment(reg, bits.lo, bits.width, field.reset),
          roles: field.roles || reg.roles,
          read_clear: reg.read_clear,
          no_dump: reg.no_dump,
          no_dump_reason: reg.no_dump_reason,
          desc: field.desc || reg.desc,
          fields: [{ ...field, bits: localBits }],
          _displayKey: `aggregate:${sourceIndex}:field:${fieldIndex}`,
          _displayOrder: sourceIndex + (fieldIndex + 1) / 1000,
          _aggregateSource: reg,
        });
      });
    }

    Array.from(available)
      .sort((left, right) => left - right)
      .forEach((addr) => {
        const offset = addr - Number(reg.addr || 0);
        const unitWidth = Number.isInteger(bitsPerAddress) && bitsPerAddress > 0 ? bitsPerAddress : 8;
        const sourceLo = offset * unitWidth;
        segments.push({
          addr,
          name: `BYTE_${offset}`,
          access: reg.access,
          width: Math.max(1, Math.ceil(unitWidth / 8)),
          bit_width: unitWidth,
          address_span: 1,
          reset: extractResetSegment(reg, sourceLo, unitWidth),
          roles: reg.roles,
          read_clear: reg.read_clear,
          no_dump: reg.no_dump,
          no_dump_reason: reg.no_dump_reason,
          desc: `批量读取数据的第 ${offset + 1} 个地址单元`,
          fields: [{ name: "data", bits: unitWidth === 1 ? "0" : `${unitWidth - 1}:0`, desc: reg.desc || "原始数据" }],
          _displayKey: `aggregate:${sourceIndex}:unit:${offset}`,
          _displayOrder: sourceIndex + (offset + 1) / 1000,
          _aggregateSource: reg,
        });
      });

    return segments;
  }

  function getDisplayRegisters() {
    const source = getRegisters();
    if (isSystemChip()) {
      return source.map((reg, sourceIndex) => ({ ...reg, _sourceRegisterIndex: sourceIndex, _displayOrder: sourceIndex }));
    }
    const physical = source
      .map((reg, sourceIndex) => ({ reg, sourceIndex }))
      .filter(({ reg }) => !reg.multi_byte)
      .map(({ reg, sourceIndex }) => ({ ...reg, _sourceRegisterIndex: sourceIndex, _displayOrder: sourceIndex }));
    const occupiedAddresses = new Set();
    physical.forEach((reg) => {
      const range = addressRange(reg);
      for (let addr = range.start; addr <= range.end; addr += 1) occupiedAddresses.add(addr);
    });

    const generated = [];
    source.forEach((reg, sourceIndex) => {
      if (!reg.multi_byte) return;
      const overlappingPhysical = physical.filter((item) => rangesOverlap(item, reg));
      overlappingPhysical.forEach((item) => {
        if (item.alias_note && item.alias_note.includes(reg.name || "")) delete item.alias_note;
      });

      const segments = buildAggregateDisplaySegments(reg, sourceIndex, occupiedAddresses);
      const noteProxy = segments[0] || overlappingPhysical.sort((left, right) => Number(left.addr) - Number(right.addr))[0];
      if (noteProxy) {
        noteProxy._noteAliases = [
          ...(noteProxy._noteAliases || []),
          { addr: Number(reg.addr || 0), name: reg.name },
        ];
      }
      generated.push(...segments);
    });

    return [...physical, ...generated].sort(
      (left, right) => Number(left.addr || 0) - Number(right.addr || 0) || left._displayOrder - right._displayOrder,
    );
  }

  function getRegisterKey(reg) {
    const chip = getChip();
    if (isSystemChip(chip)) {
      return [
        chip?._id || chip?.sensor || "chip",
        state.pageName || "page",
        getPersistentRegisterIdentity(reg),
      ].join("::");
    }
    if (reg._displayKey) {
      return [
        chip?._id || chip?.sensor || "chip",
        state.pageName || "page",
        "display",
        reg._displayKey,
        Number(reg.addr || 0),
        reg.name || "register",
      ].join("::");
    }
    const registerIndex = Number.isInteger(reg._sourceRegisterIndex)
      ? reg._sourceRegisterIndex
      : getRegisters().indexOf(reg);
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

  function getRegisterNotes(reg, pageName = state.pageName) {
    const chip = getChip();
    const notes = Array.isArray(chip?._notes) ? chip._notes : [];
    const targets = [
      { addr: isSystemChip(chip) ? null : Number(reg.addr || 0), name: reg.name, key: getPersistentRegisterIdentity(reg) },
      ...(Array.isArray(reg._noteAliases) ? reg._noteAliases : []),
    ];
    return notes.filter(
      (note) =>
        note.pageName === pageName &&
        targets.some((target) => (
          note.registerKey
            ? note.registerKey === target.key
            : target.addr !== null && Number(note.registerAddr) === Number(target.addr) && note.registerName === target.name
        )),
    );
  }

  function countPageNotes() {
    const chip = getChip();
    const notes = Array.isArray(chip?._notes) ? chip._notes : [];
    return notes.filter((note) => note.pageName === state.pageName).length;
  }

  function renderNoteEditButton(reg) {
    if (!isDesktopApp()) return "";
    const count = getRegisterNotes(reg).length;
    const registerName = reg.name || "寄存器";
    const label = count ? `管理 ${registerName} 的 ${count} 条备注` : `为 ${registerName} 添加备注`;
    return `
      <button class="note-edit-button ${count ? "has-notes" : ""}" type="button"
        data-note-register-key="${escapeHtml(getRegisterKey(reg))}" title="${label}" aria-label="${label}">
        <i data-lucide="${count ? "notebook-pen" : "sticky-note"}"></i>
        <span class="note-edit-count" aria-hidden="true">${count || "+"}</span>
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
    const ranges = String(bits ?? "0").split(",").map((range) => {
      const [hiText, loText = hiText] = range.trim().split(":");
      const hi = Number.parseInt(hiText, 10);
      const lo = Number.parseInt(loText, 10);
      return { hi, lo, width: hi - lo + 1 };
    });
    return {
      hi: Math.max(...ranges.map((range) => range.hi)),
      lo: Math.min(...ranges.map((range) => range.lo)),
      width: ranges.reduce((sum, range) => sum + range.width, 0),
      ranges,
    };
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

  function getRadixMask() {
    return (1n << BigInt(state.radixBitWidth)) - 1n;
  }

  function getRadixSignedValue() {
    const value = state.radixValue & getRadixMask();
    const signBit = 1n << BigInt(state.radixBitWidth - 1);
    return value & signBit ? value - (getRadixMask() + 1n) : value;
  }

  function getRadixFieldKey(field) {
    return `${field.high}:${field.low}`;
  }

  function formatRadixFieldRange(field) {
    return field.high === field.low ? String(field.high) : getRadixFieldKey(field);
  }

  function getRadixFieldWidth(field) {
    return field.high - field.low + 1;
  }

  function getRadixFieldMask(field) {
    return ((1n << BigInt(getRadixFieldWidth(field))) - 1n) << BigInt(field.low);
  }

  function getRadixFieldValue(field) {
    return (state.radixValue & getRadixFieldMask(field)) >> BigInt(field.low);
  }

  function getRadixFieldAtBit(bit) {
    return state.radixFields.find((field) => bit <= field.high && bit >= field.low) || null;
  }

  function resetRadixFields() {
    state.radixFields = [{ high: state.radixBitWidth - 1, low: 0, name: "" }];
    state.radixFieldInputErrors.clear();
    state.radixActiveFieldKey = "";
    state.radixFieldSelection = null;
  }

  function formatRadixFieldValue(field, radix) {
    const value = getRadixFieldValue(field);
    if (radix === 16) return value.toString(16).toUpperCase().padStart(Math.ceil(getRadixFieldWidth(field) / 4), "0");
    return value.toString(10);
  }

  function parseRadixFieldValue(text, radix, field) {
    let compact = String(text ?? "").trim().replace(/_/g, "");
    if (!compact) return { ok: true, value: 0n, message: "" };
    if (radix === 16 && /^0x/i.test(compact)) compact = compact.slice(2);
    if (!compact) return { ok: true, value: 0n, message: "" };
    const pattern = radix === 16 ? /^[0-9a-f]+$/i : /^\d+$/;
    if (!pattern.test(compact)) return { ok: false, value: 0n, message: "输入值格式无效" };
    try {
      const value = BigInt(radix === 16 ? `0x${compact}` : compact);
      const max = (1n << BigInt(getRadixFieldWidth(field))) - 1n;
      if (value > max) {
        return { ok: false, value, message: `超出当前 ${getRadixFieldWidth(field)} bit 字段范围` };
      }
      return { ok: true, value, message: "" };
    } catch (error) {
      return { ok: false, value: 0n, message: error.message || "输入值格式无效" };
    }
  }

  function getRadixShiftCount(direction) {
    const parsed = Number.parseInt(els.radixShiftInputs[direction].value, 10);
    if (!Number.isInteger(parsed)) return state.radixShiftCounts[direction];
    return Math.min(state.radixBitWidth, Math.max(1, parsed));
  }

  function syncRadixShiftControl(direction) {
    const input = els.radixShiftInputs[direction];
    state.radixShiftCounts[direction] = Math.min(state.radixBitWidth, Math.max(1, state.radixShiftCounts[direction]));
    input.min = "1";
    input.max = String(state.radixBitWidth);
    input.value = String(state.radixShiftCounts[direction]);
  }

  function syncRadixShiftControls() {
    ["left", "right"].forEach(syncRadixShiftControl);
  }

  function formatRadixValue(radix) {
    const value = state.radixValue & getRadixMask();
    if (radix === 16) return value.toString(16).toUpperCase().padStart(state.radixBitWidth / 4, "0");
    if (radix === 2) return value.toString(2).padStart(state.radixBitWidth, "0");
    return (state.radixSigned ? getRadixSignedValue() : value).toString(10);
  }

  function parseRadixValue(text, radix) {
    let compact = String(text ?? "").trim().replace(/_/g, "");
    if (!compact) return { ok: true, value: 0n, message: "" };
    if (radix === 16 && /^0x/i.test(compact)) compact = compact.slice(2);
    if (radix === 2 && /^0b/i.test(compact)) compact = compact.slice(2);
    if (radix === 2 && /b$/i.test(compact)) compact = compact.slice(0, -1);
    if (!compact) return { ok: true, value: 0n, message: "" };

    const pattern = radix === 16 ? /^[0-9a-f]+$/i : radix === 2 ? /^[01]+$/ : state.radixSigned ? /^-?\d+$/ : /^\d+$/;
    if (!pattern.test(compact)) return { ok: false, value: 0n, message: "输入值格式无效" };
    try {
      const value = BigInt(radix === 16 ? `0x${compact}` : radix === 2 ? `0b${compact}` : compact);
      if (radix === 10 && state.radixSigned) {
        const signedLimit = 1n << BigInt(state.radixBitWidth - 1);
        if (value < -signedLimit || value >= signedLimit) {
          return { ok: false, value, message: `超出当前 ${state.radixBitWidth} bit 有符号范围` };
        }
        return { ok: true, value: value < 0n ? value + getRadixMask() + 1n : value, message: "" };
      }
      if (value > getRadixMask()) {
        return { ok: false, value, message: `超出当前 ${state.radixBitWidth} bit 位宽` };
      }
      return { ok: true, value, message: "" };
    } catch (error) {
      return { ok: false, value: 0n, message: error.message || "输入值格式无效" };
    }
  }

  function setRadixStatus(message = "") {
    state.radixStatus = message;
    els.radixValueStatus.textContent = message || `${state.radixSigned ? "二补码有符号" : "无符号"} · ${state.radixBitWidth} bit`;
    els.radixValueStatus.classList.toggle("error", Boolean(message));
  }

  function syncRadixFields(preserveKind = "") {
    const values = { hex: formatRadixValue(16), dec: formatRadixValue(10), bin: formatRadixValue(2) };
    ["hex", "dec", "bin"].forEach((kind) => {
      const input = els.radixInputs.querySelector(`[data-radix-input="${kind}"]`);
      if (!input) return;
      if (kind !== preserveKind) input.value = values[kind];
      input.closest(".radix-field")?.classList.toggle("invalid", state.radixInputErrors.has(kind));
    });
    if (!preserveKind) state.radixInputErrors.clear();
  }

  function renderRadixBytes() {
    const bytes = [];
    const hex = formatRadixValue(16);
    for (let index = 0; index < state.radixBitWidth / 8; index += 1) {
      const start = index * 2;
      bytes.push(`<span class="radix-byte" style="--radix-byte-start: ${index * 8 + 1}; --radix-byte-span: 8">${hex.slice(start, start + 2)}</span>`);
    }
    els.radixBytes.innerHTML = bytes.join("");
  }

  function renderRadixBits() {
    const value = state.radixValue & getRadixMask();
    const bits = [];
    const selection = state.radixFieldSelection;
    const selectionHigh = selection ? Math.max(selection.start, selection.end) : -1;
    const selectionLow = selection ? Math.min(selection.start, selection.end) : -1;
    for (let bit = state.radixBitWidth - 1; bit >= 0; bit -= 1) {
      const set = ((value >> BigInt(bit)) & 1n) === 1n;
      const field = getRadixFieldAtBit(bit);
      const active = field && getRadixFieldKey(field) === state.radixActiveFieldKey;
      const preview = selection && bit <= selectionHigh && bit >= selectionLow;
      bits.push(`
        <div class="radix-bit ${set ? "set" : ""} ${active ? "is-field-active" : ""} ${preview ? "is-field-preview" : ""}"
          data-radix-bit="${bit}">
          <span class="radix-bit-index" data-radix-bit-index="${bit}" title="拖动定义位域范围">${bit}</span>
          <button class="radix-bit-value" type="button" data-radix-bit-value="${bit}"
            aria-label="bit ${bit}: ${set ? 1 : 0}" title="bit ${bit}：${set ? 1 : 0}">${set ? 1 : 0}</button>
        </div>
      `);
    }
    els.radixBits.innerHTML = bits.join("");
  }

  function renderRadixFields() {
    const bitColumnWidth = state.radixBitWidth === 64 ? 16 : 20;
    const totalWidth = state.radixBitWidth * bitColumnWidth;
    const getFieldStyle = (field) => {
      const start = state.radixBitWidth - field.high;
      return `--radix-field-start: ${start}; --radix-field-span: ${getRadixFieldWidth(field)};`;
    };
    const renderTrack = (kind) => state.radixFields.map((field) => {
      const key = getRadixFieldKey(field);
      const range = formatRadixFieldRange(field);
      const active = key === state.radixActiveFieldKey;
      const narrow = getRadixFieldWidth(field) <= 2;
      const classes = `radix-field-cell ${narrow ? "is-narrow" : ""} ${active ? "active" : ""}`;
      const attributes = `data-radix-field-key="${key}" style="${getFieldStyle(field)}"`;
      if (kind === "range") {
        return `<button class="${classes} radix-field-range" type="button" ${attributes}
          title="选择位域 ${range}" aria-label="选择位域 ${range}">${range}</button>`;
      }
      if (kind === "name") {
        return `<label class="${classes}" ${attributes}>
          <input class="radix-field-name-input" type="text" maxlength="80" value="${escapeHtml(field.name)}"
            data-radix-field-name data-radix-field-key="${key}" aria-label="位域 ${key} 名称">
        </label>`;
      }
      const radix = kind === "hex" ? 16 : 10;
      return `<label class="${classes}" ${attributes}>
        <input type="text" spellcheck="false" inputmode="${kind === "hex" ? "text" : "numeric"}" autocomplete="off"
          value="${formatRadixFieldValue(field, radix)}" data-radix-field-input="${kind}" data-radix-field-key="${key}"
          aria-label="位域 ${key} ${kind === "hex" ? "十六进制" : "十进制"}值">
      </label>`;
    }).join("");
    [els.radixComposer, els.radixBytes, els.radixBits, els.radixFieldList].forEach((element) => {
      element.style.setProperty("--radix-field-width", `${totalWidth}px`);
      element.style.setProperty("--radix-field-columns", String(state.radixBitWidth));
    });
    els.radixFieldList.innerHTML = ["range", "hex", "dec", "name"].map((kind) => `
      <div class="radix-field-track" data-radix-field-track="${kind}">${renderTrack(kind)}</div>
    `).join("");
    syncRadixFieldValues();
  }

  function scrollRadixFieldIntoView(fieldKey = state.radixActiveFieldKey) {
    const scroll = els.radixComposerScroll;
    if (!scroll) return;
    if (!fieldKey) {
      scroll.scrollLeft = 0;
      return;
    }
    const field = Array.from(els.radixFieldList.querySelectorAll(".radix-field-range")).find(
      (cell) => cell.dataset.radixFieldKey === fieldKey,
    );
    if (!field) return;
    const fieldRect = field.getBoundingClientRect();
    const scrollRect = scroll.getBoundingClientRect();
    const nextLeft = scroll.scrollLeft + fieldRect.left - scrollRect.left - (scroll.clientWidth - fieldRect.width) / 2;
    scroll.scrollLeft = Math.max(0, Math.min(nextLeft, scroll.scrollWidth - scroll.clientWidth));
  }

  function setRadixActiveField(key = "") {
    if (key === state.radixActiveFieldKey) return;
    state.radixActiveFieldKey = key;
    renderRadixBits();
    syncRadixFieldValues();
  }

  function syncRadixFieldValues(preserveKey = "") {
    els.radixFieldList.querySelectorAll(".radix-field-cell[data-radix-field-key]").forEach((cell) => {
      const key = cell.dataset.radixFieldKey;
      cell.classList.toggle("active", key === state.radixActiveFieldKey);
    });
    els.radixFieldList.querySelectorAll("[data-radix-field-input]").forEach((input) => {
      const key = input.dataset.radixFieldKey;
      const field = state.radixFields.find((item) => getRadixFieldKey(item) === key);
      if (!field) return;
      const inputKey = `${key}:${input.dataset.radixFieldInput}`;
      if (inputKey !== preserveKey) input.value = formatRadixFieldValue(field, input.dataset.radixFieldInput === "hex" ? 16 : 10);
      input.classList.toggle("invalid", state.radixFieldInputErrors.has(inputKey));
    });
  }

  function applyRadixFieldSelection(start, end) {
    const high = Math.max(start, end);
    const low = Math.min(start, end);
    const existing = state.radixFields.find((field) => field.high === high && field.low === low);
    state.radixFieldSelection = null;
    state.radixFieldInputErrors.clear();
    if (existing) {
      const selectedKey = getRadixFieldKey(existing);
      state.radixActiveFieldKey = "";
      renderRadixBits();
      renderRadixFields();
      scrollRadixFieldIntoView(selectedKey);
      return;
    }

    const next = [];
    let inserted = false;
    state.radixFields.forEach((field) => {
      if (field.low > high || field.high < low) {
        next.push(field);
        return;
      }
      if (field.high > high) next.push({ high: field.high, low: high + 1, name: "" });
      if (!inserted) {
        next.push({ high, low, name: "" });
        inserted = true;
      }
      if (field.low < low) next.push({ high: low - 1, low: field.low, name: "" });
    });
    state.radixFields = next.sort((left, right) => right.high - left.high);
    const selectedKey = `${high}:${low}`;
    state.radixActiveFieldKey = "";
    renderRadixBits();
    renderRadixFields();
    scrollRadixFieldIntoView(selectedKey);
  }

  function getRadixBitAtPointer(event) {
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-radix-bit]");
    const bit = Number(target?.dataset.radixBit);
    return Number.isInteger(bit) ? bit : null;
  }

  function startRadixFieldSelection(event) {
    const label = event.target.closest("[data-radix-bit-index]");
    if (!label || event.button !== 0) return;
    const bit = Number(label.dataset.radixBitIndex);
    state.radixFieldSelection = { pointerId: event.pointerId, start: bit, end: bit };
    els.radixBits.setPointerCapture?.(event.pointerId);
    renderRadixBits();
    event.preventDefault();
  }

  function moveRadixFieldSelection(event) {
    if (!state.radixFieldSelection || state.radixFieldSelection.pointerId !== event.pointerId) return;
    const bit = getRadixBitAtPointer(event);
    if (bit === null || bit === state.radixFieldSelection.end) return;
    state.radixFieldSelection.end = bit;
    renderRadixBits();
  }

  function endRadixFieldSelection(event) {
    if (!state.radixFieldSelection || state.radixFieldSelection.pointerId !== event.pointerId) return;
    const { start, end } = state.radixFieldSelection;
    if (els.radixBits.hasPointerCapture?.(event.pointerId)) els.radixBits.releasePointerCapture(event.pointerId);
    applyRadixFieldSelection(start, end);
  }

  function cancelRadixFieldSelection(event) {
    if (!state.radixFieldSelection || state.radixFieldSelection.pointerId !== event.pointerId) return;
    if (els.radixBits.hasPointerCapture?.(event.pointerId)) els.radixBits.releasePointerCapture(event.pointerId);
    state.radixFieldSelection = null;
    renderRadixBits();
  }

  function renderRadixDialog() {
    els.radixDialog.classList.toggle("is-wide", state.radixBitWidth === 64);
    els.radixWidthControl.querySelectorAll("[data-radix-width]").forEach((button) => {
      const active = Number(button.dataset.radixWidth) === state.radixBitWidth;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    els.radixSignedControl.querySelectorAll("[data-radix-signed]").forEach((button) => {
      const active = (button.dataset.radixSigned === "true") === state.radixSigned;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    syncRadixFields();
    renderRadixBytes();
    renderRadixBits();
    renderRadixFields();
    syncRadixShiftControls();
    setRadixStatus(state.radixStatus);
    refreshIcons(els.radixDialog);
  }

  function updateRadixValue(value, preserveKind = "", preserveFieldKey = "") {
    state.radixValue = value & getRadixMask();
    state.radixInputErrors.clear();
    syncRadixFields(preserveKind);
    renderRadixBytes();
    renderRadixBits();
    syncRadixFieldValues(preserveFieldKey);
    setRadixStatus();
  }

  function radixDialogMargin() {
    return window.innerWidth <= 560 ? 10 : 16;
  }

  function clampRadixDialogPosition(left, top) {
    const margin = radixDialogMargin();
    const rect = els.radixDialog.getBoundingClientRect();
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
    return {
      left: Math.min(Math.max(margin, left), maxLeft),
      top: Math.min(Math.max(margin, top), maxTop),
    };
  }

  function positionRadixDialog(left, top) {
    const position = clampRadixDialogPosition(left, top);
    state.radixPosition = position;
    els.radixDialog.style.left = `${Math.round(position.left)}px`;
    els.radixDialog.style.top = `${Math.round(position.top)}px`;
  }

  function dockRadixDialog() {
    const margin = radixDialogMargin();
    const rect = els.radixDialog.getBoundingClientRect();
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
    const top = window.innerWidth <= 560 ? maxTop : Math.min(86, maxTop);
    positionRadixDialog(window.innerWidth - rect.width - margin, top);
  }

  function clampOpenRadixDialog() {
    if (els.radixDialog.hidden) return;
    if (window.innerWidth <= 560) {
      els.radixDialog.style.removeProperty("width");
      els.radixDialog.style.removeProperty("height");
      dockRadixDialog();
      return;
    }
    if (state.radixSize) {
      const margin = radixDialogMargin();
      const width = Math.min(Math.max(520, state.radixSize.width), window.innerWidth - margin * 2);
      const height = Math.min(Math.max(360, state.radixSize.height), window.innerHeight - margin * 2);
      state.radixSize = { width, height };
      els.radixDialog.style.width = `${Math.round(width)}px`;
      els.radixDialog.style.height = `${Math.round(height)}px`;
    }
    if (!state.radixPosition) {
      dockRadixDialog();
      return;
    }
    positionRadixDialog(state.radixPosition.left, state.radixPosition.top);
  }

  function canDragRadixDialog() {
    return window.innerWidth > 560;
  }

  function startRadixDrag(event) {
    if (event.button !== 0 || !canDragRadixDialog()) return;
    if (event.target.closest("button, input, select, textarea, a")) return;
    const rect = els.radixDialog.getBoundingClientRect();
    state.radixDrag = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    els.radixDialog.classList.add("is-dragging");
    els.radixDialogDragHandle.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function moveRadixDrag(event) {
    if (!state.radixDrag || state.radixDrag.pointerId !== event.pointerId) return;
    positionRadixDialog(event.clientX - state.radixDrag.offsetX, event.clientY - state.radixDrag.offsetY);
  }

  function endRadixDrag(event) {
    if (!state.radixDrag || state.radixDrag.pointerId !== event.pointerId) return;
    if (els.radixDialogDragHandle.hasPointerCapture?.(event.pointerId)) {
      els.radixDialogDragHandle.releasePointerCapture(event.pointerId);
    }
    state.radixDrag = null;
    els.radixDialog.classList.remove("is-dragging");
  }

  function canResizeRadixDialog() {
    return window.innerWidth > 560;
  }

  function startRadixResize(event) {
    if (event.button !== 0 || !canResizeRadixDialog()) return;
    const direction = event.currentTarget.dataset.radixResize;
    if (!/^(?:n|ne|e|se|s|sw|w|nw)$/.test(direction)) return;
    const rect = els.radixDialog.getBoundingClientRect();
    state.radixResize = {
      pointerId: event.pointerId,
      handle: event.currentTarget,
      direction,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
    };
    els.radixDialog.classList.add("is-resizing");
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }

  function moveRadixResize(event) {
    const resize = state.radixResize;
    if (!resize || resize.pointerId !== event.pointerId) return;
    const margin = radixDialogMargin();
    const minWidth = Math.min(520, window.innerWidth - margin * 2);
    const minHeight = Math.min(360, window.innerHeight - margin * 2);
    const deltaX = event.clientX - resize.startX;
    const deltaY = event.clientY - resize.startY;
    let { left, top, right, bottom } = resize;

    if (resize.direction.includes("e")) {
      right = Math.min(window.innerWidth - margin, Math.max(left + minWidth, resize.right + deltaX));
    }
    if (resize.direction.includes("w")) {
      left = Math.max(margin, Math.min(right - minWidth, resize.left + deltaX));
    }
    if (resize.direction.includes("s")) {
      bottom = Math.min(window.innerHeight - margin, Math.max(top + minHeight, resize.bottom + deltaY));
    }
    if (resize.direction.includes("n")) {
      top = Math.max(margin, Math.min(bottom - minHeight, resize.top + deltaY));
    }

    state.radixPosition = { left, top };
    state.radixSize = { width: right - left, height: bottom - top };
    els.radixDialog.style.left = `${Math.round(left)}px`;
    els.radixDialog.style.top = `${Math.round(top)}px`;
    els.radixDialog.style.width = `${Math.round(state.radixSize.width)}px`;
    els.radixDialog.style.height = `${Math.round(state.radixSize.height)}px`;
  }

  function endRadixResize(event) {
    const resize = state.radixResize;
    if (!resize || resize.pointerId !== event.pointerId) return;
    if (resize.handle.hasPointerCapture?.(event.pointerId)) resize.handle.releasePointerCapture(event.pointerId);
    state.radixResize = null;
    els.radixDialog.classList.remove("is-resizing");
  }

  function openRadixDialog() {
    if (!els.radixDialog.hidden) {
      clampOpenRadixDialog();
      els.radixDialog.focus({ preventScroll: true });
      return;
    }
    closeNoteDialog();
    closeAttachmentsDialog();
    if (state.libraryOpen) closeLibrary();
    state.radixInputErrors.clear();
    state.radixStatus = "";
    resetRadixFields();
    renderRadixDialog();
    els.radixDialog.hidden = false;
    els.radixToolButton.setAttribute("aria-expanded", "true");
    clampOpenRadixDialog();
    refreshIcons(els.radixDialog);
    window.setTimeout(() => {
      scrollRadixFieldIntoView();
      els.radixInputs.querySelector("[data-radix-input='hex']")?.focus();
    }, 0);
  }

  function closeRadixDialog(restoreFocus = true) {
    if (els.radixDialog.hidden) return;
    const pointerId = state.radixDrag?.pointerId;
    if (pointerId != null && els.radixDialogDragHandle.hasPointerCapture?.(pointerId)) {
      els.radixDialogDragHandle.releasePointerCapture(pointerId);
    }
    state.radixDrag = null;
    els.radixDialog.classList.remove("is-dragging");
    const resizePointerId = state.radixResize?.pointerId;
    const resizeHandle = state.radixResize?.handle;
    if (resizePointerId != null && resizeHandle?.hasPointerCapture?.(resizePointerId)) {
      resizeHandle.releasePointerCapture(resizePointerId);
    }
    state.radixResize = null;
    els.radixDialog.classList.remove("is-resizing");
    els.radixDialog.hidden = true;
    els.radixToolButton.setAttribute("aria-expanded", "false");
    state.radixInputErrors.clear();
    state.radixFields = [];
    state.radixFieldInputErrors.clear();
    state.radixActiveFieldKey = "";
    state.radixFieldSelection = null;
    state.radixStatus = "";
    if (restoreFocus) els.radixToolButton.focus({ preventScroll: true });
  }

  async function copyRadixValue(kind) {
    const value = kind === "hex" ? `0x${formatRadixValue(16)}` : kind === "bin" ? `0b${formatRadixValue(2)}` : formatRadixValue(10);
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else {
        const helper = document.createElement("textarea");
        helper.value = value;
        helper.style.position = "fixed";
        helper.style.opacity = "0";
        document.body.append(helper);
        helper.select();
        document.execCommand("copy");
        helper.remove();
      }
      setRadixStatus(`${kind.toUpperCase()} 已复制`);
      window.setTimeout(() => setRadixStatus(), 1200);
    } catch (error) {
      setRadixStatus(`复制失败：${error.message || String(error)}`);
    }
  }

  function handleRadixInput(event) {
    const input = event.target.closest("[data-radix-input]");
    if (!input) return;
    const kind = input.dataset.radixInput;
    const radix = kind === "hex" ? 16 : kind === "bin" ? 2 : 10;
    const parsed = parseRadixValue(input.value, radix);
    state.radixInputErrors.delete(kind);
    if (!parsed.ok) {
      state.radixInputErrors.add(kind);
      input.closest(".radix-field")?.classList.add("invalid");
      setRadixStatus(parsed.message);
      return;
    }
    state.radixValue = parsed.value;
    syncRadixFields(kind);
    renderRadixBytes();
    renderRadixBits();
    syncRadixFieldValues();
    setRadixStatus();
  }

  function handleRadixFieldInput(event) {
    const nameInput = event.target.closest("[data-radix-field-name]");
    if (nameInput) {
      const field = state.radixFields.find((item) => getRadixFieldKey(item) === nameInput.dataset.radixFieldKey);
      if (field) field.name = nameInput.value;
      return;
    }

    const input = event.target.closest("[data-radix-field-input]");
    if (!input) return;
    const field = state.radixFields.find((item) => getRadixFieldKey(item) === input.dataset.radixFieldKey);
    if (!field) return;
    const kind = input.dataset.radixFieldInput;
    const inputKey = `${getRadixFieldKey(field)}:${kind}`;
    const parsed = parseRadixFieldValue(input.value, kind === "hex" ? 16 : 10, field);
    state.radixFieldInputErrors.delete(inputKey);
    if (!parsed.ok) {
      state.radixFieldInputErrors.add(inputKey);
      input.classList.add("invalid");
      setRadixStatus(`${formatRadixFieldRange(field)}: ${parsed.message}`);
      return;
    }
    const nextValue = (state.radixValue & ~getRadixFieldMask(field)) | (parsed.value << BigInt(field.low));
    updateRadixValue(nextValue, "", inputKey);
  }

  function handleRadixFieldBlur(event) {
    const input = event.target.closest("[data-radix-field-input]");
    if (!input) return;
    const key = input.dataset.radixFieldKey;
    const inputKey = `${key}:${input.dataset.radixFieldInput}`;
    if (!state.radixFieldInputErrors.has(inputKey)) syncRadixFieldValues();
  }

  function handleRadixInputBlur(event) {
    const input = event.target.closest("[data-radix-input]");
    if (!input) return;
    const kind = input.dataset.radixInput;
    if (!state.radixInputErrors.has(kind)) syncRadixFields();
  }

  function handleRadixOperation(operation) {
    const mask = getRadixMask();
    let value = state.radixValue & mask;
    if (operation === "zero") value = 0n;
    if (operation === "ones") value = mask;
    if (operation === "invert") value = (~value) & mask;
    if (operation === "increment") value = (value + 1n) & mask;
    if (operation === "decrement") value = (value - 1n) & mask;
    const direction = operation === "shift-left" ? "left" : operation === "shift-right" ? "right" : "";
    if (direction) {
      state.radixShiftCounts[direction] = getRadixShiftCount(direction);
      syncRadixShiftControl(direction);
      const shift = BigInt(state.radixShiftCounts[direction]);
      if (direction === "left") value = (value << shift) & mask;
      if (direction === "right") value >>= shift;
    }
    updateRadixValue(value);
    els.radixInputs.querySelector("[data-radix-input='hex']")?.focus();
  }

  function normalizeCalculatorExpression(expression) {
    let normalized = String(expression || "").trim();
    const replacePrefixedInteger = (pattern) => {
      normalized = normalized.replace(pattern, (_match, prefix, literal) => {
        try {
          return `${prefix}${BigInt(literal.replace(/_/g, "")).toString(10)}`;
        } catch (_error) {
          throw new Error(`无效整数：${literal}`);
        }
      });
    };
    replacePrefixedInteger(/(^|[^A-Za-z0-9_$])(0[xX][0-9a-fA-F](?:_?[0-9a-fA-F])*)/g);
    replacePrefixedInteger(/(^|[^A-Za-z0-9_$])(0[bB][01](?:_?[01])*)/g);
    replacePrefixedInteger(/(^|[^A-Za-z0-9_$])(0[oO][0-7](?:_?[0-7])*)/g);
    while (/(\d)_(?=\d)/.test(normalized)) normalized = normalized.replace(/(\d)_(?=\d)/g, "$1");
    return normalized;
  }

  function validateCalculatorResult(value) {
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new Error("结果超出可表示范围");
      return value;
    }
    if (typeof value !== "bigint") throw new Error("表达式结果不是数值");
    const magnitude = value < 0n ? -value : value;
    if (magnitude.toString(2).length > 65536) throw new Error("整数结果过大");
    return value;
  }

  function calculatorNumber(value) {
    if (typeof value === "number") return value;
    const converted = Number(value);
    if (!Number.isFinite(converted)) throw new Error("数值过大，无法转换为浮点数");
    return converted;
  }

  function calculatorInteger(value) {
    if (typeof value === "bigint") return value;
    if (!Number.isSafeInteger(value)) throw new Error("位运算仅支持精确整数");
    return BigInt(value);
  }

  function calculatorFloorDivide(left, right) {
    if (typeof left !== "bigint" || typeof right !== "bigint") {
      const divisor = calculatorNumber(right);
      if (divisor === 0) throw new Error("除数不能为 0");
      return Math.floor(calculatorNumber(left) / divisor);
    }
    if (right === 0n) throw new Error("除数不能为 0");
    let quotient = left / right;
    const remainder = left % right;
    if (remainder !== 0n && (remainder > 0n) !== (right > 0n)) quotient -= 1n;
    return quotient;
  }

  function calculatorModulo(left, right) {
    if (typeof left !== "bigint" || typeof right !== "bigint") {
      const dividend = calculatorNumber(left);
      const divisor = calculatorNumber(right);
      if (divisor === 0) throw new Error("除数不能为 0");
      let remainder = dividend % divisor;
      if (remainder !== 0 && (remainder > 0) !== (divisor > 0)) remainder += divisor;
      return remainder;
    }
    if (right === 0n) throw new Error("除数不能为 0");
    let remainder = left % right;
    if (remainder !== 0n && (remainder > 0n) !== (right > 0n)) remainder += right;
    return remainder;
  }

  function evaluateCalculatorBinary(operator, left, right) {
    const bothIntegers = typeof left === "bigint" && typeof right === "bigint";
    if (operator === "+") return bothIntegers ? left + right : calculatorNumber(left) + calculatorNumber(right);
    if (operator === "-") return bothIntegers ? left - right : calculatorNumber(left) - calculatorNumber(right);
    if (operator === "*") return bothIntegers ? left * right : calculatorNumber(left) * calculatorNumber(right);
    if (operator === "/") {
      const divisor = calculatorNumber(right);
      if (divisor === 0) throw new Error("除数不能为 0");
      return calculatorNumber(left) / divisor;
    }
    if (operator === "//") return calculatorFloorDivide(left, right);
    if (operator === "%") return calculatorModulo(left, right);
    if (operator === "**") {
      if (bothIntegers && right >= 0n) {
        if (right > 10000n) throw new Error("指数过大");
        return left ** right;
      }
      return calculatorNumber(left) ** calculatorNumber(right);
    }
    if (["<<", ">>", "&", "|", "^"].includes(operator)) {
      const integerLeft = calculatorInteger(left);
      const integerRight = calculatorInteger(right);
      if (["<<", ">>"].includes(operator) && (integerRight < 0n || integerRight > 65536n)) {
        throw new Error("移位位数必须在 0 到 65536 之间");
      }
      if (operator === "<<") return integerLeft << integerRight;
      if (operator === ">>") return integerLeft >> integerRight;
      if (operator === "&") return integerLeft & integerRight;
      if (operator === "|") return integerLeft | integerRight;
      return integerLeft ^ integerRight;
    }
    throw new Error(`不支持运算符 ${operator}`);
  }

  function evaluateCalculatorNode(node) {
    if (node.type === "Literal") {
      if (typeof node.value !== "number") throw new Error("仅支持数字字面量");
      if (/^\d+$/.test(node.raw || "")) return BigInt(node.raw);
      return validateCalculatorResult(node.value);
    }
    if (node.type === "Identifier") {
      if (!["ans", "_"].includes(node.name)) throw new Error(`未知名称 ${node.name}`);
      if (state.calculatorLastResult === null) throw new Error("还没有上一条计算结果");
      return state.calculatorLastResult;
    }
    if (node.type === "UnaryExpression") {
      const value = evaluateCalculatorNode(node.argument);
      if (node.operator === "+") return value;
      if (node.operator === "-") return validateCalculatorResult(-value);
      if (node.operator === "~") return validateCalculatorResult(~calculatorInteger(value));
      throw new Error(`不支持一元运算符 ${node.operator}`);
    }
    if (node.type === "BinaryExpression") {
      const value = evaluateCalculatorBinary(node.operator, evaluateCalculatorNode(node.left), evaluateCalculatorNode(node.right));
      return validateCalculatorResult(value);
    }
    throw new Error("仅支持数字、括号和算术或位运算符");
  }

  function calculateExpression(expression) {
    if (!window.jsep) throw new Error("计算器解析器未加载");
    const normalized = normalizeCalculatorExpression(expression);
    if (!normalized) throw new Error("请输入表达式");
    return evaluateCalculatorNode(window.jsep(normalized));
  }

  function formatCalculatorResult(value) {
    return typeof value === "bigint" ? value.toString(10) : String(value);
  }

  function formatCalculatorHexResult(value) {
    const negative = value < 0;
    const magnitude = negative ? -value : value;
    return `${negative ? "-" : ""}0x${magnitude.toString(16).toUpperCase()}`;
  }

  function appendCalculatorEntry(expression, result, error = false) {
    const entry = document.createElement("div");
    entry.className = `calculator-entry ${error ? "error" : ""}`;
    const resultMarkup = error
      ? `<div class="calculator-result"><span class="calculator-result-marker" aria-hidden="true">!</span><output data-calculator-error>${escapeHtml(result)}</output></div>`
      : `
        <div class="calculator-result" data-calculator-result>
          <span class="calculator-result-marker" aria-hidden="true">=</span>
          <div class="calculator-result-values">
            <span class="calculator-result-value"><span class="calculator-result-base">DEC</span><output data-calculator-dec aria-label="十进制结果">${escapeHtml(formatCalculatorResult(result))}</output></span>
            <span class="calculator-result-value"><span class="calculator-result-base">HEX</span><output data-calculator-hex aria-label="十六进制结果">${escapeHtml(formatCalculatorHexResult(result))}</output></span>
          </div>
        </div>
      `;
    entry.innerHTML = `
      <div class="calculator-expression"><span aria-hidden="true">&gt;&gt;&gt;</span><code>${escapeHtml(expression)}</code></div>
      ${resultMarkup}
    `;
    els.calculatorHistory.append(entry);
    while (els.calculatorHistory.children.length > 50) els.calculatorHistory.firstElementChild.remove();
    els.calculatorHistory.scrollTop = els.calculatorHistory.scrollHeight;
    els.calculatorClearButton.disabled = false;
  }

  function submitCalculatorExpression() {
    const expression = els.calculatorInput.value.trim();
    if (!expression) return;
    state.calculatorCommands.push(expression);
    if (state.calculatorCommands.length > 100) state.calculatorCommands.shift();
    state.calculatorHistoryIndex = state.calculatorCommands.length;
    state.calculatorDraft = "";
    try {
      const result = calculateExpression(expression);
      state.calculatorLastResult = result;
      appendCalculatorEntry(expression, result);
    } catch (error) {
      appendCalculatorEntry(expression, error.message || String(error), true);
    }
    els.calculatorInput.value = "";
  }

  function clearCalculatorHistory() {
    els.calculatorHistory.replaceChildren();
    state.calculatorCommands = [];
    state.calculatorHistoryIndex = 0;
    state.calculatorDraft = "";
    state.calculatorLastResult = null;
    els.calculatorClearButton.disabled = true;
    els.calculatorInput.focus();
  }

  function navigateCalculatorHistory(direction) {
    if (!state.calculatorCommands.length) return;
    if (state.calculatorHistoryIndex === state.calculatorCommands.length) state.calculatorDraft = els.calculatorInput.value;
    state.calculatorHistoryIndex = Math.min(
      state.calculatorCommands.length,
      Math.max(0, state.calculatorHistoryIndex + direction),
    );
    els.calculatorInput.value = state.calculatorHistoryIndex === state.calculatorCommands.length
      ? state.calculatorDraft
      : state.calculatorCommands[state.calculatorHistoryIndex];
    els.calculatorInput.setSelectionRange(els.calculatorInput.value.length, els.calculatorInput.value.length);
  }

  function formatReset(value, bitWidth) {
    if (value === undefined || value === null) return "";
    const parsed = parseInputValue(value);
    return parsed.ok ? formatBigIntHex(parsed.value, bitWidth) : String(value);
  }

  function extractFieldValue(regValue, field) {
    const { ranges } = parseBits(field.bits);
    return ranges.reduce((result, range) => {
      const mask = (1n << BigInt(range.width)) - 1n;
      const segment = (regValue >> BigInt(range.lo)) & mask;
      return (result << BigInt(range.width)) | segment;
    }, 0n);
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

    const createEntry = (value, desc, condition = "") => {
      const label = String(value).trim();
      const range = label.split("..");
      try {
        if (range.length === 2) {
          return { from: BigInt(range[0]), to: BigInt(range[1]), label, desc: String(desc), condition };
        }
        const pattern = /^0[bB]([01xX]+)$/.exec(label);
        if (pattern && /[xX]/.test(pattern[1])) {
          const maskText = pattern[1].replace(/[01]/g, "1").replace(/[xX]/g, "0");
          const valueText = pattern[1].replace(/[xX]/g, "0");
          return {
            mask: BigInt(`0b${maskText}`),
            match: BigInt(`0b${valueText}`),
            label,
            desc: String(desc),
            condition,
          };
        }
        const exact = BigInt(label);
        return { from: exact, to: exact, label, desc: String(desc), condition };
      } catch {
        return null;
      }
    };

    if (field.values && !Array.isArray(field.values) && typeof field.values === "object") {
      for (const [key, desc] of Object.entries(field.values)) {
        const entry = createEntry(key, desc);
        if (entry) entries.push(entry);
      }
    }

    if (Array.isArray(field.values)) {
      for (const item of field.values) {
        const entry = createEntry(item.value, item.desc ?? item.name ?? item.value, item.condition || "");
        if (entry) entries.push(entry);
      }
    }

    entries.push(...parseInlineEnums(field));
    return entries;
  }

  function getStructuredEnum(field, value) {
    for (const item of getFieldEnumEntries(field)) {
      const matches = "mask" in item ? (value & item.mask) === item.match : value >= item.from && value <= item.to;
      if (matches) {
        return item.desc;
      }
    }

    return "";
  }

  function formatEnumKey(item) {
    if (item.label) return item.label;
    const from = item.from.toString(10);
    const to = item.to.toString(10);
    return item.from === item.to ? from : `${from}~${to}`;
  }

  function renderEnumList(field, currentValue) {
    const enums = getFieldEnumEntries(field);
    if (!enums.length) return "";

    const items = enums
      .map((item) => {
        const active = "mask" in item
          ? (currentValue & item.mask) === item.match
          : currentValue >= item.from && currentValue <= item.to;
        const description = item.condition ? `${item.desc}（${item.condition}）` : item.desc;
        return `
          <span class="enum-chip ${active ? "active" : ""}">
            <code>${escapeHtml(formatEnumKey(item))}</code>
            <span>${escapeHtml(description)}</span>
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

  function registerMatchesQuery(reg, query, pageName = state.pageName) {
    if (!query) return true;
    const target = [
      isSystemChip() && !hasSystemMmioAddress(reg) ? formatSystemEncoding(reg) : formatHex(reg.addr),
      reg.name,
      reg.access,
      reg.reset,
      reg.desc,
      reg.condition,
      reg.execution_state,
      pageName,
      ...(reg.groups || []),
      ...(reg.aliases || []),
      ...(reg.accessors || []).flatMap((accessor) => [accessor.name, accessor.kind, accessor.instruction, accessor.condition]),
      reg.alias_note,
      ...(reg.fields || []).flatMap((field) => [
        field.name, field.bits, field.access, field.reset, field.reset_info, field.condition, field.reserved, field.desc,
      ]),
      ...getRegisterNotes(reg, pageName).flatMap((note) => [note.content, noteKinds[note.kind]?.label || note.kind]),
    ]
      .join(" ")
      .toLowerCase();
    return target.includes(query);
  }

  function summarizePage() {
    const chip = getChip();
    const page = getPage();
    const regs = getDisplayRegisters();
    if (!chip || !page) {
      els.chipMeta.textContent = "未加载芯片";
      els.statusBand.textContent = state.loadMessage || "请选择 YAML 文件或目录";
      return;
    }

    if (isSystemChip(chip) && state.view === "matrix") {
      const pages = Object.values(getPages(chip));
      const registerCount = pages.reduce((sum, item) => sum + (Array.isArray(item.registers) ? item.registers.length : 0), 0);
      const fieldCount = pages.reduce(
        (sum, item) => sum + (item.registers || []).reduce((subtotal, reg) => subtotal + (reg.fields || []).length, 0),
        0,
      );
      const noteCount = Array.isArray(chip._notes) ? chip._notes.length : 0;
      const sourceVersion = chip.source?.version ? ` · ${chip.source.version}` : "";
      const summary = `全局预览 · ${pages.length} 个架构分类 · ${registerCount} 个寄存器 · ${fieldCount} 个位域${noteCount ? ` · ${noteCount} 条备注` : ""}${sourceVersion}`;
      els.chipMeta.textContent = `${chip.sensor || "Unknown"} · ${chip._source || "内置数据"}`;
      els.statusBand.textContent = state.loadMessage ? `${summary} · ${state.loadMessage}` : summary;
      return;
    }

    const fieldCount = regs.reduce((sum, reg) => sum + (reg.fields || []).length, 0);
    const noteCount = countPageNotes();
    els.chipMeta.textContent = `${chip.sensor || "Unknown"} · ${chip._source || "内置数据"}`;
    const pageIdentity = isSystemChip(chip) ? "架构分类" : `page_id ${formatHex(page.page_id)}`;
    const sourceVersion = isSystemChip(chip) && chip.source?.version ? ` · ${chip.source.version}` : "";
    const summary = `${state.pageName} · ${pageIdentity} · ${page.access || ""} · ${regs.length} 个寄存器 · ${fieldCount} 个位域${noteCount ? ` · ${noteCount} 条备注` : ""}${sourceVersion}`;
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
    if (reg.execution_state) badges.push(`<span class="badge">${escapeHtml(reg.execution_state)}</span>`);
    if (reg.encoding?.scheme) badges.push(`<span class="badge">${escapeHtml(reg.encoding.scheme)}</span>`);
    return badges.join("");
  }

  function syncSystemOverviewStickyMetrics() {
    const topbar = document.querySelector(".topbar");
    if (!topbar) return;
    const isSticky = getComputedStyle(topbar).position === "sticky";
    const offset = isSticky ? Math.ceil(topbar.getBoundingClientRect().height) : 0;
    document.documentElement.style.setProperty("--system-overview-sticky-top", `${offset}px`);
    const index = els.matrixGrid.querySelector(".system-overview-index");
    const indexHeight = index ? Math.ceil(index.getBoundingClientRect().height) : 0;
    els.matrixGrid.style.setProperty("--system-overview-index-height", `${indexHeight}px`);
  }

  function renderSystemOverview() {
    const chip = getChip();
    const query = state.query.trim().toLowerCase();
    const pageEntries = Object.entries(getPages(chip));
    const sections = [];
    const indexItems = [];
    let registerCount = 0;
    let visibleCount = 0;

    pageEntries.forEach(([pageName, page], pageIndex) => {
      const registers = Array.isArray(page.registers) ? page.registers : [];
      registerCount += registers.length;
      const matching = registers
        .map((reg, registerIndex) => ({ reg, registerIndex }))
        .filter(({ reg }) => registerMatchesQuery(reg, query, pageName));
      visibleCount += matching.length;
      if (query && !matching.length) return;

      const active = pageName === state.pageName;
      indexItems.push(`
        <button class="system-overview-index-item ${active ? "active" : ""}" type="button"
          data-system-group-index="${pageIndex}" title="${escapeHtml(pageName)}">
          <span>${escapeHtml(pageName)}</span><strong>${matching.length}</strong>
        </button>
      `);

      const tiles = matching.map(({ reg, registerIndex }) => {
        const access = String(reg.access || "");
        const locator = hasSystemMmioAddress(reg) ? formatRange(reg) : formatSystemEncoding(reg);
        const noteCount = getRegisterNotes(reg, pageName).length;
        const special = hasSpecialBehavior(reg);
        const classes = [
          "system-overview-register",
          "has-register",
          getAccessClass([reg]),
          special ? "has-special" : "",
          noteCount ? "has-note" : "",
        ].filter(Boolean).join(" ");
        const tooltip = [reg.name, locator, reg.desc, reg.condition].filter(Boolean).join("\n");
        return `
          <button class="${classes}" type="button" data-system-page-index="${pageIndex}"
            data-system-register-index="${registerIndex}" title="${escapeHtml(tooltip)}"
            aria-label="查看 ${escapeHtml(reg.name || "系统寄存器")} 详情">
            <span class="system-overview-register-name">${escapeHtml(reg.name || "-")}</span>
            <span class="system-overview-register-meta">
              <code>${escapeHtml(locator)}</code>
              <span class="access-pill ${escapeHtml(access.toLowerCase())}">${escapeHtml(access)}</span>
            </span>
            ${noteCount ? `<span class="system-overview-note" title="${noteCount} 条备注"><i data-lucide="sticky-note"></i></span>` : ""}
          </button>
        `;
      }).join("");

      sections.push(`
        <section id="system-overview-group-${pageIndex}" class="system-overview-group ${active ? "active" : ""}">
          <div class="system-overview-group-head">
            <h3>${escapeHtml(pageName)}</h3>
            <span>${matching.length}/${registers.length}</span>
          </div>
          <div class="system-overview-register-grid">${tiles}</div>
        </section>
      `);
    });

    els.matrixTitle.textContent = "全局预览";
    els.matrixGrid.classList.add("system-overview");
    els.matrixGrid.setAttribute("aria-label", "系统寄存器全局预览");
    els.matrixSummary.textContent = `${visibleCount}/${registerCount} 个寄存器匹配 · ${sections.length}/${pageEntries.length} 个分类`;
    els.matrixGrid.innerHTML = sections.length
      ? `<nav class="system-overview-index" aria-label="系统寄存器分类">${indexItems.join("")}</nav>${sections.join("")}`
      : `<div class="empty-state">没有匹配的系统寄存器</div>`;
    syncSystemOverviewStickyMetrics();
    refreshIcons(els.matrixGrid);
  }

  function renderMatrix() {
    const regs = getDisplayRegisters();
    if (isSystemChip()) {
      renderSystemOverview();
      return;
    }
    els.matrixTitle.textContent = "地址矩阵";
    els.matrixGrid.classList.remove("system-overview");
    els.matrixGrid.setAttribute("aria-label", "寄存器地址矩阵");
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
        const isOpen = hasRegister && state.activeHoverAddress === addr && !els.hoverPanel.hidden;
        const dataRegs = hasRegister
          ? `data-address="${addr}" tabindex="0" role="button" aria-haspopup="true" aria-expanded="${isOpen ? "true" : "false"}" title="单击查看详情"`
          : "";
        const access = hasRegister ? displayRegs[0].access || "" : "";

        cells.push(`
          <div class="${cellClass}${isOpen ? " is-open" : ""}" ${dataRegs}>
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
        const condition = field.condition ? `<div class="field-condition"><i data-lucide="git-branch"></i><span>${escapeHtml(field.condition)}</span></div>` : "";
        const resetInfo = field.reset_info ? `<div class="field-desc"><strong>Reset:</strong> ${escapeHtml(field.reset_info)}</div>` : "";
        const accessRules = Array.isArray(field.access_rules) && field.access_rules.length
          ? `<div class="field-desc"><strong>Access:</strong> ${field.access_rules.map((rule) => escapeHtml(rule.condition ? `${rule.access} · ${rule.condition}` : rule.access)).join("<br>")}</div>`
          : "";
        return `
          <div class="field-row ${isSet ? "is-set" : ""}">
            <div class="field-name">${escapeHtml(field.name)} ${fieldAccess}</div>
            <div class="field-bits">[${escapeHtml(field.bits)}]${fieldReset ? `<br>reset ${escapeHtml(fieldReset)}` : ""}</div>
            <div class="field-value">${escapeHtml(valueLabel)}</div>
            <div class="field-meaning">
              ${meaning ? `<strong>${escapeHtml(meaning)}</strong>` : `<span class="muted">未匹配枚举</span>`}
              ${condition}
              ${enumList}
              ${desc && !compact ? `<div class="field-desc">${escapeHtml(desc).replace(/\n/g, "<br>")}</div>` : ""}
              ${compact ? "" : resetInfo}
              ${compact ? "" : accessRules}
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
          <h3>${escapeHtml(reg.name)} <span class="addr-cell">${escapeHtml(formatRange(reg))}</span></h3>
          ${compact ? "" : renderNoteEditButton(reg)}
        </div>
        <div class="hover-meta">
          ${renderBadges(reg)}
        </div>
        ${renderRegisterValueEditor(reg, false)}
        <div class="register-desc">${escapeHtml(reg.desc || "").replace(/\n/g, "<br>")}</div>
        ${reg.condition ? `<div class="register-desc system-condition"><i data-lucide="git-branch"></i> ${escapeHtml(reg.condition)}</div>` : ""}
        ${reg.alias_note ? `<div class="register-desc"><span class="badge">alias</span> ${escapeHtml(reg.alias_note)}</div>` : ""}
        ${renderRegisterNotes(reg)}
        <div class="bit-lane-slot">${renderBitLane(reg, valueInfo)}</div>
        <div class="field-list" data-compact="${compact ? "true" : "false"}">${renderFieldRows(reg, compact)}</div>
      </div>
    `;
  }

  function relatedRegsForAddress(addr) {
    const regs = getDisplayRegisters();
    return regs.filter((reg) => {
      const start = Number(reg.addr || 0);
      const end = start + getAddressSpan(reg) - 1;
      return addr >= start && addr <= end;
    });
  }

  function getDetailNoteTarget(regs, addr) {
    return regs.find((reg) => Number(reg.addr || 0) === addr) || regs[0] || null;
  }

  function renderHoverPanelContent(regs, addr) {
    const noteTarget = getDetailNoteTarget(regs, addr);
    return `
      <div class="hover-panel-caret" aria-hidden="true"></div>
      <div class="hover-panel-body">
        <div class="hover-panel-bar">
          <div class="hover-panel-actions">
            <button class="hover-close close-button" type="button" title="关闭详情" aria-label="关闭详情窗口">
              <i data-lucide="x"></i>
            </button>
            ${noteTarget ? renderNoteEditButton(noteTarget) : ""}
          </div>
          <span>再点该寄存器或按 Esc 关闭</span>
        </div>
        ${regs.map((reg) => renderRegisterBlock(reg, true)).join("")}
      </div>
    `;
  }

  function getOpenRegisterCell() {
    if (state.activeHoverAddress == null) return null;
    return els.matrixGrid.querySelector(`.has-register[data-address="${state.activeHoverAddress}"]`);
  }

  function syncOpenCellHighlight() {
    els.matrixGrid.querySelectorAll(".reg-cell.is-open").forEach((cell) => {
      cell.classList.remove("is-open");
      if (cell.hasAttribute("aria-expanded")) cell.setAttribute("aria-expanded", "false");
    });
    const cell = getOpenRegisterCell();
    if (!cell || els.hoverPanel.hidden) return;
    cell.classList.add("is-open");
    cell.setAttribute("aria-expanded", "true");
  }

  function positionDetailPanel(anchor) {
    const panel = els.hoverPanel;
    if (panel.hidden || !anchor) return;

    const margin = 10;
    const gap = 10;
    const cell = anchor.getBoundingClientRect();
    const rect = panel.getBoundingClientRect();
    const width = rect.width || Math.min(560, window.innerWidth - 28);
    const height = rect.height || Math.min(window.innerHeight * 0.82, 720);
    const viewWidth = window.innerWidth;
    const viewHeight = window.innerHeight;

    const clamp = (left, top) => ({
      left: Math.min(Math.max(margin, left), Math.max(margin, viewWidth - width - margin)),
      top: Math.min(Math.max(margin, top), Math.max(margin, viewHeight - height - margin)),
    });
    const fitsHorizontally = (left) => left >= margin && left + width <= viewWidth - margin;
    const fitsVertically = (top) => top >= margin && top + height <= viewHeight - margin;

    const rightLeft = cell.right + gap;
    const leftLeft = cell.left - width - gap;
    const bottomTop = cell.bottom + gap;
    const topTop = cell.top - height - gap;
    let chosen;
    if (fitsHorizontally(rightLeft)) {
      chosen = { placement: "right", left: rightLeft, top: clamp(rightLeft, cell.top).top };
    } else if (fitsHorizontally(leftLeft)) {
      chosen = { placement: "left", left: leftLeft, top: clamp(leftLeft, cell.top).top };
    } else if (fitsVertically(bottomTop)) {
      chosen = { placement: "bottom", left: clamp(cell.left, bottomTop).left, top: bottomTop };
    } else if (fitsVertically(topTop)) {
      chosen = { placement: "top", left: clamp(cell.left, topTop).left, top: topTop };
    } else if (viewWidth - cell.right >= cell.left) {
      chosen = { placement: "right", ...clamp(rightLeft, cell.top) };
    } else {
      chosen = { placement: "left", ...clamp(leftLeft, cell.top) };
    }

    panel.dataset.placement = chosen.placement;
    panel.style.left = `${Math.round(chosen.left)}px`;
    panel.style.top = `${Math.round(chosen.top)}px`;
    const anchorCenter = cell.left + cell.width / 2;
    const panelCenter = chosen.left + width / 2;
    panel.dataset.actionSide = chosen.placement === "right"
      ? "left"
      : chosen.placement === "left"
        ? "right"
        : anchorCenter <= panelCenter
          ? "left"
          : "right";

    const caretSize = 10;
    const caretPad = 14;
    const caretOffset = chosen.placement === "right" || chosen.placement === "left"
      ? cell.top + cell.height / 2 - chosen.top - caretSize / 2
      : cell.left + cell.width / 2 - chosen.left - caretSize / 2;
    const maxOffset = Math.max(
      caretPad,
      (chosen.placement === "right" || chosen.placement === "left" ? height : width) - caretPad - caretSize,
    );
    panel.style.setProperty(
      "--caret-offset",
      `${Math.round(Math.min(Math.max(caretPad, caretOffset), maxOffset))}px`,
    );
  }

  function showDetailPanel(addr, anchor, { focusPanel = false } = {}) {
    const regs = relatedRegsForAddress(addr);
    if (!regs.length) return;

    state.activeHoverAddress = addr;
    els.hoverPanel.innerHTML = renderHoverPanelContent(regs, addr);
    refreshIcons(els.hoverPanel);
    els.hoverPanel.hidden = false;
    els.hoverPanel.setAttribute("tabindex", "-1");
    syncOpenCellHighlight();
    positionDetailPanel(anchor || getOpenRegisterCell());
    if (focusPanel) {
      els.hoverPanel.querySelector(".hover-close")?.focus({ preventScroll: true });
    }
  }

  function hideHoverPanel() {
    state.activeHoverAddress = null;
    els.hoverPanel.hidden = true;
    els.hoverPanel.innerHTML = "";
    syncOpenCellHighlight();
  }

  function repositionOrHideDetailPanel() {
    if (els.hoverPanel.hidden) return;
    const cell = getOpenRegisterCell();
    if (!cell) {
      hideHoverPanel();
      return;
    }
    const rect = cell.getBoundingClientRect();
    const visible =
      rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
    if (!visible) {
      hideHoverPanel();
      return;
    }
    positionDetailPanel(cell);
  }

  function handleRegisterCellActivate(cell, { viaKeyboard = false } = {}) {
    if (cell.classList.contains("system-overview-register")) {
      const pageIndex = Number(cell.dataset.systemPageIndex);
      const registerIndex = Number(cell.dataset.systemRegisterIndex);
      const pageEntry = Object.entries(getPages(getChip()))[pageIndex];
      const reg = pageEntry?.[1]?.registers?.[registerIndex];
      if (!pageEntry || !reg) return;

      const targetIdentity = getPersistentRegisterIdentity(reg);
      state.systemOverviewSnapshot = createNavigationState({
        view: "matrix",
        scrollY: window.scrollY,
        focusIdentity: "",
        fromSystemOverview: false,
      });
      replaceNavigationState(state.systemOverviewSnapshot);
      state.pageName = pageEntry[0];
      state.view = "table";
      populatePageSelect();
      pushNavigationState({
        focusIdentity: targetIdentity,
        fromSystemOverview: true,
      });
      render();
      window.requestAnimationFrame(() => {
        revealSystemRegister(targetIdentity, { focus: viaKeyboard });
      });
      return;
    }

    const addr = Number(cell.dataset.address);
    if (!Number.isFinite(addr)) return;
    if (state.activeHoverAddress === addr && !els.hoverPanel.hidden) {
      hideHoverPanel();
      return;
    }
    showDetailPanel(addr, cell, { focusPanel: viaKeyboard });
  }

  function renderRegisterLocator(reg) {
    if (!isSystemChip()) return escapeHtml(formatRange(reg));
    if (hasSystemMmioAddress(reg)) return `<code class="system-encoding">${escapeHtml(formatRange(reg))}</code>`;
    const accessors = Array.from(new Set((reg.accessors || []).map((item) => item.name).filter(Boolean)));
    return `
      <code class="system-encoding">${escapeHtml(formatSystemEncoding(reg))}</code>
      ${accessors.length ? `<div class="system-accessor-names">${accessors.map((name) => `<span>${escapeHtml(name)}</span>`).join("")}</div>` : ""}
    `;
  }

  function renderSystemRegisterDetails(reg) {
    if (!isSystemChip()) return "";
    const accessors = Array.isArray(reg.accessors) ? reg.accessors : [];
    return `
      ${reg.condition ? `<div class="system-condition"><i data-lucide="git-branch"></i><span>${escapeHtml(reg.condition)}</span></div>` : ""}
      ${accessors.length ? `<div class="system-accessors">${accessors.map((item) => `
        <div><span class="badge">${escapeHtml(item.kind === "read" ? "READ" : item.kind === "write" ? "WRITE" : "IMPLICIT")}</span><code>${escapeHtml(item.instruction)}</code>${item.condition ? `<span>${escapeHtml(item.condition)}</span>` : ""}</div>
      `).join("")}</div>` : ""}
    `;
  }

  function renderTable() {
    const regs = getDisplayRegisters();
    const query = state.query.trim().toLowerCase();
    const rows = regs.filter((reg) => registerMatchesQuery(reg, query));

    const noteCount = rows.reduce((count, reg) => count + getRegisterNotes(reg).length, 0);
    const locatorType = isSystemChip()
      ? (regs.some((reg) => hasSystemMmioAddress(reg)) ? "系统编码 / MMIO 地址" : "结构化系统编码")
      : "MMIO 地址";
    els.tableSummary.textContent = `${rows.length}/${regs.length} 个寄存器匹配 · ${noteCount} 条备注 · ${locatorType} · 每个寄存器独立保存输入值`;

    if (!rows.length) {
      els.tableBody.innerHTML = `<tr><td colspan="6"><div class="empty-state">没有匹配的寄存器</div></td></tr>`;
      return;
    }

    els.tableBody.innerHTML = rows
      .map((reg) => {
        const key = getRegisterKey(reg);
        return `
        <tr class="register-display" data-register-key="${escapeHtml(key)}">
          <td class="addr-cell">${renderRegisterLocator(reg)}</td>
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
            ${renderSystemRegisterDetails(reg)}
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
    return getDisplayRegisters().find((reg) => getRegisterKey(reg) === key) || null;
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
    hideHoverPanel();
    syncSystemOverviewStickyMetrics();
    setView(state.view);
    updateAttachmentsButton();
    summarizePage();
    renderMatrix();
    renderTable();
  }

  function fallbackCategory(record) {
    if (record.deviceType === "architecture_registers") return "架构寄存器";
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
        category: chip._category || fallbackCategory({ deviceType: chip.device_type }),
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
    hideHoverPanel();
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
          registerAddr: isSystemChip(chip) ? null : Number(reg.addr || 0),
          registerKey: getPersistentRegisterIdentity(reg),
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
    hideHoverPanel();
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
            category: chip._category || fallbackCategory({ deviceType: chip.device_type }),
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
    const system = isSystemChip();
    const resolvedView = view === "table" ? "table" : "matrix";
    state.view = resolvedView;
    const matrixLabel = system ? "全局预览" : "矩阵视图";
    els.matrixViewButton.title = matrixLabel;
    els.matrixViewButton.setAttribute("aria-label", matrixLabel);
    els.matrixTitle.textContent = system ? "全局预览" : "地址矩阵";
    els.searchInput.placeholder = system && resolvedView === "matrix"
      ? "全部分类 / 编码 / 名称 / 字段"
      : "地址 / 编码 / 名称 / 字段";
    els.registerLocatorHeader.textContent = system
      ? (getRegisters().some((reg) => hasSystemMmioAddress(reg)) ? "系统编码 / 地址" : "系统编码")
      : "地址";
    els.matrixViewButton.hidden = false;
    els.systemOverviewBackButton.hidden = !(system && resolvedView === "table");
    els.matrixView.classList.toggle("hidden", resolvedView !== "matrix");
    els.tableView.classList.toggle("hidden", resolvedView !== "table");
    els.viewButtons.forEach((button) => {
      const active = button.dataset.view === resolvedView;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    hideHoverPanel();
  }

  function returnToSystemOverview() {
    if (!isSystemChip()) return;
    const currentChipId = getNavigationChipId();
    if (
      isAppNavigationState(window.history.state) &&
      window.history.state.fromSystemOverview &&
      window.history.state.chipId === currentChipId
    ) {
      window.history.back();
      return;
    }

    if (
      isAppNavigationState(state.systemOverviewSnapshot) &&
      state.systemOverviewSnapshot.chipId === currentChipId
    ) {
      restoreNavigationState(state.systemOverviewSnapshot);
      replaceNavigationState(state.systemOverviewSnapshot);
      return;
    }

    state.view = "matrix";
    render();
    replaceNavigationState({
      view: "matrix",
      scrollY: window.scrollY,
      focusIdentity: "",
      fromSystemOverview: false,
    });
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
    els.radixToolButton.addEventListener("click", openRadixDialog);
    els.radixDialogCloseButton.addEventListener("click", closeRadixDialog);
    els.radixDialogDragHandle.addEventListener("pointerdown", startRadixDrag);
    els.radixDialogDragHandle.addEventListener("pointermove", moveRadixDrag);
    els.radixDialogDragHandle.addEventListener("pointerup", endRadixDrag);
    els.radixDialogDragHandle.addEventListener("pointercancel", endRadixDrag);
    els.radixResizeHandles.forEach((handle) => {
      handle.addEventListener("pointerdown", startRadixResize);
      handle.addEventListener("pointermove", moveRadixResize);
      handle.addEventListener("pointerup", endRadixResize);
      handle.addEventListener("pointercancel", endRadixResize);
    });
    els.radixWidthControl.addEventListener("click", (event) => {
      const button = event.target.closest("[data-radix-width]");
      if (!button) return;
      const nextWidth = Number(button.dataset.radixWidth);
      if (![8, 16, 32, 64].includes(nextWidth)) return;
      if (nextWidth === state.radixBitWidth) return;
      state.radixBitWidth = nextWidth;
      state.radixValue &= getRadixMask();
      state.radixShiftCounts.left = Math.min(state.radixShiftCounts.left, nextWidth);
      state.radixShiftCounts.right = Math.min(state.radixShiftCounts.right, nextWidth);
      state.radixInputErrors.clear();
      state.radixStatus = "";
      resetRadixFields();
      renderRadixDialog();
      clampOpenRadixDialog();
      scrollRadixFieldIntoView();
    });
    els.radixSignedControl.addEventListener("click", (event) => {
      const button = event.target.closest("[data-radix-signed]");
      if (!button) return;
      state.radixSigned = button.dataset.radixSigned === "true";
      state.radixInputErrors.clear();
      state.radixStatus = "";
      renderRadixDialog();
    });
    els.radixInputs.addEventListener("input", handleRadixInput);
    els.radixInputs.addEventListener("blur", handleRadixInputBlur, true);
    els.radixFieldsResetButton.addEventListener("click", () => {
      resetRadixFields();
      renderRadixBits();
      renderRadixFields();
      scrollRadixFieldIntoView();
      setRadixStatus();
    });
    els.radixFieldList.addEventListener("input", handleRadixFieldInput);
    els.radixFieldList.addEventListener("blur", handleRadixFieldBlur, true);
    els.radixFieldList.addEventListener("click", (event) => {
      const fieldCell = event.target.closest(".radix-field-cell[data-radix-field-key]");
      if (!fieldCell) return;
      const key = fieldCell.dataset.radixFieldKey;
      if (!state.radixFields.some((field) => getRadixFieldKey(field) === key)) return;
      setRadixActiveField(key);
    });
    els.radixFieldList.addEventListener("focusin", (event) => {
      const fieldCell = event.target.closest(".radix-field-cell[data-radix-field-key]");
      if (fieldCell) setRadixActiveField(fieldCell.dataset.radixFieldKey);
    });
    document.addEventListener("pointerdown", (event) => {
      if (!state.radixActiveFieldKey || event.target.closest(".radix-field-cell[data-radix-field-key]")) return;
      setRadixActiveField();
    });
    els.radixBits.addEventListener("pointerdown", startRadixFieldSelection);
    els.radixBits.addEventListener("pointermove", moveRadixFieldSelection);
    els.radixBits.addEventListener("pointerup", endRadixFieldSelection);
    els.radixBits.addEventListener("pointercancel", cancelRadixFieldSelection);
    Object.entries(els.radixShiftInputs).forEach(([direction, input]) => {
      input.addEventListener("input", () => {
        const parsed = Number.parseInt(input.value, 10);
        if (Number.isInteger(parsed) && parsed >= 1) {
          state.radixShiftCounts[direction] = Math.min(state.radixBitWidth, parsed);
        }
      });
      input.addEventListener("blur", () => syncRadixShiftControl(direction));
      input.addEventListener("change", () => syncRadixShiftControl(direction));
    });
    els.radixInputs.addEventListener("click", (event) => {
      const button = event.target.closest("[data-radix-copy]");
      if (button) copyRadixValue(button.dataset.radixCopy);
    });
    els.radixBits.addEventListener("click", (event) => {
      const button = event.target.closest("[data-radix-bit-value]");
      if (!button) return;
      const bit = BigInt(button.dataset.radixBitValue);
      updateRadixValue(state.radixValue ^ (1n << bit));
    });
    els.radixOperations.addEventListener("click", (event) => {
      const shiftStep = event.target.closest("[data-radix-shift-direction]");
      if (shiftStep) {
        const direction = shiftStep.dataset.radixShiftDirection;
        const delta = Number(shiftStep.dataset.radixShiftDelta);
        if (!["left", "right"].includes(direction) || !Number.isInteger(delta)) return;
        state.radixShiftCounts[direction] = Math.min(
          state.radixBitWidth,
          Math.max(1, state.radixShiftCounts[direction] + delta),
        );
        syncRadixShiftControl(direction);
        els.radixShiftInputs[direction].focus();
        return;
      }
      const button = event.target.closest("[data-radix-operation]");
      if (button) handleRadixOperation(button.dataset.radixOperation);
    });
    els.calculatorForm.addEventListener("submit", (event) => {
      event.preventDefault();
      submitCalculatorExpression();
    });
    els.calculatorInput.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      navigateCalculatorHistory(event.key === "ArrowUp" ? -1 : 1);
    });
    els.calculatorClearButton.addEventListener("click", clearCalculatorHistory);
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
      if (isSystemChip() && state.view === "matrix") {
        const pageIndex = Object.keys(getPages(getChip())).indexOf(state.pageName);
        window.requestAnimationFrame(() => {
          document.getElementById(`system-overview-group-${pageIndex}`)?.scrollIntoView({ block: "start" });
        });
      }
    });

    els.searchInput.addEventListener("input", () => {
      state.query = els.searchInput.value.trim().toLowerCase();
      render();
    });

    els.viewButtons.forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.view === "matrix" && isSystemChip() && state.view === "table") {
          returnToSystemOverview();
          return;
        }
        setView(button.dataset.view);
        replaceNavigationState({
          focusIdentity: "",
          fromSystemOverview: false,
        });
      });
    });

    els.systemOverviewBackButton.addEventListener("click", returnToSystemOverview);

    els.matrixGrid.addEventListener("click", (event) => {
      const groupLink = event.target.closest("[data-system-group-index]");
      if (groupLink && els.matrixGrid.contains(groupLink)) {
        document.getElementById(`system-overview-group-${groupLink.dataset.systemGroupIndex}`)?.scrollIntoView({ block: "start" });
        return;
      }
      const cell = event.target.closest(".has-register");
      if (!cell || !els.matrixGrid.contains(cell)) return;
      handleRegisterCellActivate(cell);
    });
    els.matrixGrid.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const cell = event.target.closest(".has-register");
      if (!cell || !els.matrixGrid.contains(cell)) return;
      event.preventDefault();
      handleRegisterCellActivate(cell, { viaKeyboard: true });
    });

    els.hoverPanel.addEventListener("input", handleRegisterValueInput);
    els.hoverPanel.addEventListener("click", (event) => {
      if (handleNoteEditButton(event)) return;
      if (event.target.closest(".hover-close")) hideHoverPanel();
    });

    els.tableBody.addEventListener("input", handleRegisterValueInput);
    els.tableBody.addEventListener("click", handleNoteEditButton);

    document.addEventListener("click", (event) => {
      if (els.hoverPanel.hidden) return;
      if (els.hoverPanel.contains(event.target)) return;
      if (els.radixDialog.contains(event.target)) return;
      if (event.target.closest("#matrixGrid .has-register")) return;
      if (event.target.closest("dialog[open], .library-backdrop:not([hidden]), .theme-menu, .theme-button")) return;
      hideHoverPanel();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        if (state.themeMenuOpen) {
          closeThemeMenu(true);
          return;
        }
        if (els.noteDialog.open || els.attachmentsDialog.open || els.importResultDialog.open) return;
        if (!els.radixDialog.hidden) {
          closeRadixDialog();
          return;
        }
        if (state.libraryOpen) closeLibrary();
        else hideHoverPanel();
      }
    });

    window.addEventListener("scroll", repositionOrHideDetailPanel, { capture: true, passive: true });
    window.addEventListener("resize", () => {
      syncSystemOverviewStickyMetrics();
      repositionOrHideDetailPanel();
      clampOpenRadixDialog();
    });
    window.addEventListener("popstate", (event) => restoreNavigationState(event.state));
  }

  function init() {
    window.jsep?.addBinaryOp("//", 10);
    applyTheme(readStoredTheme(), false);
    bindEvents();
    populateChipSelect();
    populatePageSelect();
    setView("matrix");
    render();
    if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";
    replaceNavigationState({ view: "matrix" });
    refreshIcons();
    initializeLibrary().catch((error) => {
      state.loadMessage = `芯片库加载失败：${error.message || String(error)}`;
      setLibraryStatus(state.loadMessage, true);
      render();
    });
  }

  init();
})();
