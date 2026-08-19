import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const messages = [];
const context = { console };
context.self = context;
context.postMessage = (message) => messages.push(message);
context.importScripts = () => {};
vm.createContext(context);
vm.runInContext(await readFile(resolve(root, "vendor", "fuse.min.js"), "utf8"), context);
vm.runInContext(await readFile(resolve(root, "search-worker.js"), "utf8"), context);

const chips = [
  {
    _libraryId: "chip:dwc3",
    sensor: "RK3588_DWC3",
    _category: "接口控制器",
    pages: {
      MMIO: {
        registers: [
          {
            addr: 0xC118,
            name: "USB3OTG_GBUSERRADDRLO",
            access: "RO",
            desc: "Stores the lower bus error address.",
          },
          {
            addr: 0xC110,
            name: "USB3OTG_GSTS",
            access: "RO",
            fields: [{
              name: "buserraddrvld",
              bits: "4:4",
              access: "RO",
              desc: "Indicates that the bus error address is valid.",
            }],
          },
        ],
      },
    },
    _notes: [{
      id: 1,
      pageName: "MMIO",
      registerName: "USB3OTG_GBUSERRADDRLO",
      registerKey: "note-key",
      kind: "warning",
      content: "调试时先清空错误状态。",
    }],
  },
  {
    _libraryId: "chip:m3",
    sensor: "Arm Cortex-M3 system registers",
    _category: "架构寄存器",
    pages: {
      "Special Registers": {
        registers: [{
          name: "APSR",
          access: "RW",
          desc: "Application status flags.",
          encoding: { scheme: "aarch64_sysreg", op0: 3, op1: 0, crn: 1, crm: 0, op2: 3 },
          fields: [{
            name: "overflow",
            bits: "31:28",
            access: "RW",
            desc: "Overflow condition flag.",
          }],
        }],
      },
    },
    _translations: [{
      translations: {
        pages: [{
          name: "Special Registers",
          registers: [{
            name: "APSR",
            fields: [{ name: "overflow", bits: "31:28", desc: "算术溢出条件标志。" }],
          }],
        }],
      },
    }],
  },
  {
    _libraryId: "chip:current",
    sensor: "CURRENT_CHIP",
    _category: "测试",
    pages: {
      Events: {
        registers: [{
          addr: 0x20,
          name: "EVENT_FIFO",
          access: "RW",
          fields: [{
            name: "event_addr",
            bits: "31:28",
            access: "RW",
            desc: "The event FIFO can include a bus error address in diagnostic text.",
          }],
        }],
      },
    },
  },
];

context.onmessage({ data: {
  type: "init",
  chips,
  summaries: chips.map((chip) => ({ id: chip._libraryId, category: chip._category, enabled: true })),
} });
assert.equal(messages.pop().type, "ready");

let requestId = 0;
function search(query, currentChipId = "chip:current") {
  context.onmessage({ data: {
    type: "search",
    requestId: ++requestId,
    query,
    currentChipId,
    recentChipIds: ["chip:current"],
    limit: 100,
  } });
  const message = messages.pop();
  assert.equal(message.requestId, requestId);
  return message.response;
}

const mixed = search("bus error address");
const firstText = mixed.results.findIndex((result) => result.section === "text");
assert.ok(firstText > 0);
assert.ok(mixed.results.slice(0, firstText).every((result) => result.section === "entities"));
assert.ok(mixed.results.slice(0, firstText).some((result) => result.registerName === "USB3OTG_GBUSERRADDRLO"));
assert.equal(mixed.results[firstText].resultType, "description");

for (const query of ["0xC118", "C118", "addr:0xc118"]) {
  const response = search(query);
  assert.equal(response.results[0].registerName, "USB3OTG_GBUSERRADDRLO");
  assert.equal(response.results[0].matchKind, "address");
}
for (const query of ["[4]", "4"]) {
  const response = search(query);
  assert.equal(response.results[0].fieldName, "buserraddrvld");
  assert.equal(response.results[0].matchKind, "bits");
}

const encoding = search("S3_0_C1_C0_3");
assert.equal(encoding.results[0].registerName, "APSR");
assert.equal(encoding.results[0].matchKind, "system_encoding");

const filtered = search("chip:m3 type:field access:rw overflow");
assert.equal(filtered.filters.length, 3);
assert.equal(filtered.results.length, 1);
assert.equal(filtered.results[0].fieldName, "overflow");
assert.equal(filtered.results[0].chipId, "chip:m3");

const translated = search("算术溢出");
assert.equal(translated.results[0].matchKind, "translated_description");
assert.ok(translated.results[0].matchTerms.includes("算术溢出"));
const note = search("清空错误状态");
assert.equal(note.results[0].resultType, "note");
assert.equal(note.results[0].matchKind, "note");

const typo = search("USB3OTG_GBUSERRADDRL0");
assert.equal(typo.results[0].registerName, "USB3OTG_GBUSERRADDRLO");
assert.equal(typo.results[0].section, "suggestions");

const invalid = search("type: addr:xyz scope:all");
assert.equal(invalid.results.length, 0);
assert.equal(invalid.issues.length, 3);

console.log("search worker ranking and filter checks passed");
