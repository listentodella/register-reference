import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import vm from "node:vm";
import { stringify } from "yaml";
import { importRiscvCsrDatabase } from "./import-riscv-csr.mjs";

const root = resolve(import.meta.dirname, "..");
const temp = await mkdtemp(join(tmpdir(), "riscv-csr-import-test-"));
const csrRoot = join(temp, "spec", "std", "isa", "csr");

const mstatus = `kind: csr
name: mstatus
long_name: Machine Status
address: 0x300
writable: true
priv_mode: M
length: MXLEN
description: "Synthetic machine status register."
definedBy:
  extension:
    name: Sm
fields:
  SD:
    location_rv32: 31
    location_rv64: 63
    type(): |
      if (FEATURE) { return CsrFieldType::RO; }
      return CsrFieldType::RW;
    reset_value(): |
      return FEATURE ? 1 : UNDEFINED_LEGAL;
    description: "State dirty summary."
  MODE:
    location: 3-2
    type: RW-R
    reset_value: 0
    definedBy:
      extension:
        name: S
    description: "Synthetic mode."
    sw_write(csr_value): |
      return csr_value.MODE <= 2 ? csr_value.MODE : CSR[mstatus].MODE;
  PARAM:
    location: 5
    type: RW-H
    reset_value: UNDEFINED_LEGAL
    definedBy:
      param:
        name: TEST_PARAM_ENABLED
        equal: true
    description:
      - text: "Always-visible parameterized text."
      - text: "Conditional parameterized text."
        when(): |
          return TEST_PARAM_ENABLED;
`;

const mcycle = `kind: csr
name: mcycle
long_name: Machine Cycle Counter
address: 0xB00
writable: true
priv_mode: M
length: 64
description: "64-bit counter with an RV32 high-half alias."
definedBy:
  extension:
    name: Sm
fields:
  COUNT:
    location: 63-0
    type: RW-RH
    reset_value: UNDEFINED_LEGAL
    alias: cycle.COUNT
    description: "Cycle count."
`;

const mcycleh = `kind: csr
name: mcycleh
long_name: Machine Cycle Counter High Half
address: 0xB80
writable: true
priv_mode: M
length: 32
description: "RV32 high-half alias."
definedBy:
  allOf:
    - xlen: 32
    - extension:
        name: Sm
fields:
  COUNT:
    location: 31-0
    type: RW
    reset_value(): |
      return 0;
    description: "Upper half."
`;

const satp = `kind: csr
name: satp
long_name: Supervisor Address Translation and Protection
address: 0x180
writable: true
priv_mode: S
length: SXLEN
description: "Synthetic address translation register."
definedBy:
  extension:
    name: S
fields:
  MODE:
    location_rv32: 31
    location_rv64: 63-60
    type: RW-R
    reset_value: 0
    description: "Translation mode."
`;

try {
  await mkdir(csrRoot, { recursive: true });
  await writeFile(join(csrRoot, "mstatus.yaml"), mstatus);
  await writeFile(join(csrRoot, "mcycle.yaml"), mcycle);
  await writeFile(join(csrRoot, "mcycleh.yaml"), mcycleh);
  await writeFile(join(csrRoot, "satp.yaml"), satp);

  const common = {
    input: temp,
    version: "test",
    revision: "test-revision",
    url: "https://example.invalid/riscv-unified-db",
    license: "BSD-3-Clause-Clear",
    notice: "Synthetic test fixture",
  };
  const rv32 = await importRiscvCsrDatabase({ ...common, xlen: 32 });
  const rv64 = await importRiscvCsrDatabase({ ...common, xlen: 64 });
  assert.equal(rv32.register_space.kind, "riscv_system");
  assert.equal(rv32.register_space.architecture, "RV32");
  assert.equal(rv64.register_space.architecture, "RV64");

  const rv32Registers = Object.values(rv32.pages).flatMap((page) => page.registers);
  const rv64Registers = Object.values(rv64.pages).flatMap((page) => page.registers);
  const rv32ByName = Object.fromEntries(rv32Registers.map((register) => [register.name, register]));
  const rv64ByName = Object.fromEntries(rv64Registers.map((register) => [register.name, register]));
  assert.equal(rv32ByName.mstatus.bit_width, 32);
  assert.equal(rv64ByName.mstatus.bit_width, 64);
  assert.equal(rv32ByName.mstatus.fields[0].bits, "31");
  assert.equal(rv64ByName.mstatus.fields[0].bits, "63");
  assert.equal(rv32ByName.mstatus.fields[0].access, "RO/RW");
  assert.match(rv32ByName.mstatus.fields[0].access_rules[0].condition, /Unified DB type\(\) expression/);
  assert.match(rv32ByName.mstatus.fields[0].reset_info, /UNDEFINED_LEGAL/);
  assert.equal(rv32ByName.mstatus.fields[1].condition, "S");
  assert.equal(rv32ByName.mstatus.fields[1].access, "RW-R");
  assert.match(rv32ByName.mstatus.fields[1].action_hint, /sw_write\(csr_value\).*csr_value\.MODE/);
  assert.equal(rv32ByName.mstatus.fields[2].access, "RW-H");
  assert.equal(rv32ByName.mstatus.fields[2].condition, "TEST_PARAM_ENABLED == true");
  assert.match(rv32ByName.mstatus.fields[2].desc, /Always-visible parameterized text/);
  assert.match(rv32ByName.mstatus.fields[2].desc, /When return TEST_PARAM_ENABLED;:/);
  assert.doesNotMatch(rv32ByName.mstatus.fields[2].desc, /\[object Object\]/);
  assert.equal(rv32ByName.mcycle.bit_width, 32);
  assert.equal(rv32ByName.mcycle.fields[0].bits, "31:0");
  assert.equal(rv64ByName.mcycle.bit_width, 64);
  assert.equal(rv64ByName.mcycle.fields[0].bits, "63:0");
  assert.equal(rv32ByName.mcycleh.fields[0].reset, 0);
  assert.equal(rv64ByName.mcycleh, undefined);
  assert.equal(rv32ByName.satp.fields[0].bits, "31");
  assert.equal(rv64ByName.satp.fields[0].bits, "63:60");
  assert.deepEqual(rv32ByName.mstatus.encoding, { scheme: "riscv_csr", address: 0x300 });
  assert.deepEqual(rv32ByName.mstatus.accessors.map((item) => item.kind), ["read", "write"]);

  const yamlText = stringify(rv32, {
    lineWidth: 0,
    defaultStringType: "QUOTE_DOUBLE",
    defaultKeyType: "PLAIN",
    doubleQuotedAsJSON: true,
  });
  const context = { console };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(await readFile(join(root, "yaml-lite.js"), "utf8"), context);
  vm.runInContext(await readFile(join(root, "yaml-validator.js"), "utf8"), context);
  const parsed = context.parseRegisterYaml(yamlText);
  const report = context.validateRegisterYaml(yamlText, parsed);
  assert.equal(report.errors.length, 0, report.errors.join("\n"));
  assert.equal(report.warnings.length, 0, report.warnings.join("\n"));
  assert.equal(report.valid, true);

  const invalidAddress = structuredClone(rv32);
  const invalidMstatus = Object.values(invalidAddress.pages).flatMap((page) => page.registers).find((register) => register.name === "mstatus");
  invalidMstatus.encoding.address = 0x1000;
  const invalidText = stringify(invalidAddress, {
    lineWidth: 0,
    defaultStringType: "QUOTE_DOUBLE",
    defaultKeyType: "PLAIN",
    doubleQuotedAsJSON: true,
  });
  const invalidParsed = context.parseRegisterYaml(invalidText);
  const invalidReport = context.validateRegisterYaml(invalidText, invalidParsed);
  assert.match(invalidReport.errors.join("\n"), /riscv_csr address.*0xFFF/);
  console.log("RISC-V CSR importer tests passed");
} finally {
  await rm(temp, { recursive: true, force: true });
}
