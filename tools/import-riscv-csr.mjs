import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { parse, stringify } from "yaml";

const DEFAULT_SOURCE_URL = "https://github.com/riscv-software-src/riscv-unified-db";
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const GENERATED_HEADER = `# Generated from RISC-V Unified Database CSR YAML under BSD-3-Clause-Clear.
# Retain the source attribution and license notices recorded below.
`;

function compactText(value) {
  return String(value ?? "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanCode(value) {
  return String(value ?? "")
    .replace(/\/\/.*$/gm, "")
    .replace(/#[^\n]*$/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatSpecText(value) {
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === "string") return compactText(item);
      if (!item || typeof item !== "object") return compactText(item);
      const text = compactText(item.text);
      const condition = cleanCode(item["when()"]);
      return condition ? `When ${condition}:\n${text}` : text;
    }).filter(Boolean).join("\n\n");
  }
  return compactText(value);
}

function parseInteger(value) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isInteger(value)) return BigInt(value);
  const text = String(value ?? "").trim();
  if (!/^(?:0[bB][01]+|0[xX][0-9a-fA-F]+|\d+)$/.test(text)) return null;
  try {
    return BigInt(text);
  } catch {
    return null;
  }
}

function yamlInteger(value) {
  const number = parseInteger(value);
  if (number === null) return String(value).trim();
  return number <= MAX_SAFE ? Number(number) : `0x${number.toString(16).toUpperCase()}`;
}

function parseRange(value) {
  const text = String(value ?? "").trim().replace(/:/g, "-");
  const match = text.match(/^(\d+)(?:-(\d+))?$/);
  if (!match) return null;
  const hi = Number(match[1]);
  const lo = Number(match[2] ?? match[1]);
  return hi >= lo ? { hi, lo } : null;
}

function rangeText(range) {
  return range.hi === range.lo ? String(range.hi) : `${range.hi}:${range.lo}`;
}

function conditionScalar(value) {
  if (Array.isArray(value)) return `[${value.map(conditionScalar).join(", ")}]`;
  if (typeof value === "string") return JSON.stringify(value);
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function namedRequirementText(value) {
  if (!value || typeof value !== "object") return compactText(value);
  if (value.name) {
    const subject = `${value.name}${value.index !== undefined ? `[${value.index}]` : ""}`;
    const operators = [
      ["equal", "=="],
      ["notEqual", "!="],
      ["greaterThan", ">"],
      ["lessThan", "<"],
      ["greaterThanOrEqual", ">="],
      ["lessThanOrEqual", "<="],
      ["includes", "includes"],
      ["oneOf", "one of"],
    ];
    const rule = operators.find(([key]) => value[key] !== undefined);
    if (rule) return `${subject} ${rule[1]} ${conditionScalar(value[rule[0]])}`;
    if (value.size !== undefined) return `${subject}.size == ${conditionScalar(value.size)}`;
    return `${subject}${value.version ? ` ${conditionScalar(value.version)}` : ""}`;
  }
  return conditionText(value);
}

function conditionText(value) {
  if (!value || typeof value !== "object") return compactText(value);
  if (value.xlen !== undefined) return `XLEN=${conditionScalar(value.xlen)}`;
  if (value.extension !== undefined) return namedRequirementText(value.extension);
  if (value.param !== undefined) return namedRequirementText(value.param);
  if (value["idl()"] !== undefined) return `IDL: ${cleanCode(value["idl()"])}`;
  for (const [key, label] of [["allOf", "all of"], ["anyOf", "any of"], ["oneOf", "one of"], ["noneOf", "none of"]]) {
    if (Array.isArray(value[key])) {
      return `${label}: ${value[key].map(conditionText).filter(Boolean).join(", ")}`;
    }
  }
  if (value.not !== undefined) return `not: ${conditionText(value.not)}`;
  if (value.if !== undefined && value.then !== undefined) {
    return `if ${conditionText(value.if)}, then ${conditionText(value.then)}`;
  }
  if (value.name) return namedRequirementText(value);
  return Object.entries(value).map(([key, item]) => `${key}: ${conditionText(item)}`).join("; ");
}

function supportsXlen(value, xlen) {
  if (!value || typeof value !== "object") return true;
  if (value.xlen !== undefined) {
    if (Array.isArray(value.xlen)) return value.xlen.map(Number).includes(xlen);
    return Number(value.xlen) === xlen;
  }
  if (Array.isArray(value.allOf)) {
    return value.allOf.every((item) => supportsXlen(item, xlen));
  }
  for (const key of ["anyOf", "oneOf"]) {
    if (Array.isArray(value[key])) {
      const xlenParts = value[key].filter((item) => item && typeof item === "object" && item.xlen !== undefined);
      if (xlenParts.length === value[key].length) return xlenParts.some((item) => supportsXlen(item, xlen));
    }
  }
  return true;
}

function collectExtensionRequirements(value, output) {
  if (!value || typeof value !== "object") return;
  if (value.name) output.push(String(value.name));
  for (const key of ["allOf", "anyOf", "oneOf", "noneOf"]) {
    if (Array.isArray(value[key])) value[key].forEach((item) => collectExtensionRequirements(item, output));
  }
  if (value.not) collectExtensionRequirements(value.not, output);
  if (value.then) collectExtensionRequirements(value.then, output);
}

function extensionNames(value, output = []) {
  if (!value || typeof value !== "object") return output;
  if (value.extension) collectExtensionRequirements(value.extension, output);
  for (const key of ["allOf", "anyOf", "oneOf", "noneOf"]) {
    if (Array.isArray(value[key])) value[key].forEach((item) => extensionNames(item, output));
  }
  if (value.not) extensionNames(value.not, output);
  if (value.if) extensionNames(value.if, output);
  if (value.then) extensionNames(value.then, output);
  return [...new Set(output)];
}

function resolveLength(length, xlen) {
  if (["MXLEN", "SXLEN", "VSXLEN", "XLEN"].includes(String(length))) return xlen;
  const parsed = parseInteger(length);
  return parsed === null ? xlen : Number(parsed);
}

function fieldAccess(field) {
  const normalizeType = (value) => ({
    RO: "RO",
    ROH: "RO-H",
    RW: "RW",
    RWR: "RW-R",
    RWH: "RW-H",
    RWRH: "RW-RH",
    WO: "WO",
  })[String(value)] || String(value).replace(/_/g, "-");
  const staticTypes = field.type ? [normalizeType(field.type)] : [];
  const dynamicTypes = [...String(field["type()"] ?? "").matchAll(/CsrFieldType::([A-Z]+)/g)]
    .map((match) => normalizeType(match[1]));
  const types = [...new Set([...staticTypes, ...dynamicTypes])];
  const access = types.length ? types.join("/") : undefined;
  if (!field["type()"] || !access) return access ? { access } : {};
  return {
    ...(access ? { access } : {}),
    access_rules: [{
      access: access || "dynamic",
      condition: `Unified DB type() expression: ${cleanCode(field["type()"])}`,
    }],
  };
}

function fieldReset(field) {
  if (field.reset_value !== undefined) {
    const value = parseInteger(field.reset_value);
    if (value !== null) return { reset: yamlInteger(value) };
    return { reset_info: `Unified DB reset_value: ${compactText(field.reset_value)}` };
  }
  if (field["reset_value()"] !== undefined) {
    const source = String(field["reset_value()"]).trim();
    const match = source.match(/^return\s+((?:0[bB][01]+|0[xX][0-9a-fA-F]+|\d+))\s*;$/);
    if (match) return { reset: yamlInteger(match[1]) };
    return { reset_info: `Unified DB reset_value() expression: ${cleanCode(source)}` };
  }
  return {};
}

function resolveFieldRanges(field, xlen, bitWidth) {
  const source = xlen === 32 && field.location_rv32 !== undefined
    ? field.location_rv32
    : xlen === 64 && field.location_rv64 !== undefined
      ? field.location_rv64
      : field.location;
  const parsed = String(source ?? "").split(",").map(parseRange).filter(Boolean);
  const clipped = [];
  for (const range of parsed) {
    if (range.lo >= bitWidth) continue;
    clipped.push({ hi: Math.min(range.hi, bitWidth - 1), lo: range.lo });
  }
  return clipped;
}

function fieldDescription(field, ranges) {
  const parts = [];
  if (field.long_name) parts.push(String(field.long_name));
  if (field.description) parts.push(formatSpecText(field.description));
  if (field.alias) {
    const aliases = Array.isArray(field.alias) ? field.alias.join(", ") : String(field.alias);
    parts.push(`Aliases: ${aliases}`);
  }
  if (field.affectedBy) {
    const affected = Array.isArray(field.affectedBy) ? field.affectedBy.join(", ") : String(field.affectedBy);
    parts.push(`Affected by: ${affected}`);
  }
  if (!parts.length) parts.push(`RISC-V CSR field ${ranges.map(rangeText).join(",")}`);
  return parts.join("\n\n");
}

function fieldActionHint(field) {
  const parts = [];
  if (field.affectedBy) {
    const affected = Array.isArray(field.affectedBy) ? field.affectedBy.join(", ") : String(field.affectedBy);
    parts.push(`Affected by ${affected}`);
  }
  if (field["sw_write(csr_value)"]) {
    parts.push(`Unified DB sw_write(csr_value) expression: ${cleanCode(field["sw_write(csr_value)"])}`);
  }
  return parts.join("\n\n");
}

function parseFieldValues(field) {
  // Unified DB keeps many enum tables inside AsciiDoc descriptions. Preserve those
  // tables in the description rather than inventing enum entries from prose.
  return undefined;
}

function classifyPage(register, relativePath) {
  const name = String(register.name || "").toLowerCase();
  const path = relativePath.toLowerCase();
  const extensions = extensionNames(register.definedBy).map((item) => item.toLowerCase());
  if (register.priv_mode === "D" || ["dcsr", "dpc", "dscratch0", "dscratch1", "tselect", "tdata1", "tdata2", "tdata3"].includes(name) || extensions.some((item) => item.startsWith("sd"))) return "Debug and Triggers";
  if (/pmp/.test(name) || path.includes("pmp")) return "Physical Memory Protection";
  if (/^(?:m|s|h|v?)(?:cycle|time|instret|hpmcounter|hpmevent|counter|countinhibit)/.test(name) || /counter|zihpm|zicntr/.test(path)) return "Counters and Timers";
  if (path.includes("/f/") || path.includes("/v/") || /^(?:fcsr|fflags|frm|v[a-z])/.test(name)) return "Floating Point and Vector";
  if (path.includes("csrind") || /(?:select|ireg)/.test(name)) return "Indirect CSR Access";
  if (register.priv_mode === "VS" || name.startsWith("vs")) return "Virtual Supervisor";
  if (path.includes("/h/") || extensions.includes("h") || name.startsWith("h")) return "Hypervisor";
  if (register.priv_mode === "U") return "User and Unprivileged";
  if (register.priv_mode === "S") return "Supervisor";
  if (register.priv_mode === "M") return "Machine";
  return "Other Architectural CSRs";
}

function pageDescription(pageName, xlen) {
  return `RISC-V ${xlen}-bit architectural CSR definitions: ${pageName}. CSR addresses use the standard CSR encoding space, not MMIO addresses.`;
}

function makeAccessor(name, address, writable, kind) {
  if (kind === "write" && !writable) return null;
  const instruction = kind === "read"
    ? `CSRRS rd, ${name}, x0`
    : `CSRRW x0, ${name}, rs1`;
  return {
    name,
    kind,
    instruction,
    encoding: { scheme: "riscv_csr", address },
  };
}

function makeRegister(source, relativePath, xlen) {
  if (!source || source.kind !== "csr" || !source.name || !Number.isInteger(Number(source.address))) return null;
  if (!supportsXlen(source.definedBy, xlen)) return null;
  const rawLength = resolveLength(source.length, xlen);
  const bitWidth = Math.min(rawLength, xlen === 32 && rawLength > 32 ? 32 : rawLength);
  const fields = [];
  for (const [name, field] of Object.entries(source.fields || {})) {
    if (!supportsXlen(field.definedBy, xlen)) continue;
    const ranges = resolveFieldRanges(field, xlen, bitWidth);
    if (!ranges.length) continue;
    const fieldValue = {
      name,
      bits: ranges.map(rangeText).join(","),
      desc: fieldDescription(field, ranges),
      ...fieldAccess(field),
      ...fieldReset(field),
      ...(field.definedBy ? { condition: conditionText(field.definedBy) } : {}),
      ...(fieldActionHint(field) ? { action_hint: fieldActionHint(field) } : {}),
    };
    const reserved = /^(?:RES|reserved|unused|zero)/i.test(name);
    if (reserved) fieldValue.reserved = name;
    const values = parseFieldValues(field);
    if (values) fieldValue.values = values;
    fields.push(fieldValue);
  }
  const writable = source.writable !== false;
  const address = Number(source.address);
  const accessors = [makeAccessor(source.name, address, writable, "read"), makeAccessor(source.name, address, writable, "write")].filter(Boolean);
  const page = classifyPage(source, relativePath);
  const extensionList = extensionNames(source.definedBy);
  const registerDescription = [source.long_name, source.description ? formatSpecText(source.description) : "", source.virtual_address ? `Virtual address: ${source.virtual_address}` : ""].filter(Boolean).join("\n\n") || `RISC-V CSR ${source.name}`;
  return {
    name: source.name,
    access: writable ? "RW" : "RO",
    width: Math.ceil(bitWidth / 8),
    bit_width: bitWidth,
    desc: registerDescription,
    execution_state: `RV${xlen}`,
    encoding: { scheme: "riscv_csr", address },
    accessors,
    ...(conditionText(source.definedBy) ? { condition: conditionText(source.definedBy) } : {}),
    groups: [page, ...extensionList],
    source_ref: relativePath,
    ...(fields.length ? { fields } : {}),
    _page: page,
    _address: address,
  };
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.name.endsWith(".yaml")) files.push(path);
  }
  return files.sort();
}

function parseArgs(argv) {
  const args = {
    input: "",
    output: "",
    xlen: 64,
    version: "2026-08-18",
    revision: "22776b219c386d549e07b14ed0e781ae7956e11a",
    url: DEFAULT_SOURCE_URL,
    license: "BSD-3-Clause-Clear",
    notice: "Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries; Copyright (c) Katherine Hsu; Copyright (c) Muhammad Abdullah - 10xEngineers; Copyright (c) Salil Mittal; Copyright (c) Syed Owais Ali Shah. BSD-3-Clause-Clear.",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output" || arg === "-o") args.output = argv[++index] || "";
    else if (arg === "--xlen") args.xlen = Number(argv[++index] || args.xlen);
    else if (arg === "--version") args.version = argv[++index] || args.version;
    else if (arg === "--revision") args.revision = argv[++index] || args.revision;
    else if (arg === "--url") args.url = argv[++index] || args.url;
    else if (arg === "--license") args.license = argv[++index] || args.license;
    else if (arg === "--notice") args.notice = argv[++index] || args.notice;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (!arg.startsWith("-")) args.input ||= arg;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (![32, 64].includes(args.xlen)) throw new Error("--xlen must be 32 or 64");
  return args;
}

export async function importRiscvCsrDatabase(options) {
  const inputRoot = resolve(options.input);
  const inputInfo = await stat(inputRoot);
  if (!inputInfo.isDirectory()) throw new Error("RISC-V Unified DB input must be a directory");
  const csrRoot = join(inputRoot, "spec", "std", "isa", "csr");
  const files = await walk(csrRoot);
  const pages = new Map();
  for (const file of files) {
    const relativePath = relative(inputRoot, file).split("\\").join("/");
    const source = parse(await readFile(file, "utf8"));
    const register = makeRegister(source, relativePath, options.xlen);
    if (!register) continue;
    const page = register._page;
    if (!pages.has(page)) pages.set(page, []);
    const { _page, _address, ...publicRegister } = register;
    pages.get(page).push(publicRegister);
  }
  const pageOrder = [
    "User and Unprivileged",
    "Floating Point and Vector",
    "Supervisor",
    "Virtual Supervisor",
    "Hypervisor",
    "Machine",
    "Counters and Timers",
    "Physical Memory Protection",
    "Indirect CSR Access",
    "Debug and Triggers",
    "Other Architectural CSRs",
  ];
  const orderedPages = {};
  for (const pageName of [...pages.keys()].sort((left, right) => (pageOrder.indexOf(left) - pageOrder.indexOf(right)) || left.localeCompare(right))) {
    const registers = pages.get(pageName).sort((left, right) => Number(left.encoding.address) - Number(right.encoding.address) || left.name.localeCompare(right.name));
    orderedPages[pageName] = {
      access: "CSR instruction encoding space",
      desc: pageDescription(pageName, options.xlen),
      registers,
    };
  }
  return {
    schema_version: 2,
    sensor: `RISC-V RV${options.xlen} architectural CSRs`,
    vendor: "RISC-V International",
    family: "RISC-V Privileged ISA",
    device_type: "architecture_registers",
    register_space: {
      kind: "riscv_system",
      architecture: `RV${options.xlen}`,
      profile: "privileged",
    },
    source: {
      title: "RISC-V Unified Database standard CSR definitions",
      version: options.version,
      revision: options.revision,
      document: "RISC-V Unified Database, spec/std/isa/csr",
      url: options.url,
      license: options.license,
      notice: options.notice,
    },
    pages: orderedPages,
  };
}

function usage() {
  return `Usage: node tools/import-riscv-csr.mjs <riscv-unified-db-directory> --xlen 32|64 --output <registers.yaml> [options]\n\nOptions:\n  --xlen XLEN          Generate RV32 or RV64 data\n  --output FILE        Output YAML path\n  --version VERSION    Source snapshot or release version\n  --revision REVISION  Source commit or revision\n  --url URL            Source repository URL\n  --license TEXT       Source license notice\n  --notice TEXT        Copyright/REUSE attribution\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help || !options.input || !options.output) {
      console.log(usage());
      process.exit(options.help ? 0 : 2);
    }
    const data = await importRiscvCsrDatabase(options);
    const text = stringify(data, {
      lineWidth: 0,
      defaultStringType: "QUOTE_DOUBLE",
      defaultKeyType: "PLAIN",
      doubleQuotedAsJSON: true,
    });
    await writeFile(resolve(options.output), GENERATED_HEADER + text, "utf8");
    const registers = Object.values(data.pages).reduce((sum, page) => sum + page.registers.length, 0);
    const fields = Object.values(data.pages).reduce((sum, page) => sum + page.registers.reduce((subtotal, register) => subtotal + (register.fields?.length || 0), 0), 0);
    console.log(`Generated ${options.output}: ${Object.keys(data.pages).length} pages, ${registers} registers, ${fields} fields (RV${options.xlen})`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
