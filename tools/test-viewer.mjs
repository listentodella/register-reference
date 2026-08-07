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
  await page.locator("#matrixGrid .has-register").first().hover();
  await page.waitForSelector("#hoverPanel:not([hidden])");
  assert.equal(await page.locator("#hoverPanel .bit-box").count(), 32);
  assert.equal(await page.locator("#hoverPanel .register-value-input").first().inputValue(), "0x00000001");

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
`;

  await page.setInputFiles("#yamlFileInput", {
    name: "test64.yaml",
    mimeType: "application/yaml",
    buffer: Buffer.from(yaml64),
  });
  await page.waitForTimeout(100);
  assert.equal(await page.locator("#chipSelect option:checked").innerText(), "TEST64");
  assert.equal(await page.locator("#matrixGrid .reg-cell").count(), 16);
  await page.locator("#matrixGrid .has-register").hover();
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
  await notesPage.locator("#matrixGrid .has-register").click();
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
