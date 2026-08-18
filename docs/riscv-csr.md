# RISC-V CSR 数据生成

## 官方来源

本项目使用公开的 [RISC-V Unified Database](https://github.com/riscv-software-src/riscv-unified-db) 作为架构 CSR 的机器可读来源，读取 `spec/std/isa/csr/**/*.yaml`。当前已验证快照：

- 日期：`2026-08-18`
- Git commit：`22776b219c386d549e07b14ed0e781ae7956e11a`
- 源 CSR：396 个
- 源字段：1307 个

Unified Database 仍在快速开发，仓库 README 也明确提示 `spec` 数据可能变化或存在错误。因此每次更新必须固定 commit、重新运行导入器测试和全量校验，不能把“最新分支”当作可复现版本。

## 生成

输入目录必须包含 `spec/std/isa/csr`。RV32 与 RV64 分开生成：

```bash
npm run riscv:import -- <riscv-unified-db目录> \
  --xlen 32 \
  --output riscv-rv32-csr.yaml \
  --version 2026-08-18 \
  --revision 22776b219c386d549e07b14ed0e781ae7956e11a

npm run riscv:import -- <riscv-unified-db目录> \
  --xlen 64 \
  --output riscv-rv64-csr.yaml \
  --version 2026-08-18 \
  --revision 22776b219c386d549e07b14ed0e781ae7956e11a
```

输出采用 schema v2：

```yaml
register_space:
  kind: "riscv_system"
  architecture: "RV64"
  profile: "privileged"

encoding:
  scheme: "riscv_csr"
  address: 0x300
```

`encoding.address` 是指令编码中的 12-bit CSR 编号，不是内存地址。前端显示为 `CSR 0x300`，搜索支持 CSR 编号、寄存器名、扩展名、条件和说明文本；备注使用 `riscv_csr:address=<十进制编号>:<寄存器名>` 作为稳定身份。

## XLEN 与动态语义

- `MXLEN`、`SXLEN`、`VSXLEN` 和 `XLEN` 按目标 XLEN 解析。
- RV32 对共享的 64-bit CSR 显示当前可见的低 32 bit，同时保留官方定义的 `*h` 高半 CSR。
- 只在 RV32 存在的高半 CSR 不进入 RV64 文件；字段级 `definedBy.xlen` 也会按目标过滤。
- 静态 `RO-H`、`RW-R`、`RW-H`、`RW-RH` 原样保留。
- 无法静态求值的 `type()`、`reset_value()`、参数条件与 `sw_write(csr_value)` 分别保留到 `access_rules`、`reset_info`、`condition` 和 `action_hint`。
- 条件描述数组会合并正文并保留 `when()` 表达式，不会降级成 `[object Object]`。

主数值和位域仍由查看器的 `BigInt` 路径处理；字段值按字段自身位宽解释。

## 许可

当前快照的 396 个 `spec/std/isa/csr/**/*.yaml` 均标记 `BSD-3-Clause-Clear`。这些文件的版权声明来自 Qualcomm Technologies, Inc. and/or its subsidiaries、Katherine Hsu、Muhammad Abdullah - 10xEngineers、Salil Mittal 和 Syed Owais Ali Shah。

生成数据必须保留：

- `source.revision` 中的 Git commit
- 每个寄存器的 `source_ref`
- `source.license: BSD-3-Clause-Clear`
- 数据仓库的聚合 NOTICE 和 `LICENSES/BSD-3-Clause-Clear.txt`

Unified Database 的其他目录可能使用不同许可。例如 `data/arch_overlay` 的聚合内容包含 CC-BY-4.0；本导入器不读取该目录，因此不能把它笼统写进 CSR 生成文件的许可证。

## 验证

```bash
npm run test:riscv-import
python3 .agents/skills/register-yaml-generator/scripts/validate_register_yaml.py --strict riscv-rv32-csr.yaml riscv-rv64-csr.yaml
node .agents/skills/register-yaml-generator/scripts/check-browser-yaml.js riscv-rv32-csr.yaml riscv-rv64-csr.yaml
```

发布到 `register-yaml-library` 后还需要运行该仓库的 `npm test`，确认 Python/JavaScript 校验、浏览器 YAML 子集、翻译 sidecar 和 `catalog.json` 全部同步。
