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
typedef union
{
  struct
  {
    uint32_t _reserved0:16; /*!< bit:  0..15  Reserved */
    uint32_t GE:4;          /*!< bit: 16..19  Greater than or Equal flags */
    uint32_t _reserved1:7;  /*!< bit: 20..26  Reserved */
    uint32_t Q:1;           /*!< bit:     27  Saturation condition flag */
    uint32_t V:1;           /*!< bit:     28  Overflow condition code flag */
    uint32_t C:1;           /*!< bit:     29  Carry condition code flag */
    uint32_t Z:1;           /*!< bit:     30  Zero condition code flag */
    uint32_t N:1;           /*!< bit:     31  Negative condition code flag */
  } b;
  uint32_t w;
} APSR_Type;
#define APSR_N_Pos 31U /*!< APSR: N Position */
#define APSR_N_Msk (1UL << APSR_N_Pos) /*!< APSR: N Mask */
#define APSR_Z_Pos 30U /*!< APSR: Z Position */
#define APSR_Z_Msk (1UL << APSR_Z_Pos) /*!< APSR: Z Mask */
#define APSR_C_Pos 29U /*!< APSR: C Position */
#define APSR_C_Msk (1UL << APSR_C_Pos) /*!< APSR: C Mask */
#define APSR_V_Pos 28U /*!< APSR: V Position */
#define APSR_V_Msk (1UL << APSR_V_Pos) /*!< APSR: V Mask */
#define APSR_Q_Pos 27U /*!< APSR: Q Position */
#define APSR_Q_Msk (1UL << APSR_Q_Pos) /*!< APSR: Q Mask */
#define APSR_GE_Pos 16U /*!< APSR: GE Position */
#define APSR_GE_Msk (0xFUL << APSR_GE_Pos) /*!< APSR: GE Mask */
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
#define SCB_TEST_EN_Pos 4U /*!< SCB TEST: Region enable bit Position */
#define SCB_TEST_EN_Msk (1UL << SCB_TEST_EN_Pos) /*!< SCB TEST: Region enable bit Mask */
#define SCB_TEST_S_Pos 5U /*!< SCB TEST: Security status of the FP context bit Position */
#define SCB_TEST_S_Msk (1UL << SCB_TEST_S_Pos) /*!< SCB TEST: Security status of the FP context bit Mask */
#define SCB ((SCB_Type *) SCB_BASE)
#define SCS_BASE_NS (0xE002E000UL)
#define SCB_BASE_NS (SCS_BASE_NS + 0x0D00UL)
#define SCB_NS ((SCB_Type *) SCB_BASE_NS)
#define DWT_BASE (0xE0001000UL)
typedef struct
{
  __IOM uint32_t CTRL; /*!< Offset: 0x000 (R/W) Control Register */
} DWT_Type;
#define DWT_CTRL_NOTRCPKT_Pos 27U /*!< DWT CTRL: NOTRCPKT Position */
#define DWT_CTRL_NOTRCPKT_Msk (1UL << DWT_CTRL_NOTRCPKT_Pos) /*!< DWT CTRL: NOTRCPKT Mask */
#define DWT_CTRL_NOEXTTRIG_Pos 26U /*!< DWT CTRL: NOEXTTRIG Position */
#define DWT_CTRL_NOEXTTRIG_Msk (1UL << DWT_CTRL_NOEXTTRIG_Pos) /*!< DWT CTRL: NOEXTTRIG Mask */
#define DWT_CTRL_NOCYCCNT_Pos 25U /*!< DWT CTRL: NOCYCCNT Position */
#define DWT_CTRL_NOCYCCNT_Msk (1UL << DWT_CTRL_NOCYCCNT_Pos) /*!< DWT CTRL: NOCYCCNT Mask */
#define DWT_CTRL_NOPRFCNT_Pos 24U /*!< DWT CTRL: NOPRFCNT Position */
#define DWT_CTRL_NOPRFCNT_Msk (1UL << DWT_CTRL_NOPRFCNT_Pos) /*!< DWT CTRL: NOPRFCNT Mask */
#define DWT ((DWT_Type *) DWT_BASE)
#define FPU_BASE (0xE000EF30UL)
typedef struct
{
  __IOM uint32_t FPCCR; /*!< Offset: 0x004 (R/W) Floating-Point Context Control Register */
} FPU_Type;
#define FPU_FPCCR_S_Pos 2U /*!< FPCCR: Security status of the FP context bit Position */
#define FPU_FPCCR_S_Msk (1UL << FPU_FPCCR_S_Pos) /*!< FPCCR: Security status of the FP context bit Mask */
#define FPU ((FPU_Type *) FPU_BASE)
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
/** \\brief Get non-secure Main Stack Pointer */
__STATIC_FORCEINLINE uint32_t __TZ_get_MSP_NS(void)
{
  uint32_t result;
  __ASM volatile ("MRS %0, msp_ns" : "=r" (result));
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
  const apsrFields = Object.fromEntries(special.APSR.fields.map((field) => [field.name, field]));
  assert.match(apsrFields.N.desc, /two's-complement value.*most recent flag-setting result/);
  assert.match(apsrFields.Z.desc, /CMP.*Z=1 usually means the compared operands were equal/);
  assert.match(apsrFields.C.desc, /subtraction or comparison, C=1 means no borrow.*last bit shifted out/);
  assert.match(apsrFields.V.desc, /signed two's-complement range.*C reports unsigned carry or borrow/);
  assert.match(apsrFields.Q.desc, /Q is sticky.*software must explicitly clear it/);
  assert.deepEqual(apsrFields.N.values, [
    { value: 0, desc: "The most recent flag-setting result was non-negative." },
    { value: 1, desc: "The most recent flag-setting result was negative." },
  ]);
  assert.equal(apsrFields.C.values[0].desc.includes("a borrow occurred"), true);
  assert.equal(apsrFields.Q.values[1].desc.includes("earlier instruction"), true);
  assert.match(apsrFields.GE.desc, /meaning depends on the instruction.*unsigned carry.*unsigned no-borrow.*SEL/i);
  assert.equal(special.CONTROL.access, "RW");
  assert.equal(special.CONTROL.encoding.selector, "CONTROL");
  assert.equal(special.CONTROL_NS.condition.includes("Security Extension"), true);
  assert.equal(special.MSP_NS.fields[0].desc, "Non-secure Main Stack Pointer value accessed from Secure state.");
  assert.equal(special.BASEPRI.accessors[0].encoding.selector, "BASEPRI_MAX");

  assert.deepEqual(data.pages.SCB.registers.map((register) => [register.name, register.addr]), [
    ["CPUID", 0xE000ED00],
    ["TEST[0]", 0xE000ED04],
    ["TEST[1]", 0xE000ED08],
  ]);
  assert.deepEqual(data.pages.SCB.registers[0].fields.map((field) => field.name), ["IMPLEMENTER"]);
  assert.equal(data.pages.SCB.registers[1].fields.find((field) => field.name === "VALUE").bits, "3:0");
  const testFields = Object.fromEntries(data.pages.SCB.registers[1].fields.map((field) => [field.name, field]));
  assert.equal(testFields.EN.desc, "Region enable bit");
  assert.equal(testFields.S.desc, "Security status of the FP context bit");
  assert.equal(data.pages.SCB_NS.registers[0].addr, 0xE002ED00);

  const fpccrS = data.pages.FPU.registers[0].fields.find((field) => field.name === "S");
  assert.deepEqual(fpccrS.values, [
    { value: 0, desc: "The floating-point context is Non-secure." },
    { value: 1, desc: "The floating-point context is Secure." },
  ]);
  const dwtFields = Object.fromEntries(data.pages.DWT.registers[0].fields.map((field) => [field.name, field]));
  assert.equal(dwtFields.NOCYCCNT.values[0].desc, "A cycle counter is implemented.");
  assert.equal(dwtFields.NOCYCCNT.values[1].desc, "No cycle counter is implemented.");
  assert.equal(dwtFields.NOEXTTRIG.values[1].desc, "External match triggers are not implemented.");
  assert.equal(dwtFields.NOPRFCNT.values[1].desc, "Profiling counters are not implemented.");
  assert.equal(dwtFields.NOTRCPKT.values[1].desc, "Trace packet generation is not implemented.");

  const yamlText = stringify(data, { lineWidth: 0, defaultStringType: "QUOTE_DOUBLE", defaultKeyType: "PLAIN", doubleQuotedAsJSON: true });
  assert.doesNotMatch(yamlText, /desc:\s*["']CMSIS\s+.+\s+field["']/i);
  assert.doesNotMatch(yamlText, /desc:\s*["'](?:able bit|ecurity status)/i);
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
