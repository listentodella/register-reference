import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import jsep from "jsep";
import { stringify } from "yaml";

const CMSIS_URL = "https://github.com/ARM-software/CMSIS_6";
const CORE_PROFILES = {
  cm0: { file: "core_cm0.h", name: "Cortex-M0", architecture: "Armv6-M", mainline: false, limits: false, security: false },
  cm0plus: { file: "core_cm0plus.h", name: "Cortex-M0+", architecture: "Armv6-M", mainline: false, limits: false, security: false },
  cm1: { file: "core_cm1.h", name: "Cortex-M1", architecture: "Armv6-M", mainline: false, limits: false, security: false },
  cm23: { file: "core_cm23.h", name: "Cortex-M23", architecture: "Armv8-M Baseline", mainline: false, limits: true, security: true },
  cm3: { file: "core_cm3.h", name: "Cortex-M3", architecture: "Armv7-M", mainline: true, limits: false, security: false },
  cm33: { file: "core_cm33.h", name: "Cortex-M33", architecture: "Armv8-M Mainline", mainline: true, limits: true, security: true },
  cm35p: { file: "core_cm35p.h", name: "Cortex-M35P", architecture: "Armv8-M Mainline", mainline: true, limits: true, security: true },
  cm4: { file: "core_cm4.h", name: "Cortex-M4", architecture: "Armv7E-M", mainline: true, limits: false, security: false },
  cm52: { file: "core_cm52.h", name: "Cortex-M52", architecture: "Armv8.1-M Mainline", mainline: true, limits: true, security: true },
  cm55: { file: "core_cm55.h", name: "Cortex-M55", architecture: "Armv8.1-M Mainline", mainline: true, limits: true, security: true },
  cm7: { file: "core_cm7.h", name: "Cortex-M7", architecture: "Armv7E-M", mainline: true, limits: false, security: false },
  cm85: { file: "core_cm85.h", name: "Cortex-M85", architecture: "Armv8.1-M Mainline", mainline: true, limits: true, security: true },
};

const TYPE_WIDTHS = { uint8_t: 1, uint16_t: 2, uint32_t: 4, uint64_t: 8 };
const ACCESS_BY_QUALIFIER = { __IM: "RO", __I: "RO", __OM: "WO", __O: "WO", __IOM: "RW", __IO: "RW" };
const OPTIONAL_COMPONENTS = {
  MPU: "When __MPU_PRESENT == 1",
  FPU: "When __FPU_PRESENT == 1",
  SAU: "When the Security Extension is implemented",
};
// CMSIS exposes these registers through intrinsics but does not provide
// *_Pos/*_Msk macros for them. Keep this small table limited to stable
// M-profile architectural value layouts; it is not parsed from core_cm*.h.
const SPECIAL_FIELDS = {
  PRIMASK: [{ name: "PM", bits: "0", desc: "Exception mask bit" }],
  FAULTMASK: [{ name: "FM", bits: "0", desc: "Fault mask bit" }],
  BASEPRI: [{ name: "BASEPRI", bits: "7:0", desc: "Base priority mask value" }],
  MSP: [{ name: "ADDRESS", bits: "31:0", desc: "Main Stack Pointer value" }],
  PSP: [{ name: "ADDRESS", bits: "31:0", desc: "Process Stack Pointer value" }],
  MSP_NS: [{ name: "ADDRESS", bits: "31:0", desc: "Non-secure Main Stack Pointer value" }],
  PSP_NS: [{ name: "ADDRESS", bits: "31:0", desc: "Non-secure Process Stack Pointer value" }],
  MSPLIM: [{ name: "ADDRESS", bits: "31:0", desc: "Main Stack Pointer limit" }],
  PSPLIM: [{ name: "ADDRESS", bits: "31:0", desc: "Process Stack Pointer limit" }],
  MSPLIM_NS: [{ name: "ADDRESS", bits: "31:0", desc: "Non-secure Main Stack Pointer limit" }],
  PSPLIM_NS: [{ name: "ADDRESS", bits: "31:0", desc: "Non-secure Process Stack Pointer limit" }],
  SP_NS: [{ name: "ADDRESS", bits: "31:0", desc: "Non-secure Stack Pointer value" }],
};

function cleanComment(value) {
  return String(value || "")
    .replace(/^\s*\/\*+!?<?|\*\/\s*$/g, "")
    .replace(/^\s*\*\s?/gm, "")
    .replace(/\\(?:brief|details)\s*/g, "")
    .replace(/\\(?:param|return|note|see)\b.*$/gm, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function logicalLines(source) {
  return source.replace(/\\\r?\n/g, " ").split(/\r?\n/);
}

function parseMacros(source) {
  const result = new Map();
  for (const line of logicalLines(source)) {
    const match = /^\s*#\s*define\s+([A-Za-z_]\w*)\s+(.+)$/.exec(line);
    if (!match) continue;
    const comment = /\/\*!?<([\s\S]*?)\*\//.exec(match[2])?.[1] || /\/\*+!?<([\s\S]*?)\*\//.exec(match[2])?.[1] || "";
    const expression = match[2].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/, "").trim();
    if (!result.has(match[1])) result.set(match[1], { expression, comment: cleanComment(comment) });
  }
  return result;
}

function normalizeExpression(value) {
  return String(value || "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\(\s*(?:u?int(?:8|16|32|64)_t|unsigned(?:\s+long)?|long)\s*\)/g, "")
    .replace(/\b(0[xX][0-9A-Fa-f]+|0[bB][01]+|\d+)[uUlL]+\b/g, "$1")
    .replace(/\b0[xX][0-9A-Fa-f]+\b|\b0[bB][01]+\b/g, (token) => BigInt(token).toString())
    .trim();
}

function evaluateNode(node, lookup) {
  if (node.type === "Literal") {
    if (!Number.isInteger(node.value)) throw new Error("not an integer literal");
    return BigInt(node.value);
  }
  if (node.type === "Identifier") return lookup(node.name);
  if (node.type === "UnaryExpression") {
    const value = evaluateNode(node.argument, lookup);
    if (node.operator === "+") return value;
    if (node.operator === "-") return -value;
    if (node.operator === "~") return ~value;
    throw new Error(`unsupported unary operator ${node.operator}`);
  }
  if (node.type !== "BinaryExpression") throw new Error(`unsupported expression ${node.type}`);
  const left = evaluateNode(node.left, lookup);
  const right = evaluateNode(node.right, lookup);
  switch (node.operator) {
    case "+": return left + right;
    case "-": return left - right;
    case "*": return left * right;
    case "/": return left / right;
    case "%": return left % right;
    case "<<": return left << right;
    case ">>": return left >> right;
    case "|": return left | right;
    case "&": return left & right;
    case "^": return left ^ right;
    default: throw new Error(`unsupported binary operator ${node.operator}`);
  }
}

function makeMacroEvaluator(macros) {
  const cache = new Map();
  const active = new Set();
  const evaluate = (name) => {
    if (cache.has(name)) return cache.get(name);
    if (active.has(name) || !macros.has(name)) throw new Error(`unresolved macro ${name}`);
    active.add(name);
    try {
      const expression = normalizeExpression(macros.get(name).expression);
      const value = evaluateNode(jsep(expression), evaluate);
      cache.set(name, value);
      return value;
    } finally {
      active.delete(name);
    }
  };
  return evaluate;
}

function matchingBrace(source, openIndex) {
  let depth = 0;
  let blockComment = false;
  let lineComment = false;
  let quote = "";
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") { blockComment = false; index += 1; }
      continue;
    }
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "/" && next === "*") { blockComment = true; index += 1; continue; }
    if (char === "/" && next === "/") { lineComment = true; index += 1; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === "{") depth += 1;
    if (char === "}" && --depth === 0) return index;
  }
  return -1;
}

function parseMemberLine(line) {
  const offset = /Offset:\s*0x([0-9A-Fa-f]+)\s*\(([^)]*)\)\s*([^*]*?)\s*\*\//.exec(line);
  if (!offset) return null;
  const declaration = /^\s*(__IOM|__IM|__OM|__IO|__I|__O)\s+(uint(?:8|16|32|64)_t)\s+([A-Za-z_]\w*)(?:\[(\d+)U?\])?\s*;/.exec(line);
  if (declaration) {
    return {
      name: declaration[3],
      width: TYPE_WIDTHS[declaration[2]],
      count: Number(declaration[4] || 1),
      offset: Number.parseInt(offset[1], 16),
      access: ACCESS_BY_QUALIFIER[declaration[1]],
      desc: cleanComment(offset[3]),
    };
  }
  const unionArray = /^\s*}\s*([A-Za-z_]\w*)\s*\[(\d+)U?\]\s*;/.exec(line);
  if (!unionArray) return null;
  return {
    name: unionArray[1], width: 4, count: Number(unionArray[2]), offset: Number.parseInt(offset[1], 16),
    access: /W/.test(offset[2]) && /R/.test(offset[2]) ? "RW" : /W/.test(offset[2]) ? "WO" : "RO",
    desc: cleanComment(offset[3]),
  };
}

function parseStructs(source) {
  const result = new Map();
  const endPattern = /}\s+([A-Za-z_]\w*)_Type\s*;/g;
  for (const end of source.matchAll(endPattern)) {
    const start = source.lastIndexOf("typedef struct", end.index);
    if (start < 0 || result.has(end[1])) continue;
    const open = source.indexOf("{", start);
    if (open < 0 || matchingBrace(source, open) !== end.index) continue;
    const members = source.slice(open + 1, end.index).split(/\r?\n/).map(parseMemberLine).filter(Boolean);
    if (members.length) result.set(end[1], { name: end[1], members });
  }
  return result;
}

function parsePointers(source) {
  const result = [];
  const seen = new Set();
  for (const line of logicalLines(source)) {
    const match = /^\s*#\s*define\s+([A-Za-z_]\w*)\s+\(\(\s*([A-Za-z_]\w*)_Type\s*\*\s*\)\s*([A-Za-z_]\w*)\s*\)/.exec(line);
    if (!match || match[1].startsWith("CoreDebug")) continue;
    const key = `${match[1]}\0${match[2]}\0${match[3]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ name: match[1], type: match[2], baseMacro: match[3] });
  }
  return result;
}

function rangesFromMask(mask, bitWidth) {
  const ranges = [];
  let bit = 0;
  while (bit < bitWidth) {
    if (((mask >> BigInt(bit)) & 1n) === 0n) { bit += 1; continue; }
    const low = bit;
    while (bit + 1 < bitWidth && ((mask >> BigInt(bit + 1)) & 1n) === 1n) bit += 1;
    ranges.push([bit, low]);
    bit += 1;
  }
  return ranges.reverse();
}

function rangesOverlap(left, right) {
  return left.some(([hi, lo]) => right.some(([otherHi, otherLo]) => Math.max(lo, otherLo) <= Math.min(hi, otherHi)));
}

function registerTokens(name, index) {
  const tokens = [name];
  if (index !== null) tokens.unshift(`${name}${index}`);
  tokens.push(name.replace(/_A\d+$/, ""), name.replace(/\d+$/, ""));
  return Array.from(new Set(tokens.filter(Boolean))).sort((left, right) => right.length - left.length);
}

function buildFields(macros, evaluate, prefixes, registerName, index, bitWidth) {
  const fields = [];
  const tokens = registerName ? registerTokens(registerName, index) : [""];
  for (const [macroName, macro] of macros) {
    if (!macroName.endsWith("_Pos") || /backward compatibility|deprecated/i.test(macro.comment)) continue;
    if (/^[A-Za-z_]\w*_Pos$/.test(macro.expression.trim())) continue;
    let matched = null;
    for (const prefix of prefixes) {
      for (const token of tokens) {
        const start = token ? `${prefix}_${token}_` : `${prefix}_`;
        if (macroName.startsWith(start)) { matched = { start, token }; break; }
      }
      if (matched) break;
    }
    if (!matched) continue;
    const fieldName = macroName.slice(matched.start.length, -4);
    const maskName = `${macroName.slice(0, -4)}_Msk`;
    if (!macros.has(maskName)) continue;
    let position;
    let mask;
    try {
      position = Number(evaluate(macroName));
      mask = evaluate(maskName);
    } catch {
      continue;
    }
    if (!Number.isInteger(position) || position < 0 || mask <= 0n) continue;
    const ranges = rangesFromMask(mask, bitWidth);
    if (!ranges.length) continue;
    const bits = ranges.map(([hi, lo]) => hi === lo ? String(hi) : `${hi}:${lo}`).join(",");
    const description = macro.comment
      .replace(new RegExp(`^.*?${fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:?\\s*`, "i"), "")
      .replace(/\bPosition\b\s*$/i, "")
      .trim();
    fields.push({ name: fieldName, bits, desc: description || `CMSIS ${fieldName} field`, _ranges: ranges });
  }
  const unique = [];
  const seen = new Set();
  for (const field of fields) {
    const key = `${field.name}\0${field.bits}`;
    if (!seen.has(key)) { seen.add(key); unique.push(field); }
  }
  const overlapping = new Set(unique.filter((field) => unique.some(
    (other) => other !== field && rangesOverlap(field._ranges, other._ranges),
  )));
  unique.forEach((field) => {
    if (overlapping.has(field)) {
      field.condition = `Field view: ${field.name}`;
    }
    delete field._ranges;
  });
  return unique.sort((left, right) => Number(right.bits.split(/[:,]/)[0]) - Number(left.bits.split(/[:,]/)[0]) || left.name.localeCompare(right.name));
}

function buildMmioPages(source, coreFile, macros, evaluate) {
  const structs = parseStructs(source);
  const pages = {};
  for (const pointer of parsePointers(source)) {
    const struct = structs.get(pointer.type);
    if (!struct) continue;
    let base;
    try { base = evaluate(pointer.baseMacro); } catch { continue; }
    if (base < 0n || base > BigInt(Number.MAX_SAFE_INTEGER)) continue;
    const prefixes = Array.from(new Set([pointer.name.replace(/_NS$/, ""), pointer.type, pointer.type.toUpperCase()]));
    const registers = [];
    for (const member of struct.members) {
      for (let index = 0; index < member.count; index += 1) {
        const address = base + BigInt(member.offset + index * member.width);
        const fields = buildFields(macros, evaluate, prefixes, member.name, member.count > 1 ? index : null, member.width * 8);
        const condition = pointer.name.endsWith("_NS")
          ? "When the Security Extension exposes the Non-secure alias"
          : OPTIONAL_COMPONENTS[pointer.name];
        registers.push({
          addr: Number(address),
          name: member.count > 1 ? `${member.name}[${index}]` : member.name,
          access: member.access,
          width: member.width,
          bit_width: member.width * 8,
          desc: member.count > 1 ? `${member.desc} (element ${index})` : member.desc,
          ...(condition ? { condition } : {}),
          groups: [pointer.name],
          source_ref: `CMSIS/Core/Include/${coreFile}#${pointer.type}_Type.${member.name}`,
          ...(fields.length ? { fields } : {}),
        });
      }
    }
    if (registers.length) {
      pages[pointer.name] = {
        access: "Memory-mapped Core Peripheral access",
        desc: `${pointer.name} registers from ${pointer.type}_Type`,
        registers: registers.sort((left, right) => left.addr - right.addr || left.name.localeCompare(right.name)),
      };
    }
  }
  return pages;
}

function functionBlocks(source) {
  const result = [];
  const pattern = /__STATIC_FORCEINLINE\s+[^{;]+?\s+(__[A-Za-z_]\w*)\s*\([^)]*\)\s*\{/g;
  for (const match of source.matchAll(pattern)) {
    const open = source.indexOf("{", match.index);
    const close = matchingBrace(source, open);
    if (close < 0) continue;
    const commentStart = source.lastIndexOf("/**", match.index);
    const commentEnd = commentStart >= 0 ? source.indexOf("*/", commentStart) : -1;
    result.push({
      name: match[1],
      body: source.slice(open + 1, close),
      desc: commentEnd >= 0 && commentEnd < match.index ? cleanComment(source.slice(commentStart, commentEnd + 2)) : "",
    });
  }
  return result;
}

function normalizeInstruction(mnemonic, operands) {
  const text = operands.replace(/\\n/g, " ").replace(/%\d+/g, "<value>").replace(/\s+/g, " ").trim();
  const parts = text.split(",").map((part) => part.trim());
  if (mnemonic === "MRS" && parts[1]) parts[1] = parts[1].toUpperCase();
  if (mnemonic === "MSR" && parts[0]) parts[0] = parts[0].toUpperCase();
  return `${mnemonic} ${parts.join(", ")}`;
}

function specialTarget(selector) {
  if (selector === "BASEPRI_MAX") return "BASEPRI";
  return selector;
}

function selectorAllowed(selector, profile) {
  const target = specialTarget(selector).replace(/_NS$/, "");
  const basic = new Set(["CONTROL", "IPSR", "APSR", "XPSR", "PSP", "MSP", "PRIMASK"]);
  if (basic.has(target)) return !selector.endsWith("_NS") || profile.security;
  if (["BASEPRI", "FAULTMASK"].includes(target)) return profile.mainline && (!selector.endsWith("_NS") || profile.security);
  if (["PSPLIM", "MSPLIM"].includes(target)) return profile.limits && (!selector.endsWith("_NS") || profile.security);
  if (target === "SP" && selector === "SP_NS") return profile.security;
  return false;
}

function buildSpecialPage(intrinsics, macros, evaluate, profile, coreFile) {
  const accessors = new Map();
  const descriptions = new Map();
  for (const block of functionBlocks(intrinsics)) {
    if (block.name === "__TZ_set_STACKSEAL_S") continue;
    const instruction = /"\s*(MRS|MSR)\s+([^"\\]+(?:\\.[^"\\]*)?)/i.exec(block.body);
    if (!instruction) continue;
    const mnemonic = instruction[1].toUpperCase();
    const operands = instruction[2].trim();
    const parts = operands.split(",").map((part) => part.replace(/%\d+/g, "").trim()).filter(Boolean);
    const selector = (mnemonic === "MRS" ? parts.at(-1) : parts[0])?.toUpperCase();
    if (!selector || !selectorAllowed(selector, profile)) continue;
    const target = specialTarget(selector);
    if (!accessors.has(target)) accessors.set(target, []);
    accessors.get(target).push({
      name: block.name,
      kind: mnemonic === "MRS" ? "read" : "write",
      instruction: normalizeInstruction(mnemonic, operands),
      encoding: { scheme: "m_profile_special", selector },
    });
    if (block.desc) {
      if (!descriptions.has(target)) descriptions.set(target, new Set());
      descriptions.get(target).add(block.desc);
    }
  }
  const displayName = (name) => name === "XPSR" ? "xPSR" : name;
  const registers = Array.from(accessors, ([name, items]) => {
    const fieldPrefix = name.replace(/_NS$/, "");
    const cmsisFields = ["APSR", "IPSR", "XPSR", "CONTROL"].includes(fieldPrefix)
      ? buildFields(macros, evaluate, [fieldPrefix === "XPSR" ? "xPSR" : fieldPrefix], "", null, 32)
      : [];
    const fields = [
      ...cmsisFields,
      ...(SPECIAL_FIELDS[name] || SPECIAL_FIELDS[fieldPrefix] || []).map((field) => ({ ...field })),
    ];
    const read = items.some((item) => item.kind === "read");
    const write = items.some((item) => item.kind === "write");
    return {
      name: displayName(name),
      access: read && write ? "RW" : read ? "RO" : "WO",
      width: 4,
      bit_width: 32,
      desc: Array.from(descriptions.get(name) || []).join(" ") || `CMSIS ${displayName(name)} special register access`,
      execution_state: "M-profile",
      encoding: { scheme: "m_profile_special", selector: name },
      accessors: items,
      ...(name.endsWith("_NS") ? { condition: "Accessible from Secure state when the Security Extension is implemented" } : {}),
      source_ref: cmsisFields.length
        ? `CMSIS/Core/Include/${coreFile}#${displayName(fieldPrefix)}_Type; CMSIS/Core/Include/m-profile/cmsis_gcc_m.h`
        : "CMSIS/Core/Include/m-profile/cmsis_gcc_m.h",
      ...(fields.length ? { fields } : {}),
    };
  }).sort((left, right) => left.name.localeCompare(right.name));
  return {
    access: "MRS / MSR special-register interface",
    desc: "M-profile processor status, mask, control, and stack-pointer registers exposed by CMSIS-Core intrinsics",
    registers,
  };
}

async function isFile(path) {
  try { return (await stat(path)).isFile(); } catch { return false; }
}

async function findIncludeRoot(input, coreFile) {
  const path = resolve(input);
  const info = await stat(path);
  if (info.isFile()) {
    if (basename(path) !== coreFile) throw new Error(`输入文件必须是 ${coreFile}`);
    return dirname(path);
  }
  const candidates = [join(path, "CMSIS", "Core", "Include"), join(path, "Core", "Include"), join(path, "Include"), path];
  for (const candidate of candidates) if (await isFile(join(candidate, coreFile))) return candidate;
  throw new Error(`输入目录中没有找到 CMSIS/Core/Include/${coreFile}`);
}

async function detectVersion(includeRoot) {
  try {
    const source = await readFile(join(includeRoot, "cmsis_version.h"), "utf8");
    const main = /__CM_CMSIS_VERSION_MAIN\s+\(\s*(\d+)U?\s*\)/.exec(source)?.[1];
    const sub = /__CM_CMSIS_VERSION_SUB\s+\(\s*(\d+)U?\s*\)/.exec(source)?.[1];
    return main && sub ? `CMSIS-Core ${main}.${sub}` : "CMSIS-Core (version not detected)";
  } catch {
    return "CMSIS-Core (version not detected)";
  }
}

export const cmsisImporterInternals = {
  parseMacros,
  makeMacroEvaluator,
  parseStructs,
  parsePointers,
  buildFields,
};

export async function importArmCmsisRegisters(options) {
  const core = String(options.core || "").toLowerCase().replace(/^cortex-?m/, "cm").replace(/\+$/, "plus");
  const profile = CORE_PROFILES[core];
  if (!profile) throw new Error(`core 必须是以下之一：${Object.keys(CORE_PROFILES).join(", ")}`);
  const includeRoot = await findIncludeRoot(options.input, profile.file);
  const coreSource = await readFile(join(includeRoot, profile.file), "utf8");
  const intrinsicsPath = join(includeRoot, "m-profile", "cmsis_gcc_m.h");
  const intrinsics = await readFile(intrinsicsPath, "utf8");
  const macros = parseMacros(coreSource);
  const evaluate = makeMacroEvaluator(macros);
  const pages = {
    "Special Registers": buildSpecialPage(intrinsics, macros, evaluate, profile, profile.file),
    ...buildMmioPages(coreSource, profile.file, macros, evaluate),
  };
  const version = options.version || await detectVersion(includeRoot);
  return {
    schema_version: 2,
    sensor: `Arm ${profile.name} system registers`,
    vendor: "Arm",
    family: profile.architecture,
    device_type: "architecture_registers",
    register_space: { kind: "arm_system", architecture: profile.architecture, profile: "M" },
    source: {
      title: "Arm CMSIS-Core(M) header definitions",
      version,
      revision: options.revision || profile.name,
      document: `${profile.file}; m-profile/cmsis_gcc_m.h`,
      url: options.url || CMSIS_URL,
      license: "Apache-2.0",
      notice: "Generated derivative; retain the Apache-2.0 license and Arm copyright/attribution notices. Special-register value fields without CMSIS *_Pos/*_Msk macros are normalized from stable Arm M-profile architectural semantics.",
    },
    pages,
  };
}

function parseArgs(argv) {
  const options = { input: "", output: "", core: "", version: "", revision: "", url: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output" || arg === "-o") options.output = argv[++index] || "";
    else if (arg === "--core") options.core = argv[++index] || "";
    else if (arg === "--version") options.version = argv[++index] || "";
    else if (arg === "--revision") options.revision = argv[++index] || "";
    else if (arg === "--url") options.url = argv[++index] || "";
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (!arg.startsWith("-")) options.input ||= arg;
    else throw new Error(`未知参数：${arg}`);
  }
  return options;
}

function usage() {
  return `用法：node tools/import-arm-cmsis.mjs <CMSIS_6目录> --core cm33 --output <registers.yaml> [选项]\n\n选项：\n  --core CORE          cm0/cm0plus/cm1/cm23/cm3/cm33/cm35p/cm4/cm52/cm55/cm7/cm85\n  --version VERSION    覆盖自动检测的 CMSIS-Core 版本\n  --revision REVISION  记录目标内核或数据修订\n  --url URL            覆盖 source URL\n  --help               显示帮助\n\n输入必须包含 CMSIS/Core/Include。生成数据源自 Apache-2.0 的官方 CMSIS-Core 头文件。`;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.input || !options.output || !options.core) {
    console.log(usage());
    process.exit(options.help ? 0 : 2);
  }
  try {
    const data = await importArmCmsisRegisters(options);
    const output = `# Generated from Arm CMSIS-Core headers under Apache-2.0; retain source attribution.\n${stringify(data, { lineWidth: 0, defaultStringType: "QUOTE_DOUBLE", defaultKeyType: "PLAIN", doubleQuotedAsJSON: true })}`;
    await writeFile(resolve(options.output), output, "utf8");
    const count = Object.values(data.pages).reduce((sum, page) => sum + page.registers.length, 0);
    console.log(`wrote ${options.output} (${count} ${data.sensor} registers, ${Object.keys(data.pages).length} groups)`);
  } catch (error) {
    console.error(error.message || String(error));
    process.exit(1);
  }
}
