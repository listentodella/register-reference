/**
 * 进制与位域模型。纯函数，不依赖 DOM 或 wx API，可直接在小程序、Node 和浏览器中复用。
 * 语义与桌面版 app.js 的 radix 实现保持一致（含解析规则、位域划分算法和位操作）。
 */

const WIDTHS = [8, 16, 32, 64];

const OPERATIONS = [
  { key: "zero", label: "全 0" },
  { key: "ones", label: "全 1" },
  { key: "invert", label: "取反" },
  { key: "increment", label: "+1" },
  { key: "decrement", label: "-1" },
];

function maskFor(bitWidth) {
  return (1n << BigInt(bitWidth)) - 1n;
}

function clampValue(value, bitWidth) {
  return value & maskFor(bitWidth);
}

function toSigned(value, bitWidth) {
  const mask = maskFor(bitWidth);
  const masked = value & mask;
  const signBit = 1n << BigInt(bitWidth - 1);
  return masked & signBit ? masked - (mask + 1n) : masked;
}

function formatHex(value, bitWidth) {
  return clampValue(value, bitWidth).toString(16).toUpperCase().padStart(bitWidth / 4, "0");
}

function formatBin(value, bitWidth) {
  return clampValue(value, bitWidth).toString(2).padStart(bitWidth, "0");
}

function formatDec(value, bitWidth, signed) {
  const masked = clampValue(value, bitWidth);
  return (signed ? toSigned(masked, bitWidth) : masked).toString(10);
}

function formatValue(value, radix, bitWidth, signed) {
  if (radix === 16) return formatHex(value, bitWidth);
  if (radix === 2) return formatBin(value, bitWidth);
  return formatDec(value, bitWidth, signed);
}

/** 按字节切分十六进制串，供字节行显示。 */
function hexBytes(value, bitWidth) {
  const hex = formatHex(value, bitWidth);
  const bytes = [];
  for (let index = 0; index < bitWidth / 8; index += 1) {
    bytes.push({ start: index * 8 + 1, text: hex.slice(index * 2, index * 2 + 2) });
  }
  return bytes;
}

/**
 * 解析某个进制的输入。返回 { ok, value, message }。
 * 与桌面版一致：十进制有符号模式允许负数并做范围校验，其余进制校验是否超出当前位宽。
 */
function parseValue(text, radix, bitWidth, signed) {
  let compact = String(text == null ? "" : text).trim().replace(/_/g, "");
  if (!compact) return { ok: true, value: 0n, message: "" };
  if (radix === 16 && /^0x/i.test(compact)) compact = compact.slice(2);
  if (radix === 2 && /^0b/i.test(compact)) compact = compact.slice(2);
  if (radix === 2 && /b$/i.test(compact)) compact = compact.slice(0, -1);
  if (!compact) return { ok: true, value: 0n, message: "" };

  const pattern = radix === 16 ? /^[0-9a-f]+$/i : radix === 2 ? /^[01]+$/ : signed ? /^-?\d+$/ : /^\d+$/;
  if (!pattern.test(compact)) return { ok: false, value: 0n, message: "输入值格式无效" };

  try {
    const value = BigInt(radix === 16 ? `0x${compact}` : radix === 2 ? `0b${compact}` : compact);
    if (radix === 10 && signed) {
      const signedLimit = 1n << BigInt(bitWidth - 1);
      if (value < -signedLimit || value >= signedLimit) {
        return { ok: false, value, message: `超出当前 ${bitWidth} bit 有符号范围` };
      }
      return { ok: true, value: value < 0n ? value + maskFor(bitWidth) + 1n : value, message: "" };
    }
    if (value > maskFor(bitWidth)) {
      return { ok: false, value, message: `超出当前 ${bitWidth} bit 位宽` };
    }
    return { ok: true, value, message: "" };
  } catch (error) {
    return { ok: false, value: 0n, message: (error && error.message) || "输入值格式无效" };
  }
}

function applyOperation(value, operation, bitWidth, shift) {
  const mask = maskFor(bitWidth);
  let next = value & mask;
  if (operation === "zero") next = 0n;
  else if (operation === "ones") next = mask;
  else if (operation === "invert") next = ~next & mask;
  else if (operation === "increment") next = (next + 1n) & mask;
  else if (operation === "decrement") next = (next - 1n) & mask;
  else if (operation === "shift-left") next = (next << BigInt(shift)) & mask;
  else if (operation === "shift-right") next >>= BigInt(shift);
  return next;
}

function fieldKey(field) {
  return `${field.high}:${field.low}`;
}

function fieldWidth(field) {
  return field.high - field.low + 1;
}

function fieldMask(field) {
  return ((1n << BigInt(fieldWidth(field))) - 1n) << BigInt(field.low);
}

function fieldValue(value, field) {
  return (value & fieldMask(field)) >> BigInt(field.low);
}

function writeFieldValue(value, field, next) {
  const mask = fieldMask(field);
  return (value & ~mask) | ((next << BigInt(field.low)) & mask);
}

function fieldAtBit(fields, bit) {
  return fields.find((field) => bit <= field.high && bit >= field.low) || null;
}

function formatFieldRange(field) {
  return field.high === field.low ? String(field.high) : fieldKey(field);
}

function formatFieldValue(field, value, radix) {
  const raw = fieldValue(value, field);
  if (radix === 16) return raw.toString(16).toUpperCase().padStart(Math.ceil(fieldWidth(field) / 4), "0");
  return raw.toString(10);
}

function parseFieldValue(text, radix, field) {
  let compact = String(text == null ? "" : text).trim().replace(/_/g, "");
  if (!compact) return { ok: true, value: 0n, message: "" };
  if (radix === 16 && /^0x/i.test(compact)) compact = compact.slice(2);
  if (!compact) return { ok: true, value: 0n, message: "" };
  const pattern = radix === 16 ? /^[0-9a-f]+$/i : /^\d+$/;
  if (!pattern.test(compact)) return { ok: false, value: 0n, message: "输入值格式无效" };
  try {
    const value = BigInt(radix === 16 ? `0x${compact}` : compact);
    const max = (1n << BigInt(fieldWidth(field))) - 1n;
    if (value > max) {
      return { ok: false, value, message: `超出当前 ${fieldWidth(field)} bit 字段范围` };
    }
    return { ok: true, value, message: "" };
  } catch (error) {
    return { ok: false, value: 0n, message: (error && error.message) || "输入值格式无效" };
  }
}

function createFields(bitWidth) {
  return [{ high: bitWidth - 1, low: 0, name: "" }];
}

/**
 * 把 [low, high] 划成一个独立位域：与它相交的位域被切开，保留未被覆盖的两端。
 * 若该范围已经存在同名位域，则视为取消选择（返回原数组）。
 */
function applySelection(fields, start, end) {
  const high = Math.max(start, end);
  const low = Math.min(start, end);
  if (fields.some((field) => field.high === high && field.low === low)) {
    return { fields, selectedKey: "", created: false };
  }

  const next = [];
  let inserted = false;
  fields.forEach((field) => {
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
  next.sort((left, right) => right.high - left.high);
  return { fields: next, selectedKey: `${high}:${low}`, created: true };
}

module.exports = {
  WIDTHS,
  OPERATIONS,
  applyOperation,
  applySelection,
  clampValue,
  createFields,
  fieldAtBit,
  fieldKey,
  fieldMask,
  fieldValue,
  fieldWidth,
  formatBin,
  formatDec,
  formatFieldRange,
  formatFieldValue,
  formatHex,
  formatValue,
  hexBytes,
  maskFor,
  parseFieldValue,
  parseValue,
  toSigned,
  writeFieldValue,
};
