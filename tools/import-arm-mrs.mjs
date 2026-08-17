import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { DOMParser } from "@xmldom/xmldom";
import * as tar from "tar";
import { stringify } from "yaml";

const DEFAULT_URL = "https://developer.arm.com/-/cdn-downloads/permalink/Exploration-Tools-Arm-Architecture-System-Registers/SysReg/SysReg_xml_A_profile-2026-06_mc.tar.gz";
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

function children(node, name) {
  return Array.from(node?.childNodes || []).filter((child) => child.nodeType === 1 && (!name || child.nodeName === name));
}

function child(node, name) {
  return children(node, name)[0] || null;
}

function descendants(node, name) {
  return Array.from(node?.getElementsByTagName?.(name) || []);
}

function text(node) {
  if (!node) return "";
  let result = "";
  for (const item of Array.from(node.childNodes || [])) {
    if (item.nodeType === 3 || item.nodeType === 4) {
      result += item.data;
    } else if (item.nodeType === 1) {
      const value = text(item);
      result += ["para", "listitem", "br"].includes(item.nodeName) ? `${value}\n` : value;
    }
  }
  return result
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function combine(...values) {
  return values.map((value) => String(value || "").trim()).filter(Boolean).join("；");
}

function parseIntegerToken(value) {
  const token = String(value || "").trim().replace(/^'|'$/g, "");
  if (!/^(?:0[bB][01]+|0[xX][0-9a-fA-F]+|\d+)$/.test(token)) return null;
  try {
    return BigInt(token);
  } catch {
    return null;
  }
}

function yamlInteger(value) {
  const parsed = typeof value === "bigint" ? value : parseIntegerToken(value);
  if (parsed === null) return String(value).trim();
  return parsed <= MAX_SAFE ? Number(parsed) : `0x${parsed.toString(16).toUpperCase()}`;
}

function encodingValue(value) {
  const token = String(value || "").trim();
  const parsed = parseIntegerToken(token);
  if (parsed !== null && parsed <= MAX_SAFE) return Number(parsed);
  return token;
}

function normalizeEncodingKey(name) {
  return String(name || "").trim().toLowerCase().replace(/^cr([nm])$/, "cr$1");
}

function normalizeCondition(...values) {
  return values.map((value) => String(value || "").trim()).filter(Boolean).join("；");
}

function getEncoding(encodingNode) {
  const encoding = { scheme: "" };
  for (const item of children(encodingNode, "enc")) {
    const name = normalizeEncodingKey(item.getAttribute("n"));
    if (!name) continue;
    encoding[name] = encodingValue(item.getAttribute("v"));
  }
  return encoding;
}

function instructionKind(instruction) {
  const mnemonic = String(instruction || "").trim().split(/\s+/, 1)[0].toUpperCase();
  if (["MRS", "MRRS", "MRRC", "MRC", "VMRS", "STC"].some((prefix) => mnemonic.startsWith(prefix))) return "read";
  if (["MSR", "MCR", "MCRR", "VMSR", "LDC"].some((prefix) => mnemonic.startsWith(prefix))) return "write";
  return null;
}

function accessorName(accessor, instruction, fallback) {
  const fromAttribute = String(accessor.getAttribute("accessor") || "").trim().match(/(?:MRS|MSRregister|MRC|MCR|MRRC|MCRR|VMRS|VMSR|LDC|STC)\s+(.+)$/i);
  if (fromAttribute?.[1]) return fromAttribute[1].trim();
  const commaParts = String(instruction || "").split(",").map((part) => part.trim());
  if (/^MRS\b/i.test(instruction)) return commaParts.at(-1) || fallback;
  if (/^MSR\b/i.test(instruction)) return commaParts[0]?.replace(/^MSR\s+/i, "") || fallback;
  return fallback;
}

function parseAccessors(register) {
  const mechanisms = child(register, "access_mechanisms");
  const result = [];
  for (const accessor of children(mechanisms, "access_mechanism")) {
    const encodingNode = child(accessor, "encoding");
    if (!encodingNode) continue;
    const instruction = text(child(encodingNode, "access_instruction"));
    const kind = instructionKind(instruction);
    if (!kind) continue;
    const encoding = getEncoding(encodingNode);
    const condition = text(child(accessor, "access_condition"));
    const name = accessorName(accessor, instruction, text(child(register, "reg_short_name")));
    result.push({
      name,
      kind,
      instruction,
      ...(condition ? { condition } : {}),
      encoding,
    });
  }
  return result;
}

function setEncodingScheme(encoding, state) {
  if (encoding.scheme) return { ...encoding };
  if (state === "AArch64") return { ...encoding, scheme: "aarch64_sysreg" };
  if ("reg" in encoding) return { ...encoding, scheme: "aarch32_vfp" };
  if (["r", "m", "m1", "selector"].some((key) => key in encoding)) return { ...encoding, scheme: "aarch32_special" };
  if ("coproc" in encoding) {
    return { ...encoding, scheme: encoding.coproc === 15 ? "aarch32_cp15" : "aarch32_coproc" };
  }
  return { ...encoding, scheme: "aarch32_special" };
}

function parseRanges(field, offset = 0) {
  const ranges = children(child(field, "field_rangesets"), "field_rangeset").map((range) => [
    Number(text(child(range, "field_msb"))) + offset,
    Number(text(child(range, "field_lsb"))) + offset,
  ]);
  if (!ranges.length) {
    ranges.push([
      Number(text(child(field, "field_msb"))) + offset,
      Number(text(child(field, "field_lsb"))) + offset,
    ]);
  }
  return ranges
    .filter(([hi, lo]) => Number.isInteger(hi) && Number.isInteger(lo) && hi >= lo)
    .map(([hi, lo]) => (hi === lo ? String(hi) : `${hi}:${lo}`))
    .join(",");
}

function parseFieldAccess(field) {
  const access = child(field, "field_access");
  const rules = [];
  for (const state of children(access, "field_access_state")) {
    const accessType = text(child(state, "field_access_type"));
    if (!accessType) continue;
    const level = text(child(state, "field_access_level"));
    rules.push({ access: accessType, ...(level ? { condition: level } : {}) });
  }
  const simple = rules.find((rule) => ["RO", "RW", "WO"].includes(rule.access));
  return {
    ...(simple ? { access: simple.access } : {}),
    ...(rules.length ? { access_rules: rules } : {}),
  };
}

function parseFieldReset(field) {
  const records = [];
  const resetValue = (reset) => {
    const number = text(child(reset, "field_reset_number"));
    if (number) return { value: number, number };
    for (const name of ["field_reset_standard_text", "field_reset_expression", "field_reset_special_text"]) {
      const value = text(child(reset, name));
      if (value) return { value, number: "" };
    }
    const other = child(reset, "field_reset_other_field");
    if (other) {
      const registerNode = child(other, "field_reset_other_field_regname");
      const register = text(registerNode);
      const fieldName = text(child(other, "field_reset_other_field_fieldname"));
      const state = registerNode?.getAttribute("state") || "";
      const reference = `${state ? `${state}:` : ""}${register}${fieldName ? `.${fieldName}` : ""}`;
      return { value: `Other field ${reference}`, number: "" };
    }
    return { value: "", number: "" };
  };
  const visit = (reset, inheritedType = "", inheritedCondition = "", conditional = false) => {
    const resetType = reset.getAttribute("reset_type") || inheritedType;
    const conditions = child(reset, "field_reset_conditions");
    if (conditions) {
      for (const branch of children(conditions, "field_reset_condition")) {
        const branchCondition = branch.getAttribute("condition") || "Otherwise";
        for (const nested of children(branch, "field_reset")) {
          visit(nested, resetType, normalizeCondition(inheritedCondition, branchCondition), true);
        }
      }
      return;
    }
    const parsed = resetValue(reset);
    if (parsed.value) records.push({ ...parsed, resetType, condition: inheritedCondition, conditional });
  };
  for (const reset of children(child(field, "field_resets"), "field_reset")) visit(reset);
  const only = records.length === 1 && !records[0].conditional ? parseIntegerToken(records[0].number) : null;
  return {
    ...(only !== null ? { reset: yamlInteger(only) } : {}),
    ...(records.length ? { reset_info: records.map((record) => combine(record.resetType, record.condition, record.value)).join("；") } : {}),
  };
}

function parseFieldValues(field) {
  const values = child(field, "field_values");
  if (!values) return undefined;
  const items = children(values, "field_value_instance").map((item) => {
    const value = text(child(item, "field_value"));
    const desc = children(item, "field_value_description").map(text).filter(Boolean).join("\n");
    const name = text(child(item, "field_value_instance_name"));
    const condition = text(child(item, "field_value_condition"));
    return {
      value,
      ...(name ? { name } : {}),
      ...(desc ? { desc } : {}),
      ...(condition ? { condition } : {}),
    };
  });
  return items.length ? items : undefined;
}

function reservedMeaning(field, name) {
  const declared = field.getAttribute("reserved_type") || field.getAttribute("rwtype");
  if (declared) return declared;
  return /^(?:RES(?:ERVED)?[01]?|RA[ZO](?:\/WI)?|WI|UNKNOWN|IMPLEMENTATION DEFINED)$/i.test(name) ? name : "";
}

function containerCondition(container, inheritedCondition = "") {
  const condition = text(child(container, "fields_condition"));
  const instance = text(child(container, "fields_instance"));
  const instanceCondition = instance && !condition.toLowerCase().includes(instance.toLowerCase())
    ? `Layout: ${instance}`
    : "";
  return normalizeCondition(inheritedCondition, condition, instanceCondition);
}

function parseField(field, inheritedCondition = "", offset = 0) {
  const name = text(child(field, "field_name")) || field.getAttribute("reserved_type") || field.getAttribute("rwtype") || "RESERVED";
  const descriptions = [
    text(child(field, "field_shortdesc")),
    ...children(field, "field_description").map(text),
    text(child(field, "parent_description")),
  ].filter(Boolean);
  const condition = normalizeCondition(inheritedCondition, text(child(field, "fields_condition")));
  const access = parseFieldAccess(field);
  const reset = parseFieldReset(field);
  const values = parseFieldValues(field);
  const reserved = reservedMeaning(field, name);
  return {
    name,
    bits: parseRanges(field, offset),
    desc: descriptions.join("\n") || "ARM architectural field",
    ...(condition ? { condition } : {}),
    ...(reserved ? { reserved } : {}),
    ...(field.getAttribute("is_variable_length") === "True" ? { variable_length: true } : {}),
    ...access,
    ...reset,
    ...(values ? { values } : {}),
  };
}

function collectFields(register) {
  const fieldsets = child(register, "reg_fieldsets");
  const fields = [];
  const collectContainer = (container, inheritedCondition = "", offset = 0) => {
    if (!container) return;
    const condition = containerCondition(container, inheritedCondition);
    for (const field of children(container, "field")) {
      if (field.getAttribute("is_expansion") === "True") continue;
      const partials = children(field, "partial_fieldset");
      if (!partials.length) {
        fields.push(parseField(field, condition, offset));
        continue;
      }
      const parentCondition = normalizeCondition(condition, text(child(field, "fields_condition")));
      const parentRanges = parseRanges(field, offset).split(",").map((range) => {
        const [hi, lo = hi] = range.split(":").map(Number);
        return { hi, lo };
      });
      const parentOffset = Math.min(...parentRanges.map((range) => range.lo));
      for (const partial of partials) {
        for (const nested of children(partial, "fields")) collectContainer(nested, parentCondition, parentOffset);
      }
    }
    for (const nested of children(container, "fields")) collectContainer(nested, condition, offset);
    for (const partial of children(container, "partial_fieldset")) {
      for (const nested of children(partial, "fields")) collectContainer(nested, condition, offset);
    }
  };
  for (const shared of children(fieldsets, "shared_fields")) collectContainer(shared);
  for (const group of children(fieldsets, "fields")) collectContainer(group);
  return fields;
}

function parseVariables(register) {
  const variables = child(register, "reg_variables");
  return children(variables, "reg_variable").map((item) => ({
    name: item.getAttribute("variable"),
    ...(item.getAttribute("min") ? { min: Number(item.getAttribute("min")) } : {}),
    ...(item.getAttribute("max") ? { max: Number(item.getAttribute("max")) } : {}),
    ...(children(item, "reg_variable_val").length
      ? { values: children(item, "reg_variable_val").map((value) => text(value)) }
      : {}),
  }));
}

function parseRegister(register, fileName, state) {
  const name = text(child(register, "reg_short_name"));
  let accessors = parseAccessors(register);
  if (!accessors.length && state === "AArch64") {
    const accessText = children(child(register, "access_mechanisms"), "access_permission_text").map(text).filter(Boolean).join(" ");
    const encoding = { scheme: "aarch64_special", selector: name };
    accessors = [{
      name,
      kind: "implicit",
      instruction: `Implicit architectural access to ${name}`,
      ...(accessText ? { condition: accessText } : {}),
      encoding,
    }];
  } else if (!accessors.length && state === "AArch32") {
    const accessText = children(child(register, "access_mechanisms"), "access_permission_text").map(text).filter(Boolean).join(" ");
    const encoding = { scheme: "aarch32_special", selector: name };
    if (/\b(?:read|MRS)\b/i.test(accessText)) {
      accessors.push({ name, kind: "read", instruction: `MRS <Rd>, ${name}`, encoding });
    }
    if (/\b(?:write|written|MSR)\b/i.test(accessText)) {
      accessors.push({ name, kind: "write", instruction: `MSR ${name}, <Rn>`, encoding });
    }
    if (!accessors.length) {
      accessors.push({ name, kind: "implicit", instruction: `Implicit architectural access to ${name}`, encoding });
    }
  }
  const canonical = accessors.find((item) => item.name === name) || accessors[0];
  if (!canonical) return null;
  const fieldsNodes = descendants(child(register, "reg_fieldsets"), "fields");
  const lengths = fieldsNodes.map((item) => Number(item.getAttribute("length"))).filter((value) => Number.isInteger(value) && value > 0);
  const length = lengths.length ? Math.max(...lengths) : (state === "AArch64" ? 64 : 32);
  const groups = children(child(register, "reg_groups"), "reg_group").map(text).filter(Boolean);
  const aliases = children(child(register, "reg_mappings"), "reg_mapping")
    .map((item) => text(child(item, "mapped_name")))
    .filter(Boolean);
  const read = accessors.some((item) => item.kind === "read");
  const write = accessors.some((item) => item.kind === "write");
  const overallAccess = read && write ? "RW" : read ? "RO" : write ? "WO" : "RW";
  const condition = text(child(register, "reg_condition"));
  const description = text(child(child(register, "reg_purpose"), "purpose_text")) || text(child(register, "reg_long_name")) || "ARM architectural system register";
  const variables = parseVariables(register);
  const fields = collectFields(register);
  return {
    name,
    access: overallAccess,
    width: Math.ceil(length / 8),
    bit_width: length,
    desc: description,
    execution_state: state,
    encoding: setEncodingScheme(canonical.encoding, state),
    accessors: accessors.map((item) => ({ ...item, encoding: setEncodingScheme(item.encoding, state) })),
    ...(condition ? { condition } : {}),
    ...(groups.length ? { groups } : {}),
    ...(aliases.length ? { aliases } : {}),
    ...(variables.length ? { variables } : {}),
    source_ref: fileName,
    ...(fields.length ? { fields } : {}),
  };
}

function parseXml(fileName, state) {
  const source = readFile(fileName, "utf8");
  return source.then((xml) => {
    let parseError = "";
    const document = new DOMParser({ onError: (level, message) => { if (level !== "warning") parseError = message; } }).parseFromString(xml, "application/xml");
    if (parseError) throw new Error(`${basename(fileName)}: XML 解析失败：${parseError}`);
    const register = child(child(document.documentElement, "registers"), "register");
    if (!register || register.getAttribute("is_register") !== "True" || register.getAttribute("execution_state") !== state || register.getAttribute("is_internal") !== "True") return null;
    return parseRegister(register, basename(fileName), state);
  });
}

async function walk(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fileName = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(fileName));
    else result.push(fileName);
  }
  return result;
}

async function findPackageRoot(directory) {
  const files = await walk(directory);
  const notice = files.find((fileName) => basename(fileName) === "notice.xml");
  if (!notice) throw new Error("输入目录中没有 notice.xml，未找到 ARM system-register XML 包");
  return dirname(notice);
}

async function resolveInput(input) {
  const inputPath = resolve(input);
  const info = await stat(inputPath);
  if (info.isDirectory()) return { root: await findPackageRoot(inputPath), cleanup: null };
  if (!/\.(?:tar\.gz|tgz)$/i.test(inputPath)) throw new Error("输入必须是 ARM XML 包目录或 .tar.gz/.tgz 文件");
  const temp = await mkdtemp(join(tmpdir(), "arm-mrs-"));
  await tar.x({ file: inputPath, cwd: temp, strict: true });
  return { root: await findPackageRoot(temp), cleanup: temp };
}

function parseArgs(argv) {
  const args = { input: "", output: "", state: "AArch64", version: "2026-06", revision: "M.c", document: "Arm Architecture Reference Manual, A-profile system-register XML", url: DEFAULT_URL, notice: "LES-PRE-20349", register: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output" || arg === "-o") args.output = argv[++index] || "";
    else if (arg === "--state") args.state = argv[++index] || args.state;
    else if (arg === "--version") args.version = argv[++index] || args.version;
    else if (arg === "--revision") args.revision = argv[++index] || args.revision;
    else if (arg === "--document") args.document = argv[++index] || args.document;
    else if (arg === "--url") args.url = argv[++index] || args.url;
    else if (arg === "--notice") args.notice = argv[++index] || args.notice;
    else if (arg === "--register") args.register.push(argv[++index] || "");
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (!arg.startsWith("-")) args.input ||= arg;
    else throw new Error(`未知参数：${arg}`);
  }
  return args;
}

export async function importArmSystemRegisters(options) {
  const state = options.state || "AArch64";
  if (!["AArch64", "AArch32"].includes(state)) throw new Error("state 必须是 AArch64 或 AArch32");
  const { root, cleanup } = await resolveInput(options.input);
  try {
    const fileNames = (await walk(root)).filter((fileName) => /\.xml$/i.test(fileName) && !/notice\.xml$/i.test(fileName)).sort();
    const registers = (await Promise.all(fileNames.map((fileName) => parseXml(fileName, state)))).filter(Boolean);
    const filters = options.register || [];
    const selected = filters.length ? registers.filter((register) => filters.some((filter) => register.name === filter || register.name.includes(filter))) : registers;
    const pageMap = new Map();
    for (const register of selected) {
      const group = register.groups?.[0] || "Other";
      if (!pageMap.has(group)) pageMap.set(group, []);
      pageMap.get(group).push(register);
    }
    const pages = Object.fromEntries(Array.from(pageMap.entries()).sort(([left], [right]) => left.localeCompare(right)).map(([group, items]) => [
      group,
      { access: "MRS / MSR system-register interface", desc: `Arm ${state} architectural system registers: ${group}`, registers: items.sort((left, right) => left.name.localeCompare(right.name)) },
    ]));
    return {
      schema_version: 2,
      sensor: `ARM ${state} system registers`,
      vendor: "Arm",
      family: "A-profile architecture",
      device_type: "architecture_registers",
      register_space: { kind: "arm_system", architecture: state, profile: "A" },
      source: { title: options.title || "Arm Architecture System Registers XML", version: options.version, revision: options.revision, document: options.document, url: options.url, license: "Arm proprietary; review notice.xml before use", notice: options.notice },
      pages,
    };
  } finally {
    if (cleanup) await rm(cleanup, { recursive: true, force: true });
  }
}

function usage() {
  return `用法：node tools/import-arm-mrs.mjs <ARM_XML_DIR|ARM_XML.tar.gz> --output <registers.yaml> [选项]\n\n选项：\n  --state AArch64|AArch32  默认 AArch64\n  --register NAME          只导入指定寄存器，可重复\n  --version VERSION        数据包版本，默认 2026-06\n  --revision REVISION      ARM ARM revision，默认 M.c\n  --help                   显示帮助\n\n导入器不会把 ARM 原始 XML 或生成的完整数据提交到项目；请确认 Arm notice.xml 允许你的使用方式。`;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.input || !options.output) {
    console.log(usage());
    process.exit(options.help ? 0 : 2);
  }
  try {
    const data = await importArmSystemRegisters(options);
    if (!Object.keys(data.pages).length) throw new Error("没有找到符合条件的 ARM 系统寄存器");
    const output = `# Generated locally from the Arm XML package; review the package notice before redistribution.\n${stringify(data, { lineWidth: 0, defaultStringType: "QUOTE_DOUBLE", defaultKeyType: "PLAIN", doubleQuotedAsJSON: true })}`;
    await writeFile(resolve(options.output), output, "utf8");
    const count = Object.values(data.pages).reduce((sum, page) => sum + page.registers.length, 0);
    console.log(`wrote ${options.output} (${count} ${options.state} system registers, ${Object.keys(data.pages).length} groups)`);
  } catch (error) {
    console.error(error.message || String(error));
    process.exit(1);
  }
}
