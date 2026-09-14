/**
 * 页面交互流程校验。用 stub 的 wx / Page 真实加载 pages/tools/index.js，
 * 然后模拟点击与输入，断言 data 的变化，用来兜住无法用微信开发者工具跑出来的运行时错误。
 * 运行：node miniprogram/tests/page-flow.test.mjs
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "..");

global.wx = {
  getWindowInfo: () => ({ windowWidth: 375 }),
  getSystemInfoSync: () => ({ windowWidth: 375, theme: "light" }),
  createSelectorQuery: () => ({
    in: () => ({
      select: () => ({
        boundingClientRect: (callback) => ({
          exec: () => callback({ left: 0, top: 0, width: 750, height: 400 }),
        }),
      }),
    }),
  }),
};

let captured = null;
global.Page = (config) => {
  captured = config;
};
require(resolve(root, "pages/tools/index.js"));
assert.ok(captured, "页面模块应调用 Page()");

function createInstance() {
  const instance = {
    data: JSON.parse(JSON.stringify(captured.data)),
    setData(patch) {
      Object.assign(this.data, patch);
    },
  };
  for (const [key, value] of Object.entries(captured)) {
    if (typeof value === "function") instance[key] = value.bind(instance);
  }
  return instance;
}

const tap = (dataset, detail = {}) => ({ currentTarget: { dataset }, detail });
const touch = (clientX) => ({ touches: [{ clientX, clientY: 0 }] });

/* ---------- 初始化 ---------- */

const page = createInstance();
page.onLoad();
assert.equal(page.data.bitWidth, 32);
assert.equal(page.value, 0n);
assert.equal(page.data.hexText, "00000000");
assert.equal(page.data.binText, "0".repeat(32));
assert.equal(page.data.bits.length, 32);
assert.equal(page.data.fields.length, 1);
assert.equal(page.data.fields[0].range, "31:0");
assert.equal(page.data.bytes.length, 4);
assert.equal(page.data.trackWidth, 32 * 44);
console.log("init: 默认 32 bit，单个位域，字节与位行长度正确");

/* ---------- 数值输入与格式回填 ---------- */

page.onValueInput(tap({ kind: "hex" }, { value: "2A" }));
assert.equal(page.value, 42n);
assert.equal(page.data.hexText, "2A", "编辑中的输入框应保留用户原文");
assert.equal(page.data.decText, "42");
assert.equal(page.data.binText, "0".repeat(26) + "101010");
assert.equal(page.data.inputErrors.hex, false);

page.onValueBlur();
assert.equal(page.data.hexText, "0000002A", "失焦后应回填为规范化格式");

page.onValueInput(tap({ kind: "dec" }, { value: "4294967296" }));
assert.equal(page.data.inputErrors.dec, true, "超出位宽应标记为非法");
assert.equal(page.value, 42n, "非法输入不应改变当前值");
assert.match(page.data.status, /超出当前 32 bit 位宽/);

page.onValueInput(tap({ kind: "dec" }, { value: "255" }));
assert.equal(page.value, 255n);
assert.equal(page.data.inputErrors.dec, false);
console.log("input: 十六进制/十进制输入、非法值拦截与格式回填通过");

/* ---------- 位宽与符号 ---------- */

page.onWidthChange(tap({ width: 8 }));
assert.equal(page.data.bitWidth, 8);
assert.equal(page.value, 255n, "切换位宽应按新位宽截断");
assert.equal(page.data.hexText, "FF");
assert.equal(page.data.maxShift, 8);
assert.equal(page.data.fields.length, 1, "切换位宽应重置位域划分");

page.onSignedChange(tap({ signed: "true" }));
assert.equal(page.data.signed, true);
assert.equal(page.data.decText, "-1");
page.onSignedChange(tap({ signed: "false" }));
assert.equal(page.data.decText, "255");
console.log("width/sign: 位宽切换与有符号解释通过");

/* ---------- 位翻转与位操作 ---------- */

page.onBitToggle(tap({ bit: 0 }));
assert.equal(page.value, 254n);
assert.equal(page.data.bits[page.data.bits.length - 1].set, false);

page.onOperation(tap({ operation: "invert" }));
assert.equal(page.value, 1n);
page.onOperation(tap({ operation: "ones" }));
assert.equal(page.value, 255n);
page.onOperation(tap({ operation: "increment" }));
assert.equal(page.value, 0n, "溢出应按位宽回绕");
page.onOperation(tap({ operation: "decrement" }));
assert.equal(page.value, 255n);

page.onShiftStep(tap({ direction: "left", delta: 1 }));
assert.equal(page.data.shiftLeft, 2);
page.onShiftStep(tap({ direction: "left", delta: -1 }));
assert.equal(page.data.shiftLeft, 1);
page.onShiftInput(tap({ direction: "right" }, { value: "99" }));
assert.equal(page.data.shiftRight, 8, "移位位数应被夹到位宽以内");
page.onShiftInput(tap({ direction: "right" }, { value: "1" }));
assert.equal(page.data.shiftRight, 1);

page.onOperation(tap({ operation: "shift-left" }));
assert.equal(page.value, 254n, "255 << 1 应按 8 bit 截断");
page.onOperation(tap({ operation: "shift-right" }));
assert.equal(page.value, 127n, "254 >> 1");
page.onShiftInput(tap({ direction: "right" }, { value: "8" }));
page.onOperation(tap({ operation: "shift-right" }));
assert.equal(page.value, 0n, "254 >> 8 应清零");
console.log("operations: 位翻转、取反、自增回绕、移位与夹取通过");

/* ---------- 位域划分 ---------- */

page.onBitIndexStart(tap({ bitIndex: 7 }));
assert.deepEqual(page.selection, { start: 7, end: 7 });

// columnPx = 44 * (375 / 750) = 22。x=30 落在第 2 列（bit 6），x=77 落在第 4 列（bit 4）。
page.onBitIndexMove(touch(30));
assert.equal(page.selection.end, 6, "x=30 应对应 bit 6");
page.onBitIndexMove(touch(77));
assert.equal(page.selection.end, 4, "x=77 应对应 bit 4");

page.onBitIndexEnd();
assert.deepEqual(
  page.data.fields.map((item) => item.range),
  ["7:4", "3:0"],
);
assert.equal(page.selection, null);
console.log("fields: 拖动位号划定位域通过");

page.onBitIndexStart(tap({ bitIndex: 5 }));
page.onBitIndexMove(touch(70));
page.onBitIndexEnd();
assert.deepEqual(
  page.data.fields.map((item) => item.range),
  ["7:6", "5:4", "3:0"],
);
console.log("fields: 在位域内部继续划分通过");

/* ---------- 位域读写 ---------- */

page.onSelectField(tap({ key: "3:0" }));
assert.equal(page.data.activeFieldKey, "3:0");
assert.equal(page.data.fields.find((item) => item.key === "3:0").active, true);

page.value = 0n;
page.render();
page.onFieldInput(tap({ key: "3:0", kind: "hex" }, { value: "F" }));
assert.equal(page.value, 15n);
assert.equal(page.data.hexText, "0F");

page.onFieldInput(tap({ key: "3:0", kind: "hex" }, { value: "10" }));
assert.equal(page.value, 15n, "超出字段范围的输入不应改变值");
assert.equal(page.data.fields.find((item) => item.key === "3:0").hexInvalid, true);

page.onFieldInput(tap({ key: "3:0", kind: "dec" }, { value: "12" }));
assert.equal(page.value, 12n);
assert.equal(page.data.fields.find((item) => item.key === "3:0").decInvalid, false);

page.onFieldInput(tap({ key: "7:6", kind: "name" }, { value: "mode" }));
assert.equal(page.data.fields.find((item) => item.key === "7:6").name, "mode");

page.onFieldBlur();
page.render();
assert.equal(page.data.fields.find((item) => item.key === "3:0").hex, "C");
console.log("fields: 位域选中、HEX/DEC 写入与名称编辑通过");

page.onResetFields();
assert.equal(page.data.fields.length, 1);
assert.equal(page.data.fields[0].range, "7:0");
console.log("fields: 重置划分通过");

/* ---------- 计算器 ---------- */

page.onCalculatorInput(tap({}, { value: "0x20 + 10" }));
assert.equal(page.data.calculatorInput, "0x20 + 10");
page.onSubmitExpression();
assert.equal(page.data.history.length, 1);
assert.equal(page.data.history[0].expression, "0x20 + 10");
assert.equal(page.data.history[0].dec, "42");
assert.equal(page.data.history[0].hex, "0x2A");
assert.equal(page.data.calculatorInput, "", "提交后应清空输入框");
assert.equal(page.data.canClearHistory, true);

page.onCalculatorInput(tap({}, { value: "ans * 2" }));
page.onSubmitExpression();
assert.equal(page.data.history[0].dec, "84", "ans 应引用上一条结果");
assert.equal(page.data.history.length, 2);

page.onCalculatorInput(tap({}, { value: "1 / 0" }));
page.onSubmitExpression();
assert.equal(page.data.history[0].error, "除数不能为 0");
assert.equal(page.data.history[0].dec, "");

page.onUseResult({ currentTarget: { dataset: { dec: "84" } } });
assert.equal(page.data.calculatorInput, "84", "点击历史结果应回填到输入框");

page.onClearHistory();
assert.equal(page.data.history.length, 0);
assert.equal(page.data.canClearHistory, false);
assert.equal(page.lastResult, null);
console.log("calculator: 求值、ans 引用、错误展示、历史回填与清空通过");

/* ---------- 历史条数上限 ---------- */

for (let index = 0; index < 60; index += 1) {
  page.onCalculatorInput({ currentTarget: { dataset: {} }, detail: { value: `${index} + 1` } });
  page.onSubmitExpression();
}
assert.equal(page.data.history.length, 50, "历史应限制在 50 条");
console.log("calculator: 历史上限生效");

console.log("\nminiprogram page flow tests passed");
