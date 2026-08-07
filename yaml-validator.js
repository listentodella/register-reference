(function () {
  const TOP_KEYS = ["schema_version", "sensor", "vendor", "family", "device_type", "who_am_i", "pages"];
  const WHO_KEYS = ["reg", "values"];
  const WHO_VALUE_KEYS = ["value", "desc"];
  const PAGE_KEYS = ["page_id", "address_unit_bits", "access", "desc", "registers"];
  const REGISTER_KEYS = [
    "addr", "name", "access", "width", "bit_width", "address_span", "byte_order", "reset", "desc", "fields",
    "multi_byte", "read_clear", "no_dump", "no_dump_reason", "alias_note", "roles", "event", "target",
    "action_hint", "ignore_by_default",
  ];
  const FIELD_KEYS = [
    "name", "bits", "access", "reset", "desc", "values", "roles", "event", "target", "action_hint",
    "ignore_by_default",
  ];

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function isInteger(value) {
    return Number.isInteger(value);
  }

  function parseInteger(value) {
    if (isInteger(value)) return BigInt(value);
    if (typeof value !== "string") return null;
    const text = value.trim();
    if (!/^-?(?:0[xX][0-9a-fA-F]+|0[bB][01]+|\d+)$/.test(text)) return null;
    try {
      if (text.startsWith("-0x") || text.startsWith("-0X")) return -BigInt(`0x${text.slice(3)}`);
      if (text.startsWith("-0b") || text.startsWith("-0B")) return -BigInt(`0b${text.slice(3)}`);
      return BigInt(text);
    } catch {
      return null;
    }
  }

  function validateRegisterYaml(text, data) {
    const errors = [];
    const warnings = [];
    const error = (location, message) => errors.push(`${location}: ${message}`);
    const warn = (location, message) => warnings.push(`${location}: ${message}`);

    function requireObject(value, location) {
      if (isObject(value)) return value;
      error(location, "必须是 mapping/object");
      return null;
    }

    function requireArray(value, location) {
      if (Array.isArray(value)) return value;
      error(location, "必须是 list/array");
      return null;
    }

    function requireString(value, location) {
      if (typeof value === "string" && value.trim()) return true;
      error(location, "必须是非空字符串");
      return false;
    }

    function warnUnknownKeys(value, allowed, location) {
      Object.keys(value).forEach((key) => {
        if (!allowed.includes(key)) warn(location, `未知字段 ${JSON.stringify(key)}，请确认不是拼写错误`);
      });
    }

    function validateEnumValue(value, bitWidth, location) {
      const parsed = parseInteger(value);
      if (parsed === null) {
        error(location, "枚举值必须是整数或带 0x/0b 前缀的数字字符串");
        return null;
      }
      if (parsed < 0n || parsed >= (1n << BigInt(bitWidth))) {
        error(location, `枚举值 ${JSON.stringify(value)} 超出 ${bitWidth} bit 范围`);
      }
      return parsed;
    }

    function validateValues(values, bitWidth, location) {
      if (isObject(values)) {
        Object.entries(values).forEach(([value, desc]) => {
          validateEnumValue(value, bitWidth, `${location}.${value}`);
          requireString(desc, `${location}.${value}`);
        });
        return;
      }
      const items = requireArray(values, location);
      if (!items) return;
      const seen = new Set();
      items.forEach((item, index) => {
        const itemLocation = `${location}[${index}]`;
        const itemObject = requireObject(item, itemLocation);
        if (!itemObject) return;
        if (!("value" in itemObject)) {
          error(itemLocation, "缺少 value");
        } else {
          const parsed = validateEnumValue(itemObject.value, bitWidth, `${itemLocation}.value`);
          if (parsed !== null) {
            const key = parsed.toString();
            if (seen.has(key)) warn(itemLocation, `枚举值 ${JSON.stringify(itemObject.value)} 重复`);
            seen.add(key);
          }
        }
        if ("desc" in itemObject) requireString(itemObject.desc, `${itemLocation}.desc`);
        else if ("name" in itemObject) requireString(itemObject.name, `${itemLocation}.name`);
        else error(itemLocation, "缺少 desc 或 name");
      });
    }

    function validateField(value, registerBitWidth, location) {
      const field = requireObject(value, location);
      if (!field) return null;
      warnUnknownKeys(field, FIELD_KEYS, location);
      requireString(field.name, `${location}.name`);
      requireString(field.desc, `${location}.desc`);
      if (typeof field.bits !== "string") {
        error(`${location}.bits`, '必须是带引号的字符串，例如 "7:0"');
        return null;
      }
      const match = /^(\d+)(?::(\d+))?$/.exec(field.bits.trim());
      if (!match) {
        error(`${location}.bits`, "格式必须是 hi:lo 或单个 bit");
        return null;
      }
      const hi = Number(match[1]);
      const lo = Number(match[2] ?? match[1]);
      if (hi < lo) {
        error(`${location}.bits`, "最高位 hi 不能小于最低位 lo");
        return null;
      }
      if (hi >= registerBitWidth) {
        error(`${location}.bits`, `bit ${hi} 超出寄存器有效位宽 ${registerBitWidth}`);
        return null;
      }
      if ("access" in field) requireString(field.access, `${location}.access`);
      const fieldWidth = hi - lo + 1;
      let reset = null;
      if ("reset" in field) {
        reset = parseInteger(field.reset);
        if (reset === null || reset < 0n || reset >= (1n << BigInt(fieldWidth))) {
          error(`${location}.reset`, `必须是 ${fieldWidth} bit 范围内的非负整数`);
        }
      }
      if ("values" in field) validateValues(field.values, fieldWidth, `${location}.values`);
      return { hi, lo, reset };
    }

    function validateRegister(value, pageName, index) {
      const location = `pages.${pageName}.registers[${index}]`;
      const register = requireObject(value, location);
      if (!register) return null;
      warnUnknownKeys(register, REGISTER_KEYS, location);
      const address = isInteger(register.addr) && register.addr >= 0 ? register.addr : null;
      if (address === null) error(`${location}.addr`, "必须是非负整数");
      requireString(register.name, `${location}.name`);
      if (requireString(register.access, `${location}.access`) && !["RO", "RW", "WO"].includes(register.access)) {
        warn(`${location}.access`, `非常用访问属性 ${JSON.stringify(register.access)}，建议使用 RO/RW/WO`);
      }
      requireString(register.desc, `${location}.desc`);

      const width = isInteger(register.width) && register.width >= 1 ? register.width : 1;
      if (!isInteger(register.width) || register.width < 1) error(`${location}.width`, "必须是正整数字节数");
      const bitWidth = "bit_width" in register ? register.bit_width : width * 8;
      if (!isInteger(bitWidth) || bitWidth < 1) error(`${location}.bit_width`, "必须是正整数");
      else if (bitWidth > width * 8) error(`${location}.bit_width`, `不能超过 width=${width} 对应的 ${width * 8} bit`);
      const validBitWidth = isInteger(bitWidth) && bitWidth >= 1 ? bitWidth : width * 8;
      const addressSpan = "address_span" in register ? register.address_span : width;
      if (!isInteger(addressSpan) || addressSpan < 1) error(`${location}.address_span`, "必须是正整数");
      if ("byte_order" in register && !["little", "big"].includes(register.byte_order)) {
        error(`${location}.byte_order`, "必须是 little 或 big");
      }

      let registerReset = null;
      if ("reset" in register) {
        registerReset = parseInteger(register.reset);
        if (registerReset === null || registerReset < 0n || registerReset >= (1n << BigInt(validBitWidth))) {
          error(`${location}.reset`, `必须是 ${validBitWidth} bit 范围内的非负整数`);
        }
      }

      if ("fields" in register) {
        const fields = requireArray(register.fields, `${location}.fields`);
        if (fields) {
          const ranges = [];
          const names = new Set();
          let resetMask = 0n;
          let resetValue = 0n;
          fields.forEach((field, fieldIndex) => {
            const fieldLocation = `${location}.fields[${fieldIndex}]`;
            if (isObject(field) && typeof field.name === "string") {
              if (names.has(field.name)) warn(fieldLocation, `位域名 ${JSON.stringify(field.name)} 在同一寄存器内重复`);
              names.add(field.name);
            }
            const range = validateField(field, validBitWidth, fieldLocation);
            if (!range) return;
            ranges.forEach((other) => {
              if (Math.max(range.lo, other.lo) <= Math.min(range.hi, other.hi)) {
                warn(fieldLocation, `位域与 ${other.location} 重叠`);
              }
            });
            ranges.push({ ...range, location: fieldLocation });
            if (range.reset !== null) {
              const fieldWidth = range.hi - range.lo + 1;
              const mask = ((1n << BigInt(fieldWidth)) - 1n) << BigInt(range.lo);
              resetMask |= mask;
              resetValue = (resetValue & ~mask) | (range.reset << BigInt(range.lo));
            }
          });
          if (registerReset !== null) {
            const mismatched = (registerReset ^ resetValue) & resetMask;
            if (mismatched !== 0n) error(`${location}.reset`, `与位域复位值不一致，差异位掩码为 0x${mismatched.toString(16)}`);
          }
        }
      }

      if (address === null || !isInteger(addressSpan) || addressSpan < 1) return null;
      return {
        start: address,
        end: address + addressSpan - 1,
        name: typeof register.name === "string" ? register.name : "",
        hasAliasNote: "alias_note" in register,
        location,
      };
    }

    function validateTextSubset() {
      if (text.includes("\t")) error("file", "包含 Tab；浏览器解析器只接受空格缩进");
      text.split(/\r?\n/).forEach((line, index) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return;
        const scalar = trimmed.startsWith("- ") ? trimmed.slice(2).trim() : trimmed;
        if (["---", "..."].includes(trimmed) || trimmed.startsWith("%")) {
          error("file", `第 ${index + 1} 行使用了浏览器解析器不支持的文档标记或 directive`);
        }
        if (trimmed.startsWith("? ") || /^[&*!]/.test(scalar) || /:\s*(?:[|>]|[&*!][^=]|\{)/.test(trimmed)) {
          error("file", `第 ${index + 1} 行使用了浏览器解析器不支持的 YAML 语法`);
        }
      });
    }

    validateTextSubset();
    const root = requireObject(data, "root");
    if (!root) return { valid: false, errors, warnings };
    warnUnknownKeys(root, TOP_KEYS, "root");
    if ("schema_version" in root && (!isInteger(root.schema_version) || root.schema_version < 1)) {
      error("schema_version", "必须是正整数");
    }
    requireString(root.sensor, "sensor");
    ["vendor", "family", "device_type"].forEach((key) => {
      if (key in root) requireString(root[key], key);
    });

    let whoRegister = null;
    if (!("who_am_i" in root)) {
      warn("root", "缺少 who_am_i；未知时也应显式写 reg: null 和 values: []");
    } else {
      const who = requireObject(root.who_am_i, "who_am_i");
      if (who) {
        warnUnknownKeys(who, WHO_KEYS, "who_am_i");
        if (who.reg !== null) {
          if (isInteger(who.reg) && who.reg >= 0) whoRegister = who.reg;
          else error("who_am_i.reg", "必须是非负整数或 null");
        }
        const values = requireArray(who.values, "who_am_i.values");
        if (values) {
          const seen = new Set();
          values.forEach((item, index) => {
            const location = `who_am_i.values[${index}]`;
            const value = requireObject(item, location);
            if (!value) return;
            warnUnknownKeys(value, WHO_VALUE_KEYS, location);
            if (!isInteger(value.value) || value.value < 0) error(`${location}.value`, "必须是非负整数");
            else {
              if (seen.has(value.value)) warn(location, `WHO_AM_I 值 0x${value.value.toString(16)} 重复`);
              seen.add(value.value);
            }
            requireString(value.desc, `${location}.desc`);
          });
        }
      }
    }

    const pages = requireObject(root.pages, "pages");
    if (!pages) return { valid: false, errors, warnings };
    const pageNames = Object.keys(pages);
    if (!pageNames.length) error("pages", "至少需要一个页面");
    const pageIds = new Map();
    const registerRanges = [];
    pageNames.forEach((pageName) => {
      const pageLocation = `pages.${pageName}`;
      if (!pageName.trim()) error("pages", "页面名必须是非空字符串");
      const page = requireObject(pages[pageName], pageLocation);
      if (!page) return;
      warnUnknownKeys(page, PAGE_KEYS, pageLocation);
      if (!isInteger(page.page_id) || page.page_id < 0) error(`${pageLocation}.page_id`, "必须是非负整数");
      else if (pageIds.has(page.page_id)) warn(`${pageLocation}.page_id`, `与页面 ${JSON.stringify(pageIds.get(page.page_id))} 使用相同 page_id`);
      else pageIds.set(page.page_id, pageName);
      requireString(page.access, `${pageLocation}.access`);
      requireString(page.desc, `${pageLocation}.desc`);
      if ("address_unit_bits" in page && (!isInteger(page.address_unit_bits) || page.address_unit_bits < 1)) {
        error(`${pageLocation}.address_unit_bits`, "必须是正整数");
      }
      const registers = requireArray(page.registers, `${pageLocation}.registers`);
      if (!registers) return;
      const pageRegisters = [];
      const names = new Set();
      let previousAddress = null;
      registers.forEach((register, index) => {
        const info = validateRegister(register, pageName, index);
        if (!info) return;
        if (info.name && names.has(info.name)) warn(info.location, `寄存器名 ${JSON.stringify(info.name)} 在页面内重复`);
        names.add(info.name);
        const overlaps = pageRegisters.some((other) => Math.max(info.start, other.start) <= Math.min(info.end, other.end));
        if (previousAddress !== null && info.start < previousAddress && !overlaps) warn(info.location, "地址小于前一条目；建议按地址递增排列");
        previousAddress = info.start;
        pageRegisters.forEach((other) => {
          if (Math.max(info.start, other.start) <= Math.min(info.end, other.end) && !info.hasAliasNote && !other.hasAliasNote) {
            warn(info.location, `地址范围与 ${other.location} 重叠但双方都没有 alias_note`);
          }
        });
        pageRegisters.push(info);
        registerRanges.push(info);
      });
    });
    if (whoRegister !== null && !registerRanges.some((range) => range.start <= whoRegister && whoRegister <= range.end)) {
      warn("who_am_i.reg", "没有匹配到任何页面中的寄存器地址");
    }
    return { valid: errors.length === 0 && warnings.length === 0, errors, warnings };
  }

  function assertRegisterYaml(text, data) {
    const report = validateRegisterYaml(text, data);
    if (report.valid) return report;
    const details = [
      ...report.errors.map((message) => `错误：${message}`),
      ...report.warnings.map((message) => `规范警告：${message}`),
    ];
    const shown = details.slice(0, 12);
    if (details.length > shown.length) shown.push(`另有 ${details.length - shown.length} 项未显示`);
    throw new Error(`YAML 规范校验未通过（${report.errors.length} 个错误，${report.warnings.length} 个警告）\n${shown.join("\n")}`);
  }

  window.validateRegisterYaml = validateRegisterYaml;
  window.assertRegisterYaml = assertRegisterYaml;
})();
