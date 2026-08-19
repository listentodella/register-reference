(function () {
  const chips = Array.isArray(window.REGISTER_CHIPS) ? window.REGISTER_CHIPS : [];
  const THEME_STORAGE_KEY = "register-reference.theme";
  const LANGUAGE_STORAGE_KEY = "register-reference.language-mode";
  const SEARCH_RECENT_STORAGE_KEY = "register-reference.search-recent";
  const SEARCH_HISTORY_STORAGE_KEY = "register-reference.search-history";
  const NAVIGATION_STATE_KEY = "registerReferenceNavigation";
  const SYSTEM_SEARCH_RESULT_LIMIT = 200;
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
    searchQuery: "",
    searchResults: [],
    searchFilters: [],
    searchIssues: [],
    searchSuggestion: "",
    searchActiveIndex: -1,
    searchOpen: false,
    searchLoading: false,
    searchRequestId: 0,
    searchIndexReady: false,
    searchFallbackFiltering: false,
    searchRecent: [],
    searchHistory: [],
    searchHistoryIndex: -1,
    searchHistoryDraft: "",
    registerValues: new Map(),
    activeHoverAddress: null,
    activeWorkbenchKey: "",
    loadMessage: "",
    libraryQuery: "",
    libraryOpen: false,
    libraryStatus: "",
    libraryStatusError: false,
    librarySelection: new Set(),
    libraryRemovalIds: [],
    importPreviewId: "",
    importPreviewLabel: "",
    importPreviewResolver: null,
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
    toolsMenuOpen: false,
    languageMode: "bilingual",
    translationNotice: "",
    systemOverviewSnapshot: null,
  };

  let libraryRecords = [];
  const chipDocumentCache = new Map();
  let searchDebounceTimer = 0;
  let searchWorker = null;
  let searchWorkerBlobUrl = "";
  let importWorker = null;
  let importWorkerBlobUrl = "";
  let importRequestId = 0;
  const importRequests = new Map();

  const els = {
    chipSelect: document.getElementById("chipSelect"),
    pageSelect: document.getElementById("pageSelect"),
    searchInput: document.getElementById("searchInput"),
    searchControl: document.getElementById("searchControl"),
    searchPanel: document.getElementById("searchPanel"),
    searchSummary: document.getElementById("searchSummary"),
    searchFilters: document.getElementById("searchFilters"),
    searchResults: document.getElementById("searchResults"),
    searchActivity: document.getElementById("searchActivity"),
    languageSwitcher: document.getElementById("languageSwitcher"),
    languageControl: document.getElementById("languageControl"),
    languageButtons: Array.from(document.querySelectorAll("[data-language-mode]")),
    translationAvailability: document.getElementById("translationAvailability"),
    toolsMenuPicker: document.getElementById("toolsMenuPicker"),
    toolsMenuButton: document.getElementById("toolsMenuButton"),
    toolsMenu: document.getElementById("toolsMenu"),
    toolsMenuBadge: document.getElementById("toolsMenuBadge"),
    loadYamlButton: document.getElementById("loadYamlButton"),
    loadFolderButton: document.getElementById("loadFolderButton"),
    libraryButton: document.getElementById("libraryButton"),
    libraryQuickButton: document.getElementById("libraryQuickButton"),
    attachmentsButton: document.getElementById("attachmentsButton"),
    attachmentsButtonCount: document.getElementById("attachmentsButtonCount"),
    themePicker: document.getElementById("themePicker"),
    themeButton: document.getElementById("themeButton"),
    themeButtonLabel: document.getElementById("themeButtonLabel"),
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
    importPreviewDialog: document.getElementById("importPreviewDialog"),
    importPreviewTitle: document.getElementById("importPreviewTitle"),
    importPreviewSummary: document.getElementById("importPreviewSummary"),
    importPreviewDetails: document.getElementById("importPreviewDetails"),
    importPreviewCancelButton: document.getElementById("importPreviewCancelButton"),
    importPreviewCancelAction: document.getElementById("importPreviewCancelAction"),
    importPreviewConfirmButton: document.getElementById("importPreviewConfirmButton"),
    libraryBackdrop: document.getElementById("libraryBackdrop"),
    libraryPanel: document.getElementById("libraryPanel"),
    libraryCloseButton: document.getElementById("libraryCloseButton"),
    librarySummary: document.getElementById("librarySummary"),
    librarySearchInput: document.getElementById("librarySearchInput"),
    libraryImportButton: document.getElementById("libraryImportButton"),
    libraryFolderButton: document.getElementById("libraryFolderButton"),
    librarySelectAll: document.getElementById("librarySelectAll"),
    libraryList: document.getElementById("libraryList"),
    libraryStatus: document.getElementById("libraryStatus"),
    librarySelectionSummary: document.getElementById("librarySelectionSummary"),
    libraryBatchCategory: document.getElementById("libraryBatchCategory"),
    libraryBatchCategoryButton: document.getElementById("libraryBatchCategoryButton"),
    libraryShowSelectedButton: document.getElementById("libraryShowSelectedButton"),
    libraryHideSelectedButton: document.getElementById("libraryHideSelectedButton"),
    libraryRemoveSelectedButton: document.getElementById("libraryRemoveSelectedButton"),
    libraryRemoveDialog: document.getElementById("libraryRemoveDialog"),
    libraryRemoveSummary: document.getElementById("libraryRemoveSummary"),
    libraryRemoveList: document.getElementById("libraryRemoveList"),
    libraryRemoveImpact: document.getElementById("libraryRemoveImpact"),
    libraryRemoveCancelButton: document.getElementById("libraryRemoveCancelButton"),
    libraryRemoveConfirmButton: document.getElementById("libraryRemoveConfirmButton"),
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
    els.themeButtonLabel.textContent = label;
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

  function visibleToolsMenuItems() {
    return Array.from(els.toolsMenu.querySelectorAll('[role="menuitem"], [role="menuitemradio"]'))
      .filter((item) => !item.hidden && item.getClientRects().length > 0 && !item.disabled);
  }

  function renderToolsMenu() {
    els.toolsMenuButton.setAttribute("aria-expanded", String(state.toolsMenuOpen));
    els.toolsMenu.hidden = !state.toolsMenuOpen;
  }

  function openToolsMenu() {
    state.toolsMenuOpen = true;
    renderToolsMenu();
    window.requestAnimationFrame(() => visibleToolsMenuItems()[0]?.focus());
  }

  function closeToolsMenu(restoreFocus = false) {
    if (!state.toolsMenuOpen) return;
    if (state.themeMenuOpen) closeThemeMenu(false);
    state.toolsMenuOpen = false;
    renderToolsMenu();
    if (restoreFocus) els.toolsMenuButton.focus();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  const searchKindLabels = {
    chip: "芯片",
    page: "分类",
    register: "寄存器",
    field: "位域",
    enum: "枚举",
    description: "说明",
    note: "备注",
  };

  const searchMatchLabels = {
    register_name: "寄存器名",
    alias: "别名 / 访问器",
    system_encoding: "系统编码",
    address: "地址",
    field_name: "位域名",
    bits: "位范围",
    name: "名称",
    enum_name: "枚举名称",
    enum_value: "枚举值",
    translated_description: "中文说明",
    source_description: "英文说明",
    note: "备注",
    fuzzy_name: "相近名称",
    filter: "筛选条件",
    recent: "最近跳转",
  };

  const searchSectionLabels = {
    entities: "寄存器与位域",
    text: "说明与备注",
    suggestions: "相近名称",
    recent: "最近跳转",
  };

  function readSearchStorage(key) {
    try {
      const value = JSON.parse(window.localStorage.getItem(key) || "[]");
      return Array.isArray(value) ? value : [];
    } catch (_error) {
      return [];
    }
  }

  function writeSearchStorage(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (_error) {
      // Search history is an optional local convenience.
    }
  }

  function recentResultKey(result) {
    return [result.chipId, result.pageName, result.registerIndex, result.registerName, result.fieldName, result.fieldBits].join("|");
  }

  function rememberSearchResult(result) {
    if (!result?.chipId) return;
    const stored = {
      kind: result.kind,
      chipId: result.chipId,
      chipName: result.chipName,
      category: result.category,
      enabled: result.enabled,
      pageName: result.pageName,
      registerIndex: result.registerIndex,
      registerName: result.registerName,
      registerLocator: result.registerLocator,
      fieldName: result.fieldName,
      fieldBits: result.fieldBits,
      title: result.title,
      resultType: result.resultType || result.kind,
      matchKind: "recent",
      matchTerms: [],
      matchLanguage: "identifier",
      snippet: "",
      section: "recent",
    };
    state.searchRecent = [stored, ...state.searchRecent.filter((item) => recentResultKey(item) !== recentResultKey(stored))].slice(0, 8);
    writeSearchStorage(SEARCH_RECENT_STORAGE_KEY, state.searchRecent);
  }

  function rememberSearchQuery(query) {
    const value = String(query || "").trim();
    if (!value) return;
    state.searchHistory = [value, ...state.searchHistory.filter((item) => item !== value)].slice(0, 20);
    state.searchHistoryIndex = -1;
    state.searchHistoryDraft = "";
    writeSearchStorage(SEARCH_HISTORY_STORAGE_KEY, state.searchHistory);
  }

  function restoreSearchHistory(direction) {
    if (!state.searchHistory.length) return false;
    if (state.searchHistoryIndex < 0) state.searchHistoryDraft = els.searchInput.value;
    state.searchHistoryIndex = Math.max(-1, Math.min(state.searchHistory.length - 1, state.searchHistoryIndex + direction));
    const value = state.searchHistoryIndex < 0 ? state.searchHistoryDraft : state.searchHistory[state.searchHistoryIndex];
    els.searchInput.value = value;
    state.searchQuery = value.trim();
    scheduleSearch(true);
    return true;
  }

  function recentChipIds() {
    return [...new Set(state.searchRecent.map((result) => result.chipId).filter(Boolean))];
  }

  function highlightSearchMatch(value, terms = []) {
    const source = String(value || "");
    const matches = [...new Set((terms || []).map(String).map((term) => term.trim()).filter(Boolean))]
      .sort((left, right) => right.length - left.length);
    if (!matches.length) return escapeHtml(source);
    const expression = new RegExp(`(${matches.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "ig");
    return source.split(expression).map((part, index) => index % 2 ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part)).join("");
  }

  function inlineWorkerUrl(source) {
    if (window.location.protocol !== "file:") {
      const blobUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
      return { workerUrl: blobUrl, blobUrl };
    }
    const bytes = new TextEncoder().encode(source);
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return { workerUrl: `data:text/javascript;base64,${btoa(binary)}`, blobUrl: "" };
  }

  function setSearchLoading(loading) {
    state.searchLoading = loading;
    els.searchActivity.hidden = !loading;
  }

  function openSearchPanel() {
    if (!state.searchQuery && !state.searchResults.length && !state.searchIssues.length) return;
    state.searchOpen = true;
    els.searchPanel.hidden = false;
    els.searchInput.setAttribute("aria-expanded", "true");
  }

  function closeSearchPanel({ clear = false, restoreFocus = false } = {}) {
    state.searchOpen = false;
    els.searchPanel.hidden = true;
    els.searchInput.setAttribute("aria-expanded", "false");
    els.searchInput.removeAttribute("aria-activedescendant");
    if (clear) {
      state.searchQuery = "";
      state.searchResults = [];
      state.searchFilters = [];
      state.searchIssues = [];
      state.searchSuggestion = "";
      state.searchActiveIndex = -1;
      els.searchInput.value = "";
    }
    if (restoreFocus) els.searchInput.focus();
  }

  function renderSearchFilters() {
    const items = [
      ...state.searchFilters.map((filter) => ({ token: filter.token, label: `${filter.key}:${filter.value}`, invalid: false })),
      ...state.searchIssues.map((issue) => ({ token: issue.token, label: issue.message, invalid: true })),
    ];
    els.searchFilters.hidden = !items.length;
    els.searchFilters.innerHTML = items.map((item) => `
      <button class="search-filter ${item.invalid ? "invalid" : ""}" type="button"
        data-search-filter-token="${escapeHtml(item.token)}" title="移除 ${escapeHtml(item.token)}">
        <span>${escapeHtml(item.label)}</span><i data-lucide="x"></i>
      </button>
    `).join("");
    if (items.length) refreshIcons();
  }

  function renderSearchResults() {
    const results = state.searchResults;
    const query = state.searchQuery;
    renderSearchFilters();
    const entityCount = results.filter((result) => result.section === "entities").length;
    const textCount = results.filter((result) => result.section === "text").length;
    els.searchSummary.textContent = state.searchLoading ? `正在搜索“${query}”...`
      : state.searchIssues.length ? "请修正或移除无效筛选"
        : !query && results.length ? `${results.length} 个最近跳转`
          : `${results.length} 个结果${entityCount && textCount ? ` · ${entityCount} 个实体，${textCount} 条说明/备注` : ""}${results.length >= 100 ? " · 已显示前 100 项" : ""}`;
    if (!results.length) {
      let message;
      if (state.searchLoading) message = "正在检索寄存器、位域与说明";
      else if (state.searchIssues.length) message = `<strong>${escapeHtml(state.searchIssues[0].message)}</strong><br><small>点击上方红色筛选项即可移除</small>`;
      else if (state.searchSuggestion) message = `没有找到“${escapeHtml(query)}”<br><button class="search-suggestion" type="button" data-search-suggestion="${escapeHtml(state.searchSuggestion)}">搜索相近名称 ${escapeHtml(state.searchSuggestion)}</button>`;
      else if (state.searchFilters.length) message = `没有结果满足当前筛选<br><small>可移除上方任一筛选项后立即重搜</small>`;
      else if (!query) message = "暂无最近跳转<br><small>例如 chip:m3 APSR 或 addr:0xE000ED00</small>";
      else message = `没有找到“${escapeHtml(query)}”<br><small>可缩短实体名称，但不会自动扩展为大量正文结果</small>`;
      els.searchResults.innerHTML = `<div class="search-empty">${message}</div>`;
      return;
    }
    let previousSection = "";
    els.searchResults.innerHTML = results.map((result, index) => {
      const active = index === state.searchActiveIndex;
      const field = result.fieldName ? ` · ${result.fieldName}${result.fieldBits ? `[${result.fieldBits}]` : ""}` : "";
      const register = result.registerName ? ` · ${result.registerName}` : "";
      const path = [...new Set([result.chipName, result.category, result.pageName].filter(Boolean))].join(" / ") + register + field;
      const locator = result.registerLocator ? `<code>${highlightSearchMatch(result.registerLocator, result.matchTerms)}</code>` : "";
      const bits = result.fieldBits ? `<code>[${escapeHtml(result.fieldBits)}]</code>` : "";
      const section = result.section || "entities";
      const heading = section !== previousSection
        ? `<div class="search-result-group" role="presentation">${escapeHtml(searchSectionLabels[section] || section)}</div>` : "";
      previousSection = section;
      return `${heading}
        <button id="search-result-${index}" class="search-result ${active ? "active" : ""}" type="button" role="option"
          aria-selected="${active}" data-search-index="${index}" data-kind="${escapeHtml(result.kind)}">
          <span class="search-result-kind">${escapeHtml(searchKindLabels[result.resultType || result.kind] || result.resultType || result.kind)}</span>
          <span class="search-result-main">
            <span class="search-result-title">${highlightSearchMatch(result.title || result.registerName || result.chipName, result.matchTerms)}</span>
            <span class="search-result-path">${escapeHtml(path)}</span>
          </span>
          <span class="search-result-meta">
            ${locator}${bits}
            ${result.enabled ? "" : `<span class="search-result-hidden">已隐藏</span>`}
          </span>
          <span class="search-result-match">命中：${escapeHtml(searchMatchLabels[result.matchKind] || result.matchKind || "名称")}</span>
          ${result.snippet ? `<span class="search-result-snippet">${highlightSearchMatch(result.snippet, result.matchTerms)}</span>` : ""}
        </button>
      `;
    }).join("");
    if (state.searchActiveIndex >= 0) {
      const activeId = `search-result-${state.searchActiveIndex}`;
      els.searchInput.setAttribute("aria-activedescendant", activeId);
      document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
    } else {
      els.searchInput.removeAttribute("aria-activedescendant");
    }
  }

  function acceptSearchResults(requestId, response) {
    if (requestId !== state.searchRequestId) return;
    const hadFallbackFilter = state.searchFallbackFiltering;
    state.searchFallbackFiltering = false;
    state.query = "";
    const normalized = Array.isArray(response) ? { results: response } : response || {};
    state.searchResults = Array.isArray(normalized.results) ? normalized.results : [];
    state.searchFilters = Array.isArray(normalized.filters) ? normalized.filters : [];
    state.searchIssues = Array.isArray(normalized.issues) ? normalized.issues : [];
    state.searchSuggestion = String(normalized.suggestion || "");
    state.searchActiveIndex = state.searchResults.length ? 0 : -1;
    setSearchLoading(false);
    openSearchPanel();
    if (hadFallbackFilter) render();
    renderSearchResults();
  }

  function showRecentSearchResults() {
    state.searchResults = state.searchRecent.map((result) => ({ ...result, section: "recent", matchKind: "recent" }));
    state.searchFilters = [];
    state.searchIssues = [];
    state.searchSuggestion = "";
    state.searchActiveIndex = state.searchResults.length ? 0 : -1;
    setSearchLoading(false);
    state.searchOpen = true;
    els.searchPanel.hidden = false;
    els.searchInput.setAttribute("aria-expanded", "true");
    renderSearchResults();
  }

  function removeSearchFilterToken(token) {
    const source = els.searchInput.value;
    const exactIndex = source.toLowerCase().indexOf(String(token).toLowerCase());
    let next = source;
    if (exactIndex >= 0) {
      next = `${source.slice(0, exactIndex)} ${source.slice(exactIndex + String(token).length)}`;
    } else {
      const key = String(token).split(":", 1)[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      next = source.replace(new RegExp(`(^|\\s)${key}:(?:"[^"]*"|'[^']*'|\\S+)`, "i"), " ");
    }
    next = next.replace(/\s+/g, " ").trim();
    els.searchInput.value = next;
    state.searchQuery = next;
    state.searchHistoryIndex = -1;
    scheduleSearch(true);
    els.searchInput.focus();
  }

  function useSearchSuggestion(value) {
    const suggestion = String(value || "").trim();
    if (!suggestion) return;
    els.searchInput.value = suggestion;
    state.searchQuery = suggestion;
    state.searchHistoryIndex = -1;
    scheduleSearch(true);
    els.searchInput.focus();
  }

  async function initializeSearchWorker() {
    if (isDesktopApp() || searchWorker) return;
    let source = window.REGISTER_SEARCH_WORKER_SOURCE || "";
    let workerUrl;
    let blobUrl = "";
    if (source) {
      ({ workerUrl, blobUrl } = inlineWorkerUrl(source));
    } else {
      workerUrl = new URL("search-worker.js", document.baseURI).href;
    }
    searchWorker = new Worker(workerUrl);
    searchWorkerBlobUrl = blobUrl;
    searchWorker.addEventListener("message", (event) => {
      if (searchWorkerBlobUrl) {
        URL.revokeObjectURL(searchWorkerBlobUrl);
        searchWorkerBlobUrl = "";
      }
      const message = event.data || {};
      if (message.type === "ready") {
        state.searchIndexReady = true;
        if (state.searchQuery) scheduleSearch(true);
      } else if (message.type === "results") {
        acceptSearchResults(message.requestId, message.response || message.results);
      }
    });
    searchWorker.addEventListener("error", () => {
      if (searchWorkerBlobUrl) URL.revokeObjectURL(searchWorkerBlobUrl);
      searchWorkerBlobUrl = "";
      state.searchIndexReady = false;
    });
    refreshBrowserSearchIndex();
  }

  function initializeImportWorker() {
    if (isDesktopApp() || importWorker) return importWorker;
    const source = window.REGISTER_IMPORT_WORKER_SOURCE || "";
    let workerUrl;
    let blobUrl = "";
    if (source) {
      ({ workerUrl, blobUrl } = inlineWorkerUrl(source));
    } else {
      workerUrl = new URL("import-worker.js", document.baseURI).href;
    }
    importWorker = new Worker(workerUrl);
    importWorkerBlobUrl = blobUrl;
    importWorker.addEventListener("message", (event) => {
      if (importWorkerBlobUrl) {
        URL.revokeObjectURL(importWorkerBlobUrl);
        importWorkerBlobUrl = "";
      }
      const message = event.data || {};
      const request = importRequests.get(message.requestId);
      if (!request) return;
      importRequests.delete(message.requestId);
      if (message.type === "import-results") request.resolve(message.result);
      else request.reject(new Error(message.error || "YAML 后台解析失败"));
    });
    importWorker.addEventListener("error", (event) => {
      if (importWorkerBlobUrl) URL.revokeObjectURL(importWorkerBlobUrl);
      importWorkerBlobUrl = "";
      const error = new Error(event.message || "YAML 后台解析失败");
      for (const request of importRequests.values()) request.reject(error);
      importRequests.clear();
      importWorker?.terminate();
      importWorker = null;
    });
    return importWorker;
  }

  function readBrowserFileText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error(`无法读取 ${file.name}`));
      reader.readAsText(file, "utf-8");
    });
  }

  async function parseBrowserImportFiles(files) {
    const worker = initializeImportWorker();
    if (!worker) return Promise.reject(new Error("当前浏览器不支持 YAML 后台解析"));
    const requestId = ++importRequestId;
    const fileEntries = await Promise.all(files.map(async (file) => ({
      fileName: file.name,
      sourceName: file.webkitRelativePath || file.name,
      text: await readBrowserFileText(file),
    })));
    const existingSources = libraryRecords.map((record) => {
      const chip = record.chipData || chips.find((item) => getNavigationChipId(item) === record.id);
      return {
        sourceSha256: record.sourceSha256 || chip?._sourceSha256 || "",
        text: record.yamlText || "",
        data: chip && !chip._loading ? chip : null,
      };
    }).filter((source) => source.sourceSha256 && source.data);
    return new Promise((resolve, reject) => {
      importRequests.set(requestId, { resolve, reject });
      worker.postMessage({
        type: "parse-import",
        requestId,
        files: fileEntries,
        existingSources,
      });
    });
  }

  function refreshBrowserSearchIndex() {
    if (!searchWorker) return;
    state.searchIndexReady = false;
    const indexedChips = libraryRecords.map((record) => {
      try {
        return recordToChip(record);
      } catch (_error) {
        return null;
      }
    }).filter(Boolean);
    searchWorker.postMessage({ type: "init", chips: indexedChips, summaries: libraryRecords });
  }

  async function initializeDesktopSearchIndex() {
    if (!isDesktopApp()) return;
    let status;
    try {
      status = await getInvoke()("search_index_status");
    } catch (_error) {
      // Older test doubles and pre-upgrade development builds have no index API.
      state.searchIndexReady = true;
      return;
    }
    state.searchIndexReady = Boolean(status.ready);
    if (status.ready) return;
    state.loadMessage = `正在建立全库搜索索引 ${status.indexedChips}/${status.totalChips}`;
    render();
    try {
      await getInvoke()("rebuild_search_index");
      state.searchIndexReady = true;
      state.loadMessage = "全库搜索索引已就绪";
    } catch (error) {
      state.loadMessage = `搜索索引建立失败：${errorMessage(error)}`;
    }
    render();
    if (state.searchQuery) scheduleSearch(true);
  }

  async function runSearch(requestId, query) {
    if (!query || !state.searchIndexReady) {
      if (requestId === state.searchRequestId) {
        state.searchResults = [];
        setSearchLoading(Boolean(query && !state.searchIndexReady));
        openSearchPanel();
        renderSearchResults();
      }
      return;
    }
    if (isDesktopApp()) {
      try {
        const response = await getInvoke()("search_registers", {
          query,
          currentChipId: getNavigationChipId(),
          limit: 100,
          recentChipIds: recentChipIds(),
        });
        acceptSearchResults(requestId, response);
      } catch (error) {
        if (requestId !== state.searchRequestId) return;
        state.searchResults = [];
        state.searchFallbackFiltering = true;
        state.query = query.toLowerCase();
        setSearchLoading(false);
        openSearchPanel();
        render();
        els.searchSummary.textContent = "搜索失败";
        els.searchResults.innerHTML = `<div class="search-empty">全库索引暂不可用，已使用当前视图快速筛选<br><small>${escapeHtml(errorMessage(error))}</small></div>`;
      }
      return;
    }
    searchWorker?.postMessage({
      type: "search",
      requestId,
      query,
      currentChipId: getNavigationChipId(),
      recentChipIds: recentChipIds(),
      limit: 100,
    });
  }

  function scheduleSearch(immediate = false) {
    window.clearTimeout(searchDebounceTimer);
    const query = state.searchQuery.trim();
    const requestId = ++state.searchRequestId;
    if (!query) {
      const hadFilter = state.searchFallbackFiltering && Boolean(state.query);
      state.searchFallbackFiltering = false;
      state.query = "";
      setSearchLoading(false);
      showRecentSearchResults();
      if (hadFilter) render();
      return;
    }
    setSearchLoading(true);
    openSearchPanel();
    renderSearchResults();
    searchDebounceTimer = window.setTimeout(() => runSearch(requestId, query), immediate ? 0 : 120);
  }

  function normalizeLanguageMode(value) {
    return ["zh", "bilingual", "en"].includes(value) ? value : "bilingual";
  }

  function readStoredLanguageMode() {
    try {
      return normalizeLanguageMode(window.localStorage.getItem(LANGUAGE_STORAGE_KEY));
    } catch (_error) {
      return "bilingual";
    }
  }

  function setLanguageMode(mode, persist = true) {
    state.languageMode = normalizeLanguageMode(mode);
    els.languageButtons.forEach((button) => {
      const active = button.dataset.languageMode === state.languageMode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    if (persist) {
      try {
        window.localStorage.setItem(LANGUAGE_STORAGE_KEY, state.languageMode);
      } catch (_error) {
        // The selected mode still applies for this session when storage is unavailable.
      }
    }
    updateLanguageControl();
  }

  function translationDocumentFromRecord(record) {
    if (window.isRegisterTranslationDocument?.(record?.translationData)) return record.translationData;
    if (record && !record.yamlText && record.locale) {
      return {
        format: "register-reference-translation",
        locale: record.locale,
        metadata: {
          locale: record.locale,
          status: record.status || "draft",
          coverage: record.coverage || "partial",
          method: record.method || "",
          translator: record.translator || "",
          updated: record.updated || "",
        },
        translations: {
          sensor: record.translatedSensor || "",
          family: record.translatedFamily || "",
        },
      };
    }
    if (record?._translationParsed) return record._translationDocument || null;
    if (!record?.yamlText) return null;
    try {
      const data = window.parseRegisterYaml(record.yamlText);
      record._translationParsed = true;
      record._translationDocument = window.isRegisterTranslationDocument?.(data) ? data : null;
      return record._translationDocument;
    } catch (_error) {
      record._translationParsed = true;
      record._translationDocument = null;
      return null;
    }
  }

  function getRecordTranslationDocument(record, locale = "zh-CN") {
    return (record?.translations || [])
      .map(translationDocumentFromRecord)
      .find((translation) => translation?.locale === locale) || null;
  }

  function getTranslationDocument(chip = getChip(), locale = "zh-CN") {
    const translations = Array.isArray(chip?._translations) ? chip._translations : [];
    return translations.find((item) => item?.locale === locale) || null;
  }

  function getTranslationRoot(chip = getChip(), locale = "zh-CN") {
    return getTranslationDocument(chip, locale)?.translations || null;
  }

  function getPageTranslation(pageName, chip = getChip()) {
    const pages = getTranslationRoot(chip)?.pages;
    return Array.isArray(pages) ? pages.find((page) => page?.name === pageName) || null : null;
  }

  function getRegisterPageName(reg) {
    return reg?._pageName || state.pageName;
  }

  function getRegisterTranslation(reg, pageName = getRegisterPageName(reg), chip = getChip()) {
    const registers = getPageTranslation(pageName, chip)?.registers;
    return Array.isArray(registers) ? registers.find((item) => item?.name === reg?.name) || null : null;
  }

  function getFieldTranslation(field, reg, pageName = getRegisterPageName(reg), chip = getChip()) {
    const fields = getRegisterTranslation(reg, pageName, chip)?.fields;
    if (!Array.isArray(fields)) return null;
    return fields.find((item) => item?.name === field?.name && String(item?.bits) === String(field?.bits)
      && (!item.source_condition || item.source_condition === field.condition)) || null;
  }

  function scalarTranslationKey(value) {
    if (typeof value === "number" && Number.isInteger(value)) return `integer:${BigInt(value)}`;
    const text = String(value ?? "").trim();
    try {
      if (/^[+-]?\d+$/.test(text) || /^0x[0-9a-f]+$/i.test(text) || /^0b[01]+$/i.test(text)) {
        return `integer:${BigInt(text)}`;
      }
    } catch (_error) {
      // Keep malformed selectors as text.
    }
    return `string:${text}`;
  }

  function getValueTranslation(fieldTranslation, value, condition = "") {
    const values = fieldTranslation?.values;
    if (!Array.isArray(values)) return null;
    return values.find((item) => scalarTranslationKey(item?.value) === scalarTranslationKey(value)
      && (!item.source_condition || item.source_condition === condition)) || null;
  }

  function translatedString(source, translation) {
    const original = String(source ?? "");
    const localized = typeof translation === "string" && translation.trim() ? translation : "";
    if (state.languageMode === "en" || !localized) return original;
    if (state.languageMode === "zh") return localized;
    return localized === original ? original : `${localized}\n${original}`;
  }

  function localizedLabel(source, translation) {
    const original = String(source ?? "");
    const localized = typeof translation === "string" && translation.trim() ? translation : "";
    if (state.languageMode === "en" || !localized || localized === original) return original;
    if (state.languageMode === "zh") return localized;
    return `${localized} / ${original}`;
  }

  function renderLocalizedText(source, translation, className = "") {
    const original = String(source ?? "");
    const localized = typeof translation === "string" && translation.trim() ? translation : "";
    const classes = className ? ` ${className}` : "";
    if (state.languageMode === "en" || !localized || localized === original) {
      return escapeHtml(original).replace(/\n/g, "<br>");
    }
    if (state.languageMode === "zh") return escapeHtml(localized).replace(/\n/g, "<br>");
    return `<span class="localized-pair${classes}"><span class="localized-primary">${escapeHtml(localized).replace(/\n/g, "<br>")}</span><span class="localized-original">${escapeHtml(original).replace(/\n/g, "<br>")}</span></span>`;
  }

  function translationStatusLabel(chip = getChip()) {
    const translation = getTranslationDocument(chip);
    if (!translation?.metadata) return "";
    const status = translation.metadata.status === "reviewed" ? "已审校" : "草稿";
    const coverage = translation.metadata.coverage === "complete" ? "完整" : "部分";
    return `译文 ${status} · ${coverage}`;
  }

  function updateLanguageControl(chip = getChip()) {
    if (!chip) {
      els.languageSwitcher?.classList.remove("translation-available", "translation-missing");
      els.languageSwitcher.title = "导入芯片后显示译文状态";
      els.languageControl.dataset.translationAvailable = "false";
      els.languageButtons.forEach((button) => {
        button.title = button.dataset.languageMode === "en" ? "只显示英文原文" : "导入芯片后应用语言显示模式";
      });
      els.translationAvailability.textContent = "尚未导入芯片";
      els.loadFolderButton.dataset.translationAvailable = "false";
      els.loadFolderButton.title = "关联寄存器库目录";
      els.loadFolderButton.setAttribute("aria-label", els.loadFolderButton.title);
      return;
    }
    const translation = getTranslationDocument(chip);
    const available = Boolean(translation);
    const chipName = chip?.sensor || "当前芯片";
    const availableLabel = translationStatusLabel(chip);
    const missingHint = `${chipName} 未加载中文译文；选择中文或中英时将回退显示英文`;

    els.languageSwitcher?.classList.toggle("translation-available", available);
    els.languageSwitcher?.classList.toggle("translation-missing", !available);
    els.languageSwitcher.title = available ? `${chipName} 已加载${availableLabel || "中文译文"}` : missingHint;
    els.languageControl.dataset.translationAvailable = String(available);
    els.languageButtons.forEach((button) => {
      const mode = button.dataset.languageMode;
      if (mode === "en") {
        button.title = "只显示英文原文";
      } else if (available) {
        button.title = mode === "zh" ? "优先显示中文，缺失条目回退英文" : "同时显示中文和英文";
      } else {
        button.title = missingHint;
      }
    });

    els.translationAvailability.textContent = available
      ? `${availableLabel} · 点击可重新关联`
      : "当前芯片仅英文 · 点击关联译文";
    els.loadFolderButton.dataset.translationAvailable = String(available);
    els.loadFolderButton.title = available
      ? `${chipName} 已加载${availableLabel || "中文译文"}；点击可重新关联寄存器库目录`
      : `${missingHint}；点击关联寄存器库目录`;
    els.loadFolderButton.setAttribute("aria-label", els.loadFolderButton.title);
  }

  function currentStatusMessage() {
    return [state.loadMessage, state.translationNotice].filter(Boolean).join(" · ");
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
    return ["arm_system", "riscv_system"].includes(chip?.register_space?.kind);
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
    if (encoding.scheme === "riscv_csr") {
      const address = Number(encoding.address);
      const formatted = Number.isFinite(address) ? address.toString(16).toUpperCase().padStart(3, "0") : "?";
      return "CSR 0x" + formatted;
    }
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
    if (encoding.scheme === "riscv_csr") {
      return `riscv_csr:address=${encoding.address}:${reg.name || "register"}`;
    }
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
      query: "",
      searchQuery: state.searchQuery,
      searchOpen: state.searchOpen,
      restoreSearchFocus: false,
      scrollY: Math.max(0, Math.round(window.scrollY)),
      focusIdentity: "",
      searchTarget: null,
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

  function revealSearchTarget(result, { focus = false } = {}) {
    if (!result?.registerName && !Number.isInteger(result?.registerIndex)) return null;
    const sourceRegisters = getPages(getChip())?.[result.pageName]?.registers || [];
    const source = Number.isInteger(result.registerIndex) ? sourceRegisters[result.registerIndex] : null;
    const displayed = getDisplayRegisters().find((register) =>
      register._sourceRegisterIndex === result.registerIndex
      || (register.name === result.registerName && (!source || Number(register.addr) === Number(source.addr))),
    );
    if (!displayed) return null;
    const key = getRegisterKey(displayed);
    const row = Array.from(els.tableBody.querySelectorAll(".register-display"))
      .find((item) => item.dataset.registerKey === key);
    if (!row) return;
    row.classList.add("is-target");
    row.tabIndex = -1;
    let target = row;
    if (result.fieldName) {
      const field = Array.from(row.querySelectorAll(".field-row")).find((item) =>
        item.dataset.fieldName === result.fieldName && (!result.fieldBits || item.dataset.fieldBits === String(result.fieldBits)),
      );
      if (field) {
        field.classList.add("is-search-target");
        target = field;
        window.setTimeout(() => field.classList.remove("is-search-target"), 1800);
      }
    }
    target.scrollIntoView({ block: "center" });
    if (focus) row.focus({ preventScroll: true });
    window.setTimeout(() => row.classList.remove("is-target"), 1800);
    return row;
  }

  function getRegisterForSearchResult(result) {
    const sourceRegisters = getPages(getChip())?.[result?.pageName]?.registers || [];
    const source = Number.isInteger(result?.registerIndex) ? sourceRegisters[result.registerIndex] : null;
    return getDisplayRegisters().find((register) =>
      register._sourceRegisterIndex === result?.registerIndex
      || (register.name === result?.registerName && (!source || Number(register.addr) === Number(source.addr))),
    ) || source;
  }

  function detailSourceForCurrentChip() {
    const chip = getChip() || {};
    const record = libraryRecords.find((item) => item.id === (chip._libraryId || chip._id));
    const translations = record?.translations || chip._translations || [];
    return {
      sourceName: record?.sourceName || chip._source || "",
      sourcePath: record?.sourcePath || null,
      sourceSha256: record?.sourceSha256 || chip._sourceSha256 || "",
      sourceTitle: chip.source?.title || "",
      sourceVersion: chip.source?.version || chip.source?.revision || "",
      sourceDocument: chip.source?.document || chip.source?.title || "",
      importedAt: record?.createdAt || "",
      updatedAt: record?.updatedAt || "",
      translationPresent: translations.length > 0,
      translationLocales: translations.map((item) => item.locale).filter(Boolean),
    };
  }

  function detailCopyText(reg, kind) {
    if (kind === "name") return reg.name || "";
    if (kind === "locator") return formatRange(reg);
    const value = getRegisterValue(reg);
    const bitWidth = getBitWidth(reg);
    const type = bitWidth <= 8 ? "uint8_t" : bitWidth <= 16 ? "uint16_t" : bitWidth <= 32 ? "uint32_t" : bitWidth <= 64 ? "uint64_t" : "unsigned __int128";
    const suffix = bitWidth <= 32 ? "U" : bitWidth <= 64 ? "ULL" : "";
    const fields = (reg.fields || []).map((field) => {
      const fieldValue = value.ok ? extractFieldValue(value.value, field) : 0n;
      return `${field.name || "FIELD"}=${formatBigIntHex(fieldValue, parseBits(field.bits).width)}`;
    }).join(", ");
    const variable = String(reg.name || "register").replace(/[^0-9A-Za-z_]/g, "_").toLowerCase();
    return `${type} ${variable} = ${value.ok ? formatBigIntHex(value.value, bitWidth) : "0x0"}${suffix};${fields ? ` /* ${fields} */` : ""}`;
  }

  async function copyDetailValue(reg, kind, button) {
    const value = detailCopyText(reg, kind);
    const label = button.querySelector("span");
    const idleText = kind === "name" ? "复制名称" : kind === "locator" ? "复制地址/编码" : "复制初始化";
    try {
      await navigator.clipboard.writeText(value);
      button.classList.add("copied");
      label?.replaceChildren(document.createTextNode("已复制"));
      window.setTimeout(() => {
        button.classList.remove("copied");
        label?.replaceChildren(document.createTextNode(idleText));
      }, 1200);
    } catch (_error) {
      button.classList.add("copy-failed");
      label?.replaceChildren(document.createTextNode("复制失败"));
      button.title = "当前环境不允许写入剪贴板";
      window.setTimeout(() => {
        button.classList.remove("copy-failed");
        label?.replaceChildren(document.createTextNode(idleText));
        button.removeAttribute("title");
      }, 1800);
    }
  }

  function renderDetailSource(source, reg, notes) {
    const fields = reg.fields || [];
    const enumFields = fields.map((field) => ({ field, entries: getFieldEnumEntries(field) })).filter((item) => item.entries.length);
    const enumCount = enumFields.reduce((count, item) => count + item.entries.length, 0);
    const inferredFields = fields.filter((field) => field.inferred === true || field._inferred === true || String(field.provenance || "").toLowerCase() === "inferred");
    const unmatchedFields = fields.filter((field) => !field.name || field.bits === undefined || field.bits === null || field._unmatched === true);
    const translationLabel = source.translationPresent
      ? `已有${source.translationLocales?.length ? `（${source.translationLocales.join(", ")}）` : ""}`
      : "未导入";
    const enumLabel = enumCount
      ? `${enumCount} 项，分布于 ${enumFields.length}/${fields.length} 个位域；完整性未声明`
      : "未定义；完整性未声明";
    const inferenceLabel = inferredFields.length || unmatchedFields.length
      ? `推断 ${inferredFields.length} 个，未匹配 ${unmatchedFields.length} 个`
      : "无已标记的推断或未匹配位域";
    const hash = source.sourceSha256 || "";
    const hashLabel = hash.length > 18 ? `${hash.slice(0, 12)}...${hash.slice(-6)}` : hash || "未记录";
    return `
      <section class="detail-source" aria-label="数据可信度">
        <div class="detail-source-head"><h4>来源与可信度</h4><span class="detail-fact-label">事实来源</span></div>
        <dl class="detail-source-grid">
          <div><dt>文件</dt><dd>${escapeHtml(source.sourceName || "未知")}</dd></div>
          ${source.sourcePath ? `<div><dt>路径</dt><dd title="${escapeHtml(source.sourcePath)}">${escapeHtml(source.sourcePath)}</dd></div>` : ""}
          <div><dt>来源文档</dt><dd>${escapeHtml(source.sourceTitle || source.sourceDocument || "未声明")}</dd></div>
          <div><dt>哈希</dt><dd><code title="${escapeHtml(hash)}">${escapeHtml(hashLabel)}</code></dd></div>
          <div><dt>版本</dt><dd>${escapeHtml(source.sourceVersion || "未声明")}</dd></div>
          <div><dt>中文译文</dt><dd>${escapeHtml(translationLabel)}</dd></div>
          <div><dt>枚举</dt><dd>${escapeHtml(enumLabel)}</dd></div>
          <div><dt>推断/未匹配</dt><dd>${escapeHtml(inferenceLabel)}</dd></div>
          <div><dt>导入时间</dt><dd>${escapeHtml(formatNoteTime(source.importedAt) || "未记录")}</dd></div>
          <div><dt>更新检查</dt><dd>${escapeHtml(formatNoteTime(source.updatedAt) || "未记录")}</dd></div>
        </dl>
        ${notes.length ? `<div class="detail-user-notes"><strong>用户备注</strong><span>${notes.length} 条，已与事实来源分开保存</span></div>` : `<div class="detail-user-notes empty"><strong>用户备注</strong><span>暂无备注</span></div>`}
      </section>
    `;
  }

  async function showRegisterWorkbench(result, anchor) {
    const reg = getRegisterForSearchResult(result);
    if (!reg) return;
    state.activeHoverAddress = null;
    state.activeWorkbenchKey = getRegisterKey(reg);
    let source = detailSourceForCurrentChip();
    if (isDesktopApp() && Number.isInteger(result.registerIndex)) {
      try {
        const response = await getInvoke()("get_register_details", {
          chipId: result.chipId,
          pageName: result.pageName || "",
          registerIndex: result.registerIndex,
        });
        source = response.source || source;
      } catch (_error) {
        // The local register remains useful when running against an older desktop build.
      }
    }
    if (state.activeWorkbenchKey !== getRegisterKey(reg)) return;
    const notes = getRegisterNotes(reg);
    els.hoverPanel.innerHTML = `
      <div class="hover-panel-caret" aria-hidden="true"></div>
      <div class="hover-panel-body detail-workbench">
        <div class="hover-panel-bar">
          <div class="hover-panel-actions">
            <button class="hover-close close-button" type="button" title="关闭详情" aria-label="关闭详情窗口"><i data-lucide="x"></i></button>
            ${renderNoteEditButton(reg)}
          </div>
          <span>寄存器详情工作台</span>
        </div>
        <div class="detail-toolbar" role="toolbar" aria-label="寄存器复制操作">
          <strong>${escapeHtml(reg.name || "寄存器")}</strong>
          <button class="detail-copy-button" type="button" data-detail-copy="name"><i data-lucide="copy"></i><span>复制名称</span></button>
          <button class="detail-copy-button" type="button" data-detail-copy="locator"><i data-lucide="copy"></i><span>复制地址/编码</span></button>
          <button class="detail-copy-button" type="button" data-detail-copy="initializer"><i data-lucide="copy"></i><span>复制初始化</span></button>
        </div>
        ${renderRegisterBlock(reg, false, { showNoteButton: false })}
        ${renderDetailSource(source, reg, notes)}
      </div>
    `;
    refreshIcons(els.hoverPanel);
    els.hoverPanel.hidden = false;
    els.hoverPanel.setAttribute("tabindex", "-1");
    syncOpenCellHighlight();
    positionDetailPanel(anchor || getOpenRegisterCell());
  }

  async function openSearchResult(result, { focus = false } = {}) {
    if (!result) return;
    rememberSearchQuery(state.searchQuery);
    rememberSearchResult(result);
    replaceNavigationState({
      searchQuery: state.searchQuery,
      searchOpen: state.searchOpen,
      restoreSearchFocus: true,
      scrollY: window.scrollY,
    });
    closeSearchPanel();
    const record = libraryRecords.find((item) => item.id === result.chipId);
    if (!record) return;
    let chipIndex = chips.findIndex((chip) => getNavigationChipId(chip) === result.chipId);
    if (chipIndex < 0) {
      const temporary = recordToChip(record);
      temporary._temporaryHidden = !record.enabled;
      chips.push(temporary);
      chipIndex = chips.length - 1;
    }
    state.chipIndex = chipIndex;
    state.pageName = result.pageName || "";
    state.view = result.kind === "chip" ? "matrix" : "table";
    state.query = "";
    await ensureChipLoaded(result.chipId);
    const loaded = chips[chipIndex];
    if (loaded && !record.enabled) loaded._temporaryHidden = true;
    populateChipSelect();
    populatePageSelect();
    pushNavigationState({
      chipId: result.chipId,
      chipIndex,
      pageName: state.pageName,
      view: state.view,
      searchQuery: state.searchQuery,
      searchTarget: result,
      searchOpen: false,
      restoreSearchFocus: false,
      scrollY: 0,
    });
    render();
    window.requestAnimationFrame(() => {
      if (result.kind === "chip") window.scrollTo({ top: 0, behavior: "auto" });
      else {
        const row = revealSearchTarget(result, { focus });
        showRegisterWorkbench(result, row).catch((error) => {
          state.loadMessage = `详情加载失败：${errorMessage(error)}`;
          render();
        });
      }
    });
  }

  async function restoreNavigationState(navigation) {
    if (!isAppNavigationState(navigation)) return;

    let chipIndex = chips.findIndex((chip) => getNavigationChipId(chip) === navigation.chipId);
    if (chipIndex < 0) {
      const record = libraryRecords.find((item) => item.id === navigation.chipId);
      if (record) {
        chips.push(recordToChip(record));
        chipIndex = chips.length - 1;
      }
    }
    if (chipIndex >= 0) state.chipIndex = chipIndex;
    else if (Number.isInteger(navigation.chipIndex) && chips[navigation.chipIndex]) state.chipIndex = navigation.chipIndex;

    state.pageName = String(navigation.pageName || "");
    state.view = navigation.view === "table" ? "table" : "matrix";
    state.query = "";
    state.searchQuery = String(navigation.searchQuery || navigation.query || "");
    els.searchInput.value = state.searchQuery;
    closeSearchPanel();
    await ensureChipLoaded(navigation.chipId);
    populateChipSelect();
    populatePageSelect();
    render();
    if (state.view === "matrix" && isSystemChip()) state.systemOverviewSnapshot = navigation;

    window.requestAnimationFrame(() => {
      if (navigation.restoreSearchFocus) {
        if (state.searchQuery) scheduleSearch(true);
        else showRecentSearchResults();
        els.searchInput.focus({ preventScroll: true });
      }
      if (state.view === "table" && navigation.focusIdentity) {
        revealSystemRegister(navigation.focusIdentity);
        return;
      }
      if (state.view === "table" && navigation.searchTarget) {
        revealSearchTarget(navigation.searchTarget);
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
      return source.map((reg, sourceIndex) => ({
        ...reg,
        _pageName: state.pageName,
        _sourceRegisterIndex: sourceIndex,
        _displayOrder: sourceIndex,
      }));
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

  function getAllSystemRegisters() {
    return Object.entries(getPages(getChip())).flatMap(([pageName, page], pageIndex) => {
      const registers = Array.isArray(page.registers) ? page.registers : [];
      return registers.map((reg, sourceIndex) => ({
        ...reg,
        _pageName: pageName,
        _systemPageIndex: pageIndex,
        _sourceRegisterIndex: sourceIndex,
        _displayOrder: sourceIndex,
      }));
    });
  }

  function isGlobalSystemSearchActive() {
    return isSystemChip() && state.view === "table" && Boolean(state.query.trim());
  }

  function getTableRegisters() {
    return isGlobalSystemSearchActive() ? getAllSystemRegisters() : getDisplayRegisters();
  }

  function getRegisterKey(reg) {
    const chip = getChip();
    const pageName = getRegisterPageName(reg);
    if (isSystemChip(chip)) {
      return [
        chip?._id || chip?.sensor || "chip",
        pageName || "page",
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

  function getRegisterNotes(reg, pageName = getRegisterPageName(reg)) {
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

  function parseVerilogNumericToken(token) {
    const match = /^(\d+)'([bBoOdDhH])([0-9a-fA-F_xXzZ?]+)$/.exec(String(token).trim());
    if (!match) return null;
    const base = match[2].toLowerCase();
    const digits = match[3].replace(/_/g, "").toLowerCase();
    const radix = { b: 2, o: 8, d: 10, h: 16 }[base];
    const validDigits = { b: /^[01xz?]+$/, o: /^[0-7xz?]+$/, d: /^[0-9xz?]+$/, h: /^[0-9a-fxz?]+$/ }[base];
    if (!validDigits.test(digits)) return null;

    if (!/[xz?]/.test(digits)) {
      const prefix = { b: "0b", o: "0o", d: "", h: "0x" }[base];
      const value = BigInt(`${prefix}${digits}`);
      return { from: value, to: value };
    }
    if (base === "d") return null;

    let mask = 0n;
    let value = 0n;
    for (const digit of digits) {
      mask *= BigInt(radix);
      value *= BigInt(radix);
      if (/[xz?]/.test(digit)) continue;
      mask += BigInt(radix - 1);
      value += BigInt(Number.parseInt(digit, radix));
    }
    return { mask, match: value };
  }

  function parseInlineEnumLine(line, fieldWidth) {
    const text = String(line || "").trim();
    const verilogToken = "\\d+'[bBoOdDhH][0-9a-fA-F_xXzZ?]+";
    const numericToken = `(?:${verilogToken}|0[xX][0-9a-fA-F]+|0[bB][01]+|[01]+|\\d+)`;
    let match = new RegExp(`^(${numericToken})(?:\\s*(?:~|～|\\.\\.|-)\\s*(${numericToken}))?\\s*(?:=|:)\\s*(.+)$`).exec(text);
    let startToken;
    let endToken;
    let description;
    if (match) {
      [, startToken, endToken, description] = match;
    } else {
      match = new RegExp(`^(${numericToken})\\s+-\\s+(.+)$`).exec(text);
      if (match) {
        [, startToken, description] = match;
      } else {
        // Some vendor manuals omit the delimiter, for example "8'h8 Start New Configuration".
        match = new RegExp(`^(${verilogToken})\\s+([A-Z][A-Za-z].+)$`).exec(text);
        if (!match) return null;
        [, startToken, description] = match;
      }
    }

    const parseToken = (token) => {
      if (/^\d+'/.test(token)) return parseVerilogNumericToken(token);
      const value = numericTokenToBigInt(token, fieldWidth);
      return { from: value, to: value };
    };
    try {
      const start = parseToken(startToken);
      if (!start) return null;
      if (endToken) {
        if ("mask" in start) return null;
        const end = parseToken(endToken);
        if (!end || "mask" in end) return null;
        return { from: start.from, to: end.to, label: `${startToken}..${endToken}`, desc: description.trim() };
      }
      return { ...start, label: startToken, desc: description.trim() };
    } catch {
      return null;
    }
  }

  function parseInlineEnums(field) {
    const desc = String(field.desc || "");
    const { width } = parseBits(field.bits);
    const entries = [];

    for (const line of desc.split(/\r?\n/)) {
      const entry = parseInlineEnumLine(line, width);
      if (entry) entries.push(entry);
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

  function getStructuredEnum(field, value, fieldTranslation = null, entries = getFieldEnumEntries(field)) {
    const matchingEntries = [];
    for (const item of entries) {
      const matches = "mask" in item ? (value & item.mask) === item.match : value >= item.from && value <= item.to;
      if (matches) {
        const translation = getValueTranslation(fieldTranslation, item.label, item.condition);
        matchingEntries.push({ source: item.desc, translation: translation?.desc || "" });
      }
    }
    if (!matchingEntries.length) return null;
    const source = Array.from(new Set(matchingEntries.map((item) => item.source))).join("\n");
    const translated = matchingEntries.map((item) => item.translation).filter(Boolean);
    const translation = translated.length === matchingEntries.length ? Array.from(new Set(translated)).join("\n") : "";
    return { source, translation };
  }

  function getReservedFieldMeaning(field) {
    const reserved = typeof field.reserved === "string" ? field.reserved.trim() : "";
    if (reserved) return reserved;
    return "";
  }

  function formatEnumKey(item) {
    if (item.label) return item.label;
    const from = item.from.toString(10);
    const to = item.to.toString(10);
    return item.from === item.to ? from : `${from}~${to}`;
  }

  function renderEnumList(field, currentValue, fieldTranslation = null, enums = getFieldEnumEntries(field)) {
    if (!enums.length) return "";

    const items = enums
      .map((item) => {
        const active = "mask" in item
          ? (currentValue & item.mask) === item.match
          : currentValue >= item.from && currentValue <= item.to;
        const translation = getValueTranslation(fieldTranslation, item.label, item.condition);
        const sourceDescription = item.condition ? `${item.desc}（${item.condition}）` : item.desc;
        const translatedDescription = translation
          ? `${translation.desc || item.desc}${translation.condition ? `（${translation.condition}）` : ""}`
          : "";
        return `
          <span class="enum-chip ${active ? "active" : ""}">
            <code>${escapeHtml(formatEnumKey(item))}</code>
            <span>${renderLocalizedText(sourceDescription, translatedDescription, "localized-inline")}</span>
          </span>
        `;
      })
      .join("");

    return `<div class="enum-list">${items}</div>`;
  }

  function stripEnumLines(field) {
    const { width } = parseBits(field.bits);
    return String(field.desc || "")
      .split(/\r?\n/)
      .filter((line) => !parseInlineEnumLine(line, width))
      .join("\n")
      .trim();
  }

  function hasSpecialBehavior(reg) {
    return Boolean(reg.multi_byte || reg.read_clear || reg.no_dump || reg.alias_note || reg.roles);
  }

  function registerMatchesQuery(reg, query, pageName = getRegisterPageName(reg)) {
    if (!query) return true;
    const pageTranslation = getPageTranslation(pageName);
    const registerTranslation = getRegisterTranslation(reg, pageName);
    const target = [
      isSystemChip() && !hasSystemMmioAddress(reg) ? formatSystemEncoding(reg) : formatHex(reg.addr),
      reg.name,
      reg.access,
      reg.reset,
      reg.desc,
      reg.condition,
      reg.execution_state,
      pageName,
      pageTranslation?.title,
      pageTranslation?.access,
      pageTranslation?.desc,
      registerTranslation?.desc,
      registerTranslation?.condition,
      registerTranslation?.alias_note,
      registerTranslation?.no_dump_reason,
      ...(reg.groups || []),
      ...(reg.aliases || []),
      ...(reg.accessors || []).flatMap((accessor) => [accessor.name, accessor.kind, accessor.instruction, accessor.condition]),
      reg.alias_note,
      ...(reg.fields || []).flatMap((field) => [
        field.name, field.bits, field.access, field.reset, field.reset_info, field.condition, field.reserved, field.desc,
        ...getFieldEnumEntries(field).flatMap((item) => [item.label, item.desc, item.condition]),
      ]),
      ...((registerTranslation?.fields || []).flatMap((field) => [
        field.desc,
        field.condition,
        field.reset_info,
        ...(field.values || []).flatMap((value) => [value.desc, value.condition]),
      ])),
      ...getRegisterNotes(reg, pageName).flatMap((note) => [note.content, noteKinds[note.kind]?.label || note.kind]),
    ]
      .join(" ")
      .toLowerCase();
    return target.includes(query);
  }

  function systemRegisterSearchRank(reg, query) {
    const name = String(reg.name || "").toLowerCase();
    if (name === query) return 0;
    if (name.startsWith(query)) return 1;
    if (name.includes(query)) return 2;
    const aliases = [...(reg.aliases || []), ...(reg.accessors || []).map((item) => item.name)]
      .filter(Boolean)
      .map((item) => String(item).toLowerCase());
    if (aliases.some((item) => item === query)) return 3;
    if (aliases.some((item) => item.startsWith(query))) return 4;
    return 5;
  }

  function summarizePage() {
    const chip = getChip();
    const page = getPage();
    const translationRoot = getTranslationRoot(chip);
    const pageTranslation = getPageTranslation(state.pageName, chip);
    const regs = getDisplayRegisters();
    if (!chip || !page) {
      els.chipMeta.textContent = "未加载芯片";
      els.statusBand.textContent = currentStatusMessage() || "请选择 YAML 文件或目录";
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
      const translationStatus = translationStatusLabel(chip);
      const summary = `全局预览 · ${pages.length} 个架构分类 · ${registerCount} 个寄存器 · ${fieldCount} 个位域${noteCount ? ` · ${noteCount} 条备注` : ""}${translationStatus ? ` · ${translationStatus}` : ""}${sourceVersion}`;
      els.chipMeta.textContent = `${localizedLabel(chip.sensor || "Unknown", translationRoot?.sensor)} · ${chip._source || "内置数据"}`;
      const statusMessage = currentStatusMessage();
      els.statusBand.textContent = statusMessage ? `${summary} · ${statusMessage}` : summary;
      return;
    }

    if (isGlobalSystemSearchActive()) {
      const query = state.query.trim().toLowerCase();
      const allRegisters = getAllSystemRegisters();
      const matches = allRegisters.filter((reg) => registerMatchesQuery(reg, query));
      const pageCount = new Set(matches.map(getRegisterPageName)).size;
      const fieldCount = matches.reduce((sum, reg) => sum + (reg.fields || []).length, 0);
      const noteCount = matches.reduce((sum, reg) => sum + getRegisterNotes(reg).length, 0);
      const sourceVersion = chip.source?.version ? ` · ${chip.source.version}` : "";
      const translationStatus = translationStatusLabel(chip);
      const summary = `跨全部分类搜索 · ${matches.length}/${allRegisters.length} 个寄存器 · ${pageCount} 个分类 · ${fieldCount} 个位域${noteCount ? ` · ${noteCount} 条备注` : ""}${translationStatus ? ` · ${translationStatus}` : ""}${sourceVersion}`;
      els.chipMeta.textContent = `${localizedLabel(chip.sensor || "Unknown", translationRoot?.sensor)} · ${chip._source || "内置数据"}`;
      const statusMessage = currentStatusMessage();
      els.statusBand.textContent = statusMessage ? `${summary} · ${statusMessage}` : summary;
      return;
    }

    const fieldCount = regs.reduce((sum, reg) => sum + (reg.fields || []).length, 0);
    const noteCount = countPageNotes();
    els.chipMeta.textContent = `${localizedLabel(chip.sensor || "Unknown", translationRoot?.sensor)} · ${chip._source || "内置数据"}`;
    const pageIdentity = isSystemChip(chip) ? "架构分类" : `page_id ${formatHex(page.page_id)}`;
    const sourceVersion = isSystemChip(chip) && chip.source?.version ? ` · ${chip.source.version}` : "";
    const translationStatus = translationStatusLabel(chip);
    const pageLabel = localizedLabel(state.pageName, pageTranslation?.title);
    const pageAccess = localizedLabel(page.access || "", pageTranslation?.access);
    const summary = `${pageLabel} · ${pageIdentity} · ${pageAccess} · ${regs.length} 个寄存器 · ${fieldCount} 个位域${noteCount ? ` · ${noteCount} 条备注` : ""}${translationStatus ? ` · ${translationStatus}` : ""}${sourceVersion}`;
    const statusMessage = currentStatusMessage();
    els.statusBand.textContent = statusMessage ? `${summary} · ${statusMessage}` : summary;
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
          data-system-group-index="${pageIndex}" title="${escapeHtml(localizedLabel(pageName, getPageTranslation(pageName, chip)?.title))}">
          <span>${escapeHtml(localizedLabel(pageName, getPageTranslation(pageName, chip)?.title))}</span><strong>${matching.length}</strong>
        </button>
      `);

      const tiles = matching.map(({ reg, registerIndex }) => {
        const access = String(reg.access || "");
        const locator = hasSystemMmioAddress(reg) ? formatRange(reg) : formatSystemEncoding(reg);
        const noteCount = getRegisterNotes(reg, pageName).length;
        const registerTranslation = getRegisterTranslation(reg, pageName, chip);
        const special = hasSpecialBehavior(reg);
        const classes = [
          "system-overview-register",
          "has-register",
          getAccessClass([reg]),
          special ? "has-special" : "",
          noteCount ? "has-note" : "",
        ].filter(Boolean).join(" ");
        const tooltip = [
          reg.name,
          locator,
          translatedString(reg.desc, registerTranslation?.desc),
          translatedString(reg.condition, registerTranslation?.condition),
        ].filter(Boolean).join("\n");
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
            <h3>${escapeHtml(localizedLabel(pageName, getPageTranslation(pageName, chip)?.title))}</h3>
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
        const fieldTranslation = getFieldTranslation(field, reg);
        const enumEntries = getFieldEnumEntries(field);
        const meaning = getStructuredEnum(field, fieldValue, fieldTranslation, enumEntries);
        const desc = stripEnumLines(field);
        const translatedDesc = fieldTranslation?.desc || "";
        const reservedMeaning = enumEntries.length ? "" : getReservedFieldMeaning(field);
        const descriptionIsMeaning = !enumEntries.length && !reservedMeaning && Boolean(desc || translatedDesc);
        const descriptionMarkup = (desc || translatedDesc)
          ? `<div class="field-desc">${renderLocalizedText(desc, translatedDesc)}</div>`
          : "";
        const valueLabel = `${formatBigIntHex(fieldValue, bits.width)} / ${fieldValue.toString(10)}`;
        const enumList = renderEnumList(field, fieldValue, fieldTranslation, enumEntries);
        const fieldAccess = field.access ? `<span class="field-access">${escapeHtml(field.access)}</span>` : "";
        const fieldReset = formatReset(field.reset, bits.width);
        const condition = field.condition ? `<div class="field-condition"><i data-lucide="git-branch"></i><span>${renderLocalizedText(field.condition, fieldTranslation?.condition, "localized-inline")}</span></div>` : "";
        const resetInfo = field.reset_info ? `<div class="field-desc"><strong>Reset:</strong> ${renderLocalizedText(field.reset_info, fieldTranslation?.reset_info, "localized-inline")}</div>` : "";
        const accessRules = Array.isArray(field.access_rules) && field.access_rules.length
          ? `<div class="field-desc"><strong>Access:</strong> ${field.access_rules.map((rule) => escapeHtml(rule.condition ? `${rule.access} · ${rule.condition}` : rule.access)).join("<br>")}</div>`
          : "";
        return `
          <div class="field-row ${isSet ? "is-set" : ""}" data-field-name="${escapeHtml(field.name || "")}" data-field-bits="${escapeHtml(String(field.bits ?? ""))}">
            <div class="field-name">${escapeHtml(field.name)} ${fieldAccess}</div>
            <div class="field-bits">[${escapeHtml(field.bits)}]${fieldReset ? `<br>reset ${escapeHtml(fieldReset)}` : ""}</div>
            <div class="field-value">${escapeHtml(valueLabel)}</div>
            <div class="field-meaning">
              ${meaning
                ? `<strong>${renderLocalizedText(meaning.source, meaning.translation, "localized-inline")}</strong>`
                : enumEntries.length
                  ? `<span class="muted">资料未定义当前值</span>`
                  : reservedMeaning
                    ? `<strong>${escapeHtml(reservedMeaning)}</strong>`
                    : descriptionMarkup}
              ${condition}
              ${enumList}
              ${descriptionIsMeaning || compact ? "" : descriptionMarkup}
              ${compact ? "" : resetInfo}
              ${compact ? "" : accessRules}
            </div>
          </div>
        `;
      })
      .join("");
  }

  function renderRegisterBlock(reg, compact = false, { showNoteButton = true } = {}) {
    const valueInfo = getRegisterValue(reg);
    const key = getRegisterKey(reg);
    const registerTranslation = getRegisterTranslation(reg);
    return `
      <div class="register-block register-display" data-register-key="${escapeHtml(key)}">
        <div class="register-heading">
          <h3>${escapeHtml(reg.name)} <span class="addr-cell">${escapeHtml(formatRange(reg))}</span></h3>
          ${compact || !showNoteButton ? "" : renderNoteEditButton(reg)}
        </div>
        <div class="hover-meta">
          ${renderBadges(reg)}
        </div>
        ${renderRegisterValueEditor(reg, false)}
        <div class="register-desc">${renderLocalizedText(reg.desc || "", registerTranslation?.desc)}</div>
        ${reg.condition ? `<div class="register-desc system-condition"><i data-lucide="git-branch"></i> ${renderLocalizedText(reg.condition, registerTranslation?.condition, "localized-inline")}</div>` : ""}
        ${reg.alias_note ? `<div class="register-desc"><span class="badge">alias</span> ${renderLocalizedText(reg.alias_note, registerTranslation?.alias_note, "localized-inline")}</div>` : ""}
        ${reg.no_dump_reason ? `<div class="register-desc"><span class="badge warn">no-dump</span> ${renderLocalizedText(reg.no_dump_reason, registerTranslation?.no_dump_reason, "localized-inline")}</div>` : ""}
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
    state.activeWorkbenchKey = "";
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
    state.activeWorkbenchKey = "";
    els.hoverPanel.hidden = true;
    els.hoverPanel.innerHTML = "";
    syncOpenCellHighlight();
  }

  function repositionOrHideDetailPanel() {
    if (els.hoverPanel.hidden) return;
    if (state.activeWorkbenchKey) {
      const anchor = els.tableBody.querySelector(`.register-display[data-register-key="${CSS.escape(state.activeWorkbenchKey)}"]`);
      if (anchor) {
        positionDetailPanel(anchor);
        return;
      }
    }
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
    const registerTranslation = getRegisterTranslation(reg);
    return `
      ${reg.condition ? `<div class="system-condition"><i data-lucide="git-branch"></i><span>${renderLocalizedText(reg.condition, registerTranslation?.condition, "localized-inline")}</span></div>` : ""}
      ${accessors.length ? `<div class="system-accessors">${accessors.map((item) => `
        <div><span class="badge">${escapeHtml(item.kind === "read" ? "READ" : item.kind === "write" ? "WRITE" : "IMPLICIT")}</span><code>${escapeHtml(item.instruction)}</code>${item.condition ? `<span>${escapeHtml(item.condition)}</span>` : ""}</div>
      `).join("")}</div>` : ""}
    `;
  }

  function renderTable() {
    const globalSystemSearch = isGlobalSystemSearchActive();
    const regs = getTableRegisters();
    const query = state.query.trim().toLowerCase();
    const matchingRows = regs.filter((reg) => registerMatchesQuery(reg, query));
    if (globalSystemSearch) {
      matchingRows.sort((left, right) => (
        systemRegisterSearchRank(left, query) - systemRegisterSearchRank(right, query) ||
        left._systemPageIndex - right._systemPageIndex ||
        left._displayOrder - right._displayOrder
      ));
    }
    const rows = globalSystemSearch ? matchingRows.slice(0, SYSTEM_SEARCH_RESULT_LIMIT) : matchingRows;

    const noteCount = rows.reduce((count, reg) => count + getRegisterNotes(reg).length, 0);
    const locatorType = isSystemChip()
      ? (regs.some((reg) => hasSystemMmioAddress(reg)) ? "系统编码 / MMIO 地址" : "结构化系统编码")
      : "MMIO 地址";
    const resultLimit = matchingRows.length > rows.length ? ` · 显示前 ${rows.length} 条，请继续缩小范围` : "";
    const searchScope = globalSystemSearch
      ? ` · 跨 ${new Set(matchingRows.map(getRegisterPageName)).size} 个分类搜索`
      : "";
    els.tableSummary.textContent = `${matchingRows.length}/${regs.length} 个寄存器匹配${resultLimit}${searchScope} · ${noteCount} 条备注 · ${locatorType} · 每个寄存器独立保存输入值`;

    if (!rows.length) {
      els.tableBody.innerHTML = `<tr><td colspan="6"><div class="empty-state">没有匹配的寄存器</div></td></tr>`;
      return;
    }

    els.tableBody.innerHTML = rows
      .map((reg) => {
        const key = getRegisterKey(reg);
        const registerTranslation = getRegisterTranslation(reg);
        const pageName = getRegisterPageName(reg);
        const pageLabel = localizedLabel(pageName, getPageTranslation(pageName)?.title);
        return `
        <tr class="register-display" data-register-key="${escapeHtml(key)}">
          <td class="addr-cell">${renderRegisterLocator(reg)}</td>
          <td class="name-cell">
            <div class="name-cell-heading">
              <strong>${escapeHtml(reg.name)}</strong>
              ${renderNoteEditButton(reg)}
            </div>
            ${globalSystemSearch ? `
              <button class="register-page-link" type="button" data-register-page-link data-register-key="${escapeHtml(key)}"
                title="只浏览 ${escapeHtml(pageLabel)} 分类">
                <i data-lucide="folder-open"></i><span>${escapeHtml(pageLabel)}</span>
              </button>
            ` : ""}
            <div class="cell-badges">${renderBadges(reg)}</div>
          </td>
          <td>${escapeHtml(reg.access || "")}<br><span class="field-bits">${getBitWidth(reg)} bit</span></td>
          <td class="value-cell">${renderRegisterValueEditor(reg, true)}</td>
          <td class="desc-cell">
            ${renderLocalizedText(reg.desc || "", registerTranslation?.desc)}
            ${renderSystemRegisterDetails(reg)}
            ${reg.alias_note ? `<div class="field-desc">${renderLocalizedText(reg.alias_note, registerTranslation?.alias_note)}</div>` : ""}
            ${reg.no_dump_reason ? `<div class="field-desc">${renderLocalizedText(reg.no_dump_reason, registerTranslation?.no_dump_reason)}</div>` : ""}
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
    return getTableRegisters().find((reg) => getRegisterKey(reg) === key) || null;
  }

  function handleRegisterPageLink(event) {
    const button = event.target.closest("[data-register-page-link]");
    if (!button) return false;
    const reg = findRegisterByKey(button.dataset.registerKey);
    if (!reg) return true;

    const pageName = getRegisterPageName(reg);
    const identity = getPersistentRegisterIdentity(reg);
    state.pageName = pageName;
    state.query = "";
    els.searchInput.value = "";
    populatePageSelect();
    render();
    replaceNavigationState({ focusIdentity: identity, fromSystemOverview: false });
    window.requestAnimationFrame(() => revealSystemRegister(identity, { focus: true }));
    return true;
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
    updateLanguageControl();
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
    const cached = chipDocumentCache.get(record.id);
    if (cached && cached.sourceSha256 === (record.sourceSha256 || "")) return cached.chip;
    let chip = null;
    if (record.chipData) {
      chip = record.chipData;
    } else if (record.yamlText) {
      const data = window.parseRegisterYaml(record.yamlText);
      window.assertRegisterYaml(record.yamlText, data);
      chip = normalizeLoadedChip(data, record.sourceName);
    }
    if (!chip) {
      chip = {
        sensor: record.sensor || record.id,
        vendor: record.vendor || "",
        family: record.family || "",
        device_type: record.deviceType || "",
        pages: {},
        _loading: true,
      };
    }
    chip._id = record.id;
    chip._libraryId = record.id;
    chip._source = record.sourceName;
    chip._sourceSha256 = record.sourceSha256 || chip._sourceSha256 || "";
    chip._category = record.category || fallbackCategory(record);
    chip._builtin = Boolean(record.builtin);
    chip._notes = Array.isArray(record.notes) ? record.notes : Array.isArray(chip._notes) ? chip._notes : [];
    chip._attachments = Array.isArray(record.attachments) ? record.attachments : [];
    if (!chip._loading) {
      chip._translations = Array.isArray(chip._translations) ? chip._translations : [];
      chipDocumentCache.set(record.id, { sourceSha256: record.sourceSha256 || "", chip });
    }
    return chip;
  }

  async function loadRecordChip(record) {
    const cached = chipDocumentCache.get(record.id);
    if (cached && cached.sourceSha256 === (record.sourceSha256 || "")) return cached.chip;
    if (!isDesktopApp()) return recordToChip(record);
    let document;
    try {
      document = await getInvoke()("load_chip_document", { chipId: record.id });
    } catch (error) {
      if (!record.yamlText) throw error;
      return recordToChip(record);
    }
    const chip = normalizeLoadedChip(document.chipData, record.sourceName);
    chip._translations = Array.isArray(document.translations) ? document.translations : [];
    chip._loading = false;
    chip._id = record.id;
    chip._libraryId = record.id;
    chip._source = record.sourceName;
    chip._sourceSha256 = record.sourceSha256 || "";
    chip._category = record.category || fallbackCategory(record);
    chip._builtin = Boolean(record.builtin);
    chip._notes = Array.isArray(record.notes) ? record.notes : [];
    chip._attachments = Array.isArray(record.attachments) ? record.attachments : [];
    chipDocumentCache.set(record.id, { sourceSha256: record.sourceSha256 || "", chip });
    return chip;
  }

  async function ensureChipLoaded(chipId = getNavigationChipId()) {
    const record = libraryRecords.find((item) => item.id === chipId);
    if (!record) return null;
    let chipIndex = chips.findIndex((chip) => getNavigationChipId(chip) === chipId);
    if (chipIndex < 0) {
      chips.push(recordToChip(record));
      chipIndex = chips.length - 1;
    }
    const existing = chips[chipIndex];
    if (!existing?._loading) return existing;
    const requestedHash = record.sourceSha256 || "";
    existing._loadingPromise ||= loadRecordChip(record);
    try {
      const loaded = await existing._loadingPromise;
      const latestRecord = libraryRecords.find((item) => item.id === chipId);
      if (!latestRecord || (latestRecord.sourceSha256 || "") !== requestedHash) return null;
      chips[chipIndex] = loaded;
      if (state.chipIndex === chipIndex) {
        populateChipSelect();
        populatePageSelect();
        render();
      }
      return loaded;
    } catch (error) {
      existing._loadingPromise = null;
      existing._loadError = errorMessage(error);
      if (state.chipIndex === chipIndex) {
        state.loadMessage = `${record.sourceName} 加载失败：${existing._loadError}`;
        render();
      }
      throw error;
    }
  }

  async function applyLibraryRecords(records) {
    const previousChipId = getChip()?._libraryId || getChip()?._id || "";
    libraryRecords = Array.isArray(records) ? records : [];
    const currentIds = new Set(libraryRecords.map((record) => record.id));
    state.librarySelection.forEach((id) => {
      if (!currentIds.has(id)) state.librarySelection.delete(id);
    });

    for (const record of libraryRecords) {
      const cached = chipDocumentCache.get(record.id);
      if (cached && cached.sourceSha256 !== (record.sourceSha256 || "")) chipDocumentCache.delete(record.id);
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
    refreshBrowserSearchIndex();
    if (chips.length) await ensureChipLoaded(getNavigationChipId());
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
        sourceSha256: chip._sourceSha256 || "",
        yamlText: "",
        notes: Array.isArray(chip._notes) ? chip._notes : [],
        attachments: [],
        translations: Array.isArray(chip._translations) ? chip._translations.map((translation) => ({
          yamlText: "",
          translationData: translation,
        })) : [],
        chipData: chip,
      };
    });
  }

  async function initializeLibrary() {
    if (isDesktopApp()) {
      const records = await getLibrarySummaries();
      await applyLibraryRecords(records);
      return;
    }
    await applyLibraryRecords(createStaticLibraryRecords());
  }

  async function getLibrarySummaries() {
    if (!isDesktopApp()) return libraryRecords;
    try {
      return await getInvoke()("list_chip_summaries");
    } catch (error) {
      const legacy = await getInvoke()("list_chips");
      if (!Array.isArray(legacy)) throw error;
      return legacy;
    }
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

  function importPreviewStatusLabel(status) {
    return ({ new: "新增", update: "更新", unchanged: "无结构变化", rejected: "拒绝" })[status] || status || "待处理";
  }

  function previewEnumItems(field) {
    if (Array.isArray(field?.values)) return field.values;
    if (field?.values && typeof field.values === "object") {
      return Object.entries(field.values).map(([value, desc]) => ({ value, desc }));
    }
    return [];
  }

  function previewDocumentMaps(document) {
    const registers = new Map();
    const fields = new Map();
    const enums = new Map();
    Object.entries(document?.pages || {}).forEach(([pageName, page]) => {
      (page?.registers || []).forEach((register, registerIndex) => {
        const hasEncoding = register.encoding && Object.keys(register.encoding).length > 0;
        const locator = register.addr ?? (hasEncoding ? JSON.stringify(register.encoding) : `index:${registerIndex}`);
        const registerKey = `${pageName}/${register.name || `#${registerIndex}`}@${locator}`;
        registers.set(registerKey, JSON.stringify(register));
        (register.fields || []).forEach((field, fieldIndex) => {
          const fieldKey = `${registerKey}/${field.name || `#${fieldIndex}`}/${field.bits ?? ""}`;
          fields.set(fieldKey, JSON.stringify(field));
          previewEnumItems(field).forEach((item, enumIndex) => {
            const enumKey = `${fieldKey}/${String(item.value ?? enumIndex)}@${item.condition || ""}`;
            enums.set(enumKey, JSON.stringify(item));
          });
        });
      });
    });
    return { registers, fields, enums };
  }

  function comparePreviewMaps(before, after, added, removed, modified) {
    for (const [key, value] of after) {
      if (!before.has(key)) added.push(key);
      else if (before.get(key) !== value) modified.push(key);
    }
    for (const key of before.keys()) {
      if (!after.has(key)) removed.push(key);
    }
  }

  function compareBrowserChipDocuments(beforeDocument, afterDocument) {
    const before = previewDocumentMaps(beforeDocument);
    const after = previewDocumentMaps(afterDocument);
    const changes = {
      addedRegisters: [], removedRegisters: [], modifiedRegisters: [],
      addedFields: [], removedFields: [], modifiedFields: [],
      addedEnums: [], removedEnums: [], modifiedEnums: [],
    };
    comparePreviewMaps(before.registers, after.registers, changes.addedRegisters, changes.removedRegisters, changes.modifiedRegisters);
    comparePreviewMaps(before.fields, after.fields, changes.addedFields, changes.removedFields, changes.modifiedFields);
    comparePreviewMaps(before.enums, after.enums, changes.addedEnums, changes.removedEnums, changes.modifiedEnums);
    return changes;
  }

  function browserImportRecord(item) {
    return libraryRecords.find((record) => {
      const chip = record.chipData || chips.find((candidate) => getNavigationChipId(candidate) === record.id);
      return record.sourceName === item.sourceName || chip?._source === item.sourceName || record.sensor === item.data?.sensor;
    }) || null;
  }

  function buildBrowserImportPreview(sources, translations, failures) {
    const translationHashes = new Set(translations.map((item) => item.sourceSha256));
    const files = sources.map((item) => {
      const previous = browserImportRecord(item);
      const previousChip = previous?.chipData || chips.find((chip) => getNavigationChipId(chip) === previous?.id);
      const sourceHashChanged = Boolean(previous && previous.sourceSha256 !== item.sourceSha256);
      const hasTranslation = translationHashes.has(item.sourceSha256)
        || (previous?.translations || []).some((translation) => {
          return translation.sourceSha256 === item.sourceSha256
            || translationDocumentFromRecord(translation)?.source_sha256 === item.sourceSha256;
        });
      return {
        sourceName: item.sourceName,
        kind: "source",
        sensor: item.data?.sensor || "",
        status: previous ? (sourceHashChanged ? "update" : "unchanged") : "new",
        sourceHashChanged,
        translationMissing: !hasTranslation,
        changes: compareBrowserChipDocuments(previousChip || {}, item.data || {}),
      };
    });
    for (const item of translations) {
      const record = libraryRecords.find((candidate) => candidate.sourceSha256 === item.sourceSha256);
      const existing = (record?.translations || []).find((translation) => {
        return translationDocumentFromRecord(translation)?.locale === item.data?.locale;
      });
      files.push({
        sourceName: item.sourceName,
        kind: "translation",
        sensor: item.data?.translations?.sensor || record?.sensor || "",
        status: existing ? (existing.yamlText === item.text ? "unchanged" : "update") : "new",
        sourceHashChanged: Boolean(existing && existing.sourceSha256 !== item.sourceSha256),
        translationMissing: false,
        changes: {},
      });
    }
    return { previewId: "browser-import-preview", files, failures, folder: null };
  }

  function importPreviewText(report) {
    const files = Array.isArray(report.files) ? report.files : [];
    const counts = files.reduce((result, file) => {
      result[file.status] = (result[file.status] || 0) + 1;
      return result;
    }, {});
    const lines = [
      `文件：${files.length} · 新增 ${counts.new || 0} · 更新 ${counts.update || 0} · 无结构变化 ${counts.unchanged || 0} · 拒绝 ${counts.rejected || 0}`,
    ];
    if (report.folder) lines.push(`目录：${report.folder}`);
    for (const file of files) {
      const changes = file.changes || {};
      const parts = [
        changes.addedRegisters?.length ? `新增寄存器 ${changes.addedRegisters.length}` : "",
        changes.removedRegisters?.length ? `删除寄存器 ${changes.removedRegisters.length}` : "",
        changes.modifiedRegisters?.length ? `修改寄存器 ${changes.modifiedRegisters.length}` : "",
        changes.addedFields?.length ? `新增位域 ${changes.addedFields.length}` : "",
        changes.removedFields?.length ? `删除位域 ${changes.removedFields.length}` : "",
        changes.modifiedFields?.length ? `修改位域 ${changes.modifiedFields.length}` : "",
        changes.addedEnums?.length ? `新增枚举 ${changes.addedEnums.length}` : "",
        changes.removedEnums?.length ? `删除枚举 ${changes.removedEnums.length}` : "",
        changes.modifiedEnums?.length ? `修改枚举 ${changes.modifiedEnums.length}` : "",
        file.sourceHashChanged ? "源哈希变化" : "",
        file.translationMissing ? "缺少译文" : "",
      ].filter(Boolean);
      lines.push(`\n[${importPreviewStatusLabel(file.status)}] ${file.sourceName} · ${file.kind === "translation" ? "译文" : file.sensor || "未知芯片"}`);
      lines.push(parts.length ? `  ${parts.join(" · ")}` : "  无结构变化");
    }
    if (report.failures?.length) {
      lines.push("\n无法预览：");
      lines.push(...report.failures.map((failure) => `  ${failure}`));
    }
    return lines.join("\n");
  }

  function openImportPreview(report, label) {
    if (!report || report.canceled) return false;
    state.importPreviewId = report.previewId || "";
    state.importPreviewLabel = label;
    els.importPreviewTitle.textContent = `${label}预览`;
    const fileCount = report.files?.length || 0;
    const acceptedCount = (report.files || []).filter((file) => file.status !== "rejected").length;
    els.importPreviewSummary.textContent = acceptedCount
      ? `${acceptedCount} 个文件将在确认后写入芯片库；取消不会修改现有数据。`
      : "没有可导入的合规文件；关闭不会修改现有数据。";
    els.importPreviewDetails.textContent = importPreviewText(report);
    els.importPreviewCancelButton.disabled = false;
    els.importPreviewCancelAction.disabled = false;
    els.importPreviewConfirmButton.disabled = !state.importPreviewId || !fileCount;
    els.importPreviewConfirmButton.dataset.canImport = acceptedCount ? "true" : "false";
    els.importPreviewConfirmButton.textContent = acceptedCount ? "确认导入" : "关闭";
    els.importPreviewDialog.showModal();
    refreshIcons(els.importPreviewDialog);
    window.setTimeout(() => els.importPreviewConfirmButton.focus(), 0);
    return true;
  }

  async function cancelImportPreview() {
    const previewId = state.importPreviewId;
    const resolver = state.importPreviewResolver;
    state.importPreviewId = "";
    state.importPreviewLabel = "";
    state.importPreviewResolver = null;
    if (previewId && isDesktopApp()) {
      try { await getInvoke()("cancel_yaml_import_preview", { previewId }); } catch (_error) { /* expired previews are harmless */ }
    }
    if (els.importPreviewDialog.open) els.importPreviewDialog.close();
    setLibraryStatus("已取消导入");
    resolver?.(false);
  }

  function requestBrowserImportConfirmation(report) {
    return new Promise((resolve) => {
      state.importPreviewResolver = resolve;
      openImportPreview(report, "文件导入");
    });
  }

  async function confirmImportPreview() {
    if (els.importPreviewConfirmButton.dataset.canImport !== "true") {
      await cancelImportPreview();
      return;
    }
    const previewId = state.importPreviewId;
    const label = state.importPreviewLabel || "文件导入";
    if (!previewId || !isDesktopApp()) {
      const resolver = state.importPreviewResolver;
      state.importPreviewResolver = null;
      state.importPreviewId = "";
      state.importPreviewLabel = "";
      if (els.importPreviewDialog.open) els.importPreviewDialog.close();
      resolver?.(true);
      return;
    }
    els.importPreviewConfirmButton.disabled = true;
    els.importPreviewCancelButton.disabled = true;
    els.importPreviewCancelAction.disabled = true;
    els.importPreviewSummary.textContent = "正在确认并写入芯片库...";
    try {
      const report = await getInvoke()("confirm_yaml_import_preview", { previewId });
      state.importPreviewId = "";
      state.importPreviewLabel = "";
      els.importPreviewDialog.close();
      await applyDesktopImportReport(report, label);
    } catch (error) {
      els.importPreviewConfirmButton.disabled = false;
      els.importPreviewCancelButton.disabled = false;
      els.importPreviewCancelAction.disabled = false;
      els.importPreviewSummary.textContent = errorMessage(error);
      setLibraryStatus(errorMessage(error), true);
    }
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
    els.noteDialogRegister.textContent = `${getRegisterPageName(reg)} · ${formatRange(reg)} · ${reg.name}`;
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
          pageName: getRegisterPageName(reg),
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
    els.toolsMenuBadge.hidden = count === 0 || !isDesktopApp() || !chip;
    els.toolsMenuBadge.textContent = count > 99 ? "99+" : String(count);
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
    els.attachmentsDialogChip.textContent = localizedLabel(chip.sensor || chip._id || "当前芯片", getTranslationRoot(chip)?.sensor);
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
    closeToolsMenu(false);
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

  function filteredLibraryRecords() {
    const query = state.libraryQuery.trim().toLowerCase();
    return libraryRecords.filter((record) =>
      [
        record.sensor,
        record.vendor,
        record.family,
        record.category,
        record.sourceName,
        getRecordTranslationDocument(record)?.translations?.sensor,
        getRecordTranslationDocument(record)?.translations?.family,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }

  function selectedLibraryRecords() {
    return libraryRecords.filter((record) => state.librarySelection.has(record.id));
  }

  function renderLibraryList() {
    const filtered = filteredLibraryRecords();
    const enabledCount = libraryRecords.filter((record) => record.enabled).length;
    const selected = selectedLibraryRecords();
    const selectedCount = selected.length;
    const removableCount = selectedCount;
    const categories = Array.from(new Set(libraryRecords.map((record) => record.category).filter(Boolean))).sort((a, b) => a.localeCompare(b));

    els.librarySummary.textContent = `${libraryRecords.length} 个芯片 · ${enabledCount} 个显示 · ${selectedCount} 个已选择`;
    els.librarySelectionSummary.textContent = selectedCount ? `已选择 ${selectedCount} 个` : "未选择芯片";
    els.categoryOptions.innerHTML = categories.map((category) => `<option value="${escapeHtml(category)}"></option>`).join("");
    els.libraryList.innerHTML = filtered.length
      ? filtered
          .map((record) => {
            const sourceLabel = record.sourceKind === "linked" ? "关联目录" : "已导入";
            const sourceDetail = record.sourcePath || record.sourceName || "";
            const translation = getRecordTranslationDocument(record);
            const translatedSensor = translation?.translations?.sensor;
            const translationLabel = translation?.metadata
              ? `${translation.metadata.locale || translation.locale} · ${translation.metadata.status === "reviewed" ? "已审校" : "草稿"}`
              : "仅英文";
            return `
              <div class="library-row ${record.enabled ? "" : "is-disabled"}" data-chip-id="${escapeHtml(record.id)}">
                <label class="check-control library-select-control" title="选择芯片">
                  <input type="checkbox" data-library-action="select" ${state.librarySelection.has(record.id) ? "checked" : ""} aria-label="选择 ${escapeHtml(record.sensor)}">
                </label>
                <div class="library-chip-name" title="${escapeHtml(record.sensor)}">
                  <strong>${escapeHtml(localizedLabel(record.sensor, translatedSensor))}</strong>
                  <span>${escapeHtml(record.vendor || record.family || record.deviceType || "未提供厂商信息")}</span>
                  <small class="library-translation-status ${translation ? "" : "is-missing"}">${escapeHtml(translationLabel)}</small>
                </div>
                <input class="category-input" data-library-action="category" list="categoryOptions" value="${escapeHtml(record.category || fallbackCategory(record))}" aria-label="${escapeHtml(record.sensor)} 的分类">
                <label class="check-control library-enabled-control" title="在主界面显示">
                  <input type="checkbox" data-library-action="enabled" ${record.enabled ? "checked" : ""} aria-label="显示 ${escapeHtml(record.sensor)}">
                </label>
                <div class="library-source" title="${escapeHtml(sourceDetail)}">
                  <strong>${sourceLabel}</strong>
                  <span>${escapeHtml(record.sourceName || "")}</span>
                </div>
                <button class="icon-button danger library-remove-control" type="button" data-library-action="remove" title="从芯片库移除 ${escapeHtml(record.sensor)}" aria-label="从芯片库移除 ${escapeHtml(record.sensor)}"><i data-lucide="trash-2"></i></button>
              </div>
            `;
          })
          .join("")
      : `<div class="empty-state">${libraryRecords.length ? "没有匹配的芯片" : "芯片库为空"}</div>`;

    const filteredSelectedCount = filtered.filter((record) => state.librarySelection.has(record.id)).length;
    els.librarySelectAll.checked = filtered.length > 0 && filteredSelectedCount === filtered.length;
    els.librarySelectAll.indeterminate = filteredSelectedCount > 0 && filteredSelectedCount < filtered.length;
    els.librarySelectAll.disabled = filtered.length === 0;
    els.libraryBatchCategoryButton.disabled = selectedCount === 0;
    els.libraryShowSelectedButton.disabled = selectedCount === 0;
    els.libraryHideSelectedButton.disabled = selectedCount === 0;
    els.libraryRemoveSelectedButton.disabled = removableCount === 0;
    els.libraryRemoveSelectedButton.title = removableCount ? `移除 ${removableCount} 个芯片` : "请先选择芯片";
    els.exportSelectedButton.disabled = selectedCount === 0 || !isDesktopApp();
    els.exportSelectedButton.title = isDesktopApp() ? "" : "独立 HTML 导出需要桌面版";
    setLibraryStatus(state.libraryStatus, state.libraryStatusError);
    refreshIcons(els.libraryPanel);
  }

  function openLibrary() {
    closeToolsMenu(false);
    hideHoverPanel();
    state.libraryOpen = true;
    els.libraryBackdrop.hidden = false;
    els.libraryQuickButton.setAttribute("aria-expanded", "true");
    document.body.classList.add("library-open");
    renderLibraryList();
    window.setTimeout(() => els.librarySearchInput.focus(), 0);
  }

  function closeLibrary() {
    state.libraryOpen = false;
    els.libraryBackdrop.hidden = true;
    els.libraryQuickButton.setAttribute("aria-expanded", "false");
    document.body.classList.remove("library-open");
    els.libraryQuickButton.focus({ preventScroll: true });
  }

  function populateChipSelect() {
    if (!chips.length) {
      els.chipSelect.innerHTML = '<option value="">尚未导入芯片</option>';
      els.chipSelect.disabled = true;
      return;
    }
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
            ${items.map(({ chip, index }) => `<option value="${index}">${escapeHtml(localizedLabel(chip.sensor || chip._id || `Chip ${index + 1}`, getTranslationRoot(chip)?.sensor))}${chip._temporaryHidden ? "（临时查看）" : ""}</option>`).join("")}
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
    els.pageSelect.innerHTML = pages.length
      ? pages.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(localizedLabel(name, getPageTranslation(name)?.title))}</option>`).join("")
      : '<option value="">尚未选择页面</option>';
    els.pageSelect.disabled = pages.length === 0;
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

  async function loadYamlFiles(fileList) {
    if (isDesktopApp()) {
      setLibraryStatus("正在选择 YAML / 译文...", false);
      try {
        const preview = await getInvoke()("preview_yaml_files", { category: null });
        if (preview.canceled || !preview.previewId) {
          setLibraryStatus("已取消文件导入");
          return;
        }
        openImportPreview(preview, "文件导入");
      } catch (error) {
        const message = errorMessage(error);
        setLibraryStatus(message, true);
        showImportFailures("文件导入失败", "所选文件未能完成导入。", [message]);
      }
      return;
    }
    const files = Array.from(fileList || []).filter((file) => /\.(ya?ml)$/i.test(file.name));
    if (!files.length) {
      state.loadMessage = "未选择 YAML 文件";
      render();
      return;
    }

    let parsed;
    try {
      state.loadMessage = `正在后台解析 ${files.length} 个 YAML 文件...`;
      render();
      parsed = await parseBrowserImportFiles(files);
    } catch (error) {
      state.loadMessage = errorMessage(error);
      render();
      showImportFailures("YAML 未导入", "后台解析任务失败。", [state.loadMessage]);
      return;
    }
    const failures = Array.isArray(parsed.failures) ? [...parsed.failures] : [];
    const sources = Array.isArray(parsed.sources) ? parsed.sources : [];
    const translations = Array.isArray(parsed.translations) ? parsed.translations : [];
    if (!sources.length && !translations.length) {
      state.loadMessage = failures.length ? `未导入：${failures.length} 个文件未通过规范检查` : "未找到可导入的 YAML";
      render();
      if (failures.length) showImportFailures("YAML 未导入", "所选文件未通过规范检查。", failures);
      return;
    }
    const previewAccepted = await requestBrowserImportConfirmation(
      buildBrowserImportPreview(sources, translations, failures),
    );
    if (!previewAccepted) return;

    let selectedIndex = state.chipIndex;
    let selectedSourceSha256 = "";
    let desktopRecords = null;
    let loaded = 0;
    let translated = 0;

    for (const item of sources) {
      try {
        const sourceSha256 = item.sourceSha256;
        const chip = normalizeLoadedChip(item.data, item.sourceName);
        chip._sourceSha256 = sourceSha256;
        selectedSourceSha256 = sourceSha256;
        if (isDesktopApp()) {
          desktopRecords = await getInvoke()("import_yaml", {
            sourceName: item.sourceName,
            yamlText: item.text,
            category: null,
          });
        } else {
          selectedIndex = upsertChip(chip);
          const existingRecord = libraryRecords.findIndex((record) => record.id === chip._id);
          const previous = existingRecord >= 0 ? libraryRecords[existingRecord] : null;
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
            sourceName: item.sourceName,
            sourcePath: null,
            sourceSha256,
            yamlText: item.text,
            notes: previous?.notes || [],
            attachments: previous?.attachments || [],
            translations: (previous?.translations || []).filter((translation) => {
              return translation.sourceSha256 === sourceSha256
                || translationDocumentFromRecord(translation)?.source_sha256 === sourceSha256;
            }),
            chipData: chip,
          };
          if (existingRecord >= 0) libraryRecords[existingRecord] = record;
          else libraryRecords.push(record);
        }
        loaded += 1;
      } catch (error) {
        failures.push(`${item.fileName}: ${errorMessage(error)}`);
      }
    }

    for (const item of translations) {
      try {
        const sourceSha256 = item.sourceSha256;
        selectedSourceSha256 = sourceSha256;
        if (isDesktopApp()) {
          desktopRecords = await getInvoke()("import_translation", {
            sourceName: item.sourceName,
            yamlText: item.text,
          });
        } else {
          const chip = chips.find((candidate) => candidate._sourceSha256 === sourceSha256);
          if (!chip) throw new Error("英文源 YAML 当前未显示");
          chip._translations = (chip._translations || []).filter((translation) => translation.locale !== item.data.locale);
          chip._translations.push(item.data);
          const record = libraryRecords.find((candidate) => candidate.sourceSha256 === sourceSha256);
          if (record) {
            record.translations = (record.translations || []).filter((translation) => {
              return translationDocumentFromRecord(translation)?.locale !== item.data.locale;
            });
            record.translations.push({
              sourceSha256,
              sourceFile: item.data.source_file,
              locale: item.data.locale,
              yamlText: item.text,
              translationData: item.data,
            });
          }
        }
        translated += 1;
      } catch (error) {
        failures.push(`${item.fileName}: ${errorMessage(error)}`);
      }
    }

    if (desktopRecords) applyLibraryRecords(desktopRecords);
    if (selectedSourceSha256) {
      const importedIndex = chips.findIndex((chip) => chip._sourceSha256 === selectedSourceSha256);
      state.chipIndex = importedIndex >= 0 ? importedIndex : selectedIndex;
    } else {
      state.chipIndex = selectedIndex;
    }
    const accepted = [loaded ? `${loaded} 个寄存器 YAML` : "", translated ? `${translated} 个译文` : ""].filter(Boolean).join("、");
    state.loadMessage = failures.length
      ? `已加载 ${accepted || "0 个文件"}，失败 ${failures.length} 个：${failures.join("；")}`
      : `已加载 ${accepted || "0 个文件"}`;
    if (getTranslationDocument(chips[state.chipIndex])) state.translationNotice = "";
    populateChipSelect();
    populatePageSelect();
    render();
    refreshBrowserSearchIndex();
    if (state.libraryOpen) {
      setLibraryStatus(state.loadMessage, failures.length > 0);
      renderLibraryList();
    }
    if (failures.length) {
      const failureKind = translations.length && !sources.length ? "译文" : translations.length ? "文件" : "YAML";
      showImportFailures(
        loaded || translated ? `部分${failureKind}未导入` : `${failureKind} 未导入`,
        `已接受 ${loaded + translated} 个，拒绝 ${failures.length} 个。请修正规范问题后重新导入。`,
        failures,
      );
    }
  }

  async function applyDesktopImportReport(report, label) {
    if (report.canceled) {
      setLibraryStatus("已取消导入");
      return;
    }
    for (const chipId of report.changedChipIds || []) chipDocumentCache.delete(chipId);
    const records = await getLibrarySummaries();
    await applyLibraryRecords(records);
    if (report.changedChipIds?.length) {
      const targetId = report.changedChipIds[report.changedChipIds.length - 1];
      const targetIndex = chips.findIndex((chip) => getNavigationChipId(chip) === targetId);
      if (targetIndex >= 0) {
        state.chipIndex = targetIndex;
        await ensureChipLoaded(targetId);
        populateChipSelect();
        populatePageSelect();
        render();
      }
    }
    const accepted = [
      report.imported ? `${report.imported} 个寄存器 YAML` : "",
      report.translations ? `${report.translations} 个译文` : "",
      report.skipped ? `${report.skipped} 个未变化` : "",
    ].filter(Boolean).join("、") || "0 个文件";
    state.loadMessage = report.failures?.length
      ? `${label} ${accepted}，失败 ${report.failures.length} 个`
      : `${label} ${accepted}`;
    setLibraryStatus(state.loadMessage, Boolean(report.failures?.length));
    render();
    if (state.libraryOpen) renderLibraryList();
    if (report.failures?.length) {
      showImportFailures(
        `部分文件未导入`,
        `已接受 ${Number(report.imported || 0) + Number(report.translations || 0)} 个，拒绝 ${report.failures.length} 个。`,
        report.failures,
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
      const preview = await getInvoke()("preview_yaml_directory", { category: null });
      if (!preview.folder || preview.canceled) {
        setLibraryStatus("已取消目录导入");
        if (state.libraryOpen) renderLibraryList();
        return;
      }
      openImportPreview(preview, "目录导入");
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

    if (action === "select") {
      if (control.checked) state.librarySelection.add(record.id);
      else state.librarySelection.delete(record.id);
      renderLibraryList();
      return;
    }

    try {
      if (action === "enabled") {
        record.enabled = control.checked;
        if (isDesktopApp()) {
          await getInvoke()("set_chip_enabled", { chipId: record.id, enabled: record.enabled });
        }
        await applyLibraryRecords(libraryRecords);
        setLibraryStatus(`${record.sensor} 已${record.enabled ? "显示" : "隐藏"}`);
      } else if (action === "category") {
        const category = control.value.trim();
        if (!category) throw new Error("分类不能为空");
        record.category = category;
        if (isDesktopApp()) {
          await getInvoke()("set_chip_category", { chipId: record.id, category });
        }
        await applyLibraryRecords(libraryRecords);
        setLibraryStatus(`${record.sensor} 已归入 ${category}`);
      }
      renderLibraryList();
    } catch (error) {
      setLibraryStatus(error.message || String(error), true);
      if (isDesktopApp()) {
        const records = await getLibrarySummaries();
        await applyLibraryRecords(records);
      }
      renderLibraryList();
    }
  }

  function closeLibraryRemoveDialog() {
    state.libraryRemovalIds = [];
    if (els.libraryRemoveDialog.open) els.libraryRemoveDialog.close();
  }

  function requestLibraryRemoval(records) {
    const removable = records;
    if (!removable.length) {
      setLibraryStatus("请先选择要移除的芯片");
      renderLibraryList();
      return;
    }
    const noteCount = removable.reduce((count, record) => count + (record.notes?.length || 0), 0);
    const attachmentCount = removable.reduce((count, record) => count + (record.attachments?.length || 0), 0);
    const linkedCount = removable.filter((record) => record.sourceKind === "linked").length;
    state.libraryRemovalIds = removable.map((record) => record.id);
    els.libraryRemoveSummary.textContent = removable.length === 1
      ? `将移除 ${removable[0].sensor}`
      : `将移除 ${removable.length} 个芯片`;
    els.libraryRemoveList.innerHTML = removable.slice(0, 6)
      .map((record) => `<li><strong>${escapeHtml(record.sensor)}</strong><span>${escapeHtml(record.category || fallbackCategory(record))}</span></li>`)
      .join("") + (removable.length > 6 ? `<li><strong>以及另外 ${removable.length - 6} 个芯片</strong></li>` : "");
    const impacts = [
      noteCount ? `${noteCount} 条本地备注` : "",
      attachmentCount ? `${attachmentCount} 个附件关联` : "",
    ].filter(Boolean);
    const cleanup = impacts.length ? `同时清除 ${impacts.join("和")}；附件原文件不会被删除。` : "不会删除 YAML 或附件原文件。";
    const linked = linkedCount ? `其中 ${linkedCount} 个来自关联目录，再次关联该目录时可能重新出现。` : "";
    els.libraryRemoveImpact.textContent = `${cleanup}${linked}`;
    els.libraryRemoveDialog.showModal();
    refreshIcons(els.libraryRemoveDialog);
    window.setTimeout(() => els.libraryRemoveCancelButton.focus(), 0);
  }

  async function confirmLibraryRemoval() {
    const ids = [...state.libraryRemovalIds];
    if (!ids.length) return;
    els.libraryRemoveConfirmButton.disabled = true;
    els.libraryRemoveConfirmButton.querySelector("span").textContent = "正在移除";
    try {
      if (isDesktopApp()) {
        for (const chipId of ids) await getInvoke()("delete_chip", { chipId });
        await applyLibraryRecords(await getLibrarySummaries());
      } else {
        await applyLibraryRecords(libraryRecords.filter((record) => !ids.includes(record.id)));
      }
      ids.forEach((id) => state.librarySelection.delete(id));
      closeLibraryRemoveDialog();
      setLibraryStatus(`已从芯片库移除 ${ids.length} 个芯片`);
      renderLibraryList();
    } catch (error) {
      setLibraryStatus(error.message || String(error), true);
      closeLibraryRemoveDialog();
      if (isDesktopApp()) await applyLibraryRecords(await getLibrarySummaries());
      renderLibraryList();
    } finally {
      els.libraryRemoveConfirmButton.disabled = false;
      els.libraryRemoveConfirmButton.querySelector("span").textContent = "确认移除";
    }
  }

  async function applyLibrarySelectionEnabled(enabled) {
    const selected = selectedLibraryRecords();
    if (!selected.length) return;
    try {
      selected.forEach((record) => { record.enabled = enabled; });
      if (isDesktopApp()) {
        for (const record of selected) {
          await getInvoke()("set_chip_enabled", { chipId: record.id, enabled });
        }
      }
      await applyLibraryRecords(isDesktopApp() ? await getLibrarySummaries() : libraryRecords);
      setLibraryStatus(`${selected.length} 个芯片已${enabled ? "显示" : "隐藏"}`);
      renderLibraryList();
    } catch (error) {
      setLibraryStatus(error.message || String(error), true);
      if (isDesktopApp()) await applyLibraryRecords(await getLibrarySummaries());
      renderLibraryList();
    }
  }

  async function applyLibrarySelectionCategory() {
    const category = els.libraryBatchCategory.value.trim();
    const selected = selectedLibraryRecords();
    if (!selected.length) return;
    if (!category) {
      setLibraryStatus("请输入要应用的分类", true);
      els.libraryBatchCategory.focus();
      return;
    }
    try {
      selected.forEach((record) => { record.category = category; });
      if (isDesktopApp()) {
        for (const record of selected) {
          await getInvoke()("set_chip_category", { chipId: record.id, category });
        }
      }
      await applyLibraryRecords(isDesktopApp() ? await getLibrarySummaries() : libraryRecords);
      els.libraryBatchCategory.value = "";
      setLibraryStatus(`${selected.length} 个芯片已归入 ${category}`);
      renderLibraryList();
    } catch (error) {
      setLibraryStatus(error.message || String(error), true);
      if (isDesktopApp()) await applyLibraryRecords(await getLibrarySummaries());
      renderLibraryList();
    }
  }

  function handleLibraryClick(event) {
    const button = event.target.closest("[data-library-action=\"remove\"]");
    const row = event.target.closest("[data-chip-id]");
    if (!button || !row) return;
    const record = libraryRecords.find((item) => item.id === row.dataset.chipId);
    if (!record) return;

    requestLibraryRemoval([record]);
  }

  async function exportSelectedChips() {
    const chipIds = libraryRecords
      .filter((record) => state.librarySelection.has(record.id))
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
    els.searchInput.placeholder = system
      ? "全部分类 / 编码 / 名称 / 字段"
      : "地址 / 名称 / 字段";
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
    els.toolsMenuButton.addEventListener("click", () => {
      if (state.toolsMenuOpen) closeToolsMenu();
      else openToolsMenu();
    });
    els.toolsMenu.addEventListener("keydown", (event) => {
      if (event.defaultPrevented) return;
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const items = visibleToolsMenuItems();
      const currentIndex = items.indexOf(document.activeElement);
      let nextIndex = currentIndex;
      if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = items.length - 1;
      else if (event.key === "ArrowDown") nextIndex = (currentIndex + 1) % items.length;
      else nextIndex = (currentIndex - 1 + items.length) % items.length;
      items[nextIndex]?.focus();
    });
    els.themeButton.addEventListener("click", () => {
      if (state.themeMenuOpen) closeThemeMenu();
      else openThemeMenu();
    });
    els.themeMenu.addEventListener("click", (event) => {
      const option = event.target.closest("[data-theme-option]");
      if (!option) return;
      applyTheme(option.dataset.themeOption);
      closeThemeMenu(false);
      closeToolsMenu(true);
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
      if (state.toolsMenuOpen && !els.toolsMenuPicker.contains(event.target)) closeToolsMenu();
    });
    const handleSystemThemeChange = () => {
      if (state.themePreference === "system") applyTheme("system", false);
    };
    if (systemThemeMedia?.addEventListener) systemThemeMedia.addEventListener("change", handleSystemThemeChange);
    else systemThemeMedia?.addListener?.(handleSystemThemeChange);

    els.loadYamlButton.addEventListener("click", () => {
      closeToolsMenu(false);
      if (isDesktopApp()) loadYamlFiles([]);
      else els.yamlFileInput.click();
    });

    els.loadFolderButton.addEventListener("click", () => {
      closeToolsMenu(false);
      importDirectory();
    });

    els.libraryButton.addEventListener("click", openLibrary);
    els.libraryQuickButton.addEventListener("click", openLibrary);
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
    els.importPreviewCancelButton.addEventListener("click", cancelImportPreview);
    els.importPreviewCancelAction.addEventListener("click", cancelImportPreview);
    els.importPreviewConfirmButton.addEventListener("click", confirmImportPreview);
    els.importPreviewDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      cancelImportPreview();
    });
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
    els.librarySelectAll.addEventListener("change", () => {
      filteredLibraryRecords().forEach((record) => {
        if (els.librarySelectAll.checked) state.librarySelection.add(record.id);
        else state.librarySelection.delete(record.id);
      });
      renderLibraryList();
    });
    els.libraryBatchCategoryButton.addEventListener("click", applyLibrarySelectionCategory);
    els.libraryBatchCategory.addEventListener("keydown", (event) => {
      if (event.key === "Enter") applyLibrarySelectionCategory();
    });
    els.libraryShowSelectedButton.addEventListener("click", () => applyLibrarySelectionEnabled(true));
    els.libraryHideSelectedButton.addEventListener("click", () => applyLibrarySelectionEnabled(false));
    els.libraryRemoveSelectedButton.addEventListener("click", () => requestLibraryRemoval(selectedLibraryRecords()));
    els.libraryRemoveCancelButton.addEventListener("click", closeLibraryRemoveDialog);
    els.libraryRemoveConfirmButton.addEventListener("click", confirmLibraryRemoval);
    els.libraryRemoveDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeLibraryRemoveDialog();
    });
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

    els.chipSelect.addEventListener("change", async () => {
      closeNoteDialog();
      closeAttachmentsDialog();
      state.chipIndex = Number(els.chipSelect.value);
      state.loadMessage = "";
      state.translationNotice = "";
      populatePageSelect();
      render();
      try {
        await ensureChipLoaded(getNavigationChipId());
      } catch (_error) {
        // The loader has already placed the actionable message in the status band.
      }
      refreshBrowserSearchIndex();
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
      state.searchQuery = els.searchInput.value.trim();
      state.searchHistoryIndex = -1;
      scheduleSearch();
    });
    els.searchInput.addEventListener("focus", () => {
      if (state.searchQuery) openSearchPanel();
      else showRecentSearchResults();
    });
    els.searchInput.addEventListener("keydown", (event) => {
      if (event.altKey && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        event.preventDefault();
        restoreSearchHistory(event.key === "ArrowUp" ? 1 : -1);
        return;
      }
      if (!state.searchOpen || !state.searchResults.length) {
        if (event.key === "Escape") {
          event.preventDefault();
          closeSearchPanel({ restoreFocus: true });
        }
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        state.searchActiveIndex = (state.searchActiveIndex + direction + state.searchResults.length) % state.searchResults.length;
        renderSearchResults();
      } else if (event.key === "Enter") {
        event.preventDefault();
        openSearchResult(state.searchResults[state.searchActiveIndex >= 0 ? state.searchActiveIndex : 0], { focus: true });
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeSearchPanel({ restoreFocus: true });
      }
    });
    els.searchFilters.addEventListener("click", (event) => {
      const filter = event.target.closest("[data-search-filter-token]");
      if (filter) removeSearchFilterToken(filter.dataset.searchFilterToken);
    });
    els.searchResults.addEventListener("click", (event) => {
      const suggestion = event.target.closest("[data-search-suggestion]");
      if (suggestion) {
        useSearchSuggestion(suggestion.dataset.searchSuggestion);
        return;
      }
      const result = event.target.closest("[data-search-index]");
      if (!result) return;
      openSearchResult(state.searchResults[Number(result.dataset.searchIndex)]);
    });

    els.languageControl.addEventListener("click", (event) => {
      const button = event.target.closest("[data-language-mode]");
      if (!button) return;
      const mode = button.dataset.languageMode;
      setLanguageMode(mode);
      state.translationNotice = mode !== "en" && !getTranslationDocument()
        ? "当前芯片未加载中文译文，已回退显示英文。请导入翻译 sidecar，或关联寄存器库目录。"
        : "";
      populateChipSelect();
      populatePageSelect();
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
      const copyButton = event.target.closest("[data-detail-copy]");
      if (copyButton) {
        const reg = state.activeWorkbenchKey ? findRegisterByKey(state.activeWorkbenchKey) : null;
        if (reg) copyDetailValue(reg, copyButton.dataset.detailCopy, copyButton);
        return;
      }
      if (event.target.closest(".hover-close")) hideHoverPanel();
    });

    els.tableBody.addEventListener("input", handleRegisterValueInput);
    els.tableBody.addEventListener("click", (event) => {
      if (handleRegisterPageLink(event)) return;
      handleNoteEditButton(event);
    });

    document.addEventListener("click", (event) => {
      if (state.searchOpen && !els.searchControl.contains(event.target)) closeSearchPanel();
      if (els.hoverPanel.hidden) return;
      if (els.hoverPanel.contains(event.target)) return;
      if (els.radixDialog.contains(event.target)) return;
      if (event.target.closest("#matrixGrid .has-register")) return;
      if (event.target.closest("dialog[open], .library-backdrop:not([hidden]), .theme-menu, .theme-button, .tools-menu, .tools-menu-button")) return;
      hideHoverPanel();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        if (state.searchOpen) {
          closeSearchPanel({ restoreFocus: true });
          return;
        }
        if (state.themeMenuOpen) {
          closeThemeMenu(true);
          return;
        }
        if (state.toolsMenuOpen) {
          closeToolsMenu(true);
          return;
        }
        if (els.noteDialog.open || els.attachmentsDialog.open || els.importResultDialog.open || els.libraryRemoveDialog.open) return;
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
    state.searchRecent = readSearchStorage(SEARCH_RECENT_STORAGE_KEY)
      .filter((result) => result && typeof result === "object" && result.chipId)
      .slice(0, 8);
    state.searchHistory = readSearchStorage(SEARCH_HISTORY_STORAGE_KEY)
      .map(String)
      .filter(Boolean)
      .slice(0, 20);
    applyTheme(readStoredTheme(), false);
    setLanguageMode(readStoredLanguageMode(), false);
    renderToolsMenu();
    bindEvents();
    populateChipSelect();
    populatePageSelect();
    setView("matrix");
    render();
    if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";
    replaceNavigationState({ view: "matrix" });
    refreshIcons();
    window.__TAURI__?.event?.listen?.("library-operation-progress", ({ payload }) => {
      if (!payload) return;
      const label = payload.operation === "search-index" ? "建立搜索索引" : payload.operation === "directory-import" ? "导入关联目录" : "导入文件";
      state.loadMessage = `${label} ${payload.current}/${payload.total || "?"}${payload.sourceName ? ` · ${payload.sourceName}` : ""}`;
      els.statusBand.textContent = state.loadMessage;
      if (state.libraryOpen) setLibraryStatus(state.loadMessage);
    });
    const initialize = async () => {
      await initializeLibrary();
      if (isDesktopApp()) await initializeDesktopSearchIndex();
      else await initializeSearchWorker();
    };
    initialize().catch((error) => {
      state.loadMessage = `芯片库加载失败：${error.message || String(error)}`;
      setLibraryStatus(state.loadMessage, true);
      render();
    });
  }

  init();
})();
