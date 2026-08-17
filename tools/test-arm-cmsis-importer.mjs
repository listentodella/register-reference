import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import vm from "node:vm";
import { stringify } from "yaml";
import { importArmCmsisRegisters } from "./import-arm-cmsis.mjs";

const root = resolve(import.meta.dirname, "..");
const temp = await mkdtemp(join(tmpdir(), "arm-cmsis-import-test-"));
const includeRoot = join(temp, "CMSIS", "Core", "Include");
const profileRoot = join(includeRoot, "m-profile");

const coreHeader = `
#define APSR_N_Pos 31U /*!< APSR: N Position */
#define APSR_N_Msk (1UL << APSR_N_Pos) /*!< APSR: N Mask */
#define CONTROL_SPSEL_Pos 1U /*!< CONTROL: SPSEL Position */
#define CONTROL_SPSEL_Msk (1UL << CONTROL_SPSEL_Pos) /*!< CONTROL: SPSEL Mask */
#define SCS_BASE (0xE000E000UL) /*!< System Control Space Base Address */
#define SCB_BASE (SCS_BASE + 0x0D00UL) /*!< System Control Block Base Address */
typedef struct
{
  __IM uint32_t CPUID; /*!< Offset: 0x000 (R/ ) CPUID Base Register */
  __IOM uint32_t TEST[2U]; /*!< Offset: 0x004 (R/W) Synthetic array register */
} SCB_Type;
#define SCB_CPUID_IMPLEMENTER_Pos 24U /*!< SCB CPUID: IMPLEMENTER Position */
#define SCB_CPUID_IMPLEMENTER_Msk (0xFFUL << SCB_CPUID_IMPLEMENTER_Pos) /*!< SCB CPUID: IMPLEMENTER Mask */
#define SCB_CPUID_IMPLEMENTOR_Pos SCB_CPUID_IMPLEMENTER_Pos
#define SCB_CPUID_IMPLEMENTOR_Msk SCB_CPUID_IMPLEMENTER_Msk
#define SCB_TEST_VALUE_Pos 0U /*!< SCB TEST: VALUE Position */
#define SCB_TEST_VALUE_Msk (0xFUL << SCB_TEST_VALUE_Pos) /*!< SCB TEST: VALUE Mask */
#define SCB ((SCB_Type *) SCB_BASE)
#define SCS_BASE_NS (0xE002E000UL)
#define SCB_BASE_NS (SCS_BASE_NS + 0x0D00UL)
#define SCB_NS ((SCB_Type *) SCB_BASE_NS)
`;

const intrinsics = `
/** \\brief Get APSR Register \\details Returns the APSR value. */
__STATIC_FORCEINLINE uint32_t __get_APSR(void)
{
  uint32_t result;
  __ASM volatile ("MRS %0, apsr" : "=r" (result));
  return result;
}
/** \\brief Get Control Register */
__STATIC_FORCEINLINE uint32_t __get_CONTROL(void)
{
  uint32_t result;
  __ASM volatile ("MRS %0, control" : "=r" (result));
  return result;
}
/** \\brief Set Control Register */
__STATIC_FORCEINLINE void __set_CONTROL(uint32_t value)
{
  __ASM volatile ("MSR control, %0" : : "r" (value));
}
/** \\brief Get non-secure Control Register */
__STATIC_FORCEINLINE uint32_t __TZ_get_CONTROL_NS(void)
{
  uint32_t result;
  __ASM volatile ("MRS %0, control_ns" : "=r" (result));
  return result;
}
/** \\brief Set Base Priority */
__STATIC_FORCEINLINE void __set_BASEPRI_MAX(uint32_t value)
{
  __ASM volatile ("MSR basepri_max, %0" : : "r" (value));
}
`;

try {
  await mkdir(profileRoot, { recursive: true });
  await writeFile(join(includeRoot, "core_cm33.h"), coreHeader);
  await writeFile(join(profileRoot, "cmsis_gcc_m.h"), intrinsics);
  await writeFile(join(includeRoot, "cmsis_version.h"), "#define __CM_CMSIS_VERSION_MAIN ( 6U)\n#define __CM_CMSIS_VERSION_SUB ( 3U)\n");

  const data = await importArmCmsisRegisters({ input: temp, core: "cm33" });
  assert.equal(data.register_space.kind, "arm_system");
  assert.equal(data.register_space.profile, "M");
  assert.equal(data.source.version, "CMSIS-Core 6.3");
  assert.equal(data.source.license, "Apache-2.0");

  const special = Object.fromEntries(data.pages["Special Registers"].registers.map((register) => [register.name, register]));
  assert.equal(special.APSR.fields[0].bits, "31");
  assert.equal(special.CONTROL.access, "RW");
  assert.equal(special.CONTROL.encoding.selector, "CONTROL");
  assert.equal(special.CONTROL_NS.condition.includes("Security Extension"), true);
  assert.equal(special.BASEPRI.accessors[0].encoding.selector, "BASEPRI_MAX");

  assert.deepEqual(data.pages.SCB.registers.map((register) => [register.name, register.addr]), [
    ["CPUID", 0xE000ED00],
    ["TEST[0]", 0xE000ED04],
    ["TEST[1]", 0xE000ED08],
  ]);
  assert.deepEqual(data.pages.SCB.registers[0].fields.map((field) => field.name), ["IMPLEMENTER"]);
  assert.equal(data.pages.SCB.registers[1].fields[0].bits, "3:0");
  assert.equal(data.pages.SCB_NS.registers[0].addr, 0xE002ED00);

  const yamlText = stringify(data, { lineWidth: 0, defaultStringType: "QUOTE_DOUBLE", defaultKeyType: "PLAIN", doubleQuotedAsJSON: true });
  const context = { console };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(await readFile(join(root, "yaml-lite.js"), "utf8"), context);
  vm.runInContext(await readFile(join(root, "yaml-validator.js"), "utf8"), context);
  const parsed = context.parseRegisterYaml(yamlText);
  const report = context.validateRegisterYaml(yamlText, parsed);
  assert.equal(report.valid, true, report.errors.join("\n"));
  assert.equal(report.warnings.length, 0);
  console.log("ARM CMSIS importer tests passed");
} finally {
  await rm(temp, { recursive: true, force: true });
}
