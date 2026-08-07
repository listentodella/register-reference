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
