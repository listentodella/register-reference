(function () {
  const TOP_KEYS = [
    "schema_version", "sensor", "vendor", "family", "device_type", "register_space", "source", "who_am_i", "pages",
  ];
  const REGISTER_SPACE_KEYS = ["kind", "architecture", "profile"];
  const SOURCE_KEYS = ["title", "version", "revision", "document", "url", "license", "notice"];
  const WHO_KEYS = ["reg", "values"];
  const WHO_VALUE_KEYS = ["value", "desc"];
  const PAGE_KEYS = ["page_id", "address_unit_bits", "access", "desc", "registers"];
  const REGISTER_KEYS = [
    "addr", "name", "access", "width", "bit_width", "address_span", "byte_order", "reset", "desc", "fields",
    "multi_byte", "read_clear", "no_dump", "no_dump_reason", "alias_note", "roles", "event", "target",
    "action_hint", "ignore_by_default", "encoding", "accessors", "execution_state", "condition", "groups",
    "aliases", "variables", "source_ref",
  ];
  const FIELD_KEYS = [
    "name", "bits", "access", "reset", "desc", "values", "roles", "event", "target", "action_hint",
    "ignore_by_default", "condition", "reserved", "reset_info", "access_rules", "variable_length",
  ];
  const ENCODING_KEYS = ["scheme", "op0", "op1", "crn", "crm", "crd", "op2", "coproc", "opc1", "opc2", "r", "m", "m1", "reg", "selector"];
  const ACCESSOR_KEYS = ["name", "kind", "instruction", "condition", "encoding"];
  const VARIABLE_KEYS = ["name", "min", "max", "values"];
  const ACCESS_RULE_KEYS = ["access", "condition"];
  const ENUM_VALUE_KEYS = ["value", "desc", "name", "condition"];
  const SYSTEM_ENCODING_SCHEMES = [
    "aarch64_sysreg", "aarch64_special", "aarch32_cp15", "aarch32_coproc", "aarch32_special", "aarch32_vfp",
    "m_profile_special",
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

  function findTopLevelColon(text) {
    let quote = "";
    let escaped = false;
    let depth = 0;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (quote === '"' && character === "\\") {
        escaped = true;
        continue;
      }
      if ((character === '"' || character === "'") && !quote) {
        quote = character;
        continue;
      }
      if (character === quote) {
        quote = "";
        continue;
      }
      if (!quote && (character === "[" || character === "{")) depth += 1;
      if (!quote && (character === "]" || character === "}")) depth -= 1;
      if (!quote && depth === 0 && character === ":") return index;
    }
    return -1;
  }

  function startsUnsupportedScalarSyntax(text) {
    const source = text.trim();
    if (/^[&*!]/.test(source)) return true;
    const colon = findTopLevelColon(text);
    const value = (colon >= 0 ? text.slice(colon + 1) : source).trim();
    return value.startsWith("|")
      || value.startsWith(">")
      || value.startsWith("&")
      || value.startsWith("*")
      || (value.startsWith("!") && value[1] !== "=")
      || value.startsWith("{");
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
      if (parsed !== null) {
        if (parsed < 0n || parsed >= (1n << BigInt(bitWidth))) {
          error(location, `枚举值 ${JSON.stringify(value)} 超出 ${bitWidth} bit 范围`);
        }
        return `exact:${parsed}`;
      }
      if (typeof value !== "string") {
        error(location, "枚举值必须是整数、数字字符串、二进制通配模式或数值区间");
        return null;
      }
      const text = value.trim();
      const pattern = /^0[bB]([01xX]+)$/.exec(text);
      if (pattern && /[xX]/.test(pattern[1])) {
        if (pattern[1].length > bitWidth) error(location, `枚举模式 ${JSON.stringify(value)} 超出 ${bitWidth} bit 范围`);
        return `pattern:${pattern[1].toLowerCase()}`;
      }
      const range = text.split("..");
      if (range.length === 2) {
        const from = parseInteger(range[0]);
        const to = parseInteger(range[1]);
        if (from === null || to === null || from < 0n || from > to) {
          error(location, "枚举区间必须是由 .. 连接的递增非负整数");
          return null;
        }
        if (to >= (1n << BigInt(bitWidth))) {
          error(location, `枚举值 ${JSON.stringify(value)} 超出 ${bitWidth} bit 范围`);
        }
        return `range:${from}:${to}`;
      }
      error(location, "枚举值必须是整数、数字字符串、二进制通配模式或数值区间");
      return null;
    }

    function parseBitRanges(value, registerBitWidth, location) {
      if (typeof value !== "string") {
        error(location, '必须是带引号的字符串，例如 "7:0" 或 "87:80,47:5"');
        return null;
      }
      const ranges = [];
      for (const token of value.split(",")) {
        const match = /^(\d+)(?::(\d+))?$/.exec(token.trim());
        if (!match) {
          error(location, "格式必须是 hi:lo、单个 bit，或由逗号分隔的多个范围");
          return null;
        }
        const hi = Number(match[1]);
        const lo = Number(match[2] ?? match[1]);
        if (hi < lo) {
          error(location, "最高位 hi 不能小于最低位 lo");
          return null;
        }
        if (hi >= registerBitWidth) {
          error(location, `bit ${hi} 超出寄存器有效位宽 ${registerBitWidth}`);
          return null;
        }
        if (ranges.some((other) => Math.max(lo, other.lo) <= Math.min(hi, other.hi))) {
          error(location, "同一位域的多个 bit 范围不能互相重叠");
          return null;
        }
        ranges.push({ hi, lo });
      }
      return ranges.length ? ranges : null;
    }

    function validateEncoding(value, location) {
      const encoding = requireObject(value, location);
      if (!encoding) return null;
      warnUnknownKeys(encoding, ENCODING_KEYS, location);
      if (!SYSTEM_ENCODING_SCHEMES.includes(encoding.scheme)) {
        error(`${location}.scheme`, `必须是 ${SYSTEM_ENCODING_SCHEMES.join("、")} 之一`);
      }
      const fields = Object.entries(encoding).filter(([key]) => key !== "scheme");
      if (!fields.length) error(location, "至少需要一个编码字段");
      fields.forEach(([key, item]) => {
        if (!(isInteger(item) && item >= 0) && !(typeof item === "string" && item.trim())) {
          error(`${location}.${key}`, "必须是非负整数或非空编码表达式");
        }
      });
      return encoding;
    }

    function validateAccessors(value, location) {
      const accessors = requireArray(value, location);
      if (!accessors) return;
      if (!accessors.length) error(location, "至少需要一个访问方式");
      accessors.forEach((item, index) => {
        const itemLocation = `${location}[${index}]`;
        const accessor = requireObject(item, itemLocation);
        if (!accessor) return;
        warnUnknownKeys(accessor, ACCESSOR_KEYS, itemLocation);
        requireString(accessor.name, `${itemLocation}.name`);
        if (requireString(accessor.kind, `${itemLocation}.kind`) && !["read", "write", "implicit"].includes(accessor.kind)) {
          error(`${itemLocation}.kind`, "必须是 read、write 或 implicit");
        }
        requireString(accessor.instruction, `${itemLocation}.instruction`);
        if ("condition" in accessor) requireString(accessor.condition, `${itemLocation}.condition`);
        validateEncoding(accessor.encoding, `${itemLocation}.encoding`);
      });
    }

    function validateVariables(value, location) {
      const variables = requireArray(value, location);
      if (!variables) return;
      variables.forEach((item, index) => {
        const itemLocation = `${location}[${index}]`;
        const variable = requireObject(item, itemLocation);
        if (!variable) return;
        warnUnknownKeys(variable, VARIABLE_KEYS, itemLocation);
        requireString(variable.name, `${itemLocation}.name`);
        ["min", "max"].forEach((key) => {
          if (key in variable && !isInteger(variable[key])) error(`${itemLocation}.${key}`, "必须是整数");
        });
        if ("values" in variable) {
          const values = requireArray(variable.values, `${itemLocation}.values`);
          values?.forEach((entry, valueIndex) => {
            if (!isInteger(entry) && !(typeof entry === "string" && entry.trim())) {
              error(`${itemLocation}.values[${valueIndex}]`, "必须是整数或非空字符串");
            }
          });
        }
      });
    }

    function validateAccessRules(value, location) {
      const rules = requireArray(value, location);
      if (!rules) return;
      rules.forEach((item, index) => {
        const itemLocation = `${location}[${index}]`;
        const rule = requireObject(item, itemLocation);
        if (!rule) return;
        warnUnknownKeys(rule, ACCESS_RULE_KEYS, itemLocation);
        requireString(rule.access, `${itemLocation}.access`);
        if ("condition" in rule) requireString(rule.condition, `${itemLocation}.condition`);
      });
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
        warnUnknownKeys(itemObject, ENUM_VALUE_KEYS, itemLocation);
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
        if ("condition" in itemObject) requireString(itemObject.condition, `${itemLocation}.condition`);
      });
    }

    function validateField(value, registerBitWidth, location) {
      const field = requireObject(value, location);
      if (!field) return null;
      warnUnknownKeys(field, FIELD_KEYS, location);
      requireString(field.name, `${location}.name`);
      requireString(field.desc, `${location}.desc`);
      const ranges = parseBitRanges(field.bits, registerBitWidth, `${location}.bits`);
      if (!ranges) return null;
      if ("access" in field) requireString(field.access, `${location}.access`);
      if ("condition" in field) requireString(field.condition, `${location}.condition`);
      if ("reserved" in field) requireString(field.reserved, `${location}.reserved`);
      if ("reset_info" in field) requireString(field.reset_info, `${location}.reset_info`);
      if ("variable_length" in field && typeof field.variable_length !== "boolean") {
        error(`${location}.variable_length`, "必须是布尔值");
      }
      if ("access_rules" in field) validateAccessRules(field.access_rules, `${location}.access_rules`);
      const fieldWidth = ranges.reduce((sum, range) => sum + range.hi - range.lo + 1, 0);
      let reset = null;
      if ("reset" in field) {
        reset = parseInteger(field.reset);
        if (reset === null || reset < 0n || reset >= (1n << BigInt(fieldWidth))) {
          error(`${location}.reset`, `必须是 ${fieldWidth} bit 范围内的非负整数`);
        }
      }
      if ("values" in field) validateValues(field.values, fieldWidth, `${location}.values`);
      return {
        hi: Math.max(...ranges.map((range) => range.hi)),
        lo: Math.min(...ranges.map((range) => range.lo)),
        ranges,
        reset,
        condition: typeof field.condition === "string" ? field.condition.trim() : "",
      };
    }

    function validateRegister(value, pageName, index, isSystem, allowsSystemMmio) {
      const location = `pages.${pageName}.registers[${index}]`;
      const register = requireObject(value, location);
      if (!register) return null;
      warnUnknownKeys(register, REGISTER_KEYS, location);
      const address = isInteger(register.addr) && register.addr >= 0 ? register.addr : null;
      const isSystemMmio = isSystem && allowsSystemMmio && address !== null;
      if (isSystem) {
        if ("addr" in register && !allowsSystemMmio) error(`${location}.addr`, "A-profile arm_system 寄存器不能使用 MMIO 地址");
        if ("addr" in register && allowsSystemMmio && address === null) error(`${location}.addr`, "M-profile MMIO 地址必须是非负整数");
        if (!isSystemMmio) {
          validateEncoding(register.encoding, `${location}.encoding`);
          validateAccessors(register.accessors, `${location}.accessors`);
        }
        if ("execution_state" in register) requireString(register.execution_state, `${location}.execution_state`);
        if ("condition" in register) requireString(register.condition, `${location}.condition`);
        for (const key of ["groups", "aliases"]) {
          if (!(key in register)) continue;
          const values = requireArray(register[key], `${location}.${key}`);
          values?.forEach((item, itemIndex) => requireString(item, `${location}.${key}[${itemIndex}]`));
        }
        if ("variables" in register) validateVariables(register.variables, `${location}.variables`);
        if ("source_ref" in register) requireString(register.source_ref, `${location}.source_ref`);
      } else if (address === null) {
        error(`${location}.addr`, "必须是非负整数");
      }
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
      if (isSystem && !isSystemMmio && "address_span" in register) error(`${location}.address_span`, "非 MMIO arm_system 寄存器不能声明地址跨度");
      else if (!isInteger(addressSpan) || addressSpan < 1) error(`${location}.address_span`, "必须是正整数");
      if (isSystem && !isSystemMmio && "byte_order" in register) error(`${location}.byte_order`, "非 MMIO arm_system 寄存器不能声明字节序");
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
            if (isObject(field) && typeof field.name === "string" && !field.reserved && !/^RES(?:ERVED)?\d*$/i.test(field.name)) {
              const nameKey = `${field.name}\u0000${String(field.condition || "").trim()}`;
              if (names.has(nameKey)) warn(fieldLocation, `位域名 ${JSON.stringify(field.name)} 在相同条件下重复`);
              names.add(nameKey);
            }
            const range = validateField(field, validBitWidth, fieldLocation);
            if (!range) return;
            ranges.forEach((other) => {
              const overlaps = range.ranges.some((part) => other.ranges.some(
                (otherPart) => Math.max(part.lo, otherPart.lo) <= Math.min(part.hi, otherPart.hi),
              ));
              if (overlaps && !range.condition && !other.condition) {
                warn(fieldLocation, `位域与 ${other.location} 重叠`);
              }
            });
            ranges.push({ ...range, location: fieldLocation });
            if (range.reset !== null) {
              let remaining = range.reset;
              [...range.ranges].reverse().forEach((part) => {
                const partWidth = part.hi - part.lo + 1;
                const partValueMask = (1n << BigInt(partWidth)) - 1n;
                const physicalMask = partValueMask << BigInt(part.lo);
                resetMask |= physicalMask;
                resetValue = (resetValue & ~physicalMask) | ((remaining & partValueMask) << BigInt(part.lo));
                remaining >>= BigInt(partWidth);
              });
            }
          });
          if (registerReset !== null) {
            const mismatched = (registerReset ^ resetValue) & resetMask;
            if (mismatched !== 0n) error(`${location}.reset`, `与位域复位值不一致，差异位掩码为 0x${mismatched.toString(16)}`);
          }
        }
      }

      if (isSystem) {
        return {
          name: typeof register.name === "string" ? register.name : "",
          location,
          system: true,
        };
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
        if (trimmed.startsWith("? ") || startsUnsupportedScalarSyntax(scalar)) {
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

    let registerSpaceKind = "mmio";
    if ("register_space" in root) {
      const registerSpace = requireObject(root.register_space, "register_space");
      if (registerSpace) {
        warnUnknownKeys(registerSpace, REGISTER_SPACE_KEYS, "register_space");
        if (!requireString(registerSpace.kind, "register_space.kind") || !["mmio", "arm_system"].includes(registerSpace.kind)) {
          error("register_space.kind", "必须是 mmio 或 arm_system");
        } else {
          registerSpaceKind = registerSpace.kind;
        }
        if ("architecture" in registerSpace) requireString(registerSpace.architecture, "register_space.architecture");
        if ("profile" in registerSpace) requireString(registerSpace.profile, "register_space.profile");
      }
    }
    const isSystem = registerSpaceKind === "arm_system";
    const allowsSystemMmio = isSystem && root.register_space?.profile === "M";
    if (isSystem && (!isInteger(root.schema_version) || root.schema_version < 2)) {
      error("schema_version", "arm_system 需要 schema_version: 2 或更高版本");
    }
    if ("source" in root) {
      const source = requireObject(root.source, "source");
      if (source) {
        warnUnknownKeys(source, SOURCE_KEYS, "source");
        Object.entries(source).forEach(([key, value]) => requireString(value, `source.${key}`));
      }
    } else if (isSystem) {
      error("source", "arm_system 数据必须记录官方来源和版本");
    }

    let whoRegister = null;
    if (isSystem && "who_am_i" in root) {
      error("who_am_i", "arm_system 数据不使用 MMIO WHO_AM_I");
    } else if (!isSystem && !("who_am_i" in root)) {
      warn("root", "缺少 who_am_i；未知时也应显式写 reg: null 和 values: []");
    } else if (!isSystem) {
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
      if (isSystem) {
        if ("page_id" in page) error(`${pageLocation}.page_id`, "arm_system 分类页不能使用 MMIO page_id");
      } else if (!isInteger(page.page_id) || page.page_id < 0) {
        error(`${pageLocation}.page_id`, "必须是非负整数");
      } else if (pageIds.has(page.page_id)) {
        warn(`${pageLocation}.page_id`, `与页面 ${JSON.stringify(pageIds.get(page.page_id))} 使用相同 page_id`);
      } else {
        pageIds.set(page.page_id, pageName);
      }
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
        const info = validateRegister(register, pageName, index, isSystem, allowsSystemMmio);
        if (!info) return;
        if (info.name && names.has(info.name)) warn(info.location, `寄存器名 ${JSON.stringify(info.name)} 在页面内重复`);
        names.add(info.name);
        if (!info.system) {
          const overlaps = pageRegisters.some((other) => Math.max(info.start, other.start) <= Math.min(info.end, other.end));
          if (previousAddress !== null && info.start < previousAddress && !overlaps) warn(info.location, "地址小于前一条目；建议按地址递增排列");
          previousAddress = info.start;
          pageRegisters.forEach((other) => {
            if (Math.max(info.start, other.start) <= Math.min(info.end, other.end) && !info.hasAliasNote && !other.hasAliasNote) {
              warn(info.location, `地址范围与 ${other.location} 重叠但双方都没有 alias_note`);
            }
          });
        }
        pageRegisters.push(info);
        if (!info.system) registerRanges.push(info);
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
