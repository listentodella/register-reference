(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RegisterDumpAnalyzer = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MAX_U128 = (1n << 128n) - 1n;
  const EXPORT_SCHEMA = "register-dump-analysis/v1";

  function parseUnsignedValue(text, options = {}) {
    const { emptyAsZero = false, maxBits = 128 } = options;
    const source = String(text ?? "").trim();
    const compact = source.replace(/_/g, "");
    if (!compact) {
      return emptyAsZero
        ? { ok: true, value: 0n, normalized: "0", radix: 10, message: "" }
        : { ok: false, value: 0n, normalized: "", radix: 10, message: "缺少数值" };
    }
    if (compact.startsWith("-")) {
      return { ok: false, value: 0n, normalized: compact, radix: 10, message: "寄存器值必须是无符号整数" };
    }

    let radix = 10;
    let digits = compact;
    if (/^0x/i.test(compact)) {
      radix = 16;
      digits = compact.slice(2);
      if (!/^[0-9a-f]+$/i.test(digits)) {
        return { ok: false, value: 0n, normalized: compact, radix, message: "十六进制值格式无效" };
      }
    } else if (/^0b/i.test(compact)) {
      radix = 2;
      digits = compact.slice(2);
      if (!/^[01]+$/.test(digits)) {
        return { ok: false, value: 0n, normalized: compact, radix, message: "二进制值格式无效" };
      }
    } else if (/^[01]+b$/i.test(compact)) {
      radix = 2;
      digits = compact.slice(0, -1);
    } else if (!/^\d+$/.test(compact)) {
      return { ok: false, value: 0n, normalized: compact, radix, message: "数值仅支持十进制、0x 十六进制或 0b 二进制" };
    }

    try {
      const prefix = radix === 16 ? "0x" : radix === 2 ? "0b" : "";
      const value = BigInt(`${prefix}${digits}`);
      if (maxBits !== null && maxBits !== undefined) {
        const limit = maxBits === 128 ? MAX_U128 : (1n << BigInt(maxBits)) - 1n;
        if (value > limit) {
          return { ok: false, value: 0n, normalized: compact, radix, message: `数值超过 ${maxBits}-bit 无符号范围` };
        }
      }
      return {
        ok: true,
        value,
        normalized: radix === 16 ? `0x${value.toString(16).toUpperCase()}` : radix === 2 ? `0b${value.toString(2)}` : value.toString(10),
        radix,
        message: "",
      };
    } catch (_error) {
      return { ok: false, value: 0n, normalized: compact, radix, message: "数值格式无效或超出可表示范围" };
    }
  }

  function stripLineComment(line) {
    const hash = line.indexOf("#");
    const slash = line.indexOf("//");
    const indexes = [hash, slash].filter((index) => index >= 0);
    return indexes.length ? line.slice(0, Math.min(...indexes)) : line;
  }

  function splitIdentifier(identifier) {
    const source = String(identifier || "").trim();
    const dot = source.lastIndexOf(".");
    if (dot <= 0 || dot === source.length - 1) {
      return { identifier: source, pageHint: "" };
    }
    return { identifier: source.slice(dot + 1), pageHint: source.slice(0, dot) };
  }

  function parseDumpLine(rawLine, lineNumber) {
    const content = stripLineComment(String(rawLine ?? "")).trim();
    if (!content) return null;

    let identifier = "";
    let valueText = "";
    const delimited = /^(\S+)\s*(?:=|:)\s*(\S+)$/.exec(content);
    if (delimited) {
      [, identifier, valueText] = delimited;
    } else {
      const spaced = /^(\S+)\s+(\S+)$/.exec(content);
      if (spaced) [, identifier, valueText] = spaced;
    }

    if (!identifier || !valueText) {
      return {
        lineNumber,
        rawLine: String(rawLine ?? ""),
        content,
        status: "invalid",
        identifier: "",
        pageHint: "",
        identifierKind: "name",
        valueText: "",
        value: 0n,
        message: "无法明确拆分寄存器标识和值",
      };
    }

    const split = splitIdentifier(identifier);
    const parsedValue = parseUnsignedValue(valueText);
    const identifierKind = /^0x[0-9a-f_]+$/i.test(split.identifier) ? "address" : "name";
    if (!parsedValue.ok) {
      return {
        lineNumber,
        rawLine: String(rawLine ?? ""),
        content,
        status: "invalid",
        identifier: split.identifier,
        pageHint: split.pageHint,
        identifierKind,
        valueText,
        value: 0n,
        message: parsedValue.message,
      };
    }

    return {
      lineNumber,
      rawLine: String(rawLine ?? ""),
      content,
      status: "parsed",
      identifier: split.identifier,
      pageHint: split.pageHint,
      identifierKind,
      valueText,
      value: parsedValue.value,
      normalizedValue: parsedValue.normalized,
      message: "",
    };
  }

  function parseDump(text) {
    return String(text ?? "")
      .split(/\r?\n/)
      .map((line, index) => parseDumpLine(line, index + 1))
      .filter(Boolean);
  }

  function parseBits(bits) {
    const source = String(bits ?? "").trim();
    if (!source) throw new Error("位域缺少 bits");
    const ranges = source.split(",").map((segment) => {
      const parts = segment.trim().split(":");
      if (parts.length > 2 || !parts[0]) throw new Error(`位范围 ${segment} 无效`);
      const hi = Number.parseInt(parts[0], 10);
      const lo = Number.parseInt(parts[1] ?? parts[0], 10);
      if (!Number.isInteger(hi) || !Number.isInteger(lo) || hi < lo || lo < 0) {
        throw new Error(`位范围 ${segment} 无效`);
      }
      return { hi, lo, width: hi - lo + 1 };
    });
    return {
      hi: Math.max(...ranges.map((range) => range.hi)),
      lo: Math.min(...ranges.map((range) => range.lo)),
      width: ranges.reduce((sum, range) => sum + range.width, 0),
      ranges,
    };
  }

  function extractFieldValue(registerValue, field) {
    return parseBits(field.bits).ranges.reduce((result, range) => {
      const mask = (1n << BigInt(range.width)) - 1n;
      const segment = (registerValue >> BigInt(range.lo)) & mask;
      return (result << BigInt(range.width)) | segment;
    }, 0n);
  }

  function parseNumericToken(token, fieldWidth) {
    const cleaned = String(token).trim().replace(/_/g, "");
    if (/^0x[0-9a-f]+$/i.test(cleaned)) return BigInt(cleaned);
    if (/^0b[01]+$/i.test(cleaned)) return BigInt(cleaned);
    if (/^[01]+$/i.test(cleaned) && (cleaned.startsWith("0") || (cleaned.length === fieldWidth && fieldWidth <= 3))) {
      return BigInt(`0b${cleaned}`);
    }
    if (/^\d+$/.test(cleaned)) return BigInt(cleaned);
    throw new Error("invalid numeric token");
  }

  function parseVerilogNumericToken(token) {
    const match = /^(\d+)'([bBoOdDhH])([0-9a-fA-F_xXzZ?]+)$/.exec(String(token).trim());
    if (!match) return null;
    const base = match[2].toLowerCase();
    const digits = match[3].replace(/_/g, "").toLowerCase();
    const radix = { b: 2, o: 8, d: 10, h: 16 }[base];
    const valid = { b: /^[01xz?]+$/, o: /^[0-7xz?]+$/, d: /^[0-9xz?]+$/, h: /^[0-9a-fxz?]+$/ }[base];
    if (!valid.test(digits)) return null;
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
      if (match) [, startToken, description] = match;
      else {
        match = new RegExp(`^(${verilogToken})\\s+([A-Z][A-Za-z].+)$`).exec(text);
        if (!match) return null;
        [, startToken, description] = match;
      }
    }
    const parseToken = (token) => (/^\d+'/.test(token) ? parseVerilogNumericToken(token) : (() => {
      const value = parseNumericToken(token, fieldWidth);
      return { from: value, to: value };
    })());
    try {
      const start = parseToken(startToken);
      if (!start) return null;
      if (endToken) {
        if ("mask" in start) return null;
        const end = parseToken(endToken);
        if (!end || "mask" in end) return null;
        return { from: start.from, to: end.to, label: `${startToken}..${endToken}`, name: "", desc: description.trim(), condition: "" };
      }
      return { ...start, label: startToken, name: "", desc: description.trim(), condition: "" };
    } catch (_error) {
      return null;
    }
  }

  function getFieldEnumEntries(field) {
    const entries = [];
    const createEntry = (value, desc, condition = "", name = "") => {
      const label = String(value ?? "").trim();
      const range = label.split("..");
      try {
        if (range.length === 2) {
          return { from: BigInt(range[0]), to: BigInt(range[1]), label, name: String(name || ""), desc: String(desc ?? ""), condition };
        }
        const verilog = parseVerilogNumericToken(label);
        if (verilog) return { ...verilog, label, name: String(name || ""), desc: String(desc ?? ""), condition };
        const pattern = /^0[bB]([01xX]+)$/.exec(label);
        if (pattern && /[xX]/.test(pattern[1])) {
          const maskText = pattern[1].replace(/[01]/g, "1").replace(/[xX]/g, "0");
          const valueText = pattern[1].replace(/[xX]/g, "0");
          return {
            mask: BigInt(`0b${maskText}`),
            match: BigInt(`0b${valueText}`),
            label,
            name: String(name || ""),
            desc: String(desc ?? ""),
            condition,
          };
        }
        const exact = BigInt(label);
        return { from: exact, to: exact, label, name: String(name || ""), desc: String(desc ?? ""), condition };
      } catch (_error) {
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
        const entry = createEntry(item.value, item.desc ?? item.name ?? item.value, item.condition || "", item.name || "");
        if (entry) entries.push(entry);
      }
    }
    const width = parseBits(field.bits).width;
    for (const line of String(field.desc || "").split(/\r?\n/)) {
      const entry = parseInlineEnumLine(line, width);
      if (entry) entries.push(entry);
    }
    return entries;
  }

  function enumMatches(entry, value) {
    return "mask" in entry ? (value & entry.mask) === entry.match : value >= entry.from && value <= entry.to;
  }

  function getBitWidth(register) {
    return Math.max(1, Number(register?.bit_width ?? (Number(register?.width || 1) * 8)));
  }

  function formatBigIntHex(value, bitWidth = 1) {
    const digits = Math.max(1, Math.ceil(Number(bitWidth || 1) / 4));
    return `0x${value.toString(16).toUpperCase().padStart(digits, "0")}`;
  }

  function decodeRegisterValue(register, rawValue) {
    const bitWidth = getBitWidth(register);
    const mask = (1n << BigInt(bitWidth)) - 1n;
    const value = rawValue & mask;
    const fields = (Array.isArray(register?.fields) ? register.fields : []).map((field, fieldIndex) => {
      try {
        const bits = parseBits(field.bits);
        const fieldValue = extractFieldValue(value, field);
        const enums = getFieldEnumEntries(field);
        const matches = enums.filter((entry) => enumMatches(entry, fieldValue));
        const reserved = Boolean(String(field.reserved || "").trim()) || /^reserved$/i.test(String(field.name || "").trim());
        return {
          fieldIndex,
          name: field.name || `FIELD_${fieldIndex}`,
          bits: String(field.bits ?? ""),
          width: bits.width,
          access: field.access || "",
          value: fieldValue,
          valueHex: formatBigIntHex(fieldValue, bits.width),
          valueDec: fieldValue.toString(10),
          enumStatus: enums.length ? (matches.length ? "matched" : "unknown_value") : "not_defined",
          matches,
          enums,
          condition: field.condition || "",
          description: field.desc || "",
          reserved: reserved ? String(field.reserved || field.desc || "reserved") : "",
          semanticStatus: reserved ? "reserved" : field.condition ? "conditional" : "normal",
          source: field,
        };
      } catch (error) {
        return {
          fieldIndex,
          name: field.name || `FIELD_${fieldIndex}`,
          bits: String(field.bits ?? ""),
          width: 0,
          access: field.access || "",
          value: 0n,
          valueHex: "",
          valueDec: "",
          enumStatus: "invalid_field",
          matches: [],
          enums: [],
          condition: field.condition || "",
          description: field.desc || "",
          reserved: "",
          semanticStatus: "invalid",
          message: error.message,
          source: field,
        };
      }
    });
    return {
      rawValue,
      value,
      valueHex: formatBigIntHex(value, bitWidth),
      valueDec: value.toString(10),
      valueBin: value.toString(2).padStart(bitWidth, "0"),
      bitWidth,
      clipped: rawValue > mask,
      fields,
    };
  }

  function normalizeName(value) {
    return String(value || "").trim().toLocaleLowerCase("en-US");
  }

  function normalizeLocator(value) {
    return String(value || "").trim().toLocaleLowerCase("en-US").replace(/[\s,]+/g, "").replace(/=/g, ":");
  }

  function numericAddress(value) {
    if (value === undefined || value === null || value === "") return null;
    const parsed = parseUnsignedValue(value, { maxBits: null });
    return parsed.ok ? parsed.value : null;
  }

  function encodingValue(value, prefix = "") {
    if (value === undefined || value === null || value === "") return "?";
    return `${prefix}${String(value).replace(/^0[bB]/, "")}`;
  }

  function registerLocator(chip, register) {
    const kind = chip?.register_space?.kind || "";
    const system = ["arm_system", "riscv_system"].includes(kind);
    const mmioAddress = numericAddress(register?.addr);
    if (!system || mmioAddress !== null) {
      if (mmioAddress === null) return { display: register?.name || "", key: "", addressKey: "" };
      const display = `0x${mmioAddress.toString(16).toUpperCase()}`;
      return { display, key: `mmio:${mmioAddress.toString(10)}`, addressKey: mmioAddress.toString(10) };
    }

    const encoding = register?.encoding || {};
    if (encoding.scheme === "riscv_csr") {
      const address = numericAddress(encoding.address);
      const display = address === null ? "CSR ?" : `CSR 0x${address.toString(16).toUpperCase().padStart(3, "0")}`;
      return {
        display,
        key: `riscv_csr:address:${address === null ? "?" : address.toString(10)}`,
        addressKey: address === null ? "" : address.toString(10),
      };
    }
    if (encoding.scheme === "aarch64_sysreg") {
      const display = [
        encodingValue(encoding.op0, "S"),
        encodingValue(encoding.op1),
        encodingValue(encoding.crn, "C"),
        encodingValue(encoding.crm, "C"),
        encodingValue(encoding.op2),
      ].join("_");
      return { display, key: normalizeLocator(display), addressKey: "" };
    }
    if (["aarch32_cp15", "aarch32_coproc"].includes(encoding.scheme)) {
      const display = [
        encodingValue(encoding.coproc, "p"),
        encodingValue(encoding.opc1 ?? encoding.op1),
        encodingValue(encoding.crn ?? encoding.crd, encoding.crd !== undefined ? "CRd=" : "c"),
        encodingValue(encoding.crm, "c"),
        encodingValue(encoding.opc2 ?? encoding.op2),
      ].filter((part) => part !== "?").join(", ");
      return { display, key: normalizeLocator(display), addressKey: "" };
    }
    const values = Object.entries(encoding)
      .filter(([name]) => name !== "scheme")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => `${name}=${value}`);
    const display = values.join(", ") || register?.name || "system register";
    return { display, key: `${encoding.scheme || kind}:${normalizeLocator(display)}`, addressKey: "" };
  }

  function publicCandidate(candidate) {
    return {
      id: candidate.id,
      stableId: candidate.stableId,
      pageName: candidate.pageName,
      registerName: candidate.registerName,
      locator: candidate.locator,
      registerIndex: candidate.registerIndex,
      aliases: [...candidate.aliases],
      bitWidth: getBitWidth(candidate.register),
    };
  }

  function buildRegisterIndex(chip) {
    const candidates = [];
    for (const [pageName, page] of Object.entries(chip?.pages || {})) {
      const registers = Array.isArray(page?.registers) ? page.registers : [];
      registers.forEach((register, registerIndex) => {
        const locator = registerLocator(chip, register);
        const aliases = Array.from(new Set([
          ...(Array.isArray(register.aliases) ? register.aliases : []),
          ...(Array.isArray(register.accessors) ? register.accessors.map((accessor) => accessor?.name) : []),
        ].filter(Boolean).map(String)));
        const baseStableId = [pageName, locator.key || `index:${registerIndex}`, normalizeName(register.name || `register_${registerIndex}`)].join("::");
        candidates.push({
          id: "",
          stableId: baseStableId,
          baseStableId,
          pageName,
          registerName: register.name || `REGISTER_${registerIndex}`,
          registerIndex,
          locator: locator.display,
          locatorKey: locator.key,
          addressKey: locator.addressKey,
          aliases,
          names: [register.name, ...aliases].filter(Boolean).map(normalizeName),
          register,
        });
      });
    }

    const stableCounts = new Map();
    candidates.forEach((candidate) => stableCounts.set(candidate.baseStableId, (stableCounts.get(candidate.baseStableId) || 0) + 1));
    candidates.forEach((candidate) => {
      candidate.stableId = stableCounts.get(candidate.baseStableId) > 1
        ? `${candidate.baseStableId}::index:${candidate.registerIndex}`
        : candidate.baseStableId;
      candidate.id = candidate.stableId;
    });

    const byAddress = new Map();
    const add = (map, key, candidate) => {
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(candidate);
    };
    candidates.forEach((candidate) => add(byAddress, candidate.addressKey, candidate));
    return { chip, candidates, byAddress };
  }

  function selectionFor(selections, lineNumber) {
    if (selections instanceof Map) return selections.get(lineNumber) || selections.get(String(lineNumber)) || "";
    return selections?.[lineNumber] || selections?.[String(lineNumber)] || "";
  }

  function candidatesForRow(row, index) {
    const pageHint = normalizeName(row.pageHint);
    let candidates;
    if (row.identifierKind === "address") {
      const parsed = parseUnsignedValue(row.identifier, { maxBits: null });
      candidates = parsed.ok ? [...(index.byAddress.get(parsed.value.toString(10)) || [])] : [];
    } else {
      const name = normalizeName(row.identifier);
      const locator = normalizeLocator(row.identifier);
      candidates = index.candidates.filter((candidate) => (
        candidate.names.includes(name)
        || (candidate.locatorKey && normalizeLocator(candidate.locator) === locator)
        || normalizeLocator(candidate.locatorKey) === locator
      ));
    }
    if (pageHint) candidates = candidates.filter((candidate) => normalizeName(candidate.pageName) === pageHint);
    return candidates;
  }

  function matchDumpRows(rows, index, selections = {}) {
    return rows.map((row) => {
      if (row.status === "invalid") return { ...row, candidates: [], candidate: null, decoded: null };
      const candidates = candidatesForRow(row, index);
      if (!candidates.length) {
        return { ...row, status: "unknown", message: "当前芯片中未找到精确匹配", candidates: [], candidate: null, decoded: null };
      }
      const selectedId = selectionFor(selections, row.lineNumber);
      const selected = selectedId ? candidates.find((candidate) => candidate.id === selectedId) : null;
      if (candidates.length > 1 && !selected) {
        return {
          ...row,
          status: "ambiguous",
          message: `找到 ${candidates.length} 个候选，请选择`,
          candidates: candidates.map(publicCandidate),
          candidate: null,
          decoded: null,
        };
      }
      const candidate = selected || candidates[0];
      return {
        ...row,
        status: "matched",
        message: "",
        candidates: candidates.map(publicCandidate),
        candidate: publicCandidate(candidate),
        register: candidate.register,
        decoded: decodeRegisterValue(candidate.register, row.value),
      };
    });
  }

  function analyzeDump(text, chip, selections = {}) {
    const index = buildRegisterIndex(chip);
    return { index, rows: matchDumpRows(parseDump(text), index, selections) };
  }

  function fieldIdentity(field) {
    return `${normalizeName(field.name)}::${String(field.bits).replace(/\s/g, "")}`;
  }

  function changedFields(before, after) {
    const beforeFields = new Map(before.fields.map((field) => [fieldIdentity(field), field]));
    const afterFields = new Map(after.fields.map((field) => [fieldIdentity(field), field]));
    const keys = new Set([...beforeFields.keys(), ...afterFields.keys()]);
    return Array.from(keys).flatMap((key) => {
      const left = beforeFields.get(key) || null;
      const right = afterFields.get(key) || null;
      if (left && right && left.value === right.value) return [];
      return [{ key, name: right?.name || left?.name || "FIELD", bits: right?.bits || left?.bits || "", before: left, after: right }];
    });
  }

  function comparisonPassthrough(row, side) {
    return {
      status: row.status,
      stableId: "",
      before: side === "before" ? row : null,
      after: side === "after" ? row : null,
      changedFields: [],
      order: row.lineNumber,
    };
  }

  function compareSnapshots(beforeRows, afterRows) {
    const beforeMatched = new Map();
    const afterMatched = new Map();
    const add = (map, row) => {
      const key = row.candidate.stableId;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    };
    beforeRows.filter((row) => row.status === "matched").forEach((row) => add(beforeMatched, row));
    afterRows.filter((row) => row.status === "matched").forEach((row) => add(afterMatched, row));

    const comparisons = [];
    const keys = new Set([...beforeMatched.keys(), ...afterMatched.keys()]);
    for (const key of keys) {
      const before = beforeMatched.get(key) || [];
      const after = afterMatched.get(key) || [];
      if (before.length > 1 || after.length > 1) {
        comparisons.push({
          status: "ambiguous",
          stableId: key,
          before: before[0] || null,
          after: after[0] || null,
          duplicateRows: { before: before.map((row) => row.lineNumber), after: after.map((row) => row.lineNumber) },
          changedFields: [],
          order: after[0]?.lineNumber ?? before[0]?.lineNumber ?? Number.MAX_SAFE_INTEGER,
        });
      } else if (!before.length) {
        comparisons.push({ status: "added", stableId: key, before: null, after: after[0], changedFields: [], order: after[0].lineNumber });
      } else if (!after.length) {
        comparisons.push({ status: "removed", stableId: key, before: before[0], after: null, changedFields: [], order: before[0].lineNumber });
      } else {
        const changed = before[0].decoded.value !== after[0].decoded.value;
        comparisons.push({
          status: changed ? "changed" : "unchanged",
          stableId: key,
          before: before[0],
          after: after[0],
          changedFields: changed ? changedFields(before[0].decoded, after[0].decoded) : [],
          order: after[0].lineNumber,
        });
      }
    }
    beforeRows.filter((row) => row.status !== "matched").forEach((row) => comparisons.push(comparisonPassthrough(row, "before")));
    afterRows.filter((row) => row.status !== "matched").forEach((row) => comparisons.push(comparisonPassthrough(row, "after")));
    return comparisons.sort((left, right) => left.order - right.order || left.stableId.localeCompare(right.stableId));
  }

  function enumSummary(field) {
    if (!field) return null;
    return {
      status: field.enumStatus,
      matches: field.matches.map((entry) => ({ value: entry.label, name: entry.name, description: entry.desc, condition: entry.condition })),
      semanticStatus: field.semanticStatus,
      condition: field.condition,
    };
  }

  function exportDecoded(decoded) {
    if (!decoded) return null;
    return {
      bitWidth: decoded.bitWidth,
      valueHex: decoded.valueHex,
      valueDec: decoded.valueDec,
      clipped: decoded.clipped,
      fields: decoded.fields.map((field) => ({
        name: field.name,
        bits: field.bits,
        access: field.access,
        valueHex: field.valueHex,
        valueDec: field.valueDec,
        ...enumSummary(field),
      })),
    };
  }

  function exportRow(row) {
    return {
      lineNumber: row.lineNumber,
      status: row.status,
      identifier: row.identifier,
      pageHint: row.pageHint || null,
      inputValue: row.normalizedValue || row.valueText || null,
      message: row.message || null,
      location: row.candidate ? {
        stableId: row.candidate.stableId,
        page: row.candidate.pageName,
        register: row.candidate.registerName,
        locator: row.candidate.locator,
      } : null,
      candidates: row.status === "ambiguous" ? row.candidates.map((candidate) => ({
        id: candidate.id,
        page: candidate.pageName,
        register: candidate.registerName,
        locator: candidate.locator,
      })) : [],
      decoded: exportDecoded(row.decoded),
    };
  }

  function exportComparison(item) {
    return {
      status: item.status,
      stableId: item.stableId || null,
      before: item.before ? exportRow(item.before) : null,
      after: item.after ? exportRow(item.after) : null,
      changedFields: item.changedFields.map((field) => ({
        name: field.name,
        bits: field.bits,
        before: field.before ? { valueHex: field.before.valueHex, valueDec: field.before.valueDec, ...enumSummary(field.before) } : null,
        after: field.after ? { valueHex: field.after.valueHex, valueDec: field.after.valueDec, ...enumSummary(field.after) } : null,
      })),
    };
  }

  function createExportDocument(chip, mode, payload) {
    const document = {
      schema: EXPORT_SCHEMA,
      generatedAt: new Date().toISOString(),
      chip: {
        sensor: chip?.sensor || "",
        vendor: chip?.vendor || "",
        family: chip?.family || "",
        sourceSha256: chip?._sourceSha256 || "",
      },
      mode,
    };
    if (mode === "compare") document.comparisons = payload.map(exportComparison);
    else document.rows = payload.map(exportRow);
    return document;
  }

  function fieldMeaningText(field) {
    if (!field) return "-";
    if (field.matches.length) {
      return field.matches.map((entry) => [entry.name, entry.desc].filter(Boolean).join(": ") || entry.label).join(" / ");
    }
    if (field.enumStatus === "unknown_value") return "资料未定义当前枚举值";
    if (field.semanticStatus === "reserved") return field.reserved || "reserved";
    return field.description || "未定义枚举";
  }

  function createMarkdown(chip, mode, payload) {
    const lines = [`# ${chip?.sensor || "寄存器"} 转储${mode === "compare" ? "对比" : "分析"}`, ""];
    if (mode === "compare") {
      lines.push("| 状态 | 寄存器 | 定位 | Before | After | 变化位域 |", "| --- | --- | --- | --- | --- | --- |");
      payload.forEach((item) => {
        const row = item.after || item.before;
        const changed = item.changedFields.map((field) => `${field.name}[${field.bits}] ${field.before?.valueHex || "-"} -> ${field.after?.valueHex || "-"}`).join("<br>");
        lines.push(`| ${item.status} | ${row?.candidate?.registerName || row?.identifier || "-"} | ${row?.candidate ? `${row.candidate.pageName} / ${row.candidate.locator}` : "-"} | ${item.before?.decoded?.valueHex || "-"} | ${item.after?.decoded?.valueHex || "-"} | ${changed || "-"} |`);
      });
    } else {
      lines.push("| 行 | 状态 | 输入 | 寄存器 | 定位 | 值 |", "| ---: | --- | --- | --- | --- | --- |");
      payload.forEach((row) => {
        lines.push(`| ${row.lineNumber} | ${row.status} | ${row.identifier || "-"} | ${row.candidate?.registerName || "-"} | ${row.candidate ? `${row.candidate.pageName} / ${row.candidate.locator}` : "-"} | ${row.decoded?.valueHex || row.valueText || "-"} |`);
        if (row.decoded?.fields.length) {
          lines.push("", ...row.decoded.fields.map((field) => `- ${field.name}[${field.bits}] = ${field.valueHex} (${field.valueDec}): ${fieldMeaningText(field)}`), "");
        }
      });
    }
    return lines.join("\n");
  }

  return {
    EXPORT_SCHEMA,
    MAX_U128,
    analyzeDump,
    buildRegisterIndex,
    candidatesForRow,
    compareSnapshots,
    createExportDocument,
    createMarkdown,
    decodeRegisterValue,
    enumMatches,
    extractFieldValue,
    formatBigIntHex,
    getBitWidth,
    getFieldEnumEntries,
    matchDumpRows,
    parseBits,
    parseDump,
    parseDumpLine,
    parseInlineEnumLine,
    parseUnsignedValue,
    registerLocator,
  };
});
