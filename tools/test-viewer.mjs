import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, webkit } from "playwright";

const root = resolve(import.meta.dirname, "..");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browserEngine = process.env.BROWSER_ENGINE || "chromium";
const browserType = { chromium, webkit }[browserEngine];
if (!browserType) throw new Error(`unsupported BROWSER_ENGINE: ${browserEngine}`);
const launchOptions = browserEngine === "chromium" && existsSync(chromePath) ? { executablePath: chromePath } : {};
const dwc3Yaml = readFileSync(resolve(root, "dwc3_rk3588.yaml"), "utf8");
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
  const waitForSearch = async () => {
    await page.waitForFunction(() => {
      const panel = document.querySelector("#searchPanel");
      return panel && !panel.hidden && !document.querySelector("#searchActivity")?.hidden
        ? false
        : Boolean(panel && !panel.hidden && document.querySelector(".search-result"));
    });
  };

  await page.goto(pathToFileURL(resolve(root, "index.html")).href, { waitUntil: "load" });
  assert.equal(await page.locator("#chipSelect option").count(), 1, "the clean library should have only its empty placeholder");
  assert.equal(await page.locator("#chipSelect").inputValue(), "");
  assert.equal(await page.locator("#pageSelect option:checked").innerText(), "尚未选择页面");
  assert.match(await page.locator("#statusBand").innerText(), /请选择 YAML 文件或目录/);
  assert.match(await page.locator("#languageSwitcher").getAttribute("title"), /导入芯片后/);
  await page.locator("#yamlFileInput").setInputFiles({
    name: "dwc3_rk3588.yaml",
    mimeType: "application/yaml",
    buffer: Buffer.from(dwc3Yaml),
  });
  await page.waitForFunction(() => document.querySelector("#chipSelect option:checked")?.textContent === "RK3588_DWC3");
  const toolbarLayout = await page.evaluate(() => ({
    pageWidth: document.documentElement.scrollWidth,
    languageWidth: document.getElementById("languageControl").getBoundingClientRect().width,
    viewWidth: document.querySelector(".segmented").getBoundingClientRect().width,
    commandWidths: Array.from(document.querySelectorAll(".toolbar > .tool-button:not([hidden])"), (button) => button.getBoundingClientRect().width),
  }));
  assert.equal(toolbarLayout.pageWidth, 1280, "toolbar should not create horizontal page overflow");
  assert.ok(toolbarLayout.languageWidth >= 120, "language control should remain fully visible");
  assert.ok(toolbarLayout.viewWidth >= 70, "view control should remain fully visible");
  assert.ok(toolbarLayout.commandWidths.every((width) => width >= 34), "toolbar commands should remain clickable");
  assert.equal(await page.locator("#languageControl").getAttribute("data-translation-available"), "false");
  assert.match(await page.locator("#languageSwitcher").getAttribute("title"), /未加载中文译文/);
  assert.equal(await page.locator("#loadYamlButton").isVisible(), false, "low-frequency data actions should start in the overflow menu");
  await page.locator("#toolsMenuButton").click();
  assert.equal(await page.locator("#toolsMenu").isVisible(), true);
  assert.equal(await page.locator("#loadFolderButton strong").innerText(), "关联寄存器库");
  assert.match(await page.locator("#translationAvailability").innerText(), /当前芯片仅英文/);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#toolsMenu").isHidden(), true);
  await page.locator("[data-language-mode='zh']").click();
  assert.match(await page.locator("#statusBand").innerText(), /当前芯片未加载中文译文.*回退显示英文/);
  await page.locator("[data-language-mode='en']").click();
  assert.doesNotMatch(await page.locator("#statusBand").innerText(), /当前芯片未加载中文译文/);
  await page.locator("[data-language-mode='bilingual']").click();
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
  const openThemePicker = async () => {
    if (await page.locator("#toolsMenu").isHidden()) await page.locator("#toolsMenuButton").click();
    await page.locator("#themeButton").click();
  };
  await openThemePicker();
  await page.waitForFunction(() => document.activeElement?.dataset.themeOption === "light");
  await page.keyboard.press("ArrowDown");
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.themeOption), "dark");
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  assert.equal(await page.evaluate(() => localStorage.getItem("register-reference.theme")), "dark");
  assert.equal(await page.locator("body").evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(20, 22, 24)");
  await page.reload({ waitUntil: "load" });
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  await openThemePicker();
  await page.locator('[data-theme-option="rusty"]').click();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "rusty");
  assert.equal(await page.evaluate(() => localStorage.getItem("register-reference.theme")), "rusty");
  assert.equal(await page.locator("body").evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(28, 29, 31)");
  await page.reload({ waitUntil: "load" });
  assert.equal(await page.locator("html").getAttribute("data-theme"), "rusty");
  await page.locator("#yamlFileInput").setInputFiles({
    name: "dwc3_rk3588.yaml",
    mimeType: "application/yaml",
    buffer: Buffer.from(dwc3Yaml),
  });
  await page.waitForFunction(() => document.querySelector("#chipSelect option:checked")?.textContent === "RK3588_DWC3");
  await openThemePicker();
  await page.locator('[data-theme-option="contrast"]').click();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "contrast");
  await page.emulateMedia({ colorScheme: "dark" });
  await openThemePicker();
  await page.locator('[data-theme-option="system"]').click();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
  await openThemePicker();
  await page.locator('[data-theme-option="light"]').click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);

  const systemRegisterYaml = `schema_version: 2
sensor: "ARM_UI_TEST"
vendor: "Arm"
family: "A-profile"
device_type: "architecture_registers"
register_space:
  kind: "arm_system"
  architecture: "AArch64"
  profile: "A"
source:
  title: "Synthetic browser fixture"
  version: "test"
  document: "test"
  url: "https://example.invalid"
  license: "test only"
pages:
  Control:
    access: "MRS / MSR"
    desc: "Synthetic system-register category"
    registers:
      - name: "TEST_EL1"
        access: "RW"
        width: 16
        bit_width: 128
        desc: "Synthetic system register; Event FIFO diagnostic text includes a bus error address"
        condition: "when FEAT_TEST is implemented"
        encoding:
          scheme: "aarch64_sysreg"
          op0: 3
          op1: 0
          crn: 1
          crm: 0
          op2: 3
        accessors:
          - name: "TEST_EL1"
            kind: "read"
            instruction: "MRS <Xt>, TEST_EL1"
            encoding:
              scheme: "aarch64_sysreg"
              op0: 3
              op1: 0
              crn: 1
              crm: 0
              op2: 3
          - name: "TEST_EL1"
            kind: "write"
            instruction: "MSR TEST_EL1, <Xt>"
            encoding:
              scheme: "aarch64_sysreg"
              op0: 3
              op1: 0
              crn: 1
              crm: 0
              op2: 3
        fields:
          - name: "SPLIT"
            bits: "127:124,3:0"
            desc: "Non-contiguous field"
            values:
              - value: "0b1010xxxx"
                desc: "High nibble is A"
          - name: "MODE_A"
            bits: "7:4"
            desc: "Conditional layout A"
            condition: "When FEAT_A is implemented"
          - name: "MODE_B"
            bits: "7:4"
            desc: "Conditional layout B"
            condition: "Layout: !IsFeatureImplemented(FEAT_A)"
          - name: "N"
            bits: "8"
            desc: "Negative condition flag. Set to 1 if the result of the last flag-setting instruction was negative."
`;
  await page.locator("#yamlFileInput").setInputFiles({
    name: "arm-ui-test.yaml",
    mimeType: "application/yaml",
    buffer: Buffer.from(systemRegisterYaml),
  });
  await page.waitForFunction(() => Array.from(document.querySelectorAll("#chipSelect option")).some((option) => option.textContent === "ARM_UI_TEST"));
  assert.equal(await page.locator("#chipSelect option:checked").innerText(), "ARM_UI_TEST");
  const systemRegisterSha256 = createHash("sha256").update(systemRegisterYaml).digest("hex");
  const systemTranslationYaml = `translation_schema_version: 1
format: "register-reference-translation"
source_locale: "en"
locale: "zh-CN"
source_file: "architecture/arm/a-profile/arm-ui-test.yaml"
source_sha256: "${systemRegisterSha256}"
metadata:
  status: "draft"
  coverage: "partial"
  method: "human"
  translator: "browser test"
  updated: "2026-08-17"
translations:
  sensor: "ARM 界面测试"
  family: "A 系列"
  pages:
    - name: "Control"
      title: "控制寄存器"
      access: "MRS / MSR 访问"
      desc: "合成系统寄存器分类"
      registers:
        - name: "TEST_EL1"
          desc: "合成系统寄存器"
          condition: "实现 FEAT_TEST 时可用"
          fields:
            - name: "SPLIT"
              bits: "127:124,3:0"
              desc: "非连续位域"
              values:
                - value: "0b1010xxxx"
                  desc: "高半字节为 A"
`;
  await page.locator("#yamlFileInput").setInputFiles({
    name: "arm-ui-test.zh-CN.yaml",
    mimeType: "application/yaml",
    buffer: Buffer.from(systemTranslationYaml),
  });
  await page.waitForFunction(() => document.querySelector("#chipSelect option:checked")?.textContent.includes("ARM 界面测试"));
  assert.equal(await page.locator("#languageControl").getAttribute("data-translation-available"), "true");
  assert.match(await page.locator("#languageSwitcher").getAttribute("title"), /已加载译文 草稿 · 部分/);
  assert.equal(await page.locator("[data-language-mode='bilingual']").getAttribute("aria-selected"), "true");
  assert.equal(await page.locator("#chipSelect option:checked").innerText(), "ARM 界面测试 / ARM_UI_TEST");
  assert.equal(await page.locator("#pageSelect option:checked").innerText(), "控制寄存器 / Control");
  assert.match(await page.locator("#statusBand").innerText(), /译文 草稿 · 部分/);
  await page.locator("#yamlFileInput").setInputFiles({
    name: "arm-ui-test.stale.zh-CN.yaml",
    mimeType: "application/yaml",
    buffer: Buffer.from(systemTranslationYaml.replace(systemRegisterSha256, "0".repeat(64))),
  });
  await page.locator("#importResultDialog").waitFor({ state: "visible" });
  assert.match(await page.locator("#importResultDetails").innerText(), /source_sha256.*匹配/);
  await page.locator("#importResultConfirmButton").click();
  assert.equal(await page.locator("#chipSelect option:checked").innerText(), "ARM 界面测试 / ARM_UI_TEST");
  await page.locator("#searchInput").fill("合成系统寄存器");
  await waitForSearch();
  assert.ok(await page.locator(".search-result[data-kind='register']").filter({ hasText: "TEST_EL1" }).count() >= 1);
  await page.locator("#searchInput").fill("");
  assert.equal(await page.locator("#matrixViewButton").isHidden(), false);
  assert.equal(await page.locator("#matrixViewButton").getAttribute("aria-label"), "全局预览");
  assert.equal(await page.locator("#matrixViewButton").getAttribute("aria-selected"), "true");
  assert.equal(await page.locator("#matrixTitle").innerText(), "全局预览");
  assert.equal(await page.locator(".system-overview-group").count(), 1);
  assert.equal(await page.locator(".system-overview-register").count(), 1);
  await page.locator(".system-overview-register").click();
  await page.waitForFunction(() => document.querySelector("#tableViewButton")?.getAttribute("aria-selected") === "true");
  assert.equal(await page.locator("#registerLocatorHeader").innerText(), "系统编码");
  assert.equal(await page.locator("#registerTableBody tr").count(), 1);
  assert.equal(await page.locator("#registerTableBody .system-encoding").innerText(), "S3_0_C1_C0_3");
  assert.match(await page.locator("#registerTableBody .desc-cell").innerText(), /合成系统寄存器[\s\S]*Synthetic system register/);
  await page.locator("[data-language-mode='zh']").click();
  assert.match(await page.locator("#registerTableBody .desc-cell").innerText(), /合成系统寄存器/);
  assert.doesNotMatch(await page.locator("#registerTableBody .desc-cell").innerText(), /Synthetic system register/);
  await page.locator("#searchInput").fill("Synthetic system register");
  await waitForSearch();
  assert.ok(
    await page.locator(".search-result[data-kind='register']").filter({ hasText: "TEST_EL1" }).count() >= 1,
    "search should match English while Chinese display mode is active",
  );
  await page.locator("#searchInput").fill("");
  await page.locator("[data-language-mode='en']").click();
  assert.match(await page.locator("#registerTableBody .desc-cell").innerText(), /Synthetic system register/);
  assert.doesNotMatch(await page.locator("#registerTableBody .desc-cell").innerText(), /合成系统寄存器/);
  await page.locator("[data-language-mode='bilingual']").click();
  assert.deepEqual(await page.locator("#registerTableBody .system-accessors .badge").allTextContents(), ["READ", "WRITE"]);
  await page.locator("#registerTableBody .register-value-input").fill("0xA0000000000000000000000000000005");
  const splitField = page.locator("#registerTableBody .field-row").filter({ hasText: "SPLIT" });
  assert.match(await splitField.locator(".field-value").innerText(), /0xA5 \/ 165/);
  assert.match(await splitField.locator(".enum-chip.active").innerText(), /0b1010xxxx/);
  assert.match(await splitField.locator(".enum-chip.active").innerText(), /高半字节为 A[\s\S]*High nibble is A/);
  assert.match(await splitField.locator(".field-desc").innerText(), /非连续位域[\s\S]*Non-contiguous field/);
  const flagField = page.locator("#registerTableBody .field-row").filter({ hasText: "Negative condition flag" });
  assert.match(await flagField.locator(".field-meaning").innerText(), /Negative condition flag[\s\S]*Set to 1 if the result of the last flag-setting instruction was negative/);
  assert.doesNotMatch(await flagField.locator(".field-meaning").innerText(), /已置位|未置位/);
  assert.equal(await page.locator("#registerTableBody .field-meaning").filter({ hasText: "未匹配枚举" }).count(), 0);
  await page.locator("#registerTableBody .register-value-input").fill("0xA0000000000000000000000000000105");
  assert.match(await flagField.locator(".field-meaning").innerText(), /Negative condition flag/);
  await page.locator("#registerTableBody .register-value-input").fill("0xB0000000000000000000000000000105");
  assert.match(await splitField.locator(".field-meaning").innerText(), /资料未定义当前值/);
  assert.equal(await page.locator("#registerTableBody .field-condition").count(), 2);
  await page.locator("#searchInput").fill("FEAT_TEST");
  await waitForSearch();
  assert.ok(await page.locator(".search-result[data-kind='register']").filter({ hasText: "TEST_EL1" }).count() >= 1);
  await page.locator("#searchInput").fill("");

  const riscvRegisterYaml = `schema_version: 2
sensor: "RISCV_RV64_UI_TEST"
vendor: "RISC-V International"
family: "RISC-V Privileged ISA"
device_type: "architecture_registers"
register_space:
  kind: "riscv_system"
  architecture: "RV64"
  profile: "privileged"
source:
  title: "Synthetic RISC-V browser fixture"
  version: "test"
  revision: "test"
  document: "test"
  url: "https://example.invalid"
  license: "test only"
pages:
  Supervisor:
    access: "CSR instruction encoding space"
    desc: "Synthetic supervisor CSRs"
    registers:
      - name: "satp"
        access: "RW"
        width: 8
        bit_width: 64
        desc: "Supervisor address translation and protection"
        execution_state: "RV64"
        condition: "S"
        groups:
          - "Supervisor"
          - "S"
        encoding:
          scheme: "riscv_csr"
          address: 0x180
        accessors:
          - name: "satp"
            kind: "read"
            instruction: "CSRRS rd, satp, x0"
            encoding:
              scheme: "riscv_csr"
              address: 0x180
  Machine:
    access: "CSR instruction encoding space"
    desc: "Synthetic machine CSRs"
    registers:
      - name: "mstatus"
        access: "RW"
        width: 8
        bit_width: 64
        desc: "Machine status register"
        execution_state: "RV64"
        condition: "Sm"
        groups:
          - "Machine"
          - "Sm"
        encoding:
          scheme: "riscv_csr"
          address: 0x300
        accessors:
          - name: "mstatus"
            kind: "read"
            instruction: "CSRRS rd, mstatus, x0"
            encoding:
              scheme: "riscv_csr"
              address: 0x300
          - name: "mstatus"
            kind: "write"
            instruction: "CSRRW x0, mstatus, rs1"
            encoding:
              scheme: "riscv_csr"
              address: 0x300
        fields:
          - name: "MIE"
            bits: "3"
            access: "RW"
            reset: 0
            desc: "Machine interrupt enable"
`;
  await page.locator("#yamlFileInput").setInputFiles({
    name: "riscv-rv64-ui-test.yaml",
    mimeType: "application/yaml",
    buffer: Buffer.from(riscvRegisterYaml),
  });
  await page.waitForFunction(() => document.querySelector("#chipSelect option:checked")?.textContent.includes("RISCV_RV64_UI_TEST"));
  await page.locator("#matrixViewButton").click();
  await page.waitForFunction(() => document.querySelector("#matrixViewButton")?.getAttribute("aria-selected") === "true");
  assert.equal(await page.locator("#matrixViewButton").getAttribute("aria-selected"), "true");
  assert.equal(await page.locator(".system-overview-group").count(), 2);
  assert.equal(await page.locator(".system-overview-register").count(), 2);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.locator("#searchInput").fill("0x300");
  await waitForSearch();
  assert.ok(await page.locator(".search-result[data-kind='register']").filter({ hasText: "mstatus" }).count() >= 1);
  await page.locator("#searchInput").fill("Sm");
  await waitForSearch();
  assert.ok(await page.locator(".search-result[data-kind='register']").filter({ hasText: "mstatus" }).count() >= 1);
  await page.locator("#searchInput").fill("");
  await page.locator(".system-overview-register").filter({ hasText: "mstatus" }).click();
  await page.waitForFunction(() => document.querySelector("#tableViewButton")?.getAttribute("aria-selected") === "true");
  assert.equal(await page.locator("#registerLocatorHeader").innerText(), "系统编码");
  assert.equal(await page.locator("#registerTableBody .system-encoding").innerText(), "CSR 0x300");
  assert.deepEqual(await page.locator("#registerTableBody .system-accessors .badge").allTextContents(), ["READ", "WRITE"]);
  assert.equal(await page.locator("#pageSelect").inputValue(), "Machine");
  await page.locator("#searchInput").fill("CSRRS");
  await waitForSearch();
  const csrrsResults = await page.locator(".search-result[data-kind='register'] .search-result-title").allTextContents();
  assert.ok(csrrsResults.includes("satp") && csrrsResults.includes("mstatus"));
  await page.locator("#searchInput").fill("satp");
  await waitForSearch();
  assert.equal(await page.locator("#pageSelect").inputValue(), "Machine", "global search should not require changing the active page");
  await page.locator(".search-result[data-kind='register']").filter({ hasText: "satp" }).first().click();
  await page.waitForFunction(() => document.querySelector("#pageSelect")?.value === "Supervisor");
  assert.equal(await page.locator("#searchInput").inputValue(), "satp");
  assert.deepEqual(await page.locator("#registerTableBody .name-cell strong").allTextContents(), ["satp"]);
  await page.goBack();
  await page.waitForFunction(() => document.querySelector("#pageSelect")?.value === "Machine");
  assert.equal(await page.locator("#searchInput").inputValue(), "satp");
  await page.waitForFunction(() => document.activeElement?.id === "searchInput");
  assert.equal(await page.locator("#searchPanel").isVisible(), true, "back navigation should restore search focus and results");
  assert.deepEqual(await page.locator("#registerTableBody .name-cell strong").allTextContents(), ["mstatus"]);
  await page.goForward();
  await page.waitForFunction(() => document.querySelector("#pageSelect")?.value === "Supervisor");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.locator("#searchInput").fill("");
  await page.locator("#searchInput").focus();
  assert.equal(await page.locator(".search-result-group").first().innerText(), "最近跳转");
  assert.ok(await page.locator(".search-result").filter({ hasText: "satp" }).count() >= 1);
  await page.locator("#searchInput").press("Alt+ArrowUp");
  assert.equal(await page.locator("#searchInput").inputValue(), "satp", "Alt+Up should restore local query history");
  await page.locator("#searchInput").fill("");
  await page.keyboard.press("Escape");

  const aarch32RegisterYaml = `schema_version: 2
sensor: "ARM_A32_UI_TEST"
vendor: "Arm"
family: "A-profile"
device_type: "architecture_registers"
register_space:
  kind: "arm_system"
  architecture: "AArch32"
  profile: "A"
source:
  title: "Synthetic AArch32 browser fixture"
  version: "test"
  document: "test"
  url: "https://example.invalid"
  license: "test only"
pages:
  Special:
    access: "architectural instructions"
    desc: "Synthetic AArch32 encodings"
    registers:
      - name: "ELR_hyp"
        access: "RW"
        width: 4
        bit_width: 32
        desc: "Banked special register"
        encoding:
          scheme: "aarch32_special"
          r: 0
          m: 1
          m1: 14
        accessors:
          - name: "ELR_hyp"
            kind: "read"
            instruction: "MRS <Rd>, ELR_hyp"
            encoding:
              scheme: "aarch32_special"
              r: 0
              m: 1
              m1: 14
      - name: "FPSCR"
        access: "RW"
        width: 4
        bit_width: 32
        desc: "VFP system register"
        encoding:
          scheme: "aarch32_vfp"
          reg: 1
        accessors:
          - name: "FPSCR"
            kind: "read"
            instruction: "VMRS <Rt>, FPSCR"
            encoding:
              scheme: "aarch32_vfp"
              reg: 1
      - name: "DBGDTRTXint"
        access: "WO"
        width: 4
        bit_width: 32
        desc: "Debug coprocessor register"
        encoding:
          scheme: "aarch32_coproc"
          coproc: 14
          opc1: 0
          crn: 0
          crm: 5
          opc2: 0
        accessors:
          - name: "DBGDTRTXint"
            kind: "write"
            instruction: "MCR p14, 0, <Rt>, c0, c5, 0"
            encoding:
              scheme: "aarch32_coproc"
              coproc: 14
              opc1: 0
              crn: 0
              crm: 5
              opc2: 0
      - name: "APSR"
        access: "RW"
        width: 4
        bit_width: 32
        desc: "Selector-based special register"
        encoding:
          scheme: "aarch32_special"
          selector: "APSR"
        accessors:
          - name: "APSR"
            kind: "read"
            instruction: "MRS <Rd>, APSR"
            encoding:
              scheme: "aarch32_special"
              selector: "APSR"
`;
  await page.locator("#yamlFileInput").setInputFiles({
    name: "arm-a32-ui-test.yaml",
    mimeType: "application/yaml",
    buffer: Buffer.from(aarch32RegisterYaml),
  });
  await page.waitForFunction(() => document.querySelector("#chipSelect option:checked")?.textContent === "ARM_A32_UI_TEST");
  assert.deepEqual(await page.locator("#registerTableBody .system-encoding").allTextContents(), [
    "r=0, m=1, m1=14",
    "reg=1",
    "p14, 0, c0, c5, 0",
    "selector=APSR",
  ]);
  await page.locator("#searchInput").fill("VMRS");
  await waitForSearch();
  assert.ok(await page.locator(".search-result[data-kind='register']").filter({ hasText: "FPSCR" }).count() >= 1);
  await page.locator("#searchInput").fill("");

  const mProfileBulkRegisters = Array.from({ length: 120 }, (_, index) => {
    const address = (0xe0010000 + index * 4).toString(16).toUpperCase();
    return `      - addr: 0x${address}\n        name: "BULK_${index}"\n        access: "RO"\n        width: 4\n        bit_width: 32\n        desc: "Synthetic bulk system register ${index}"`;
  }).join("\n");
  const mProfileRegisterYaml = `schema_version: 2
sensor: "ARM_M_UI_TEST"
vendor: "Arm"
family: "Armv8-M Mainline"
device_type: "architecture_registers"
register_space:
  kind: "arm_system"
  architecture: "Armv8-M Mainline"
  profile: "M"
source:
  title: "Synthetic M-profile browser fixture"
  version: "test"
  document: "test"
  url: "https://example.invalid"
  license: "Apache-2.0"
pages:
  Special Registers:
    access: "MRS / MSR special-register interface"
    desc: "Synthetic CPU special registers"
    registers:
      - name: "CONTROL"
        access: "RW"
        width: 4
        bit_width: 32
        desc: "Control Register"
        encoding:
          scheme: "m_profile_special"
          selector: "CONTROL"
        accessors:
          - name: "__get_CONTROL"
            kind: "read"
            instruction: "MRS <value>, CONTROL"
            encoding:
              scheme: "m_profile_special"
              selector: "CONTROL"
  Bulk:
    access: "Memory-mapped Core Peripheral access"
    desc: "Synthetic scroll fixture"
    registers:
${mProfileBulkRegisters}
  SCB:
    access: "Memory-mapped Core Peripheral access"
    desc: "System Control Block"
    registers:
      - addr: 0xE000ED00
        name: "CPUID"
        access: "RO"
        width: 4
        bit_width: 32
        desc: "CPUID Base Register"
`;
  await page.locator("#yamlFileInput").setInputFiles({
    name: "arm-m-ui-test.yaml",
    mimeType: "application/yaml",
    buffer: Buffer.from(mProfileRegisterYaml),
  });
  await page.waitForFunction(() => document.querySelector("#chipSelect option:checked")?.textContent === "ARM_M_UI_TEST");
  assert.equal(await page.locator("#matrixViewButton").isHidden(), false);
  assert.equal(await page.locator("#registerLocatorHeader").innerText(), "系统编码");
  assert.deepEqual(await page.locator("#registerTableBody .system-encoding").allTextContents(), ["selector=CONTROL"]);
  assert.equal(await page.locator("#registerTableBody .system-accessors .badge").innerText(), "READ");
  await page.locator("#matrixViewButton").click();
  assert.equal(await page.locator("#matrixViewButton").getAttribute("aria-selected"), "true");
  assert.equal(await page.locator(".system-overview-group").count(), 3);
  assert.equal(await page.locator(".system-overview-register").count(), 122);
  assert.equal(
    await page.locator(".system-overview-index").evaluate((element) => getComputedStyle(element).position),
    "sticky",
  );
  await page.evaluate(() => window.scrollTo(0, 520));
  await page.waitForFunction(() => window.scrollY > 400);
  const stickyPosition = await page.locator(".system-overview-index").evaluate((element) => {
    const topbar = document.querySelector(".topbar").getBoundingClientRect();
    const index = element.getBoundingClientRect();
    return { indexTop: index.top, topbarBottom: topbar.bottom };
  });
  assert.ok(
    Math.abs(stickyPosition.indexTop - stickyPosition.topbarBottom) <= 2,
    `system category index should remain below the sticky topbar: ${JSON.stringify(stickyPosition)}`,
  );
  await page.locator(".system-overview-index-item").filter({ hasText: "SCB" }).click();
  const anchoredGroupPosition = await page.locator("#system-overview-group-2").evaluate((element) => {
    const index = document.querySelector(".system-overview-index").getBoundingClientRect();
    return { groupTop: element.getBoundingClientRect().top, indexBottom: index.bottom };
  });
  assert.ok(
    anchoredGroupPosition.groupTop >= anchoredGroupPosition.indexBottom,
    `category target should remain below the sticky index: ${JSON.stringify(anchoredGroupPosition)}`,
  );
  const cpuidOverviewRegister = page.locator(".system-overview-register").filter({ hasText: "CPUID" });
  await cpuidOverviewRegister.scrollIntoViewIfNeeded();
  const overviewScrollY = await page.evaluate(() => window.scrollY);
  assert.ok(overviewScrollY > 400, "CPUID should be deep enough to exercise scroll restoration");
  await cpuidOverviewRegister.click();
  await page.waitForFunction(() => document.querySelector("#pageSelect")?.value === "SCB");
  assert.equal(await page.locator("#tableViewButton").getAttribute("aria-selected"), "true");
  assert.equal(await page.locator("#systemOverviewBackButton").isVisible(), true);
  await page.waitForSelector("#registerTableBody tr.is-target");
  assert.equal(await page.locator("#registerTableBody tr.is-target").count(), 1);
  assert.equal(await page.locator("#registerLocatorHeader").innerText(), "系统编码 / 地址");
  assert.deepEqual(await page.locator("#registerTableBody .system-encoding").allTextContents(), ["0xE000ED00-0xE000ED03"]);
  await page.goBack();
  await page.waitForFunction(() => document.querySelector("#matrixViewButton")?.getAttribute("aria-selected") === "true");
  assert.equal(await page.locator("#matrixTitle").innerText(), "全局预览");
  assert.equal(await page.locator("#pageSelect").inputValue(), "Special Registers");
  await page.waitForFunction((expected) => Math.abs(window.scrollY - expected) <= 2, overviewScrollY);
  assert.ok(
    Math.abs((await page.evaluate(() => window.scrollY)) - overviewScrollY) <= 2,
    "back navigation should restore the overview scroll position",
  );
  await page.goForward();
  await page.waitForFunction(() => document.querySelector("#pageSelect")?.value === "SCB");
  assert.equal(await page.locator("#tableViewButton").getAttribute("aria-selected"), "true");
  await page.waitForSelector("#registerTableBody tr.is-target");
  await page.locator("#systemOverviewBackButton").click();
  await page.waitForFunction(() => document.querySelector("#matrixViewButton")?.getAttribute("aria-selected") === "true");
  await page.waitForFunction((expected) => Math.abs(window.scrollY - expected) <= 2, overviewScrollY);
  assert.ok(
    Math.abs((await page.evaluate(() => window.scrollY)) - overviewScrollY) <= 2,
    "overview back button should restore the previous position",
  );

  await page.selectOption("#chipSelect", { label: "RK3588_DWC3" });
  await page.locator("#tableViewButton").click();
  await page.locator("#searchInput").fill("bus error address");
  await waitForSearch();
  const mixedSearchGroups = await page.locator(".search-result-group").allTextContents();
  assert.equal(mixedSearchGroups[0], "寄存器与位域");
  assert.ok(mixedSearchGroups.includes("说明与备注"));
  const mixedSearchOrder = await page.locator("#searchResults > *").evaluateAll((items) => {
    let section = "";
    return items.flatMap((item) => {
      if (item.classList.contains("search-result-group")) {
        section = item.textContent.trim();
        return [];
      }
      return item.classList.contains("search-result") ? [{ section, title: item.querySelector(".search-result-title")?.textContent }] : [];
    });
  });
  const firstDescription = mixedSearchOrder.findIndex((item) => item.section === "说明与备注");
  assert.ok(firstDescription > 0);
  assert.ok(mixedSearchOrder.slice(0, firstDescription).some((item) => /GBUSERRADDR|buserraddrvld/i.test(item.title)));
  assert.match(await page.locator(".search-result-match").first().innerText(), /^命中：/);
  assert.equal(await page.locator(".search-result-language").count(), 0, "results should explain the matched field instead of exposing EN badges");

  let addressRegister = "";
  for (const addressQuery of ["0xC118", "C118"]) {
    await page.locator("#searchInput").fill(addressQuery);
    await waitForSearch();
    const title = await page.locator(".search-result[data-kind='register'] .search-result-title").first().innerText();
    if (!addressRegister) addressRegister = title;
    assert.equal(title, addressRegister, "0x-prefixed and unprefixed addresses should resolve identically");
    assert.match(await page.locator(".search-result[data-kind='register'] .search-result-match").first().innerText(), /地址/);
  }

  await page.locator("#searchInput").fill("chip:RK3588 type:field access:ro buserraddrvld");
  await waitForSearch();
  assert.deepEqual(await page.locator(".search-filter:not(.invalid) > span").allTextContents(), [
    "chip:RK3588", "type:field", "access:ro",
  ]);
  assert.ok(await page.locator(".search-result[data-kind='field']").filter({ hasText: "buserraddrvld" }).count() >= 1);
  await page.locator('.search-filter[data-search-filter-token="access:ro"]').click();
  await waitForSearch();
  assert.doesNotMatch(await page.locator("#searchInput").inputValue(), /access:/);
  assert.equal(await page.locator(".search-filter:not(.invalid)").count(), 2);

  await page.locator("#searchInput").fill("type:");
  await page.waitForFunction(() => document.querySelector(".search-filter.invalid") && document.querySelector("#searchActivity")?.hidden);
  assert.match(await page.locator(".search-filter.invalid").innerText(), /缺少值/);
  await page.locator(".search-filter.invalid").click();
  assert.equal(await page.locator("#searchInput").inputValue(), "");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#searchInput").fill("bus error address");
  await waitForSearch();
  assert.equal(
    await page.evaluate(() => {
      const panel = document.querySelector("#searchPanel");
      return document.documentElement.scrollWidth <= window.innerWidth
        && panel.getBoundingClientRect().right <= window.innerWidth
        && panel.scrollWidth <= panel.clientWidth;
    }),
    true,
    "search results should not overflow a narrow viewport",
  );
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.locator("#searchInput").fill("USB3OTG_GSBUSCFG0");
  await waitForSearch();
  await page.locator(".search-result[data-kind='register']").filter({ hasText: "USB3OTG_GSBUSCFG0" }).first().click();
  await page.waitForSelector("#registerTableBody tr.is-target");
  const dataEndianField = page.locator("#registerTableBody .field-row").filter({ hasText: "datbigend" });
  assert.match(await dataEndianField.locator(".field-meaning").innerText(), /Little-endian \(default\)/);
  assert.match(await dataEndianField.locator(".enum-chip.active").innerText(), /1'b0/);
  await page.getByRole("textbox", { name: "USB3OTG_GSBUSCFG0 的寄存器值" }).fill("0x00000801");
  assert.match(await dataEndianField.locator(".field-meaning").innerText(), /Big-endian/);
  assert.match(await dataEndianField.locator(".enum-chip.active").innerText(), /1'b1/);
  await page.getByRole("textbox", { name: "USB3OTG_GSBUSCFG0 的寄存器值" }).fill("0x00000001");
  await page.locator("#searchInput").fill("USB3OTG_GSBUSCFG1");
  await waitForSearch();
  await page.locator(".search-result[data-kind='register']").filter({ hasText: "USB3OTG_GSBUSCFG1" }).first().click();
  await page.waitForSelector("#registerTableBody tr.is-target");
  const pipelineLimitField = page.locator("#registerTableBody .field-row").filter({ hasText: "pipe_trans_limit" });
  assert.match(await pipelineLimitField.locator(".field-meaning").innerText(), /4 requests/);
  assert.match(await pipelineLimitField.locator(".enum-chip.active").innerText(), /4'h3/);
  await page.locator("#searchInput").fill("USB3OTG_DGCMD");
  await waitForSearch();
  await page.locator(".search-result[data-kind='register']").filter({ hasText: "USB3OTG_DGCMD" }).first().click();
  await page.waitForSelector("#registerTableBody tr.is-target");
  const commandInput = page.getByRole("textbox", { name: "USB3OTG_DGCMD 的寄存器值" });
  await commandInput.fill("0x00000008");
  const commandTypeField = page.locator("#registerTableBody tr")
    .filter({ has: commandInput })
    .locator(".field-row")
    .filter({ hasText: "cmdtyp" });
  assert.match(await commandTypeField.locator(".field-meaning").innerText(), /Start New Configuration/);
  assert.match(await commandTypeField.locator(".enum-chip.active").innerText(), /8'h8/);
  await page.locator("#searchInput").fill("");
  await page.locator("#matrixViewButton").click();
  assert.equal(await page.locator("#matrixViewButton").isVisible(), true);
  assert.equal(await page.locator("#registerLocatorHeader").innerText(), "地址");
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
  await page.keyboard.press("Escape");
  await page.locator("#hoverPanel").waitFor({ state: "hidden" });

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
  await mobilePage.locator("#toolsMenuButton").click();
  const mobileToolsMenu = await mobilePage.locator("#toolsMenu").boundingBox();
  assert.ok(mobileToolsMenu.x >= 0 && mobileToolsMenu.x + mobileToolsMenu.width <= 390, "mobile tools menu should stay inside the viewport");
  assert.equal(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await mobilePage.keyboard.press("Escape");
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

  const libraryPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const libraryErrors = [];
  libraryPage.on("console", (message) => {
    if (message.type() === "error") libraryErrors.push(message.text());
  });
  libraryPage.on("pageerror", (error) => libraryErrors.push(error.message));
  await libraryPage.addInitScript(
    ({ yaml }) => {
      let records = [
        {
          id: "builtin:test64",
          sensor: "BUILTIN64",
          vendor: "Example",
          family: "Built-in",
          deviceType: "test",
          category: "内置",
          enabled: true,
          builtin: true,
          sourceKind: "builtin",
          sourceName: "builtin.yaml",
          sourcePath: null,
          sourceSha256: "builtin-v1",
          yamlText: yaml,
          notes: [],
          attachments: [],
          translations: [],
        },
        {
          id: "mock:imported",
          sensor: "IMPORTED64",
          vendor: "Example",
          family: "Imported",
          deviceType: "test",
          category: "待整理",
          enabled: true,
          builtin: false,
          sourceKind: "imported",
          sourceName: "imported.yaml",
          sourcePath: null,
          sourceSha256: "imported-v1",
          yamlText: yaml,
          notes: [{ id: 1, content: "local note" }],
          attachments: [{ id: 1, fileName: "manual.pdf" }],
          translations: [],
        },
        {
          id: "mock:linked",
          sensor: "LINKED64",
          vendor: "Example",
          family: "Linked",
          deviceType: "test",
          category: "待整理",
          enabled: true,
          builtin: false,
          sourceKind: "linked",
          sourceName: "linked.yaml",
          sourcePath: "/library/linked.yaml",
          sourceSha256: "linked-v1",
          yamlText: yaml,
          notes: [],
          attachments: [],
          translations: [],
        },
      ];
      window.__libraryCommands = [];
      window.__TAURI__ = {
        core: {
          invoke: async (command, args = {}) => {
            window.__libraryCommands.push({ command, args });
            if (command === "list_chip_summaries") {
              return structuredClone(records.map(({ yamlText: _yamlText, ...record }) => record));
            }
            if (command === "load_chip_document") {
              const record = records.find((item) => item.id === args.chipId);
              return { chipData: window.parseRegisterYaml(record.yamlText), translations: [] };
            }
            if (command === "search_index_status") {
              return { ready: true, indexedChips: records.length, totalChips: records.length };
            }
            if (command === "search_registers") {
              const record = records.find((item) => item.sensor.toLowerCase().includes(String(args.query || "").toLowerCase()));
              return {
                results: record ? [{
                  kind: "chip",
                  chipId: record.id,
                  chipName: record.sensor,
                  category: record.category,
                  enabled: record.enabled,
                  pageName: "",
                  registerIndex: null,
                  registerName: "",
                  registerLocator: "",
                  fieldName: "",
                  fieldBits: "",
                  title: record.sensor,
                  snippet: "",
                  matchLanguage: "identifier",
                  resultType: "chip",
                  matchKind: "name",
                  matchTerms: [args.query],
                  section: "entities",
                }] : [],
                filters: [],
                issues: [],
                suggestion: "",
              };
            }
            if (command === "set_chip_enabled") {
              records.find((record) => record.id === args.chipId).enabled = args.enabled;
              return null;
            }
            if (command === "set_chip_category") {
              records.find((record) => record.id === args.chipId).category = args.category;
              return null;
            }
            if (command === "delete_chip") {
              records = records.filter((record) => record.id !== args.chipId);
              return null;
            }
            throw new Error(`unexpected command: ${command}`);
          },
        },
      };
    },
    { yaml: yaml64 },
  );
  await libraryPage.goto(pathToFileURL(resolve(root, "index.html")).href, { waitUntil: "load" });
  await libraryPage.waitForFunction(() => document.querySelectorAll("#chipSelect option").length === 3);
  assert.ok(await libraryPage.evaluate(() => window.__libraryCommands.some((item) => item.command === "list_chip_summaries")));
  assert.ok(await libraryPage.evaluate(() => window.__libraryCommands.some((item) => item.command === "load_chip_document")));
  assert.equal(await libraryPage.locator("#libraryQuickButton").isVisible(), true);
  await libraryPage.locator("#libraryQuickButton").click();
  await libraryPage.waitForSelector("#libraryBackdrop:not([hidden])");
  assert.equal(await libraryPage.locator(".library-row").count(), 3);
  assert.equal(await libraryPage.locator(".library-protected").count(), 0);

  await libraryPage.locator('.library-row[data-chip-id="mock:imported"] [data-library-action="select"]').check();
  await libraryPage.locator('.library-row[data-chip-id="mock:linked"] [data-library-action="select"]').check();
  assert.equal(await libraryPage.locator("#librarySelectionSummary").innerText(), "已选择 2 个");
  assert.equal(await libraryPage.locator("#librarySelectAll").evaluate((input) => input.indeterminate), true);

  await libraryPage.locator("#libraryHideSelectedButton").click();
  await libraryPage.waitForFunction(() => document.querySelectorAll(".library-row.is-disabled").length === 2);
  await libraryPage.locator("#libraryBatchCategory").fill("惯性传感器");
  await libraryPage.locator("#libraryBatchCategoryButton").click();
  await libraryPage.waitForFunction(() => Array.from(document.querySelectorAll('.library-row[data-chip-id^="mock:"] .category-input')).every((input) => input.value === "惯性传感器"));

  await libraryPage.locator("#libraryCloseButton").click();
  await libraryPage.locator("#searchInput").fill("IMPORTED64");
  await libraryPage.waitForFunction(() => document.querySelector(".search-result[data-kind='chip']"));
  assert.match(await libraryPage.locator(".search-result-hidden").innerText(), /已隐藏/);
  await libraryPage.locator(".search-result[data-kind='chip']").click();
  await libraryPage.waitForFunction(() => document.querySelector("#chipSelect option:checked")?.textContent.includes("临时查看"));
  assert.match(await libraryPage.locator("#chipSelect option:checked").innerText(), /临时查看/);
  await libraryPage.goBack();
  await libraryPage.waitForFunction(() => document.activeElement?.id === "searchInput");
  await libraryPage.keyboard.press("Escape");
  await libraryPage.locator("#libraryQuickButton").click();
  await libraryPage.waitForSelector("#libraryBackdrop:not([hidden])");

  await libraryPage.locator("#librarySelectAll").check();
  assert.equal(await libraryPage.locator("#librarySelectionSummary").innerText(), "已选择 3 个");
  await libraryPage.locator("#libraryRemoveSelectedButton").click();
  await libraryPage.waitForSelector("#libraryRemoveDialog[open]");
  assert.match(await libraryPage.locator("#libraryRemoveSummary").innerText(), /3 个芯片/);
  assert.match(await libraryPage.locator("#libraryRemoveImpact").innerText(), /1 条本地备注/);
  assert.match(await libraryPage.locator("#libraryRemoveImpact").innerText(), /1 个附件关联/);
  assert.match(await libraryPage.locator("#libraryRemoveImpact").innerText(), /再次关联该目录时可能重新出现/);
  await libraryPage.locator("#libraryRemoveCancelButton").click();
  await libraryPage.waitForSelector("#libraryRemoveDialog", { state: "hidden" });
  assert.equal(await libraryPage.locator(".library-row").count(), 3);

  await libraryPage.locator("#libraryRemoveSelectedButton").click();
  await libraryPage.locator("#libraryRemoveConfirmButton").click();
  await libraryPage.waitForFunction(() => document.querySelectorAll(".library-row").length === 0);
  assert.equal(await libraryPage.locator("#libraryRemoveSelectedButton").isDisabled(), true);
  assert.match(await libraryPage.locator("#libraryStatus").innerText(), /移除 3 个芯片/);
  assert.deepEqual(
    await libraryPage.evaluate(() => window.__libraryCommands.filter((item) => item.command === "delete_chip").map((item) => item.args.chipId)),
    ["builtin:test64", "mock:imported", "mock:linked"],
  );

  await libraryPage.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await libraryPage.evaluate(() => {
      const panel = document.querySelector("#libraryPanel").getBoundingClientRect();
      const footer = document.querySelector(".library-footer").getBoundingClientRect();
      return document.documentElement.scrollWidth <= window.innerWidth
        && panel.top >= 0
        && panel.bottom <= window.innerHeight
        && footer.bottom <= window.innerHeight;
    }),
    true,
    "mobile chip library and its actions should stay inside the viewport",
  );
  assert.deepEqual(libraryErrors, []);
  await libraryPage.close();
  console.log(`[${browserEngine}] chip library management checks passed`);

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
  await notesPage.waitForFunction(
    () => document.querySelectorAll("#matrixGrid .has-register:not(.filtered-out)").length === 1,
  );
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
  assert.equal(await attachmentsPage.locator("#toolsMenuBadge").innerText(), "2");
  await attachmentsPage.locator("#toolsMenuButton").click();
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
  assert.equal(await attachmentsPage.locator("#attachmentsButtonCount").textContent(), "3");
  assert.equal(await attachmentsPage.locator("#toolsMenuBadge").innerText(), "3");
  attachmentsPage.once("dialog", (dialog) => dialog.accept());
  await attachmentsPage.locator('.attachment-row[data-attachment-id="3"] [data-attachment-action="delete"]').click();
  await attachmentsPage.waitForFunction(() => document.querySelectorAll(".attachment-row").length === 2);
  assert.match(await attachmentsPage.locator("#attachmentsStatus").innerText(), /原文件未删除/);
  assert.deepEqual(attachmentErrors, []);
  await attachmentsPage.close();
  console.log(`[${browserEngine}] attachment checks passed`);

  console.log(`${browserEngine} viewer tests passed: themes, DWC3, YAML validation, chip library, register notes, and chip attachments`);
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
