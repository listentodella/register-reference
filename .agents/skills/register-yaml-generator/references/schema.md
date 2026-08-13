# 寄存器 YAML 规范

## 目录

- 顶层结构
- 页面结构
- 寄存器结构
- 位域结构
- 枚举写法
- 特殊寄存器建模
- 浏览器 YAML 子集
- 生成检查表

## 顶层结构

```yaml
schema_version: 1
sensor: CHIP_MODEL
vendor: VENDOR_NAME
family: CHIP_FAMILY
device_type: sensor
who_am_i:
  reg: 0x00
  values:
    - value: 0x42
      desc: "芯片身份值"

pages:
  UI:
    page_id: 0x00
    access: "SPI / I2C"
    desc: "主接口寄存器页"
    registers: []
```

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `schema_version` | positive integer | 建议 | YAML 结构版本；新文件使用 `1` |
| `sensor` | string | 必填 | 下拉框显示的芯片型号，也是生成 `_id` 的来源 |
| `vendor` | string | 可选 | 芯片或 IP 供应商 |
| `family` | string | 可选 | 产品系列或 IP 家族 |
| `device_type` | string | 可选 | 固有器件类型，如 `imu`、`usb_controller` |
| `who_am_i` | object | 建议 | 身份寄存器信息；当前前端保留数据但不单独渲染 |
| `who_am_i.reg` | integer/null | 必填 | 身份寄存器地址；资料未提供时写 `null` |
| `who_am_i.values` | list | 必填 | 可接受的身份值；未知时写空列表 |
| `pages` | mapping | 必填 | 键是页面名称，例如 `UI`、`OIS`、`BANK1` |

`who_am_i.values` 的每项包含数值 `value` 和文字 `desc`。不同 silicon revision 可列出多个值。不要把芯片版本寄存器值误写成 WHO_AM_I。

## 页面结构

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `page_id` | integer | 必填 | 页编号；无分页芯片使用 `0x00` |
| `address_unit_bits` | positive integer | 可选 | 一个地址单位的位数，默认 8 |
| `access` | string | 必填 | 页面访问接口，例如 `"SPI / I2C / I3C"` |
| `desc` | string | 必填 | 页用途、切页方式或资料版本说明 |
| `registers` | list | 必填 | 本页寄存器列表，可为空 |

不同页面可以使用相同寄存器地址。页面名和 `page_id` 应在芯片内唯一；如果 datasheet 使用 bank 概念，仍使用 `pages` 表示。

## 寄存器结构

最小寄存器：

```yaml
- addr: 0x10
  name: CTRL0
  access: RW
  width: 1
  desc: "控制寄存器 0"
  fields:
    - name: enable
      bits: "0:0"
      desc: "功能使能"
      values:
        0x00: "禁用"
        0x01: "使能"
```

| 字段 | 类型 | 要求 | 前端行为 |
| --- | --- | --- | --- |
| `addr` | integer | 必填 | 起始字节地址，矩阵和表格用于定位 |
| `name` | string | 必填 | 寄存器名称和搜索关键字 |
| `access` | string | 必填 | 建议使用 `RO`、`RW`、`WO` |
| `width` | positive integer | 必填 | 占用字节数；默认视为 1，但应显式填写 |
| `bit_width` | positive integer | 可选 | 实际有效位数，默认 `width * 8` |
| `address_span` | positive integer | 可选 | 占用地址单位数，默认等于 `width` |
| `byte_order` | string | 可选 | 多字节数值的字节序，使用 `little` 或 `big` |
| `reset` | integer | 可选 | 寄存器复位值，优先使用十六进制 |
| `desc` | string | 必填 | 寄存器用途和重要行为 |
| `fields` | list | 可选 | 位域列表；没有可靠位域资料时可省略 |
| `multi_byte` | boolean | 可选 | 标记多字节聚合/联合读取视图；前端不会直接显示该聚合条目 |
| `read_clear` | boolean | 可选 | 显示 `read-clear` 警示 |
| `no_dump` | boolean | 可选 | 显示 `no-dump` 警示，标记不应普通遍历读取的端口 |
| `no_dump_reason` | string | 可选 | 记录不能普通读取的原因；当前 UI 不渲染 |
| `alias_note` | string | 可选 | 显示地址重叠或别名说明 |
| `roles` | list[string] | 可选 | 语义标签；当前 UI 仅据其标记特殊寄存器 |
| `event` | string | 可选 | 下游事件语义；当前 UI 不渲染 |
| `target` | string | 可选 | 下游目标语义，如 `int1`；当前 UI 不渲染 |
| `action_hint` | string | 可选 | 下游建议动作；当前 UI 不渲染 |
| `ignore_by_default` | boolean | 可选 | 下游默认忽略提示；当前 UI 不渲染 |

`addr + address_span - 1` 是该条目覆盖的最后地址；省略 `address_span` 时使用 `width`。当前前端允许地址重叠，以便同时表达一个多字节逻辑视图和多个单字节物理寄存器；此时为相关条目填写 `alias_note`。

## 位域结构

```yaml
fields:
  - name: mode
    bits: "3:1"
    desc: "工作模式"
```

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `name` | string | 必填 | 位域标识符，优先保留 datasheet 名称 |
| `bits` | quoted string | 必填 | `"7:4"`、`"3:3"` 或 `"0"`；推荐统一使用 `hi:lo` |
| `desc` | string | 必填 | 含义、单位、公式、有效条件和跨寄存器拼接方式 |
| `access` | string | 可选 | 位域访问属性，如 `RO`、`RW`、`RW_SC` |
| `reset` | integer | 可选 | 位域复位值，优先使用十六进制 |
| `values` | mapping/list | 可选 | 结构化枚举 |
| `roles`、`event`、`target`、`action_hint`、`ignore_by_default` | mixed | 可选 | 与寄存器同名语义元数据 |

位域最高位必须小于 `bit_width`；省略 `bit_width` 时使用 `width * 8`。同一寄存器内的普通位域不应重叠。多字节联合视图可使用如 `"47:32"` 的范围；在寄存器描述中明确低地址字节、高地址字节和数值高低位的关系。

为已知但保留的位创建 `reserved7_4` 等字段，并在 `desc` 中写“保留”或资料中的写入要求。不要假设 reserved 位应写 0，除非资料明确说明。

## 枚举写法

优先使用 mapping：

```yaml
values:
  0x00: "待机"
  0x01: "正常工作"
  0x02: "低功耗"
```

需要为值附加更多可读信息时可使用 list：

```yaml
values:
  - value: 0x00
    desc: "待机"
  - value: 0x01
    desc: "正常工作"
```

也兼容将枚举逐行放入 `desc`：

```yaml
desc: "工作模式\n0x00 = 待机\n0x01 = 正常工作\n0x04~0x07 = 保留"
```

内联枚举行必须单独成行，格式为 `值 = 描述` 或 `起值~止值 = 描述`。优先使用 `0x` 前缀；裸数字在短位域中可能被解释为二进制。`其它 = ...`、通配符和条件表达式不会被前端识别成枚举，应作为普通说明文字。

## 特殊寄存器建模

多字节数据块：设置 `width` 和 `multi_byte: true`，说明字节序；如同时保留单字节条目，给双方添加 `alias_note`。前端展示时优先使用范围内已有的细粒度物理寄存器；若没有物理条目，则按字节对齐的 `fields` 运行时拆分显示。YAML 中仍应保留聚合定义，以供驱动读取和下游工具使用。

FIFO 或流式数据端口：设置 `no_dump: true` 和 `no_dump_reason`，说明正确读取流程。不要把连续读取次数误写为寄存器 `width`。

读清零状态：设置 `read_clear: true`，并在 `desc` 中说明清除条件。若只清除部分位，在对应位域描述中精确说明。

写命令寄存器：使用 `WO` 或 datasheet 指定的访问属性；用枚举列出命令值，并说明完成/确认协议。

分页寄存器：每个页分别建模。页切换寄存器本身仍放在 datasheet 指定的页面中，在页面 `desc` 说明切换顺序。

## 浏览器 YAML 子集

项目的 `yaml-lite.js` 不是完整 YAML 解析器。生成文件时遵守以下限制：

- 仅使用空格缩进，推荐每级 2 个空格；不要使用 Tab。
- 使用普通 mapping、list 和标量；允许 `[item1, item2]` 内联列表。
- 使用 `null`、`true`、`false`、十进制、十六进制和普通字符串。
- 将包含 `:`、`#`、换行转义或特殊符号的描述放进引号。
- 多行描述使用双引号内的 `\n`，不要使用 `|` 或 `>` 块字符串。
- 不要使用 `{key: value}` 内联对象、anchor、alias、tag、directive、复杂 key 或 `---` 多文档分隔符。
- 避免依赖 YAML 1.1 隐式类型，例如 `yes`、`no`、`on`、`off`。

应用导入时会自动执行严格 schema 和浏览器兼容性检查，不合规 YAML 不会写入芯片库。安装后的应用使用内置 Rust/JavaScript 校验器，不需要 Python 或 Node；制作 YAML 和 CI 时仍应运行独立脚本进行预检。两项检查都通过才算完成。

## 生成检查表

- 型号、资料名称和 revision 是否对应。
- WHO_AM_I 地址和值是否来自明确资料。
- 页面是否完整，页号和切页说明是否正确。
- 地址、名称、RO/RW/WO 和字节宽度是否逐项核对。
- 所有位域是否在范围内，是否存在意外重叠或遗漏。
- 枚举值是否适合位域宽度，单位和公式是否保留。
- 多字节数据的字节序、符号位和有效位是否说明。
- read-clear、write-one-to-clear、FIFO、命令端口等副作用是否说明。
- 未知信息是否明确标记，而不是推测补齐。
- 两个校验脚本和 `npm run data:build` 是否通过。
