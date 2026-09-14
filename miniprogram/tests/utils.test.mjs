/**
 * 逻辑层回归测试。期望值来自桌面版实测（tools/test-viewer.mjs 的计算器用例与一次性探针），
 * 用于确认小程序端移植与原实现语义一致。运行：node miniprogram/tests/utils.test.mjs
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "..");
const radix = require(resolve(root, "utils/radix.js"));
const calculator = require(resolve(root, "utils/calculator.js"));
const jsep = require(resolve(root, "vendor/jsep.js"));

calculator.useParser(jsep);

/* ---------- 计算器：与桌面版逐条比对 ---------- */

const calculatorCases = [
  { expression: "0x20 + 10", dec: "42", hex: "0x2A" },
  { expression: "0b1010 + 0o7", dec: "17", hex: "0x11" },
  { expression: "7 // 2", dec: "3", hex: "0x3" },
  { expression: "-7 // 2", dec: "-4", hex: "-0x4" },
  { expression: "-7 % 2", dec: "1", hex: "0x1" },
  { expression: "1 << 10", dec: "1024", hex: "0x400" },
  { expression: "0xFF & 0x0F", dec: "15", hex: "0xF" },
  { expression: "2 ** 10", dec: "1024", hex: "0x400" },
  { expression: "~0", dec: "-1", hex: "-0x1" },
  { expression: "10 / 4", dec: "2.5", hex: "0x2.8" },
  { expression: "1_000 + 1", dec: "1001", hex: "0x3E9" },
  { expression: "(1 + 2) * 3", dec: "9", hex: "0x9" },
  { expression: "0x10 >> 2", dec: "4", hex: "0x4" },
  { expression: "5 % 3", dec: "2", hex: "0x2" },
  { expression: "-5 % 3", dec: "1", hex: "0x1" },
  { expression: "2 ** 0.5", dec: "1.4142135623730951", hex: "0x1.6A09E667F3BCD" },
  { expression: "1 + 2.5", dec: "3.5", hex: "0x3.8" },
  {
    expression: "0xFFFFFFFFFFFFFFFF + 1",
    dec: "18446744073709551616",
    hex: "0x10000000000000000",
  },
];

let lastResult = null;
for (const item of calculatorCases) {
  const value = calculator.calculate(item.expression, lastResult);
  assert.equal(
    calculator.formatResult(value),
    item.dec,
    `${item.expression} 的十进制结果应与桌面版一致`,
  );
  assert.equal(
    calculator.formatHexResult(value),
    item.hex,
    `${item.expression} 的十六进制结果应与桌面版一致`,
  );
  lastResult = value;
}

// ans 引用上一条结果（桌面版在上一步 1 + 2.5 = 3.5 之后得到 4.5）
const ansValue = calculator.calculate("ans + 1", 3.5);
assert.equal(calculator.formatResult(ansValue), "4.5");
assert.equal(calculator.formatHexResult(ansValue), "0x4.8");

assert.throws(() => calculator.calculate("1 / 0"), /除数不能为 0/);
assert.throws(() => calculator.calculate("1 +"), /Expected expression after \+/);
assert.throws(() => calculator.calculate("foo"), /未知名称 foo/);
assert.throws(() => calculator.calculate(""), /请输入表达式/);
assert.throws(() => calculator.calculate("1.5 & 1"), /位运算仅支持精确整数/);
assert.throws(() => calculator.calculate("1 << 70000"), /移位位数必须在 0 到 65536 之间/);
console.log(`calculator: ${calculatorCases.length + 10} 项与桌面版一致`);

/* ---------- 进制转换 ---------- */

assert.equal(radix.formatHex(0x2an, 8), "2A");
assert.equal(radix.formatHex(0x2an, 16), "002A");
assert.equal(radix.formatHex(0x2an, 64), "000000000000002A");
assert.equal(radix.formatBin(0x2an, 8), "00101010");
assert.equal(radix.formatBin(1n, 16), "0000000000000001");
assert.equal(radix.formatDec(0xffn, 8, false), "255");
assert.equal(radix.formatDec(0xffn, 8, true), "-1");
assert.equal(radix.formatDec(0x80n, 8, true), "-128");
assert.equal(radix.toSigned(0x8000000000000000n, 64), -9223372036854775808n);

assert.deepEqual(radix.hexBytes(0x2an, 16), [{ start: 1, text: "00" }, { start: 9, text: "2A" }]);

const parsedHex = radix.parseValue("0x2A", 16, 8, false);
assert.equal(parsedHex.ok, true);
assert.equal(parsedHex.value, 42n);

const parsedBinSuffix = radix.parseValue("1010b", 2, 8, false);
assert.equal(parsedBinSuffix.ok, true);
assert.equal(parsedBinSuffix.value, 10n);

const parsedSeparator = radix.parseValue("1_0", 16, 8, false);
assert.equal(parsedSeparator.ok, true);
assert.equal(parsedSeparator.value, 16n);

assert.equal(radix.parseValue("256", 10, 8, false).ok, false);
assert.equal(radix.parseValue("256", 10, 8, false).message, "超出当前 8 bit 位宽");
assert.equal(radix.parseValue("", 16, 8, false).ok, true);
assert.equal(radix.parseValue("xyz", 16, 8, false).ok, false);

const parsedSigned = radix.parseValue("-1", 10, 8, true);
assert.equal(parsedSigned.ok, true);
assert.equal(parsedSigned.value, 255n);
assert.equal(radix.parseValue("-129", 10, 8, true).ok, false);
assert.equal(radix.parseValue("128", 10, 8, true).ok, false);
assert.equal(radix.parseValue("-1", 10, 8, false).ok, false);
console.log("radix: 进制解析与格式化通过");

/* ---------- 位操作（按位宽截断） ---------- */

assert.equal(radix.applyOperation(0x2an, "zero", 8, 1), 0n);
assert.equal(radix.applyOperation(0n, "ones", 8, 1), 255n);
assert.equal(radix.applyOperation(0x2an, "invert", 8, 1), 0xd5n);
assert.equal(radix.applyOperation(0xffn, "increment", 8, 1), 0n);
assert.equal(radix.applyOperation(0n, "decrement", 8, 1), 255n);
assert.equal(radix.applyOperation(0x80n, "shift-left", 8, 1), 0n);
assert.equal(radix.applyOperation(0x80n, "shift-right", 8, 4), 8n);
assert.equal(radix.applyOperation(0x1n, "shift-left", 64, 63), 0x8000000000000000n);
console.log("radix: 位操作通过");

/* ---------- 位域划分 ---------- */

let fields = radix.createFields(8);
assert.deepEqual(fields, [{ high: 7, low: 0, name: "" }]);

const split = radix.applySelection(fields, 3, 0);
assert.equal(split.created, true);
assert.deepEqual(split.fields, [{ high: 7, low: 4, name: "" }, { high: 3, low: 0, name: "" }]);

const again = radix.applySelection(split.fields, 3, 0);
assert.equal(again.created, false);
assert.deepEqual(again.fields, split.fields);

const reversed = radix.applySelection(radix.createFields(8), 0, 3);
assert.deepEqual(reversed.fields, [{ high: 7, low: 4, name: "" }, { high: 3, low: 0, name: "" }]);

const middle = radix.applySelection(radix.createFields(8), 5, 2);
assert.deepEqual(middle.fields, [
  { high: 7, low: 6, name: "" },
  { high: 5, low: 2, name: "" },
  { high: 1, low: 0, name: "" },
]);

const single = radix.applySelection(radix.createFields(8), 0, 0);
assert.deepEqual(single.fields, [{ high: 7, low: 1, name: "" }, { high: 0, low: 0, name: "" }]);

const field = { high: 3, low: 0, name: "mode" };
assert.equal(radix.fieldWidth(field), 4);
assert.equal(radix.fieldMask(field), 0xfn);
assert.equal(radix.fieldValue(0x2an, field), 0xan);
assert.equal(radix.writeFieldValue(0x2an, field, 0x5n), 0x25n);
assert.equal(radix.formatFieldValue(field, 0x2an, 16), "A");
assert.equal(radix.formatFieldValue(field, 0x2an, 10), "10");
assert.equal(radix.formatFieldRange(field), "3:0");
assert.equal(radix.formatFieldRange({ high: 3, low: 3 }), "3");
assert.equal(radix.fieldAtBit(single.fields, 7).high, 7);
assert.equal(radix.fieldAtBit(single.fields, 0).low, 0);

const parsedField = radix.parseFieldValue("F", 16, field);
assert.equal(parsedField.ok, true);
assert.equal(parsedField.value, 15n);
assert.equal(radix.parseFieldValue("10", 16, field).ok, false);
assert.equal(radix.parseFieldValue("", 16, field).ok, true);

assert.deepEqual(radix.createFields(16), [{ high: 15, low: 0, name: "" }]);
assert.deepEqual(radix.createFields(64), [{ high: 63, low: 0, name: "" }]);
console.log("radix: 位域划分与读写通过");

console.log("\nminiprogram utils tests passed");
