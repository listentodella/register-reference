const radix = require("../../utils/radix.js");
const calculator = require("../../utils/calculator.js");
const jsep = require("../../vendor/jsep.js");

calculator.useParser(jsep);

/** 每个 bit 列的宽度（rpx）。8/16 bit 正好铺满屏宽，32/64 bit 横向滚动。 */
const COLUMN_RPX = 44;
const HISTORY_LIMIT = 50;

Page({
  data: {
    widths: radix.WIDTHS,
    bitWidth: 32,
    signed: false,

    hexText: "00000000",
    decText: "0",
    binText: "00000000000000000000000000000000",
    inputErrors: { hex: false, dec: false, bin: false },
    status: "无符号 · 32 bit",
    statusError: false,

    columnWidth: COLUMN_RPX,
    trackWidth: 0,
    bytes: [],
    bits: [],
    fields: [],
    activeFieldKey: "",

    operations: radix.OPERATIONS,
    shiftLeft: 1,
    shiftRight: 1,
    maxShift: 32,

    calculatorInput: "",
    history: [],
    canClearHistory: false,
  },

  onLoad() {
    // BigInt 无法进入 data（会被序列化丢失），因此数值状态保存在实例属性上，data 只放字符串。
    this.value = 0n;
    this.fields = radix.createFields(this.data.bitWidth);
    this.selection = null;
    this.editing = { cell: "", text: "" };
    this.inputEditing = { kind: "", text: "" };
    this.fieldErrors = new Set();
    this.inputErrorKinds = new Set();
    this.lastResult = null;
    this.calculatorCommands = [];
    this.scrollLeft = 0;
    this.composerLeft = 0;

    const info = typeof wx.getWindowInfo === "function" ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.rpxRatio = (info && info.windowWidth ? info.windowWidth : 375) / 750;
    this.columnPx = COLUMN_RPX * this.rpxRatio;

    this.render();
  },

  onReady() {
    this.measureComposer();
  },

  onResize() {
    this.measureComposer();
  },

  /**
   * 测量实际渲染尺寸。不能只用 rpx 换算：WXSS 对 rpx 转换会取整，64 列累积后偏差可达数个 bit，
   * 会让拖动划分落到错误的位上。因此以真实渲染宽度为准，rpx 换算值仅作为测量完成前的兜底。
   */
  measureComposer(callback) {
    wx.createSelectorQuery()
      .in(this)
      .select(".composer-inner")
      .boundingClientRect()
      .select(".bit-cell")
      .boundingClientRect()
      .exec((results) => {
        const [inner, cell] = results || [];
        if (inner && typeof inner.left === "number") this.composerLeft = inner.left;
        if (cell && cell.width) this.columnPx = cell.width;
        if (typeof callback === "function") callback();
      });
  },

  render(extra = {}) {
    const bitWidth = this.data.bitWidth;
    const signed = this.data.signed;
    const value = radix.clampValue(this.value, bitWidth);
    const selection = this.selection;
    const selectionHigh = selection ? Math.max(selection.start, selection.end) : -1;
    const selectionLow = selection ? Math.min(selection.start, selection.end) : -1;

    const bits = [];
    for (let bit = bitWidth - 1; bit >= 0; bit -= 1) {
      const field = radix.fieldAtBit(this.fields, bit);
      bits.push({
        index: bit,
        set: (value >> BigInt(bit)) & 1n ? true : false,
        active: Boolean(field) && radix.fieldKey(field) === this.data.activeFieldKey,
        preview: selection ? bit <= selectionHigh && bit >= selectionLow : false,
      });
    }

    const fields = this.fields.map((field) => {
      const key = radix.fieldKey(field);
      const hexValue = radix.formatFieldValue(field, value, 16);
      const decValue = radix.formatFieldValue(field, value, 10);
      return {
        key,
        range: radix.formatFieldRange(field),
        narrow: radix.fieldWidth(field) <= 2,
        active: key === this.data.activeFieldKey,
        widthRpx: radix.fieldWidth(field) * COLUMN_RPX,
        name: field.name || "",
        hex: this.editing.cell === `${key}:hex` ? this.editing.text : hexValue,
        dec: this.editing.cell === `${key}:dec` ? this.editing.text : decValue,
        hexInvalid: this.fieldErrors.has(`${key}:hex`),
        decInvalid: this.fieldErrors.has(`${key}:dec`),
      };
    });

    const inputErrors = {
      hex: this.inputErrorKinds.has("hex"),
      dec: this.inputErrorKinds.has("dec"),
      bin: this.inputErrorKinds.has("bin"),
    };

    this.setData({
      hexText: this.inputEditing.kind === "hex" ? this.inputEditing.text : radix.formatHex(value, bitWidth),
      decText: this.inputEditing.kind === "dec" ? this.inputEditing.text : radix.formatDec(value, bitWidth, signed),
      binText: this.inputEditing.kind === "bin" ? this.inputEditing.text : radix.formatBin(value, bitWidth),
      inputErrors,
      status: this.data.statusError
        ? this.data.status
        : `${signed ? "二补码有符号" : "无符号"} · ${bitWidth} bit`,
      bytes: radix.hexBytes(value, bitWidth),
      bits,
      fields,
      trackWidth: bitWidth * COLUMN_RPX,
      ...extra,
    });
  },

  setStatus(message, isError = false) {
    this.setData({ status: message || `${this.data.signed ? "二补码有符号" : "无符号"} · ${this.data.bitWidth} bit`, statusError: isError });
  },

  /* ---------- 数值输入 ---------- */

  onValueInput(event) {
    const kind = event.currentTarget.dataset.kind;
    const text = event.detail.value;
    const spec = { hex: [16, "hex"], dec: [10, "dec"], bin: [2, "bin"] }[kind];
    this.inputEditing = { kind, text };

    const parsed = radix.parseValue(text, spec[0], this.data.bitWidth, this.data.signed);
    if (!parsed.ok) {
      this.inputErrorKinds = new Set([kind]);
      this.setStatus(parsed.message, true);
      this.render();
      return;
    }

    this.inputErrorKinds = new Set();
    this.value = parsed.value;
    this.setStatus("");
    this.render();
  },

  onValueBlur() {
    this.inputEditing = { kind: "", text: "" };
    this.render();
  },

  /* ---------- 位宽与符号 ---------- */

  onWidthChange(event) {
    const bitWidth = Number(event.currentTarget.dataset.width);
    if (!radix.WIDTHS.includes(bitWidth) || bitWidth === this.data.bitWidth) return;
    // 与桌面版一致：切换位宽时重置位域划分，并清空选择。
    this.value = radix.clampValue(this.value, bitWidth);
    this.fields = radix.createFields(bitWidth);
    this.selection = null;
    this.fieldErrors = new Set();
    this.editing = { cell: "", text: "" };
    // 位宽/符号变化后必须放弃编辑态，否则输入框会停留在旧文本上（不能只依赖 blur 的触发顺序）。
    this.inputEditing = { kind: "", text: "" };
    this.inputErrorKinds = new Set();
    this.setData({ bitWidth, activeFieldKey: "", maxShift: bitWidth, shiftLeft: Math.min(this.data.shiftLeft, bitWidth), shiftRight: Math.min(this.data.shiftRight, bitWidth) });
    this.setStatus("");
    this.render();
    this.measureComposer();
  },

  onSignedChange(event) {
    const signed = event.currentTarget.dataset.signed === "true";
    if (signed === this.data.signed) return;
    this.inputEditing = { kind: "", text: "" };
    this.inputErrorKinds = new Set();
    this.setData({ signed });
    this.setStatus("");
    this.render();
  },

  /* ---------- 位操作 ---------- */

  onOperation(event) {
    const operation = event.currentTarget.dataset.operation;
    const shift = operation === "shift-left" ? this.data.shiftLeft : this.data.shiftRight;
    this.value = radix.applyOperation(this.value, operation, this.data.bitWidth, shift);
    this.setStatus("");
    this.render();
  },

  onShiftStep(event) {
    const { direction, delta } = event.currentTarget.dataset;
    const key = direction === "left" ? "shiftLeft" : "shiftRight";
    const next = Math.min(this.data.bitWidth, Math.max(1, this.data[key] + Number(delta)));
    this.setData({ [key]: next });
  },

  onShiftInput(event) {
    const direction = event.currentTarget.dataset.direction;
    const key = direction === "left" ? "shiftLeft" : "shiftRight";
    const parsed = Number.parseInt(event.detail.value, 10);
    const next = Number.isInteger(parsed) ? Math.min(this.data.bitWidth, Math.max(1, parsed)) : this.data[key];
    this.setData({ [key]: next });
  },

  /* ---------- 位：点击翻转 ---------- */

  onBitToggle(event) {
    const bit = Number(event.currentTarget.dataset.bit);
    const mask = 1n << BigInt(bit);
    this.value = (radix.clampValue(this.value, this.data.bitWidth) ^ mask) & radix.maskFor(this.data.bitWidth);
    this.setStatus("");
    this.render();
  },

  /* ---------- 位：拖动位号划分位域 ---------- */

  onBitIndexStart(event) {
    const bit = Number(event.currentTarget.dataset.bitIndex);
    this.selection = { start: bit, end: bit };
    this.render();
  },

  onBitIndexMove(event) {
    if (!this.selection) return;
    const touch = event.touches && event.touches[0];
    if (!touch) return;
    const offset = touch.clientX - this.composerLeft + this.scrollLeft;
    const column = Math.floor(offset / this.columnPx);
    const bit = this.data.bitWidth - 1 - column;
    if (bit < 0 || bit >= this.data.bitWidth || bit === this.selection.end) return;
    this.selection = { start: this.selection.start, end: bit };
    this.render();
  },

  onBitIndexEnd() {
    if (!this.selection) return;
    const { start, end } = this.selection;
    this.selection = null;
    const result = radix.applySelection(this.fields, start, end);
    if (result.created) {
      this.fields = result.fields;
      this.setData({ activeFieldKey: "" });
    }
    this.fieldErrors = new Set();
    this.editing = { cell: "", text: "" };
    this.render();
  },

  onBitIndexCancel() {
    this.selection = null;
    this.render();
  },

  onComposerScroll(event) {
    this.scrollLeft = event.detail.scrollLeft || 0;
  },

  /* ---------- 位域：选中与编辑 ---------- */

  onSelectField(event) {
    const key = event.currentTarget.dataset.key;
    this.setData({ activeFieldKey: this.data.activeFieldKey === key ? "" : key });
    this.render();
  },

  onFieldInput(event) {
    const key = event.currentTarget.dataset.key;
    const kind = event.currentTarget.dataset.kind;
    const text = event.detail.value;

    if (kind === "name") {
      const field = this.fields.find((item) => radix.fieldKey(item) === key);
      if (field) field.name = text;
      this.editing = { cell: `${key}:name`, text };
      this.render();
      return;
    }

    const field = this.fields.find((item) => radix.fieldKey(item) === key);
    if (!field) return;
    this.editing = { cell: `${key}:${kind}`, text };
    const parsed = radix.parseFieldValue(text, kind === "hex" ? 16 : 10, field);
    if (!parsed.ok) {
      this.fieldErrors.add(`${key}:${kind}`);
      this.setStatus(parsed.message, true);
      this.render();
      return;
    }
    this.fieldErrors = new Set();
    this.value = radix.writeFieldValue(radix.clampValue(this.value, this.data.bitWidth), field, parsed.value);
    this.setStatus("");
    this.render();
  },

  onFieldBlur() {
    this.editing = { cell: "", text: "" };
    this.render();
  },

  onResetFields() {
    this.fields = radix.createFields(this.data.bitWidth);
    this.selection = null;
    this.fieldErrors = new Set();
    this.editing = { cell: "", text: "" };
    this.setData({ activeFieldKey: "" });
    this.render();
  },

  /* ---------- 计算器 ---------- */

  onCalculatorInput(event) {
    this.setData({ calculatorInput: event.detail.value });
  },

  onSubmitExpression() {
    const expression = (this.data.calculatorInput || "").trim();
    if (!expression) return;
    this.calculatorCommands.push(expression);
    if (this.calculatorCommands.length > 100) this.calculatorCommands.shift();

    let entry;
    try {
      const result = calculator.calculate(expression, this.lastResult);
      this.lastResult = result;
      entry = {
        expression,
        dec: calculator.formatResult(result),
        hex: calculator.formatHexResult(result),
        error: "",
      };
    } catch (error) {
      entry = { expression, dec: "", hex: "", error: (error && error.message) || String(error) };
    }

    const history = [entry, ...this.data.history].slice(0, HISTORY_LIMIT);
    this.setData({ history, calculatorInput: "", canClearHistory: true });
  },

  onClearHistory() {
    this.calculatorCommands = [];
    this.lastResult = null;
    this.setData({ history: [], canClearHistory: false });
  },

  onUseResult(event) {
    const value = event.currentTarget.dataset.dec;
    if (value === undefined) return;
    this.setData({ calculatorInput: value });
  },
});
