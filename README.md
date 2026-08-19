# 寄存器速查工具

这是一个 Tauri v2 + vanilla HTML/CSS/JavaScript 的本地寄存器资料库。芯片定义仍使用可移植的 YAML；SQLite 只保存导入来源、分类、启用状态等本地管理信息，不污染 YAML。

## 示例数据

- `dwc3_rk3588.yaml`

可公开复用的寄存器数据已独立维护在 [register-yaml-library](https://github.com/listentodella/register-yaml-library)，并按架构、控制器、接口和厂商分类。该仓库提供机器可读 `catalog.json`、来源许可说明和自动规范校验；本查看器仓库只保留示例和测试所需的少量 YAML。

查看器默认以空芯片库启动，不再自动载入仓库中的 YAML。用户可以按需导入单个 YAML 或关联寄存器库目录；升级时，旧版本遗留的内置芯片条目会从本地数据库移除。仓库中的 `dwc3_rk3588.yaml` 仅作为格式示例、测试夹具和手动导入资料保留。

`dwc3_rk3588.yaml` 只以 Rockchip 原始文档为寄存器事实来源：

```text
RK3588 TRM-Part2, Chapter 13 USB3 Controller
```

生成脚本为 `tools/extract-dwc3-pdf.py`。它同时核对摘要表与详细位域表，并要求位域完整覆盖、位域复位值合成结果与寄存器复位值一致。

## ARM 系统寄存器

项目支持 schema v2 的非 MMIO `arm_system` 寄存器。A-profile 不必从 PDF 逐页生成：Arm 官方提供逐寄存器机器可读 XML，`tools/import-arm-mrs.mjs` 可直接读取官方 `.tar.gz` 或解压目录，生成可导入的 AArch64/AArch32 YAML。

```bash
npm run arm:import -- SysReg_xml_A_profile-2026-06_mc.tar.gz \
  --output arm-aarch64-system-registers.yaml \
  --state AArch64 \
  --version 2026-06 \
  --revision M.c
```

系统寄存器使用 MRS/MSR 或 MRC/MCR 结构化编码，不会伪装成 MMIO 地址。界面的九宫格入口会显示跨全部架构分类的紧凑全局预览；点击寄存器块会跳到对应分类的编码表格。当前模型支持条件重叠字段、非连续位域、通配枚举以及 128-bit 寄存器。来源、版本与 Arm 专有 notice 的处理详见 [docs/arm-system-registers.md](docs/arm-system-registers.md)。未确认 Arm 再分发条款前，不应把官方 XML 或生成的完整 ARM 数据包提交到仓库或 Release。

Cortex-M 使用 Arm 官方 [CMSIS_6](https://github.com/ARM-software/CMSIS_6) 头文件导入器。`core_cm*.h` 与 `m-profile/cmsis_gcc_m.h` 提供 CPU 特殊寄存器和 SCS/CoreSight 的地址、访问属性与位域定义；[Cortex_DFP](https://github.com/ARM-software/Cortex_DFP) 中的通用 SVD 当前是示例/不完整设备描述，不作为完整寄存器事实来源。生成 M-profile 数据：

```bash
npm run arm:cmsis-import -- <CMSIS_6目录> --core cm33 --version 6.3.0 --output arm-cm33-system-registers.yaml
```

M-profile YAML 可以同时包含 `m_profile_special` 特殊寄存器和带真实 `addr` 的 SCS MMIO 条目。CMSIS_6 为 Apache-2.0，生成数据应保留 Arm 版权与许可证归属；完整 A-profile XML 仍按其专有 notice 单独处理。

## RISC-V CSR

项目同样支持 schema v2 的 `riscv_system` 架构寄存器。官方机器可读来源使用公开的 [RISC-V Unified Database](https://github.com/riscv-software-src/riscv-unified-db) `spec/std/isa/csr`，不需要从庞大的 Privileged ISA PDF 逐页提取。RV32 与 RV64 分开生成：

```bash
npm run riscv:import -- <riscv-unified-db目录> \
  --xlen 32 \
  --output riscv-rv32-csr.yaml \
  --version 2026-08-18 \
  --revision 22776b219c386d549e07b14ed0e781ae7956e11a
```

CSR 使用 `encoding.scheme: riscv_csr` 与 12-bit `encoding.address`，不会伪装成 MMIO 地址。导入器保留扩展/XLEN/实现参数条件、动态访问类型、动态复位表达式和受限写入规则；RV32 还保留 `mcycleh`、`minstreth` 等高半 CSR。来源选择、许可和生成规则详见 [docs/riscv-csr.md](docs/riscv-csr.md)。可公开复用的 RV32/RV64 成品位于 `register-yaml-library/architecture/riscv`。

## 使用

开发环境需要 Node.js 22+、Rust stable 和对应平台的 Tauri 系统依赖，不再要求 Python 或 PyYAML。安装依赖并运行：

```bash
npm ci
npm run dev
```

构建当前平台的免安装应用：

```bash
npm run build
```

统一输出到 `src-tauri/target/release/portable/`：

- macOS：包含 `.app` 的 zip
- Windows：单文件 `.exe`
- Linux：单文件 `.AppImage`
- 所有平台同时生成 `SHA256SUMS.txt`

这些产物无需安装。用户数据仍保存在系统标准应用数据目录，而不是程序旁边；这样可以兼容 macOS App Translocation、Windows 受保护目录和 Linux AppImage 的只读挂载。

顶部工具栏常驻芯片、页面、搜索、语言、进制工具和视图切换。芯片库、附件、YAML 导入、寄存器库关联及主题位于右侧“更多工具”菜单；附件数量会显示在菜单入口上，译文状态则通过语言控件状态点和“关联寄存器库”说明显示。普通桌面宽度保持单行，窄屏仅对筛选控件做响应式换行。

在“芯片库”中可以：

- 导入一个或多个寄存器 YAML 或翻译 sidecar；同一次选择可以同时包含英文源与译文。
- 关联寄存器库目录；目录可以同时包含英文寄存器 YAML 与 `locales/<语言>/...` 译文，关联文件会在读取芯片库时同步。
- 导入时自动执行严格规范检查；不合规文件会被拒绝，并逐项显示原因。
- 编辑芯片分类。
- 控制芯片是否出现在主界面。
- 为具体寄存器添加“备注、注意、待确认”三类本地备注。
- 为芯片关联 PDF、Markdown、文本、图片或其他本地参考文件。
- 独立勾选需要分享的芯片，并导出单文件 HTML。

## 中英翻译

工具支持 `register-reference-translation` v1 sidecar。英文寄存器 YAML 始终是地址、位宽、位域、复位值和编码的唯一结构真源；译文只覆盖页面、寄存器、位域、枚举和条件等展示文本，不会改写芯片数据。

导入时可以先选择英文源、再选择 `locales/<语言>/<源路径>` 下的译文，也可以一次同时选择两者。桌面端和浏览器端都会验证 sidecar 结构、选择器以及 `source_sha256`；源文件不匹配、译文过期或包含结构字段时会拒绝导入。目录关联会先处理寄存器源，再处理其中的译文。推荐直接关联 `register-yaml-library` 根目录；如果英文源已经导入，也可以只选择 `locales/zh-CN`。

语言控件旁的目录图标会显示当前芯片的译文状态：绿色表示已绑定中文 sidecar，琥珀色表示当前仅有英文。译文正文会保存到桌面版 SQLite 中，语言切换不依赖编译期固定路径；原目录仅用于首次批量导入和后续自动刷新。因此移动便携程序不会丢失已导入译文，只有移动外部寄存器库后需要重新关联目录。

顶部的 `中文 | 中英 | EN` 控件决定展示方式。缺少单项译文时按字段回退英文；搜索始终同时匹配中英文，不受当前展示模式影响。`draft` / `reviewed` 和 `partial` / `complete` 状态会显示在芯片摘要与芯片库中。独立 HTML 导出会内联所选芯片当前匹配的译文，仍不会包含附件。

导出的 HTML 内联芯片 JSON、CSS、图标和查看器脚本，可以直接双击打开，不依赖 Tauri、Node、服务器或其他文件。

## 寄存器备注

备注是保存在 SQLite 中的独立覆盖层，不会修改 YAML，也不会在重新导入或同步 YAML 时被覆盖。每个寄存器可以保存多条备注；矩阵显示备注标记，悬浮详情和传统表格显示正文，搜索也会匹配备注内容。

MMIO 备注通过芯片、页面、寄存器地址和名称定位；系统寄存器备注通过结构化编码和名称定位。因此调整 YAML 中寄存器的排列顺序不会影响已有备注。独立 HTML 导出默认包含所选芯片的备注，也可以在芯片库中取消“包含备注”；分享版只读展示备注。

## 芯片附件

附件功能只在 SQLite 中保存芯片与本地文件绝对路径的关联，不复制文件内容。点击附件名称或打开按钮时由操作系统默认应用处理；也可以直接在 Finder 或其他平台的文件管理器中定位原文件。解除附件关联不会删除原文件，文件被移动或删除后会在列表中标记为不可用。

附件始终属于本机资料管理内容。无论独立 HTML 导出时选择哪些芯片，附件路径和文件内容都不会进入导出结果。

## 界面主题

工具内置“跟随系统、清晰亮色、石墨深色、Rusty 锈钢、高对比”五种主题。主题选择保存在浏览器或 WebView 的本地存储中，重新打开后继续生效；“跟随系统”会响应操作系统的明暗模式变化。主题只调整颜色令牌，不提供自定义背景图片，避免影响寄存器矩阵和位域信息的辨识。

主题结构参考了开源项目 [GitHub Primer Primitives](https://github.com/primer/primitives) 的语义颜色分层、[Catppuccin Palette](https://github.com/catppuccin/palette) 的完整状态色组织，以及 [Dracula Theme](https://github.com/dracula/dracula-theme) 的深色对比度实践。项目使用自己的配色和组件样式，并未引入这些项目的运行时依赖。

安装后的桌面应用不依赖 Python、Node 或外部 SQLite。桌面端使用已编译进应用的 Rust 校验器，纯 HTML 模式使用页面内置的 JavaScript 校验器。Node 只用于项目构建与自动化测试；Python 仅供可选的 YAML 制作和独立严格校验脚本使用，二者都不会随应用打包，也不要求普通用户安装。

## 跨平台支持

正式支持目标为 macOS 12+、Windows 10/11，以及 Ubuntu 22.04/24.04 和兼容桌面发行版。三平台共享同一套前端、Rust YAML 校验和 bundled SQLite；数据库使用各系统标准应用数据目录。发布形式以免安装包为主，不要求用户运行安装程序。

附件打开与定位使用 Tauri 官方 opener：macOS 使用 Finder，Windows 使用 Shell API，Linux 优先使用 `org.freedesktop.FileManager1` 和桌面 portal。系统文件选择器、窗口标题栏和默认字体会保留平台原生表现，寄存器矩阵、主题、字段解码和操作流程保持一致。

`.github/workflows/cross-platform.yml` 会在 macOS、Windows 和 Ubuntu 上分别运行 Chromium、WebKit、Rust 测试并构建原生安装产物。CI 产物用于兼容性验证，正式对外分发前仍需配置 Apple Developer ID 和 Windows 代码签名证书。

附件与关联寄存器库目录保存本机绝对路径，因此复制数据库到另一台电脑或另一种操作系统后，需要重新关联这些本地文件；芯片数据、译文正文、分类和备注不受影响。

根目录导入的 YAML、构建生成的 `data/chips.data.js` 和单文件 HTML 默认不会进入 Git。需要提交新的公开示例 YAML 时，应先确认资料授权，再在 `.gitignore` 中显式放行对应文件；示例文件不会被工具自动载入。普通用户导入的 YAML 只保存在本机资料库中。

## YAML 工作流

项目级生成说明位于 `.agents/skills/register-yaml-generator/SKILL.md`，schema 说明位于 `.agents/skills/register-yaml-generator/references/schema.md`。

应用导入 YAML 时会自动严格校验。开发或制作 YAML 时，仍建议提前运行独立校验脚本，以便在导入前修正问题：

```bash
python3 .agents/skills/register-yaml-generator/scripts/validate_register_yaml.py --strict chip.yaml
node .agents/skills/register-yaml-generator/scripts/check-browser-yaml.js chip.yaml
npm run test:arm-import
npm run test:riscv-import
npm run data:build
```

查看器回归测试：

```bash
npm run test:web
```

`width` 表示物理字节数，`bit_width` 表示有效位宽，`address_span` 表示占用的地址单位数。前端使用 `BigInt` 解码寄存器值，并为超过 JavaScript 安全整数范围的 YAML 数值保留字符串形式。
