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

// CMSIS union comments name these flags but do not describe what a set value
// means. These stable M-profile architectural semantics are kept here so the
// generated YAML remains useful when a user inspects a live register value.
const M_PROFILE_FLAG_METADATA = {
  N: {
    desc: "Negative condition code flag. After an instruction that updates the condition flags, N indicates the sign of the result when interpreted as a two's-complement value: N=1 means negative and N=0 means non-negative. It describes the most recent flag-setting result, not the current value of an arbitrary register.",
    values: [
      { value: 0, desc: "The most recent flag-setting result was non-negative." },
      { value: 1, desc: "The most recent flag-setting result was negative." },
    ],
  },
  Z: {
    desc: "Zero condition code flag. Z=1 when the result of the most recent flag-setting instruction was zero; otherwise Z=0. Comparison instructions such as CMP update the flags as if they performed a subtraction without storing the result, so Z=1 usually means the compared operands were equal.",
    values: [
      { value: 0, desc: "The most recent flag-setting result was not zero; a comparison was not equal." },
      { value: 1, desc: "The most recent flag-setting result was zero; a comparison was equal." },
    ],
  },
  C: {
    desc: "Carry or borrow condition code flag. For addition, C=1 means an unsigned carry out. For subtraction or comparison, C=1 means no borrow and C=0 means a borrow, so C=1 commonly means the unsigned left operand was greater than or equal to the right operand. For flag-setting shifts, C records the last bit shifted out when the instruction defines it.",
    values: [
      { value: 0, desc: "Depending on the instruction: no unsigned carry from addition, a borrow occurred in subtraction or comparison, or the last bit shifted out was 0." },
      { value: 1, desc: "Depending on the instruction: an unsigned carry occurred in addition, no borrow occurred in subtraction or comparison, or the last bit shifted out was 1." },
    ],
  },
  V: {
    desc: "Signed overflow condition code flag. V=1 when the mathematical result cannot be represented in the signed two's-complement range of the operation, for example when adding two values with the same sign produces a result with the opposite sign. V reports signed overflow; C reports unsigned carry or borrow.",
    values: [
      { value: 0, desc: "The most recent flag-setting arithmetic result did not overflow its signed range." },
      { value: 1, desc: "The most recent flag-setting arithmetic result overflowed its signed range." },
    ],
  },
  Q: {
    desc: "Cumulative saturation flag. Set to 1 when a supported saturating or DSP instruction reports saturation or overflow. Q is sticky: later ordinary instructions do not normally clear it, so Q=1 can refer to an earlier instruction; software must explicitly clear it as defined by the architecture.",
    values: [
      { value: 0, desc: "No saturation or qualifying overflow has been recorded since Q was last cleared." },
      { value: 1, desc: "Saturation or a qualifying overflow has occurred since Q was last cleared; the event may have come from an earlier instruction." },
    ],
  },
};

const binaryField = (desc, zero, one) => ({
  desc,
  values: [
    { value: 0, desc: zero },
    { value: 1, desc: one },
  ],
});

const M_PROFILE_SPECIAL_FIELD_METADATA = {
  "CONTROL.SFPA": binaryField(
    "Secure floating-point context active. SFPA is set when the Secure state has an active floating-point context.",
    "The Secure floating-point context is not active.",
    "The Secure floating-point context is active.",
  ),
  "CONTROL.FPCA": binaryField(
    "Floating-point context active. FPCA indicates whether the current context has an allocated floating-point register context.",
    "No floating-point context is active for the current context.",
    "A floating-point context is active and may need preservation during exception stacking.",
  ),
  "CONTROL.SPSEL": binaryField(
    "Thread-mode stack-pointer selection. Handler mode always uses MSP; this bit selects the stack pointer used by Thread mode.",
    "Thread mode uses MSP (Main Stack Pointer).",
    "Thread mode uses PSP (Process Stack Pointer).",
  ),
  "CONTROL.nPRIV": binaryField(
    "Thread-mode privilege. This bit controls whether Thread mode executes with privileged or unprivileged access; Handler mode is always privileged.",
    "Thread mode is privileged.",
    "Thread mode is unprivileged.",
  ),
  "IPSR.ISR": {
    desc: "Current exception number. Zero means Thread mode; a non-zero value identifies the currently active exception according to the implemented exception-number table.",
  },
  "PRIMASK.PM": binaryField(
    "Priority-mask bit. When set, it prevents activation of exceptions with configurable priority; NMI and HardFault are not masked by PRIMASK.",
    "Configurable-priority exceptions are not masked by PRIMASK.",
    "Configurable-priority exceptions are masked by PRIMASK; NMI and HardFault remain eligible.",
  ),
  "FAULTMASK.FM": binaryField(
    "Fault-mask bit. When set, it prevents activation of all exceptions except NMI, including HardFault, until the mask is cleared.",
    "FAULTMASK does not mask exceptions.",
    "All exceptions except NMI are masked by FAULTMASK.",
  ),
  "BASEPRI.BASEPRI": {
    desc: "Base-priority mask value. Zero disables BASEPRI masking; a non-zero value masks configurable exceptions whose priority is at or below the programmed threshold, subject to the implemented priority-bit width.",
  },
  "MSP.ADDRESS": { desc: "Main Stack Pointer value used by the processor in Handler mode and, when selected, Thread mode." },
  "PSP.ADDRESS": { desc: "Process Stack Pointer value used by Thread mode when CONTROL.SPSEL selects PSP." },
  "MSP_NS.ADDRESS": { desc: "Non-secure Main Stack Pointer value accessed from Secure state." },
  "PSP_NS.ADDRESS": { desc: "Non-secure Process Stack Pointer value accessed from Secure state." },
  "MSPLIM.ADDRESS": { desc: "Main Stack Pointer lower-bound limit. Stack accesses below this limit can raise a stack-limit fault when the feature is implemented." },
  "PSPLIM.ADDRESS": { desc: "Process Stack Pointer lower-bound limit. Stack accesses below this limit can raise a stack-limit fault when the feature is implemented." },
  "MSPLIM_NS.ADDRESS": { desc: "Non-secure Main Stack Pointer lower-bound limit accessed from Secure state." },
  "PSPLIM_NS.ADDRESS": { desc: "Non-secure Process Stack Pointer lower-bound limit accessed from Secure state." },
  "SP_NS.ADDRESS": { desc: "Non-secure Stack Pointer value accessed from Secure state." },
};

const XPSR_FIELD_METADATA = {
  GE: { desc: "Greater-than-or-equal flags for parallel SIMD/DSP operations. Their meaning depends on the instruction: each lane records the instruction-defined signed greater-than-or-equal result, unsigned carry, or unsigned no-borrow result. Instructions such as SEL use these flags to select values lane by lane." },
  T: { desc: "Thumb-state indicator in the stacked/program status representation. CMSIS marks this field read-only; software must preserve the architecture-defined value when handling an exception frame." },
  IT: { desc: "Saved If-Then (IT) instruction state. This field is part of the split ICI/IT state saved in xPSR and is not an independent enable flag." },
  ICI_IT: { desc: "Saved Interrupt-Continue (ICI) or If-Then (IT) execution state. The field is split across the xPSR bit ranges defined by the selected Cortex-M architecture." },
  ICI_IT_1: { desc: "Lower part of the saved ICI/IT execution state in an exception frame." },
  ICI_IT_2: { desc: "Upper part of the saved ICI/IT execution state in an exception frame." },
  B: { desc: "Branch Target Identification (BTI) active state in the stacked/program status representation. CMSIS marks this field read-only." },
};

const SCB_FAULT_FIELDS = {
  IACCVIOL: "Instruction access violation recorded by the MemManage fault status.",
  DACCVIOL: "Data access violation recorded by the MemManage fault status.",
  MUNSTKERR: "MemManage fault while unstacking registers on exception return.",
  MSTKERR: "MemManage fault while stacking registers on exception entry.",
  MLSPERR: "MemManage fault during lazy floating-point state preservation.",
  MMARVALID: "Indicates that MMFAR contains the address associated with the MemManage fault.",
  IBUSERR: "Instruction bus error recorded by the BusFault status.",
  PRECISERR: "Precise data bus error; the stacked program counter identifies the faulting instruction.",
  IMPRECISERR: "Imprecise data bus error; the faulting instruction cannot be identified precisely from the stacked program counter.",
  UNSTKERR: "BusFault while unstacking registers on exception return.",
  STKERR: "BusFault while stacking registers on exception entry.",
  LSPERR: "BusFault during lazy floating-point state preservation.",
  BFARVALID: "Indicates that BFAR contains the address associated with the BusFault.",
  UNDEFINSTR: "Undefined instruction usage fault.",
  INVSTATE: "Invalid state usage fault, such as an invalid EPSR/Thumb state.",
  INVPC: "Invalid PC load usage fault during exception return.",
  NOCP: "Coprocessor or floating-point instruction executed when the required extension is unavailable or disabled.",
  STKOF: "Stack overflow usage fault when stack-limit checking is implemented.",
  UNALIGNED: "Unaligned memory access usage fault when trapping is enabled.",
  DIVBYZERO: "Integer division by zero usage fault when divide-by-zero trapping is enabled.",
};

function normalizeComponent(value) {
  return String(value || "").replace(/_Type$/i, "").replace(/_NS$/, "").toUpperCase();
}

function isSingleBit(bits) {
  return /^\d+$/.test(String(bits || ""));
}

function humanizeFieldName(value) {
  return String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function booleanNameMetadata(fieldName, label) {
  const name = String(fieldName || "");
  if (/^DIS/i.test(name)) {
    return binaryField(
      `${label} disable control.`,
      `${label} is enabled or not disabled by this control.`,
      `${label} is disabled by this control.`,
    );
  }
  if (/(?:ENABLE|EN|ENA)$/i.test(name)) {
    return binaryField(
      `${label} enable control.`,
      `${label} is disabled.`,
      `${label} is enabled.`,
    );
  }
  if (/(?:ACTIVE|ACT)$/i.test(name)) {
    return binaryField(`${label} active status.`, `${label} is inactive.`, `${label} is active.`);
  }
  if (/(?:PENDING|PEND)$/i.test(name)) {
    return binaryField(`${label} pending status.`, `${label} is not pending.`, `${label} is pending.`);
  }
  if (/(?:VALID|PRESENT)$/i.test(name)) {
    return binaryField(`${label} validity/presence indicator.`, `${label} is invalid or absent.`, `${label} is valid or present.`);
  }
  if (/(?:READY|RDY)$/i.test(name)) {
    return binaryField(`${label} ready status.`, `${label} is not ready.`, `${label} is ready.`);
  }
  if (/(?:ERROR|ERR|FAULT|VIOL|TRAP)$/i.test(name)) {
    return binaryField(`${label} error or fault status.`, `No ${label.toLowerCase()} condition is recorded.`, `${label} condition is recorded.`);
  }
  if (/CLR$/i.test(name)) {
    return binaryField(`${label} clear command.`, "No clear request is issued.", "The corresponding status or pending state is cleared when written.");
  }
  if (/SET$/i.test(name)) {
    return binaryField(`${label} set command or pending request.`, "No set request is issued.", "The corresponding state or pending request is set when written.");
  }
  return null;
}

function deriveFieldMetadata(component, registerName, fieldName, bits) {
  const componentName = normalizeComponent(component);
  const register = String(registerName || "").replace(/\[\d+\]$/, "");
  const name = String(fieldName || "");
  const key = `${componentName}.${register}.${name}`;
  if (componentName === "SCB" && register === "CFSR" && SCB_FAULT_FIELDS[name]) {
    const desc = SCB_FAULT_FIELDS[name];
    const valid = /VALID$/.test(name);
    return binaryField(desc, valid ? "The corresponding fault address/status register is not valid." : "No such fault has been recorded.", valid ? "The corresponding fault address/status register is valid." : "The corresponding fault has been recorded; most CFSR bits are cleared by writing 1.");
  }
  if (componentName === "SCB" && register === "SHCSR") {
    if (/(?:ENA)$/.test(name)) return booleanNameMetadata(name, `${name.replace(/ENA$/, "")} fault handling`);
    if (/(?:PENDED)$/.test(name)) return booleanNameMetadata(name, `${name.replace(/PENDED$/, "")} exception`);
    if (/(?:ACT)$/.test(name)) return booleanNameMetadata(name, `${name.replace(/ACT$/, "")} exception`);
  }
  if (componentName === "SCB" && register === "ICSR") {
    const explicit = {
      PENDNMISET: binaryField("NMI pending-set request/status.", "NMI is not pending or no set request is issued.", "NMI is pending or is requested to become pending by a write of 1."),
      PENDNMICLR: binaryField("NMI pending-clear command.", "No clear request is issued.", "Writing 1 clears the pending NMI state; reads may return 0."),
      NMIPENDSET: binaryField("NMI pending-set request/status.", "NMI is not pending or no set request is issued.", "NMI is pending or is requested to become pending by a write of 1."),
      PENDSVSET: binaryField("PendSV pending-set request/status.", "PendSV is not pending or no set request is issued.", "PendSV is pending or is requested to become pending by a write of 1."),
      PENDSVCLR: binaryField("PendSV pending-clear command.", "No clear request is issued.", "Writing 1 clears the pending PendSV state; reads may return 0."),
      PENDSTSET: binaryField("SysTick pending-set request/status.", "SysTick is not pending or no set request is issued.", "SysTick is pending or is requested to become pending by a write of 1."),
      PENDSTCLR: binaryField("SysTick pending-clear command.", "No clear request is issued.", "Writing 1 clears the pending SysTick state; reads may return 0."),
      ISRPREEMPT: binaryField("Interrupt preemption pending status.", "No interrupt preemption is pending.", "Interrupt preemption is pending."),
      ISRPENDING: binaryField("External interrupt pending status.", "No external interrupt is pending.", "At least one external interrupt is pending."),
      RETTOBASE: binaryField("Exception-return stack status.", "Another exception is active beneath the current exception.", "The current exception is the only active exception; exception return will return to Thread mode."),
    };
    if (explicit[name]) return explicit[name];
    if (name === "VECTACTIVE") return { desc: "Active exception number. Zero means Thread mode; a non-zero value identifies the currently active exception." };
    if (name === "VECTPENDING") return { desc: "Highest-priority pending exception number. Zero means no exception is pending." };
  }
  if (componentName === "SCB" && register === "SCR") {
    const explicit = {
      SEVONPEND: binaryField("Send-event-on-pending control. If enabled, a pending interrupt can wake a processor waiting for an event.", "Pending interrupts do not generate an event.", "A pending interrupt generates an event that can wake WFE."),
      SLEEPDEEPS: binaryField("Secure deep-sleep request control.", "Deep sleep is not requested for Secure state.", "Secure state requests deep sleep when the sleep instruction is executed."),
      SLEEPDEEP: binaryField("Deep-sleep request control.", "Sleep instructions request ordinary sleep.", "Sleep instructions request deep sleep."),
      SLEEPONEXIT: binaryField("Sleep-on-exception-return control.", "After an exception handler returns, normal Thread-mode execution resumes.", "After an exception handler returns, the processor enters sleep instead of returning to Thread mode."),
    };
    if (explicit[name]) return explicit[name];
  }
  if (componentName === "SCB" && register === "CCR") {
    const explicit = {
      USERSETMPEND: binaryField("User-settable pending interrupt control.", "Unprivileged software cannot set an interrupt pending state through the software-trigger mechanism.", "Unprivileged software may set an interrupt pending state through the software-trigger mechanism."),
      DIV_0_TRP: binaryField("Divide-by-zero trapping control.", "Integer division by zero does not generate a UsageFault through this control.", "Integer division by zero generates a UsageFault."),
      UNALIGN_TRP: binaryField("Unaligned-access trapping control.", "Unaligned accesses are permitted when the instruction supports them.", "Unaligned accesses generate a UsageFault."),
      STKALIGN: binaryField("Exception stack alignment control.", "Exception stack alignment follows the legacy alignment behavior.", "Exception entry maintains the architecture-required stack alignment."),
      BFHFNMIGN: binaryField("BusFault handling in HardFault/NMI control.", "BusFaults are not ignored during HardFault or NMI handling.", "BusFaults are ignored during HardFault or NMI handling."),
      STKOFHFNMIGN: binaryField("Stack-overflow handling in HardFault/NMI control.", "Stack-limit violations are not ignored during HardFault or NMI handling.", "Stack-limit violations are ignored during HardFault or NMI handling."),
      BP: binaryField("Branch-prediction enable control.", "Branch prediction is disabled.", "Branch prediction is enabled."),
      IC: binaryField("Instruction-cache enable control.", "The instruction cache is disabled.", "The instruction cache is enabled."),
      DC: binaryField("Data-cache enable control.", "The data cache is disabled.", "The data cache is enabled."),
    };
    if (explicit[name]) return explicit[name];
  }
  if (componentName === "SCB" && register === "HFSR") {
    const explicit = {
      DEBUGEVT: binaryField("Debug event status. Indicates that a debug-related event caused HardFault handling.", "No debug event is recorded.", "A debug event is recorded."),
      FORCED: binaryField("Forced HardFault status. Indicates that a configurable fault escalated to HardFault.", "HardFault was not forced by a configurable fault.", "A configurable fault was escalated to HardFault."),
      VECTTBL: binaryField("Vector-table read fault status.", "The fault was not caused by a vector-table read.", "A fault occurred during vector-table read."),
    };
    if (explicit[name]) return explicit[name];
  }
  if (componentName === "SCB" && register === "DFSR") {
    return binaryField(`${name} debug-fault status. This sticky bit records the corresponding debug event until cleared by software.`, "The corresponding debug event has not been recorded.", "The corresponding debug event has been recorded.");
  }
  if (componentName === "SCB" && register === "AIRCR") {
    const explicit = {
      ENDIANNESS: { desc: "Data endianness indicator. This read-only field reports the processor's implemented data endianness." },
      VECTCLRACTIVE: binaryField("Active-exception clear control. Writing 1 clears active exception state where the architecture permits it; this is intended for debug/reset use and must be used with care." , "No active-exception clear request is issued.", "An active-exception clear request is issued."),
      SYSRESETREQ: binaryField("System-reset request control. Writing 1 requests a system reset through the implementation's reset controller.", "No system-reset request is issued.", "A system-reset request is issued when permitted."),
      SYSRESETREQS: binaryField("Secure system-reset request control.", "Secure state cannot request a system reset through this control.", "Secure state may request a system reset through this control."),
    };
    if (explicit[name]) return explicit[name];
  }
  if (componentName === "SYSTICK") {
    const explicit = {
      COUNTFLAG: binaryField("Counter-wrap status. This sticky status bit is set when the counter reaches zero and is cleared by reading the SysTick CTRL register.", "The counter has not wrapped since the last CTRL read.", "The counter has wrapped since the last CTRL read."),
      CLKSOURCE: binaryField("SysTick clock-source selection.", "Use the external/reference clock supplied to SysTick.", "Use the processor clock."),
      TICKINT: binaryField("SysTick exception request control.", "Counter wrap does not request the SysTick exception.", "Counter wrap requests the SysTick exception."),
      ENABLE: binaryField("SysTick counter enable control.", "The SysTick counter is stopped.", "The SysTick counter counts down from LOAD."),
      NOREF: binaryField("Calibration reference-clock indicator.", "A separate reference clock is available for calibration.", "No separate reference clock is available."),
      SKEW: binaryField("Calibration skew indicator.", "The TENMS calibration value is accurate within the implementation's stated tolerance.", "The TENMS calibration value is not guaranteed to be accurate."),
    };
    if (explicit[name]) return explicit[name];
    if (name === "TENMS") return { desc: "Reload value that calibrates a ten-millisecond interval for the available SysTick reference clock." };
    if (name === "RELOAD") return { desc: "Value loaded into the SysTick counter when it reaches zero." };
    if (name === "CURRENT") return { desc: "Current SysTick counter value; writing any value clears the counter to zero." };
  }
  if (componentName === "MPU") {
    const explicit = {
      ENABLE: binaryField("MPU enable control.", "The MPU is disabled.", "The MPU is enabled."),
      HFNMIENA: binaryField("MPU fault handling in HardFault/NMI control.", "MPU checking is disabled during HardFault and NMI handlers.", "MPU checking remains enabled during HardFault and NMI handlers."),
      PRIVDEFENA: binaryField("Privileged default-map control.", "Privileged software cannot use the default memory map when no MPU region matches.", "Privileged software can use the default memory map when no MPU region matches."),
      EN: binaryField("MPU region enable control.", "This MPU region is disabled.", "This MPU region is enabled."),
      XN: binaryField("Execute-never control.", "Instruction execution is permitted in this region when other permissions allow it.", "Instruction execution is prohibited in this region."),
      PXN: binaryField("Privileged execute-never control.", "Privileged instruction execution is permitted in this region when other permissions allow it.", "Privileged instruction execution is prohibited in this region."),
      VALID: binaryField("RBAR region-number validity control.", "The RBAR address is used without replacing the selected region number.", "The REGION field supplies the region number for the RBAR write."),
      SEPARATE: binaryField("Separate instruction/data-region indicator.", "Instruction and data regions share one region set.", "Separate instruction and data region sets are implemented."),
    };
    if (explicit[name]) return explicit[name];
    if (name === "AP") return { desc: "Access-permission encoding for the MPU region; the encoding determines privileged/unprivileged read/write permissions." };
    if (name === "SH") return { desc: "Shareability encoding for the MPU region." };
    if (name === "AttrIndx") return { desc: "Index into the MAIR attribute table used for this MPU region." };
    if (name === "BASE" || name === "ADDR") return { desc: "Base address of the MPU region, aligned according to the implemented region granularity." };
    if (name === "LIMIT") return { desc: "Limit address of the MPU region, aligned according to the implemented region granularity." };
    if (name === "REGION") return { desc: "MPU region number selected for the following region-register access." };
    if (name === "RNR") return { desc: "Selected MPU region number." };
    if (/^Attr\d+$/.test(name)) return { desc: "Eight-bit memory-attribute encoding stored in the MAIR register." };
  }
  if (componentName === "SAU") {
    const explicit = {
      ENABLE: binaryField("SAU enable control.", "The Security Attribution Unit is disabled.", "The Security Attribution Unit is enabled."),
      ALLNS: binaryField("Default security attribution control.", "Unmatched addresses use the architecture-defined default security attribution.", "Unmatched addresses are attributed as Non-secure."),
      NSC: binaryField("Non-secure Callable attribution control.", "The region is not Non-secure Callable.", "The region is Non-secure Callable."),
    };
    if (explicit[name]) return explicit[name];
    if (name === "BADDR" || name === "LADDR") return { desc: "SAU region boundary address, aligned according to the implemented SAU granularity." };
    if (name === "REGION") return { desc: "Selected SAU region number." };
    if (name === "VALID") return binaryField("SAU fault-address validity status.", "The SAU fault address is not valid.", "The SAU fault address is valid.");
    if (/VIOL|INV|ERR|PERR|VALID$/.test(name)) return binaryField(`Secure-fault status for ${humanizeFieldName(name)}.`, "The corresponding SecureFault condition is not recorded.", "The corresponding SecureFault condition is recorded.");
  }
  if (componentName === "FPU" && register === "FPCCR") {
    const explicit = {
      ASPEN: binaryField("Automatic floating-point state preservation control.", "Automatic preservation of floating-point state on exception entry is disabled.", "Automatic preservation of floating-point state on exception entry is enabled."),
      LSPEN: binaryField("Lazy floating-point state preservation control.", "Lazy preservation is disabled; floating-point state is preserved eagerly when required.", "Lazy floating-point state preservation is enabled."),
      LSPACT: binaryField("Lazy floating-point state preservation active status.", "No lazy floating-point preservation is active.", "Lazy floating-point preservation is active."),
      USER: binaryField("Floating-point privilege level status.", "The floating-point context is associated with privileged execution.", "The floating-point context is associated with unprivileged execution."),
      THREAD: binaryField("Floating-point processor-mode status.", "The floating-point context is associated with Handler mode.", "The floating-point context is associated with Thread mode."),
      S: binaryField("Floating-point context security status recorded for lazy floating-point state preservation.", "The floating-point context is Non-secure.", "The floating-point context is Secure."),
    };
    if (explicit[name]) return explicit[name];
    if (/RDY$/.test(name)) return binaryField(`${humanizeFieldName(name)} readiness status.`, "The corresponding floating-point state is not ready.", "The corresponding floating-point state is ready.");
  }
  if (componentName === "DWT") {
    const explicit = {
      CYCCNTENA: binaryField("DWT cycle-counter enable control.", "The DWT cycle counter is disabled.", "The DWT cycle counter is enabled."),
      CYCEVTENA: binaryField("DWT cycle-event generation control.", "Cycle-count event generation is disabled.", "Cycle-count event generation is enabled."),
      FOLDEVTENA: binaryField("DWT folded-instruction event generation control.", "Folded-instruction event generation is disabled.", "Folded-instruction event generation is enabled."),
      LSUEVTENA: binaryField("DWT load/store-unit event generation control.", "Load/store-unit event generation is disabled.", "Load/store-unit event generation is enabled."),
      SLEEPEVTENA: binaryField("DWT sleep-event generation control.", "Sleep event generation is disabled.", "Sleep event generation is enabled."),
      EXCEVTENA: binaryField("DWT exception-event generation control.", "Exception event generation is disabled.", "Exception event generation is enabled."),
      CPIEVTENA: binaryField("DWT CPI-event generation control.", "CPI event generation is disabled.", "CPI event generation is enabled."),
      EXCTRCENA: binaryField("DWT exception-trace generation control.", "Exception tracing is disabled.", "Exception tracing is enabled."),
      PCSAMPLENA: binaryField("DWT program-counter sampling control.", "Program-counter sampling is disabled.", "Program-counter sampling is enabled."),
      MATCHED: binaryField("DWT comparator-match status.", "The comparator has not matched.", "The comparator has matched."),
      NOCYCCNT: binaryField("DWT cycle-counter implementation status.", "A cycle counter is implemented.", "No cycle counter is implemented."),
      NOEXTTRIG: binaryField("DWT external-trigger implementation status.", "External match triggers are implemented.", "External match triggers are not implemented."),
      NOPRFCNT: binaryField("DWT profiling-counter implementation status.", "Profiling counters are implemented.", "Profiling counters are not implemented."),
      NOTRCPKT: binaryField("DWT trace-packet implementation status.", "Trace packet generation is implemented.", "Trace packet generation is not implemented."),
    };
    if (explicit[name]) return explicit[name];
    if (name === "ACTION") return { desc: "Action taken when the DWT comparator matches, encoded according to the implemented DWT architecture." };
    if (name === "DATAVSIZE") return { desc: "Data value size watched by the DWT comparator." };
    if (name === "MATCH") return { desc: "DWT comparator match mode." };
    if (name === "ID") return { desc: "DWT comparator/function capability identifier." };
  }
  if (isSingleBit(bits)) {
    const derived = booleanNameMetadata(name, `${componentName} ${register} ${humanizeFieldName(name)}`);
    if (derived) return derived;
  }
  return null;
}

function fallbackFieldDescription(component, registerName, fieldName) {
  const label = `${normalizeComponent(component)} ${registerName} ${humanizeFieldName(fieldName)}`.trim();
  return `${label} field. CMSIS defines the bit position, but this header does not provide detailed value semantics for the field.`;
}

function fieldMetadata(prefixes, registerName, fieldName, bits) {
  for (const prefix of prefixes) {
    const metadata = deriveFieldMetadata(prefix, registerName, fieldName, bits);
    if (metadata) return metadata;
  }
  return null;
}

function applyFieldMetadata(field, prefixes, registerName) {
  const sourceDescription = String(field.desc || "").trim();
  const replaceSourceDescription = /^CMSIS\s+.+\s+field$/i.test(sourceDescription)
    || /^(?:bit|field|type|-type)$/i.test(sourceDescription)
    || /^(?:able bit|Security status of the FP context bit)$/i.test(sourceDescription);
  const metadata = fieldMetadata(prefixes, registerName, field.name, field.bits);
  if (!replaceSourceDescription) return field;
  if (!metadata) return /^CMSIS\s+.+\s+field$/i.test(field.desc || "")
    ? { ...field, desc: fallbackFieldDescription(prefixes[0], registerName, field.name) }
    : field;
  return {
    ...field,
    desc: metadata.desc,
    ...(metadata.values ? { values: metadata.values.map((value) => ({ ...value })) } : {}),
  };
}

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

function cleanFieldComment(value, fieldName) {
  const comment = cleanComment(value);
  const colon = comment.indexOf(":");
  const afterPrefix = colon >= 0 ? comment.slice(colon + 1).trim() : comment;
  const description = afterPrefix.replace(/\bPosition\b\s*$/i, "").trim();
  if (!description || new RegExp(`^${fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i").test(description)) return "";
  return description;
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

function parseUnionFieldDescriptions(source) {
  const result = new Map();
  const endPattern = /}\s+([A-Za-z_]\w*)_Type\s*;/g;
  for (const end of source.matchAll(endPattern)) {
    const start = source.lastIndexOf("typedef union", end.index);
    if (start < 0 || result.has(end[1])) continue;
    const open = source.indexOf("{", start);
    if (open < 0 || matchingBrace(source, open) !== end.index) continue;
    const fields = new Map();
    for (const line of source.slice(open + 1, end.index).split(/\r?\n/)) {
      const declaration = /^\s*(?:u?int(?:8|16|32|64)_t|unsigned(?:\s+(?:char|short|int|long))?)\s+([A-Za-z_]\w*)\s*:\s*\d+\s*;/.exec(line);
      if (!declaration || declaration[1].startsWith("_reserved")) continue;
      const comment = /\/\*+!?<?\s*([\s\S]*?)\*\//.exec(line)?.[1] || "";
      const description = cleanComment(comment)
        .replace(/^bit:\s*\d+(?:\s*\.\.\s*\d+)?\s*/i, "")
        .trim();
      if (description) fields.set(declaration[1], description);
    }
    if (fields.size) result.set(end[1], fields);
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

function buildFields(macros, evaluate, prefixes, registerName, index, bitWidth, unionFieldDescriptions = new Map()) {
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
    const description = cleanFieldComment(macro.comment, fieldName);
    const unionDescription = prefixes
      .map((prefix) => unionFieldDescriptions.get(prefix)?.get(fieldName))
      .find(Boolean);
    const rawField = { name: fieldName, bits, desc: description || unionDescription || `CMSIS ${fieldName} field`, _ranges: ranges };
    fields.push(applyFieldMetadata(rawField, prefixes, registerName));
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

function buildMmioPages(source, coreFile, macros, evaluate, unionFieldDescriptions) {
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
        const fields = buildFields(macros, evaluate, prefixes, member.name, member.count > 1 ? index : null, member.width * 8, unionFieldDescriptions);
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

function buildSpecialPage(intrinsics, macros, evaluate, profile, coreFile, unionFieldDescriptions) {
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
      ? buildFields(macros, evaluate, [fieldPrefix === "XPSR" ? "xPSR" : fieldPrefix], "", null, 32, unionFieldDescriptions)
      : [];
    const architecturalFields = cmsisFields.map((field) => {
      const metadata = ["APSR", "XPSR"].includes(fieldPrefix)
        ? M_PROFILE_FLAG_METADATA[field.name] || XPSR_FIELD_METADATA[field.name]
        : M_PROFILE_SPECIAL_FIELD_METADATA[`${name}.${field.name}`]
          || M_PROFILE_SPECIAL_FIELD_METADATA[`${fieldPrefix}.${field.name}`];
      return metadata
        ? {
          ...field,
          desc: metadata.desc,
          ...(metadata.values ? { values: metadata.values.map((value) => ({ ...value })) } : {}),
        }
        : field;
    });
    const specialFields = (SPECIAL_FIELDS[name] || SPECIAL_FIELDS[fieldPrefix] || []).map((field) => {
      const metadata = M_PROFILE_SPECIAL_FIELD_METADATA[`${name}.${field.name}`]
        || M_PROFILE_SPECIAL_FIELD_METADATA[`${fieldPrefix}.${field.name}`];
      return metadata
        ? { ...field, desc: metadata.desc, ...(metadata.values ? { values: metadata.values.map((value) => ({ ...value })) } : {}) }
        : field;
    });
    const fields = [
      ...architecturalFields,
      ...specialFields,
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
      source_ref: architecturalFields.length
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
  parseUnionFieldDescriptions,
  parsePointers,
  buildFields,
  deriveFieldMetadata,
  fallbackFieldDescription,
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
  const unionFieldDescriptions = parseUnionFieldDescriptions(coreSource);
  const pages = {
    "Special Registers": buildSpecialPage(intrinsics, macros, evaluate, profile, profile.file, unionFieldDescriptions),
    ...buildMmioPages(coreSource, profile.file, macros, evaluate, unionFieldDescriptions),
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
