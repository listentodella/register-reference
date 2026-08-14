import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, webkit } from "playwright";

const root = resolve(import.meta.dirname, "..");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browserEngine = process.env.BROWSER_ENGINE || "chromium";
const browserType = { chromium, webkit }[browserEngine];
if (!browserType) throw new Error(`unsupported BROWSER_ENGINE: ${browserEngine}`);
const launchOptions = browserEngine === "chromium" && existsSync(chromePath) ? { executablePath: chromePath } : {};
const suiteWatchdog = setTimeout(() => {
  console.error(`${browserEngine} viewer tests exceeded the 120 second suite timeout`);
  process.exit(1);
}, 120_000);

console.log(`[${browserEngine}] launching browser`);
const browser = await browserType.launch(launchOptions);
console.log(`[${browserEngine}] browser launched`);

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(pathToFileURL(resolve(root, "index.html")).href, { waitUntil: "load" });
  assert.equal(await page.locator("#matrixViewButton").innerText(), "");
  assert.equal(await page.locator("#tableViewButton").innerText(), "");
  assert.equal(await page.locator("#matrixViewButton svg").count(), 1);
  assert.equal(await page.locator("#tableViewButton svg").count(), 1);
  assert.equal(await page.locator("#matrixViewButton").getAttribute("aria-selected"), "true");
  await page.locator("#tableViewButton").click();
  assert.equal(await page.locator("#tableViewButton").getAttribute("aria-selected"), "true");
  assert.equal(await page.locator("#matrixViewButton").getAttribute("aria-selected"), "false");
  await page.locator("#matrixViewButton").click();
  await page.locator("#radixToolButton").click();
  await page.waitForSelector("#radixDialog:not([hidden])");
  assert.equal(await page.locator("#radixToolButton").getAttribute("aria-expanded"), "true");
  assert.equal(await page.locator(".radix-dialog-body > :first-child").evaluate((element) => element.matches(".calculator-section")), true);
  await page.locator("#tableViewButton").click();
  assert.equal(await page.locator("#tableViewButton").getAttribute("aria-selected"), "true");
  assert.equal(await page.locator("#radixDialog").isVisible(), true);
  await page.locator("#matrixViewButton").click();
  assert.equal(await page.locator("#radixWidthControl [aria-selected='true']").getAttribute("data-radix-width"), "32");
  assert.equal(await page.locator("#radixHexInput").inputValue(), "00000000");
  assert.equal(await page.locator("#radixBinInput").inputValue(), "0".repeat(32));
  assert.equal(await page.locator(".calculator-terminal button").count(), 0);
  assert.equal(await page.locator("#calculatorClearButton").isDisabled(), true);
  const calculate = async (expression) => {
    await page.locator("#calculatorInput").fill(expression);
    await page.locator("#calculatorInput").press("Enter");
    return page.locator("#calculatorHistory .calculator-entry").last();
  };
  const assertCalculation = async (expression, dec, hex) => {
    const entry = await calculate(expression);
    assert.equal(await entry.locator("[data-calculator-dec]").innerText(), dec);
    assert.equal(await entry.locator("[data-calculator-hex]").innerText(), hex);
  };
  await assertCalculation("1 + 2 * 3", "7", "0x7");
  assert.equal(await page.locator("#calculatorClearButton").isEnabled(), true);
  await assertCalculation("0xFF & 0x0F", "15", "0xF");
  await assertCalculation("(0x12 << 8) | 0x34", "4660", "0x1234");
  await assertCalculation("0xFFFFFFFFFFFFFFFF + 1", "18446744073709551616", "0x10000000000000000");
  await assertCalculation("1_000 + 24", "1024", "0x400");
  await assertCalculation("-7 // 2", "-4", "-0x4");
  await assertCalculation("1 / 2", "0.5", "0x0.8");
  await assertCalculation("ans + 1", "1.5", "0x1.8");
  const divisionError = await calculate("1 / 0");
  assert.match(await divisionError.locator("[data-calculator-error]").innerText(), /除数不能为 0/);
  assert.equal(await page.locator("#calculatorHistory .calculator-entry").last().evaluate((entry) => entry.classList.contains("error")), true);
  await assertCalculation("ans", "1.5", "0x1.8");
  const memberError = await calculate("window.location");
  assert.match(await memberError.locator("[data-calculator-error]").innerText(), /仅支持数字、括号和算术或位运算符/);
  const callError = await calculate("max(1, 2)");
  assert.match(await callError.locator("[data-calculator-error]").innerText(), /仅支持数字、括号和算术或位运算符/);
  await page.locator("#calculatorInput").fill("draft");
  await page.locator("#calculatorInput").press("ArrowUp");
  assert.equal(await page.locator("#calculatorInput").inputValue(), "max(1, 2)");
  await page.locator("#calculatorInput").press("ArrowDown");
  assert.equal(await page.locator("#calculatorInput").inputValue(), "draft");
  await page.locator("#calculatorInput").fill("2 + 2");
  await page.locator("#calculatorClearButton").click();
  assert.equal(await page.locator("#calculatorHistory .calculator-entry").count(), 0);
  assert.equal(await page.locator("#calculatorClearButton").isDisabled(), true);
  assert.equal(await page.locator("#calculatorInput").inputValue(), "2 + 2");
  await page.locator("#calculatorInput").fill("ans");
  const clearedAnswerError = await calculate("ans");
  assert.match(await clearedAnswerError.locator("[data-calculator-error]").innerText(), /还没有上一条计算结果/);
  await page.locator("#calculatorClearButton").click();
  assert.equal(await page.locator("#radixBits .radix-bit").count(), 32);
  assert.equal(await page.locator("#radixBits .radix-bit").first().getAttribute("data-radix-bit"), "31");
  assert.equal(await page.locator("#radixBits .radix-bit").nth(8).getAttribute("data-radix-bit"), "23");
  assert.equal(await page.locator("#radixBits").evaluate((bits) => getComputedStyle(bits).gridTemplateColumns.split(" ").length), 32);
  assert.equal(await page.locator("#radixBytes .radix-byte").count(), 4);
  await page.locator("#radixHexInput").fill("DEADBEEF");
  assert.equal(await page.locator("#radixDecInput").inputValue(), "3735928559");
  assert.equal(await page.locator("#radixBinInput").inputValue(), "11011110101011011011111011101111");
  assert.deepEqual(await page.locator("#radixFieldList .radix-field-range").allTextContents(), ["31:0"]);
  const fieldStartLabel = page.locator("[data-radix-bit-index='31']");
  const fieldEndLabel = page.locator("[data-radix-bit-index='24']");
  await fieldStartLabel.scrollIntoViewIfNeeded();
  const fieldStart = await fieldStartLabel.boundingBox();
  const fieldEnd = await fieldEndLabel.boundingBox();
  assert.ok(fieldStart && fieldEnd, "bit labels should be available for field selection");
  await page.mouse.move(fieldStart.x + fieldStart.width / 2, fieldStart.y + fieldStart.height / 2);
  await page.mouse.down();
  await page.mouse.move(fieldEnd.x + fieldEnd.width / 2, fieldEnd.y + fieldEnd.height / 2, { steps: 4 });
  await page.mouse.up();
  assert.equal(await page.locator("#radixHexInput").inputValue(), "DEADBEEF");
  assert.deepEqual(await page.locator("#radixFieldList .radix-field-range").allTextContents(), ["31:24", "23:0"]);
  assert.equal(await page.locator("#radixBits .radix-bit.is-field-active").count(), 0);
  assert.equal(await page.locator("#radixFieldList .radix-field-cell.active").count(), 0);
  assert.equal(await page.locator("#radixFieldList .radix-field-track").count(), 4);
  assert.equal(
    await page.locator(".radix-field-labels").evaluate((labels) => getComputedStyle(labels).gridTemplateRows.split(" ").length),
    4,
  );
  assert.deepEqual(
    await page.locator("#radixFieldList [data-radix-field-track='range'] .radix-field-range").evaluateAll((fields) => fields.map((field) => {
      const style = getComputedStyle(field);
      return [style.gridColumnStart, style.gridColumnEnd];
    })),
    [["1", "span 8"], ["9", "span 24"]],
  );
  assert.equal(
    await page.evaluate(() => {
      const byte = document.querySelector("#radixBytes .radix-byte").getBoundingClientRect();
      const highBit = document.querySelector("[data-radix-bit='31']").getBoundingClientRect();
      const lowBit = document.querySelector("[data-radix-bit='24']").getBoundingClientRect();
      const field = document.querySelector(".radix-field-range[data-radix-field-key='31:24']").getBoundingClientRect();
      return Math.max(
        Math.abs(byte.left - highBit.left),
        Math.abs(byte.right - lowBit.right),
        Math.abs(field.left - highBit.left),
        Math.abs(field.right - lowBit.right),
      ) <= 1;
    }),
    true,
    "byte, bit, and field boundaries should share one horizontal axis",
  );
  await page.locator(".radix-field-range[data-radix-field-key='31:24']").click();
  assert.equal(await page.locator("#radixBits .radix-bit.is-field-active").count(), 8);
  assert.equal(await page.locator("#radixFieldList .radix-field-cell.active").count(), 4);
  await page.locator(".radix-field-range[data-radix-field-key='23:0']").click();
  assert.equal(await page.locator("#radixBits .radix-bit.is-field-active").count(), 24);
  assert.equal(await page.locator("#radixFieldList .radix-field-cell.active").count(), 4);
  await page.locator("#radixBitsTitle").click();
  assert.equal(await page.locator("#radixBits .radix-bit.is-field-active").count(), 0);
  assert.equal(await page.locator("#radixFieldList .radix-field-cell.active").count(), 0);
  await page.locator("[data-radix-bit-value='0']").click();
  assert.equal(await page.locator("#radixHexInput").inputValue(), "DEADBEEE");
  await page.locator("[data-radix-operation='increment']").click();
  assert.equal(await page.locator("#radixHexInput").inputValue(), "DEADBEEF");
  await page.locator("[data-radix-field-key='31:24'] [data-radix-field-input='hex']").fill("A5");
  assert.equal(await page.locator("#radixHexInput").inputValue(), "A5ADBEEF");
  await page.locator("[data-radix-field-key='31:24'] [data-radix-field-input='dec']").fill("18");
  assert.equal(await page.locator("#radixHexInput").inputValue(), "12ADBEEF");
  await page.locator("[data-radix-field-key='31:24'] [data-radix-field-input='dec']").fill("256");
  assert.equal(await page.locator("#radixHexInput").inputValue(), "12ADBEEF");
  assert.match(await page.locator("#radixValueStatus").innerText(), /31:24: 超出当前 8 bit 字段范围/);
  assert.equal(
    await page.locator("[data-radix-field-key='31:24'] [data-radix-field-input='dec']").evaluate((input) => input.classList.contains("invalid")),
    true,
  );
  await page.locator("[data-radix-field-key='31:24'] [data-radix-field-name]").fill("opcode");
  await page.locator("[data-radix-bit-index='23']").click();
  assert.deepEqual(await page.locator("#radixFieldList .radix-field-range").allTextContents(), ["31:24", "23", "22:0"]);
  assert.equal(await page.locator(".radix-field-range[data-radix-field-key='23:23']").innerText(), "23");
  assert.equal(
    await page.locator(".radix-field-range[data-radix-field-key='23:23']").evaluate((field) => field.scrollWidth <= field.clientWidth),
    true,
    "single-bit field label should stay within one bit column",
  );
  await page.locator("#radixFieldsResetButton").click();
  assert.deepEqual(await page.locator("#radixFieldList .radix-field-range").allTextContents(), ["31:0"]);
  assert.equal(await page.locator("#radixFieldList [data-radix-field-name]").inputValue(), "");
  await page.locator("[data-radix-width='16']").click();
  assert.deepEqual(await page.locator("#radixFieldList .radix-field-range").allTextContents(), ["15:0"]);
  await page.locator("#radixHexInput").fill("FF80");
  assert.equal(await page.locator("#radixDecInput").inputValue(), "65408");
  await page.locator("[data-radix-signed='true']").click();
  assert.equal(await page.locator("[data-radix-signed='true']").getAttribute("aria-selected"), "true");
  assert.equal(await page.locator("#radixDecInput").inputValue(), "-128");
  await page.locator("#radixDecInput").fill("-32768");
  assert.equal(await page.locator("#radixHexInput").inputValue(), "8000");
  await page.locator("#radixDecInput").fill("-32769");
  assert.match(await page.locator("#radixValueStatus").innerText(), /超出当前 16 bit 有符号范围/);
  await page.locator("[data-radix-signed='false']").click();
  assert.equal(await page.locator("#radixDecInput").inputValue(), "32768");
  assert.equal(await page.locator("#radixShiftLeftInput").inputValue(), "1");
  assert.equal(await page.locator("#radixShiftRightInput").inputValue(), "1");
  await page.locator("#radixShiftLeftInput").fill("3");
  await page.locator("[data-radix-operation='shift-left']").click();
  assert.equal(await page.locator("#radixHexInput").inputValue(), "0000");
  assert.equal(await page.locator("#radixShiftRightInput").inputValue(), "1");
  await page.locator("#radixHexInput").fill("0080");
  await page.locator("#radixShiftRightInput").fill("3");
  await page.locator("#radixShiftRightInput").press("ArrowUp");
  assert.equal(await page.locator("#radixShiftRightInput").inputValue(), "4");
  await page.locator("[data-radix-shift-direction='right'][data-radix-shift-delta='-1']").click();
  assert.equal(await page.locator("#radixShiftRightInput").inputValue(), "3");
  await page.locator("[data-radix-shift-direction='right'][data-radix-shift-delta='1']").click();
  assert.equal(await page.locator("#radixShiftRightInput").inputValue(), "4");
  await page.locator("[data-radix-operation='shift-right']").click();
  assert.equal(await page.locator("#radixHexInput").inputValue(), "0008");
  await page.locator("[data-radix-width='64']").click();
  assert.deepEqual(await page.locator("#radixFieldList .radix-field-range").allTextContents(), ["63:0"]);
  await page.locator("[data-radix-bit-index='63']").click();
  assert.deepEqual(await page.locator("#radixFieldList .radix-field-range").allTextContents(), ["63", "62:0"]);
  assert.equal(
    await page.locator(".radix-field-range[data-radix-field-key='63:63']").evaluate((field) => field.scrollWidth <= field.clientWidth),
    true,
    "64-bit single-bit field label should stay within one bit column",
  );
  assert.equal(
    await page.locator("[data-radix-field-key='63:63'] [data-radix-field-input='hex']").evaluate((input) => getComputedStyle(input).paddingLeft),
    "0px",
  );
  await page.locator("#radixFieldsResetButton").click();
  assert.deepEqual(await page.locator("#radixFieldList .radix-field-range").allTextContents(), ["63:0"]);
  assert.equal(
    await page.locator(".radix-field-scroll").evaluate((scroll) => scroll.scrollWidth <= scroll.clientWidth + 1),
    true,
    "wide 64-bit field workbench should keep the full register in view",
  );
  assert.equal(await page.locator("#radixBits .radix-bit").count(), 64);
  assert.equal(await page.locator("#radixBytes .radix-byte").count(), 8);
  const toolbarBox = await page.locator(".toolbar").boundingBox();
  const radixPanel64 = await page.locator("#radixDialog").boundingBox();
  assert.ok(radixPanel64.y >= toolbarBox.y + toolbarBox.height, "64-bit panel should remain below the toolbar");
  assert.ok(radixPanel64.width >= 1000, "64-bit panel should expand its composition workspace");
  assert.equal(await page.locator(".radix-dialog-body").evaluate((body) => getComputedStyle(body).overflowY), "auto");
  assert.equal(await page.locator("[data-radix-resize]").count(), 8);
  await page.locator("#radixHexInput").fill("FEDCBA9876543210");
  assert.equal(await page.locator("#radixDecInput").inputValue(), "18364758544493064720");
  await page.locator("#radixHexInput").fill("10000000000000000");
  assert.match(await page.locator("#radixValueStatus").innerText(), /超出当前 64 bit/);
  assert.equal(await page.locator(".radix-field[data-radix-field='hex']").evaluate((field) => field.classList.contains("invalid")), true);
  const radixBeforeResize = await page.locator("#radixDialog").boundingBox();
  const radixResizeHandle = await page.locator("[data-radix-resize='se']").boundingBox();
  await page.mouse.move(radixResizeHandle.x + radixResizeHandle.width / 2, radixResizeHandle.y + radixResizeHandle.height / 2);
  await page.mouse.down();
  await page.mouse.move(radixResizeHandle.x - 180, radixResizeHandle.y - 120, { steps: 4 });
  await page.mouse.up();
  const radixAfterResize = await page.locator("#radixDialog").boundingBox();
  assert.ok(radixAfterResize.width < radixBeforeResize.width - 150, "radix tool should follow a corner width resize");
  assert.ok(radixAfterResize.height < radixBeforeResize.height - 90, "radix tool should follow a corner height resize");
  assert.equal(Math.round(radixAfterResize.x), Math.round(radixBeforeResize.x));
  assert.equal(Math.round(radixAfterResize.y), Math.round(radixBeforeResize.y));
  const radixBeforeDrag = await page.locator("#radixDialog").boundingBox();
  const radixHeader = await page.locator("#radixDialogDragHandle").boundingBox();
  await page.mouse.move(radixHeader.x + 80, radixHeader.y + 18);
  await page.mouse.down();
  await page.mouse.move(radixHeader.x - 120, radixHeader.y + 54);
  await page.mouse.up();
  const radixAfterDrag = await page.locator("#radixDialog").boundingBox();
  assert.ok(radixAfterDrag.x < radixBeforeDrag.x - 80, "radix tool should follow a header drag");
  await page.keyboard.press("Escape");
  await page.waitForSelector("#radixDialog", { state: "hidden" });
  assert.equal(await page.locator("#radixToolButton").getAttribute("aria-expanded"), "false");
  await page.locator("#radixToolButton").click();
  await page.waitForSelector("#radixDialog:not([hidden])");
  const radixAfterReopen = await page.locator("#radixDialog").boundingBox();
  assert.equal(Math.round(radixAfterReopen.width), Math.round(radixAfterResize.width));
  assert.equal(Math.round(radixAfterReopen.height), Math.round(radixAfterResize.height));
  assert.deepEqual(await page.locator("#radixFieldList .radix-field-range").allTextContents(), ["63:0"]);
  assert.equal(await page.locator("#radixFieldList [data-radix-field-name]").inputValue(), "");
  await page.keyboard.press("Escape");
  await page.waitForSelector("#radixDialog", { state: "hidden" });
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
  await page.locator("#themeButton").click();
  await page.waitForFunction(() => document.activeElement?.dataset.themeOption === "light");
  await page.keyboard.press("ArrowDown");
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.themeOption), "dark");
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  assert.equal(await page.evaluate(() => localStorage.getItem("register-reference.theme")), "dark");
  assert.equal(await page.locator("body").evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(20, 22, 24)");
  await page.reload({ waitUntil: "load" });
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  await page.locator("#themeButton").click();
  await page.locator('[data-theme-option="rusty"]').click();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "rusty");
  assert.equal(await page.evaluate(() => localStorage.getItem("register-reference.theme")), "rusty");
  assert.equal(await page.locator("body").evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(28, 29, 31)");
  await page.reload({ waitUntil: "load" });
  assert.equal(await page.locator("html").getAttribute("data-theme"), "rusty");
  await page.locator("#themeButton").click();
  await page.locator('[data-theme-option="contrast"]').click();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "contrast");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.locator("#themeButton").click();
  await page.locator('[data-theme-option="system"]').click();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
  await page.locator("#themeButton").click();
  await page.locator('[data-theme-option="light"]').click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.selectOption("#chipSelect", { label: "RK3588_DWC3" });
  assert.match(await page.locator("#statusBand").innerText(), /57 个寄存器/);
  assert.equal(await page.locator("#matrixGrid .reg-cell").count(), 352);
  assert.equal(await page.locator("#matrixGrid .address-gap").count(), 8);
  const firstRegisterCell = page.locator("#matrixGrid .has-register:not(.covered-only)").first();
  const otherRegisterCell = page.locator("#matrixGrid .has-register:not(.covered-only)").nth(2);
  const rightRegisterCell = page.locator('#matrixGrid .has-register[data-address="49420"]');
  await firstRegisterCell.hover();
  assert.equal(await page.locator("#hoverPanel").isHidden(), true);
  await firstRegisterCell.click();
  await page.waitForSelector("#hoverPanel:not([hidden])");
  assert.equal(await page.locator("#hoverPanel .hover-close svg").count(), 1);
  assert.equal(await page.locator("#hoverPanel .hover-panel-actions").count(), 1);
  assert.equal(await page.locator("#hoverPanel .bit-box").count(), 32);
  assert.equal(await page.locator("#hoverPanel .register-value-input").first().inputValue(), "0x00000001");
  assert.equal(await page.locator("#matrixGrid .reg-cell.is-open").count(), 1);
  const firstCellBox = await firstRegisterCell.boundingBox();
  const panelBox = await page.locator("#hoverPanel").boundingBox();
  const panelGap = Math.min(
    Math.abs(panelBox.x - (firstCellBox.x + firstCellBox.width)),
    Math.abs(firstCellBox.x - (panelBox.x + panelBox.width)),
    Math.abs(panelBox.y - (firstCellBox.y + firstCellBox.height)),
    Math.abs(firstCellBox.y - (panelBox.y + panelBox.height)),
  );
  assert.ok(panelGap < 24, `detail panel should sit next to the cell, gap=${panelGap}`);
  assert.equal(await page.locator("#hoverPanel").getAttribute("data-action-side"), "left");
  await firstRegisterCell.click();
  await page.locator("#hoverPanel").waitFor({ state: "hidden" });
  await rightRegisterCell.click();
  await page.waitForSelector("#hoverPanel:not([hidden])");
  assert.equal(await page.locator("#hoverPanel").getAttribute("data-placement"), "left");
  assert.equal(await page.locator("#hoverPanel").getAttribute("data-action-side"), "right");
  const rightCellBox = await rightRegisterCell.boundingBox();
  const actionBox = await page.locator("#hoverPanel .hover-panel-actions").boundingBox();
  assert.ok(
    Math.abs(rightCellBox.x - (actionBox.x + actionBox.width)) < 40,
    "detail actions should stay near the right-side anchor",
  );
  await rightRegisterCell.click();
  await page.locator("#hoverPanel").waitFor({ state: "hidden" });
  await firstRegisterCell.click();
  await page.waitForSelector("#hoverPanel:not([hidden])");
  await otherRegisterCell.hover({ force: true });
  assert.equal(await page.locator("#hoverPanel").isHidden(), false);
  await otherRegisterCell.click({ force: true });
  assert.equal(
    await page.locator("#matrixGrid .reg-cell.is-open").getAttribute("data-address"),
    await otherRegisterCell.getAttribute("data-address"),
  );
  await page.keyboard.press("Escape");
  await page.locator("#hoverPanel").waitFor({ state: "hidden" });
  await firstRegisterCell.click();
  await page.waitForSelector("#hoverPanel:not([hidden])");
  await page.locator(".brand").click();
  await page.locator("#hoverPanel").waitFor({ state: "hidden" });
  await firstRegisterCell.click();
  await page.waitForSelector("#hoverPanel:not([hidden])");

  await page.selectOption("#chipSelect", { label: "QMI8660" });
  assert.doesNotMatch(await page.locator("#matrixGrid").innerText(), /INT_HELPER|DATA_ALL/);
  assert.match(await page.locator('#matrixGrid .has-register[data-address="88"]').innerText(), /INT_STATUS0/);
  assert.match(await page.locator('#matrixGrid .has-register[data-address="96"]').innerText(), /gyr/);
  assert.match(await page.locator('#matrixGrid .has-register[data-address="102"]').innerText(), /acc/);
  assert.match(await page.locator('#matrixGrid .has-register[data-address="108"]').innerText(), /tmp/);
  await page.selectOption("#pageSelect", { label: "OIS" });
  assert.doesNotMatch(await page.locator("#matrixGrid").innerText(), /DATA_ALL/);
  assert.match(await page.locator('#matrixGrid .has-register[data-address="82"]').innerText(), /gyr/);
  await page.selectOption("#chipSelect", { label: "QMA6100P" });
  assert.doesNotMatch(await page.locator("#matrixGrid").innerText(), /ACC_DATA/);
  assert.match(await page.locator('#matrixGrid .has-register[data-address="1"]').innerText(), /X_OUT_LSB/);

  const yaml64 = `schema_version: 1
sensor: TEST64
who_am_i:
  reg: null
  values: []
pages:
  MMIO64:
    page_id: 0x00
    address_unit_bits: 64
    access: "64-bit MMIO"
    desc: "64-bit test"
    registers:
      - addr: 0x20
        name: VALUE64
        access: RW
        width: 8
        bit_width: 64
        address_span: 1
        byte_order: little
        reset: 0xFEDCBA9876543210
        desc: "64-bit value"
        fields:
          - name: value
            bits: "63:0"
            access: RW
            reset: 0xFEDCBA9876543210
            desc: "full value"
      - addr: 0x2C
        name: BLOCK_DATA
        access: RO
        width: 4
        bit_width: 32
        address_span: 4
        multi_byte: true
        alias_note: "overlaps BYTE3"
        desc: "aggregate view"
      - addr: 0x2F
        name: BYTE3
        access: RO
        width: 1
        alias_note: "overlaps BLOCK_DATA"
        desc: "physical byte view"
      - addr: 0x30
        name: SENSOR_BURST
        access: RO
        width: 14
        multi_byte: true
        desc: "aggregate sensor view"
        fields:
          - name: gyr
            bits: "47:0"
            desc: "gyroscope data"
          - name: acc
            bits: "95:48"
            desc: "accelerometer data"
          - name: tmp
            bits: "111:96"
            desc: "temperature data"
`;

  await page.setInputFiles("#yamlFileInput", {
    name: "test64.yaml",
    mimeType: "application/yaml",
    buffer: Buffer.from(yaml64),
  });
  await page.waitForTimeout(100);
  assert.equal(await page.locator("#chipSelect option:checked").innerText(), "TEST64");
  assert.equal(await page.locator("#matrixGrid .reg-cell").count(), 32);
  assert.equal(await page.locator('#matrixGrid .has-register', { hasText: "BLOCK_DATA" }).count(), 0);
  assert.equal(await page.locator('#matrixGrid .has-register', { hasText: "SENSOR_BURST" }).count(), 0);
  assert.equal(await page.locator('#matrixGrid .has-register[data-address="44"]', { hasText: "BYTE_0" }).count(), 1);
  assert.equal(await page.locator('#matrixGrid .has-register[data-address="47"]', { hasText: "BYTE3" }).count(), 1);
  assert.equal(await page.locator('#matrixGrid .has-register[data-address="48"]', { hasText: "gyr" }).count(), 1);
  assert.equal(await page.locator('#matrixGrid .has-register[data-address="54"]', { hasText: "acc" }).count(), 1);
  assert.equal(await page.locator('#matrixGrid .has-register[data-address="60"]', { hasText: "tmp" }).count(), 1);
  await page.locator('#matrixGrid .has-register[data-address="48"]').click();
  assert.equal(await page.locator("#hoverPanel .register-block").count(), 1);
  assert.match(await page.locator("#hoverPanel .register-heading").innerText(), /gyr/);
  assert.match(await page.locator("#hoverPanel .hover-meta").innerText(), /48 bit/);
  await page.locator("#hoverPanel .hover-close").click();
  await page.locator("#tableViewButton").click();
  assert.equal(await page.locator("#registerTableBody tr").count(), 8);
  assert.doesNotMatch(await page.locator("#registerTableBody").innerText(), /BLOCK_DATA|SENSOR_BURST/);
  await page.locator("#matrixViewButton").click();
  await page.locator('#matrixGrid .has-register[data-address="32"]').click();
  await page.waitForSelector("#hoverPanel:not([hidden])");
  assert.equal(await page.locator("#hoverPanel .register-value-input").inputValue(), "0xFEDCBA9876543210");
  assert.equal(await page.locator("#hoverPanel .bit-box").count(), 64);

  const invalidYaml = yaml64.replace('bits: "63:0"', 'bits: "64:0"').replace("sensor: TEST64", "sensor: INVALID64");
  await page.setInputFiles("#yamlFileInput", {
    name: "invalid64.yaml",
    mimeType: "application/yaml",
    buffer: Buffer.from(invalidYaml),
  });
  await page.waitForSelector("#importResultDialog[open]");
  assert.equal(await page.locator("#importResultTitle").innerText(), "YAML 未导入");
  assert.match(await page.locator("#importResultDetails").innerText(), /超出寄存器有效位宽 64/);
  assert.equal(await page.locator("#chipSelect option", { hasText: "INVALID64" }).count(), 0);
  await page.locator("#importResultConfirmButton").click();
  assert.deepEqual(errors, []);
  console.log(`[${browserEngine}] main viewer checks passed`);

  const mobilePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const mobileErrors = [];
  mobilePage.on("console", (message) => {
    if (message.type() === "error") mobileErrors.push(message.text());
  });
  mobilePage.on("pageerror", (error) => mobileErrors.push(error.message));
  await mobilePage.goto(pathToFileURL(resolve(root, "index.html")).href, { waitUntil: "load" });
  await mobilePage.locator("#radixToolButton").click();
  await mobilePage.waitForSelector("#radixDialog:not([hidden])");
  assert.equal(await mobilePage.locator("[data-radix-resize]").first().isVisible(), false);
  assert.equal(await mobilePage.locator(".calculator-terminal button").count(), 0);
  await mobilePage.locator("#calculatorInput").fill("0x20 + 10");
  await mobilePage.locator("#calculatorInput").press("Enter");
  assert.equal(await mobilePage.locator("#calculatorHistory [data-calculator-dec]").last().innerText(), "42");
  assert.equal(await mobilePage.locator("#calculatorHistory [data-calculator-hex]").last().innerText(), "0x2A");
  assert.equal(
    await mobilePage.locator(".calculator-terminal").evaluate((terminal) => terminal.scrollWidth <= terminal.clientWidth),
    true,
    "mobile calculator should not overflow horizontally",
  );
  const mobilePanelBeforeDrag = await mobilePage.locator("#radixDialog").boundingBox();
  const mobileHeader = await mobilePage.locator("#radixDialogDragHandle").boundingBox();
  await mobilePage.mouse.move(mobileHeader.x + 60, mobileHeader.y + 16);
  await mobilePage.mouse.down();
  await mobilePage.mouse.move(mobileHeader.x + 180, mobileHeader.y + 80);
  await mobilePage.mouse.up();
  const mobilePanelAfterDrag = await mobilePage.locator("#radixDialog").boundingBox();
  assert.equal(Math.round(mobilePanelAfterDrag.x), Math.round(mobilePanelBeforeDrag.x));
  assert.equal(Math.round(mobilePanelAfterDrag.y), Math.round(mobilePanelBeforeDrag.y));
  await mobilePage.locator("[data-radix-width='64']").click();
  await mobilePage.locator("#radixFieldList").scrollIntoViewIfNeeded();
  assert.equal(
    await mobilePage.locator(".radix-field-scroll").evaluate((scroll) => scroll.scrollWidth > scroll.clientWidth),
    true,
    "mobile field workbench should scroll within its own viewport",
  );
  assert.equal(
    await mobilePage.evaluate(() => {
      const panel = document.querySelector("#radixDialog").getBoundingClientRect();
      return (
        document.documentElement.scrollWidth <= window.innerWidth &&
        panel.left >= 0 &&
        panel.top >= 0 &&
        panel.right <= window.innerWidth &&
        panel.bottom <= window.innerHeight
      );
    }),
    true,
  );
  assert.deepEqual(mobileErrors, []);
  await mobilePage.close();
  console.log(`[${browserEngine}] mobile floating tool checks passed`);

  const notesPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const noteErrors = [];
  notesPage.on("console", (message) => {
    if (message.type() === "error") noteErrors.push(message.text());
  });
  notesPage.on("pageerror", (error) => noteErrors.push(error.message));
  await notesPage.addInitScript(
    ({ yaml }) => {
      const record = {
        id: "mock:test64",
        sensor: "TEST64",
        vendor: "",
        family: "",
        deviceType: "test",
        category: "测试",
        enabled: true,
        builtin: false,
        sourceKind: "imported",
        sourceName: "test64.yaml",
        sourcePath: null,
        yamlText: yaml,
        notes: [],
      };
      let nextNoteId = 1;
      window.__TAURI__ = {
        core: {
          invoke: async (command, args = {}) => {
            if (command === "list_chips") return [record];
            if (command === "save_register_note") {
              const input = args.input;
              const existing = record.notes.find((note) => note.id === input.noteId);
              const note = {
                id: existing?.id || nextNoteId++,
                chipId: input.chipId,
                pageName: input.pageName,
                registerAddr: input.registerAddr,
                registerName: input.registerName,
                kind: input.kind,
                content: input.content,
                createdAt: existing?.createdAt || "2026-08-07 08:00:00",
                updatedAt: "2026-08-07 08:00:00",
              };
              if (existing) Object.assign(existing, note);
              else record.notes.unshift(note);
              return structuredClone(record.notes);
            }
            if (command === "delete_register_note") {
              record.notes = record.notes.filter((note) => note.id !== args.noteId);
              return structuredClone(record.notes);
            }
            throw new Error(`unexpected command: ${command}`);
          },
        },
      };
    },
    { yaml: yaml64 },
  );
  await notesPage.goto(pathToFileURL(resolve(root, "index.html")).href, { waitUntil: "load" });
  await notesPage.waitForFunction(() => document.querySelector("#chipSelect option:checked")?.textContent === "TEST64");
  const aliasCell = notesPage.locator('#matrixGrid .has-register[data-address="47"]');
  await aliasCell.click();
  assert.equal(await notesPage.locator("#hoverPanel .register-block").count(), 1);
  assert.equal(await notesPage.locator("#hoverPanel .note-edit-button").count(), 1);
  assert.match(await notesPage.locator("#hoverPanel .note-edit-button").getAttribute("aria-label"), /BYTE3/);
  const closeBox = await notesPage.locator("#hoverPanel .hover-close").boundingBox();
  const noteBox = await notesPage.locator("#hoverPanel .note-edit-button").boundingBox();
  assert.ok(closeBox.x > noteBox.x, "close button should be nearest to the right-side anchor");
  await notesPage.locator("#hoverPanel .hover-close").click();
  await notesPage.locator('#matrixGrid .has-register[data-address="32"]').click();
  const firstCloseBox = await notesPage.locator("#hoverPanel .hover-close").boundingBox();
  const firstNoteBox = await notesPage.locator("#hoverPanel .note-edit-button").boundingBox();
  assert.ok(firstCloseBox.x < firstNoteBox.x, "close button should be nearest to the left-side anchor");
  assert.equal(await notesPage.locator("#hoverPanel .note-edit-count").innerText(), "+");
  const controlColors = await notesPage.locator("#hoverPanel").evaluate((panel) => ({
    note: getComputedStyle(panel.querySelector(".note-edit-button")).backgroundColor,
    close: getComputedStyle(panel.querySelector(".hover-close")).backgroundColor,
  }));
  assert.notEqual(controlColors.note, controlColors.close);
  await notesPage.locator("#hoverPanel .note-edit-button").click();
  await notesPage.waitForSelector("#noteDialog[open]");
  await notesPage.locator('[data-note-kind="warning"]').click();
  await notesPage.locator("#noteContentInput").fill("切换模式后等待状态稳定");
  await notesPage.locator("#noteSaveButton").click();
  await notesPage.waitForSelector("#noteList .note-item.warning");
  assert.match(await notesPage.locator("#noteList").innerText(), /切换模式后等待状态稳定/);
  await notesPage.locator("#noteDialogCloseButton").click();
  assert.equal(await notesPage.locator("#matrixGrid .cell-note-indicator").count(), 1);
  assert.match(await notesPage.locator("#statusBand").innerText(), /1 条备注/);
  await notesPage.locator('#matrixGrid .has-register[data-address="32"]').click();
  assert.equal(await notesPage.locator("#hoverPanel .note-edit-count").innerText(), "1");
  await notesPage.locator("#hoverPanel .hover-close").click();

  await notesPage.locator("#searchInput").fill("状态稳定");
  assert.equal(await notesPage.locator("#matrixGrid .has-register:not(.filtered-out)").count(), 1);
  await notesPage.locator("#tableViewButton").click();
  assert.match(await notesPage.locator("#registerTableBody .register-note").innerText(), /切换模式后等待状态稳定/);
  await notesPage.locator("#registerTableBody .note-edit-button").click();
  await notesPage.locator('[data-note-action="edit"]').click();
  await notesPage.locator("#noteContentInput").fill("切换模式后至少等待两个周期");
  await notesPage.locator("#noteSaveButton").click();
  assert.match(await notesPage.locator("#noteList").innerText(), /至少等待两个周期/);

  notesPage.once("dialog", (dialog) => dialog.accept());
  await notesPage.locator('[data-note-action="delete"]').click();
  await notesPage.waitForFunction(() => document.querySelectorAll("#noteList .note-item").length === 0);
  await notesPage.locator("#noteDialogCloseButton").click();
  assert.equal(await notesPage.locator("#matrixGrid .cell-note-indicator").count(), 0);
  assert.deepEqual(noteErrors, []);
  await notesPage.close();
  console.log(`[${browserEngine}] register note checks passed`);

  const attachmentsPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const attachmentErrors = [];
  attachmentsPage.on("console", (message) => {
    if (message.type() === "error") attachmentErrors.push(message.text());
  });
  attachmentsPage.on("pageerror", (error) => attachmentErrors.push(error.message));
  await attachmentsPage.addInitScript(
    ({ yaml }) => {
      const record = {
        id: "mock:attachments",
        sensor: "TEST64",
        vendor: "",
        family: "",
        deviceType: "test",
        category: "测试",
        enabled: true,
        builtin: false,
        sourceKind: "imported",
        sourceName: "test64.yaml",
        sourcePath: null,
        yamlText: yaml,
        notes: [],
        attachments: [
          { id: 2, chipId: "mock:attachments", fileName: "errata.txt", filePath: "/docs/errata.txt", sizeBytes: 2048, exists: true, createdAt: "2026-08-07 08:00:00" },
          { id: 1, chipId: "mock:attachments", fileName: "timing.png", filePath: "/docs/timing.png", sizeBytes: 4096, exists: false, createdAt: "2026-08-07 07:00:00" },
        ],
      };
      window.__attachmentCommands = [];
      window.__TAURI__ = {
        core: {
          invoke: async (command, args = {}) => {
            if (command === "list_chips") return [record];
            if (command === "list_chip_attachments") return structuredClone(record.attachments);
            if (command === "add_chip_attachments") {
              record.attachments.unshift({ id: 3, chipId: "mock:attachments", fileName: "reference.pdf", filePath: "/docs/reference.pdf", sizeBytes: 8192, exists: true, createdAt: "2026-08-07 09:00:00" });
              return { attachments: structuredClone(record.attachments), added: 1, canceled: false, failures: [] };
            }
            if (command === "delete_chip_attachment") {
              record.attachments = record.attachments.filter((attachment) => attachment.id !== args.attachmentId);
              return structuredClone(record.attachments);
            }
            if (["open_chip_attachment", "reveal_chip_attachment"].includes(command)) {
              window.__attachmentCommands.push({ command, args });
              return null;
            }
            throw new Error(`unexpected command: ${command}`);
          },
        },
      };
    },
    { yaml: yaml64 },
  );
  await attachmentsPage.goto(pathToFileURL(resolve(root, "index.html")).href, { waitUntil: "load" });
  await attachmentsPage.waitForFunction(() => document.querySelector("#attachmentsButtonCount")?.textContent === "2");
  await attachmentsPage.locator("#attachmentsButton").click();
  await attachmentsPage.waitForSelector("#attachmentsDialog[open]");
  assert.equal(await attachmentsPage.locator(".attachment-row").count(), 2);
  assert.equal(await attachmentsPage.locator(".attachment-row.missing").count(), 1);
  await attachmentsPage.locator('.attachment-row:not(.missing) [data-attachment-action="open"]').first().click();
  await attachmentsPage.locator('.attachment-row:not(.missing) [data-attachment-action="reveal"]').click();
  assert.deepEqual(
    await attachmentsPage.evaluate(() => window.__attachmentCommands.map((item) => [item.command, item.args.attachmentId])),
    [["open_chip_attachment", 2], ["reveal_chip_attachment", 2]],
  );
  await attachmentsPage.locator("#addAttachmentsButton").click();
  await attachmentsPage.waitForFunction(() => document.querySelectorAll(".attachment-row").length === 3);
  assert.equal(await attachmentsPage.locator("#attachmentsButtonCount").innerText(), "3");
  attachmentsPage.once("dialog", (dialog) => dialog.accept());
  await attachmentsPage.locator('.attachment-row[data-attachment-id="3"] [data-attachment-action="delete"]').click();
  await attachmentsPage.waitForFunction(() => document.querySelectorAll(".attachment-row").length === 2);
  assert.match(await attachmentsPage.locator("#attachmentsStatus").innerText(), /原文件未删除/);
  assert.deepEqual(attachmentErrors, []);
  await attachmentsPage.close();
  console.log(`[${browserEngine}] attachment checks passed`);

  console.log(`${browserEngine} viewer tests passed: themes, DWC3, YAML validation, register notes, and chip attachments`);
} finally {
  let closeTimer;
  const closeTimedOut = await Promise.race([
    browser.close().then(() => false),
    new Promise((resolveTimeout) => {
      closeTimer = setTimeout(() => resolveTimeout(true), 10_000);
    }),
  ]);
  clearTimeout(closeTimer);
  clearTimeout(suiteWatchdog);
  if (closeTimedOut) console.warn(`${browserEngine} browser cleanup timed out; forcing test process exit`);
}

// Some WebKit runner processes stay alive after all assertions and browser.close().
// Reaching this line means the complete suite passed and cleanup had its chance.
process.exit(0);
