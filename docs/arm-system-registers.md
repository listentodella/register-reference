# ARM 官方系统寄存器数据导入

## 结论

Arm 官方为 A-profile 提供机器可读的 System Register XML，不需要从庞大的 PDF 逐页重建。当前官方入口：

- [A-profile architecture downloads](https://support.arm.com/architectures/a-profile-architecture)
- [2026-06 non-FAT XML package](https://developer.arm.com/-/cdn-downloads/permalink/Exploration-Tools-Arm-Architecture-System-Registers/SysReg/SysReg_xml_A_profile-2026-06_mc.tar.gz)

2026-06 页面标注 Arm ARM revision `M.c`，覆盖到 Armv9.6。下载页当前提供 XML/HTML 包，没有独立 JSON 包。XML 是事实来源；本项目将其结构化转换为 schema v2 YAML。

M-profile 的官方机器来源与 A-profile 不同。CMSIS_6 的 `CMSIS/Core/Include/core_cm*.h` 和 `m-profile/cmsis_gcc_m.h` 包含 CPU 特殊寄存器、SCS/CoreSight 结构体偏移、基地址、访问属性、位域位置和掩码；本项目的 `tools/import-arm-cmsis.mjs` 从这些头文件生成混合 YAML。不要把 M-profile 特殊寄存器套成 A-profile 的 MRS 编码字段。

Arm 的 `Cortex_DFP` 仓库还提供 `SVD/ARMCM*.svd`，但当前官方文件的注释明确将其作为示例、虚构且不完整的设备描述，实际不含完整 `<peripheral>`/`<register>` 数据。因此它可以用来核对 CPU 元数据，不能作为本项目 SCS 位域的事实来源；完整定义应以对应 CMSIS-Core 头文件为准。

本轮核对的官方开源基线：

- [CMSIS_6 v6.3.0](https://github.com/ARM-software/CMSIS_6/tree/v6.3.0)，commit `45dab712ad84f8cbbf2b7bfc089c19088507df6f`；[Apache-2.0 LICENSE](https://github.com/ARM-software/CMSIS_6/blob/v6.3.0/LICENSE)。
- [Cortex_DFP v1.2.0](https://github.com/ARM-software/Cortex_DFP/tree/v1.2.0)，commit `cd38dbb875f7195e70460eee51faa7ab180c24a1`；[Apache-2.0 LICENSE](https://github.com/ARM-software/Cortex_DFP/blob/v1.2.0/LICENSE)。
- [CMSIS-Core(M) 在线文档](https://arm-software.github.io/CMSIS_6/latest/Core/index.html)。

目前没有发现与 A-profile System Register XML 等价、完整覆盖 M-profile CPU 特殊寄存器与 SCS 位域的 Arm 官方 XML/JSON。CMSIS 头文件也没有为 `PRIMASK`、`FAULTMASK`、`BASEPRI` 和堆栈指针类特殊寄存器提供完整的 `*_Pos`/`*_Msk` 宏。导入器仅为这些稳定值布局维护一个很小的 `SPECIAL_FIELDS` 表，语义由 CMSIS intrinsic 注释和对应 [Arm M-profile Architecture Reference Manual](https://developer.arm.com/Architectures/M-Profile%20Architecture) 交叉核对；这部分不是宏解析结果，也不能作为继续猜补其他字段的先例。

## 为什么不是 MMIO

AArch64 系统寄存器由 MRS/MSR 编码定位，例如 `SCTLR_EL1`：

```text
op0=3, op1=0, CRn=1, CRm=0, op2=0
S3_0_C1_C0_0
```

这不是内存地址。schema v2 使用：

```yaml
register_space:
  kind: "arm_system"
  architecture: "AArch64"
  profile: "A"
```

每个寄存器必须有 `encoding` 和 `accessors`，不得填写 `addr`、`address_span`、`byte_order`。查看器不会伪造地址矩阵：九宫格入口改为按全部架构分类组织的全局预览，传统视图显示完整系统编码和寄存器细节。

## 导入

项目开发依赖安装后，导入器可直接读取官方 `.tar.gz`，也可读取解压目录：

```bash
npm ci
npm run arm:import -- \
  SysReg_xml_A_profile-2026-06_mc.tar.gz \
  --output arm-aarch64-system-registers.yaml \
  --state AArch64 \
  --version 2026-06 \
  --revision M.c
```

只抽取少量寄存器用于核验：

```bash
npm run arm:import -- \
  SysReg_xml_A_profile-2026-06_mc.tar.gz \
  --output arm-control-sample.yaml \
  --register SCTLR_EL1 \
  --register TCR_EL1 \
  --register ID_AA64PFR0_EL1
```

AArch32 使用 `--state AArch32`。`--register` 可重复；当前按完整名称或名称片段筛选。

Cortex-M 使用独立导入器。输入 CMSIS_6 官方仓库或解压目录，选择一个内核头文件：

```bash
npm run arm:cmsis-import -- \
  <CMSIS_6目录> \
  --core cm33 \
  --version 6.3.0 \
  --output arm-cm33-system-registers.yaml
```

支持 `cm0`、`cm0plus`、`cm1`、`cm23`、`cm3`、`cm33`、`cm35p`、`cm4`、`cm52`、`cm55`、`cm7`、`cm85`。生成文件使用 `register_space.profile: M`：CPU 特殊寄存器使用 `m_profile_special`，SCB/NVIC/SysTick/MPU/SAU/FPU/DWT 等使用真实 MMIO 地址；数组寄存器展开为带索引的条目，Secure/Non-secure SCS 别名也会保留。

生成后执行与普通芯片 YAML 相同的检查：

```bash
python3 .agents/skills/register-yaml-generator/scripts/validate_register_yaml.py --strict arm-aarch64-system-registers.yaml
node .agents/skills/register-yaml-generator/scripts/check-browser-yaml.js arm-aarch64-system-registers.yaml
npm run test:arm-cmsis-import
```

安装后的应用导入 YAML 时仍使用内置 JavaScript/Rust 校验，不要求普通用户安装 Node 或 Python。Node 依赖只服务于开发期官方 XML 转换，不进入 Tauri 运行时。

## 保真范围

导入器保留：

- AArch64 与 AArch32 执行状态。
- MRS/MSR、MRRS/MSRR、MRC/MCR/MRRC/MCRR、LDC/STC 与 VMRS/VMSR 访问方法及编码。
- AArch64 隐式 special-purpose register，以及 AArch32 banked、VFP 和无独立 XML 编码节点的特殊寄存器。
- 同一逻辑寄存器的条件 accessor 与别名映射。
- 32/64/128-bit 寄存器。
- feature 条件字段与条件重叠布局。
- `partial_fieldset` 的相对位域会转换为寄存器绝对 bit，并继承父布局、`fields_condition` 与 `fields_instance` 条件。
- XML 中仅用于展开非连续位域/字段数组的 `is_expansion` 项会跳过，保留规范的聚合字段，避免重复覆盖同一 bit。
- `RES0`、`RES1` 等保留语义。
- 非连续位域，例如 `"87:80,47:5"`。
- 精确枚举、`0b00xx` 通配模式和 `0b000..0b100` 区间。
- 参数化寄存器变量、字段访问规则、可表达的 reset 及复杂 `reset_info`。
- 原始 XML 文件名 `source_ref`，用于回查。

访问权限伪代码没有完整复制进 YAML。它通常很长，且并不适合在速查表中直接执行；导入器保留访问指令、条件和字段级访问规则，复杂 trap/UNDEFINED 行为应通过 `source_ref` 回到官方 XML 核对。

## 版本与授权

官方包内 `notice.xml` 对 2026-06 数据标记 `LES-PRE-20349`，并声明 Arm 专有版权及使用/分发限制。它不是开源许可证。正确流程是：

1. 用户从 Arm 官方页面自行下载目标版本。
2. 在本地阅读并接受该版本 `notice.xml`。
3. 使用导入器本地生成 YAML。
4. 在 YAML `source` 中固定记录版本、revision、URL、license 性质和 notice 标识。
5. 未确认再分发权限前，不把原始 XML 或生成的完整寄存器包提交到本仓库、Release 或公共镜像。

项目测试只提交合成 XML fixture。真实 2026-06 数据用于本地端到端验证，不进入 Git。

M-profile 路径使用的 CMSIS_6 与 Cortex_DFP 仓库是 Apache-2.0。导入器及模板可以提交，基于 CMSIS 生成的 YAML 在分发时应保留许可证、Arm 版权和来源归属。Cortex_DFP 的许可证允许使用其内容，但其通用 SVD 在技术上不完整，因此“许可可用”不等于“数据适合作为寄存器事实源”。

## 验证基线

当前实现已用 2026-06 官方 XML 实测：

- 完整 AArch64：585 个寄存器、31 个功能组、6882 个展平位域，严格校验 0 warning。
- 完整 AArch32：276 个寄存器、22 个功能组、1692 个展平位域，严格校验 0 warning。
- 抽查 `SCTLR_EL1`、`TCR_EL1`、`ID_AA64PFR0_EL1`、128-bit/非连续位域 `VTTBR_EL2`。
- 抽查 AArch32 `SCTLR`、`MIDR`、`TTBCR`、banked MRS/MSR、VFP 与 p14 debug 寄存器。
- CMSIS_6 v6.3.0 的 12 个 Cortex-M 目标均可生成并通过严格 schema 与浏览器轻量 YAML 解析检查。

完整包导入应在升级官方版本时重新运行，重点检查 XML DTD、字段条件、编码参数命名和 notice 是否变化。
