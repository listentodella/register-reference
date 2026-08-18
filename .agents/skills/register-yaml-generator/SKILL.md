---
name: register-yaml-generator
description: 从芯片 datasheet、reference manual、寄存器表或已有代码定义中提取、生成、补全和校验本项目兼容的寄存器 YAML。用户要求新增芯片、把 PDF/表格/头文件转换为寄存器描述、修复现有寄存器 YAML、检查位域/分页/枚举，或为寄存器速查工具准备数据时使用。
---

# 生成寄存器 YAML

## 工作流

1. 读取 [references/schema.md](references/schema.md)，确认字段含义和浏览器 YAML 子集限制。
2. 检查目标仓库中的 `app.js`、`yaml-lite.js` 和现有芯片 YAML；若项目约定已变化，以当前代码为准并同步更新本 skill。
3. 读取用户提供的 datasheet、reference manual、寄存器表或驱动头文件。交叉核对寄存器总表、各寄存器位域说明、复位值、访问属性和分页机制。
4. 从 [assets/register-template.yaml](assets/register-template.yaml) 开始创建新文件。将文件放到项目根目录，使用小写芯片型号命名，例如 `abc123.yaml`。
5. 忠实转录寄存器地址、名称、访问属性、宽度和位域。保留原始寄存器/位域标识符；使用简洁中文描述含义、单位、公式、字节序和副作用。
6. 不猜测资料中没有给出的值。将未知 `WHO_AM_I` 写成 `reg: null` 和 `values: []`；将未知位写成 reserved/未定义，或在 `desc` 中明确资料缺失。
7. 对多页、重叠地址、多字节联合视图、读清零、FIFO/流式端口等行为使用对应元数据，详见 schema 文档。
8. 先运行结构校验，再运行浏览器解析器兼容性校验：

```bash
python3 <skill-dir>/scripts/validate_register_yaml.py <chip.yaml>
node <skill-dir>/scripts/check-browser-yaml.js <chip.yaml>
```

9. 修复所有错误。逐项判断警告；只有确认警告是有意建模时才保留。
10. 在本项目中运行 `npm run data:build`，重新生成 `data/chips.data.js`。不要手工编辑生成文件。
11. 检查生成差异，并至少抽查 WHO_AM_I、第一页、最后一页、多字节寄存器和带枚举的位域。

桌面应用和纯 HTML 查看器在导入时还会自动执行内置严格校验，不依赖用户安装 Python 或 Node。这里的两个脚本用于 YAML 制作阶段和 CI，便于生成者在交付前定位问题；不能用应用导入成功代替原始资料核对。

## ARM 官方系统寄存器

A-profile 系统寄存器优先使用 Arm 官方 System Register XML，不从 PDF 或网络二手表格手工重建。详细流程见项目的 `docs/arm-system-registers.md`。

```bash
npm run arm:import -- <SysReg_xml_A_profile.tar.gz或解压目录> \
  --output <arm-system-registers.yaml> \
  --state AArch64 \
  --version <官方版本> \
  --revision <Arm ARM revision>
```

- 使用 schema v2、`register_space.kind: arm_system`；不得将 MRS/MSR 编码伪装成 `addr`。
- AArch64 使用 `aarch64_sysreg`/`aarch64_special`；AArch32 按官方访问机制区分 `aarch32_cp15`、`aarch32_coproc`、`aarch32_special` 与 `aarch32_vfp`。保留每个 accessor 的编码和条件。
- 保留 feature 条件、条件重叠字段、RES0/RES1、非连续位域、128-bit 宽度、通配/区间枚举和 `source_ref`。
- `source.version`、`source.revision`、`source.url`、`source.license`、`source.notice` 必须对应实际下载包。
- 每次都阅读目标包的 `notice.xml`。Arm XML 是专有资料；没有确认再分发权限时，只在本地生成和导入，不提交原始 XML 或完整生成 YAML。
- 当前 A-profile 下载包只有 XML/HTML，没有独立 JSON 包。不要把第三方 JSON 当作 Arm 官方事实来源。
- Cortex-M/CMSIS 使用下方的独立导入路径，不要套用 A-profile 编码。

### Cortex-M / CMSIS 官方数据

Cortex-M 的官方来源分成两层：

1. `CMSIS/Core/Include/core_cm*.h` 和 `m-profile/cmsis_gcc_m.h`：CPU 特殊寄存器、SCS/CoreSight 结构体偏移、访问属性、基地址、位域位置和掩码。
2. `ARM-software/Cortex_DFP` 的 `.svd` 文件：当前官方包中的 Cortex-M SVD 主要是示例/设备元数据，很多文件明确标记为虚构且不完整，不应当当作完整 SCS 位域数据库。

使用 CMSIS-Core 导入器：

```bash
npm run arm:cmsis-import -- <CMSIS_6目录> \
  --core cm33 \
  --version 6.3.0 \
  --output arm-cm33-system-registers.yaml
```

支持 `cm0`、`cm0plus`、`cm1`、`cm23`、`cm3`、`cm33`、`cm35p`、`cm4`、`cm52`、`cm55`、`cm7`、`cm85`。输出使用 `register_space.profile: M`：MRS/MSR 特殊寄存器使用 `m_profile_special`，SCB/NVIC/SysTick/MPU/SAU/FPU/DWT 等使用官方头文件中的真实 MMIO 地址。数组寄存器会展开为带索引的条目，Secure/Non-secure SCS 别名也会保留。

[CMSIS_6](https://github.com/ARM-software/CMSIS_6) 和 [Cortex_DFP](https://github.com/ARM-software/Cortex_DFP) 均为 Apache-2.0。分发生成 YAML 时保留 Arm 版权和许可证说明。CMSIS 没有为 `PRIMASK`、`FAULTMASK`、`BASEPRI` 和堆栈指针类特殊寄存器提供完整的 `*_Pos`/`*_Msk` 宏；导入器中的少量 `SPECIAL_FIELDS` 是明确标注的 M-profile 架构语义补充，不得继续凭经验扩张。每次更新 CMSIS 版本后运行：

```bash
npm run test:arm-cmsis-import
python3 .agents/skills/register-yaml-generator/scripts/validate_register_yaml.py --strict arm-cm33-system-registers.yaml
node .agents/skills/register-yaml-generator/scripts/check-browser-yaml.js arm-cm33-system-registers.yaml
```

导入器自身回归测试：

```bash
npm run test:arm-import
```

## RISC-V 官方 CSR 数据

RISC-V 架构 CSR 优先使用公开的 [RISC-V Unified Database](https://github.com/riscv-software-src/riscv-unified-db)，不从 Privileged ISA PDF 手工重建。输入目录必须包含 `spec/std/isa/csr`，并固定记录实际使用的 Git commit：

```bash
npm run riscv:import -- <riscv-unified-db目录> \
  --xlen 32 \
  --output riscv-rv32-csr.yaml \
  --version <snapshot-date> \
  --revision <git-commit>

npm run riscv:import -- <riscv-unified-db目录> \
  --xlen 64 \
  --output riscv-rv64-csr.yaml \
  --version <snapshot-date> \
  --revision <git-commit>
```

- 使用 schema v2、`register_space.kind: riscv_system` 和 `encoding.scheme: riscv_csr`；`encoding.address` 是 12-bit CSR 编号，不是 MMIO `addr`。
- RV32 和 RV64 必须分开生成。RV32 保留 `mcycleh`、`minstreth` 等高半 CSR；对共享的 64-bit CSR 条目只显示当前 XLEN 可见的低 32 bit。
- 静态 `RO-H`、`RW-R`、`RW-H`、`RW-RH` 不得降级为普通 `RO/RW`。动态 `type()`、`reset_value()`、参数条件和 `sw_write(csr_value)` 必须保留到对应元数据，不能自行求值。
- Unified Database 的条件描述可能是文本数组；生成结果不得出现 `[object Object]`，必须同时保留正文和 `when()` 条件。
- `spec/std/isa/csr` 当前源文件使用 BSD-3-Clause-Clear。生成文件和数据仓库必须保留提交号、逐条 `source_ref`、版权聚合 notice 和许可证全文；不要把其他目录的许可笼统套到 CSR 数据上。
- Unified Database 明确标记数据仍在快速演进。每次更新都要重新统计寄存器/字段数量并跑完整校验，不能假定不同提交之间 schema 稳定。

导入器回归测试：

```bash
npm run test:riscv-import
python3 .agents/skills/register-yaml-generator/scripts/validate_register_yaml.py --strict riscv-rv32-csr.yaml riscv-rv64-csr.yaml
node .agents/skills/register-yaml-generator/scripts/check-browser-yaml.js riscv-rv32-csr.yaml riscv-rv64-csr.yaml
```

## 质量规则

- 以 datasheet 为事实来源；不要根据相邻型号或常识补值。
- 使用 `width` 表示寄存器物理存储字节数，不是 bit 数；非整字节有效位用 `bit_width`。
- 使用 `address_span` 表示寄存器占用的地址单位数，默认等于 `width`；非字节编址页面显式填写 `address_unit_bits`。
- 使用 `hi:lo` 或单个 bit 编写 `bits`，确保范围落在 `bit_width`（默认 `width * 8`）内。
- 优先使用结构化 `values` 表示枚举，并使用 `0x` 前缀消除十进制/二进制歧义。
- 为重叠的联合视图和单字节视图添加 `alias_note`；为多字节视图添加 `multi_byte: true`。
- 在 `desc` 中明确复位值、单位、换算公式、有效条件和读写副作用，但不要重复可以由字段直接表达的信息。
- 保持页面内寄存器按地址递增；同地址别名紧邻排列。
- 保留 reserved 位，便于检查位域覆盖；资料没有位域表时允许省略 `fields`。
- 仅生成浏览器轻量解析器支持的 YAML。不要使用块字符串、锚点、别名、标签、内联对象或多文档语法。

## 维护现有文件

仅修改有可靠来源支持的部分。新增或调整寄存器后重新验证整个文件，因为 `width`、地址重叠和分页变化会影响其他条目。若新增 schema 字段，先确认前端或下游工具会消费该字段，再更新 [references/schema.md](references/schema.md) 和校验脚本。
