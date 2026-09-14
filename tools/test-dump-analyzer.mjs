import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const dump = require("../dump-analyzer.js");

const chip = {
  sensor: "DUMP_TEST",
  vendor: "Fixture",
  family: "Tests",
  register_space: { kind: "mmio" },
  pages: {
    Main: {
      registers: [
        {
          addr: 0x10,
          name: "CTRL",
          aliases: ["CONTROL"],
          access: "RW",
          width: 2,
          bit_width: 16,
          fields: [
            {
              name: "MODE",
              bits: "15:8",
              access: "RW",
              values: [{ value: "0x1", name: "run", desc: "Run mode" }],
            },
            {
              name: "SPLIT",
              bits: "7:4,1:0",
              condition: "when enabled",
              values: [{ value: "6'h29", name: "pattern_a1", desc: "Split A1" }],
            },
          ],
        },
        { addr: 0x30, name: "DATA", access: "RO", width: 1, fields: [] },
      ],
    },
    Alternate: {
      registers: [
        { addr: 0x20, name: "CTRL", access: "RO", width: 2, fields: [] },
        { addr: 0x30, name: "DATA_ALIAS", access: "RO", width: 1, fields: [] },
      ],
    },
    Wide: {
      registers: [
        {
          addr: 0x40,
          name: "WIDE",
          width: 16,
          bit_width: 128,
          fields: [{ name: "FULL", bits: "127:0", values: [{ value: "128'hFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF", desc: "All ones" }] }],
        },
      ],
    },
  },
};

const formats = dump.parseDump(`
# comment
CTRL=0x1234
CTRL: 0b1010
Main.CTRL = 1_024
0x10 = 0x12
0x10 0x13
CTRL 20 // trailing comment
`);
assert.equal(formats.length, 6);
assert.deepEqual(formats.map((row) => row.lineNumber), [3, 4, 5, 6, 7, 8]);
assert.deepEqual(formats.map((row) => row.value.toString()), ["4660", "10", "1024", "18", "19", "20"]);
assert.equal(formats[2].pageHint, "Main");
assert.equal(formats[3].identifierKind, "address");

const malformed = dump.parseDump("CTRL 0x1 extra\nCTRL=xyz\n=0x1");
assert.deepEqual(malformed.map((row) => row.status), ["invalid", "invalid", "invalid"]);
assert.match(malformed[0].message, /无法明确拆分/);
assert.match(malformed[1].message, /仅支持/);

const max128 = "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF";
assert.equal(dump.parseUnsignedValue(max128).ok, true);
assert.equal(dump.parseUnsignedValue("0x1_0000_0000_0000_0000_0000_0000_0000_0000").ok, false);

const ambiguousName = dump.analyzeDump("CTRL=0x1", chip).rows[0];
assert.equal(ambiguousName.status, "ambiguous");
assert.equal(ambiguousName.candidates.length, 2);
const selectedName = dump.analyzeDump("CTRL=0x1", chip, { 1: ambiguousName.candidates[0].id }).rows[0];
assert.equal(selectedName.status, "matched");
assert.equal(selectedName.candidate.pageName, "Main");

const pageQualified = dump.analyzeDump("Alternate.CTRL=0x1", chip).rows[0];
assert.equal(pageQualified.status, "matched");
assert.equal(pageQualified.candidate.locator, "0x20");

const alias = dump.analyzeDump("CONTROL=0x1", chip).rows[0];
assert.equal(alias.status, "matched");
assert.equal(alias.candidate.registerName, "CTRL");

const ambiguousAddress = dump.analyzeDump("0x30 0x1", chip).rows[0];
assert.equal(ambiguousAddress.status, "ambiguous");
assert.deepEqual(ambiguousAddress.candidates.map((candidate) => candidate.pageName), ["Main", "Alternate"]);
assert.equal(dump.analyzeDump("0x99=0x1", chip).rows[0].status, "unknown");

const decoded = dump.analyzeDump("Main.CTRL=0x01A1", chip).rows[0].decoded;
assert.equal(decoded.valueHex, "0x01A1");
assert.equal(decoded.fields[0].enumStatus, "matched");
assert.equal(decoded.fields[0].matches[0].name, "run");
assert.equal(decoded.fields[1].valueHex, "0x29");
assert.equal(decoded.fields[1].enumStatus, "matched");
assert.equal(decoded.fields[1].matches[0].name, "pattern_a1");
assert.equal(decoded.fields[1].semanticStatus, "conditional");

const unknownEnum = dump.analyzeDump("Main.CTRL=0x02B2", chip).rows[0].decoded;
assert.equal(unknownEnum.fields[0].enumStatus, "unknown_value");
assert.equal(unknownEnum.fields[1].enumStatus, "unknown_value");

const wide = dump.analyzeDump(`WIDE=${max128}`, chip).rows[0];
assert.equal(wide.status, "matched");
assert.equal(wide.decoded.bitWidth, 128);
assert.equal(wide.decoded.fields[0].enumStatus, "matched");

const before = dump.analyzeDump("Main.CTRL=0x01A1\nDATA=0x2", chip).rows;
const afterReordered = dump.analyzeDump("DATA=0x2\nMain.CTRL=0x01A1", chip).rows;
const unchanged = dump.compareSnapshots(before, afterReordered);
assert.deepEqual(unchanged.map((item) => item.status), ["unchanged", "unchanged"]);

const afterChanged = dump.analyzeDump("Main.CTRL=0x02B2\nWIDE=0x1", chip).rows;
const changed = dump.compareSnapshots(before, afterChanged);
assert.ok(changed.some((item) => item.status === "removed" && item.before.candidate.registerName === "DATA"));
assert.ok(changed.some((item) => item.status === "added" && item.after.candidate.registerName === "WIDE"));
const controlChange = changed.find((item) => item.status === "changed");
assert.deepEqual(controlChange.changedFields.map((field) => field.name), ["MODE", "SPLIT"]);

const armChip = {
  sensor: "ARM_DUMP_TEST",
  register_space: { kind: "arm_system" },
  pages: {
    Control: {
      registers: [{
        name: "TEST_EL1",
        aliases: ["TEST_ALIAS"],
        bit_width: 64,
        encoding: { scheme: "aarch64_sysreg", op0: 3, op1: 0, crn: 1, crm: 0, op2: 3 },
      }],
    },
  },
};
assert.equal(dump.analyzeDump("TEST_ALIAS=0x1", armChip).rows[0].status, "matched");
const armEncoding = dump.analyzeDump("S3_0_C1_C0_3=0x1", armChip).rows[0];
assert.equal(armEncoding.status, "matched");
assert.equal(armEncoding.candidate.locator, "S3_0_C1_C0_3");
assert.equal(armEncoding.candidate.locator.startsWith("0x"), false);

const exported = dump.createExportDocument(chip, "single", [decoded ? dump.analyzeDump("Main.CTRL=0x01A1", chip).rows[0] : null]);
const exportedText = JSON.stringify(exported);
assert.equal(exported.schema, "register-dump-analysis/v1");
assert.doesNotMatch(exportedText, /rawLine|Main\.CTRL=0x01A1/);
assert.match(dump.createMarkdown(chip, "single", dump.analyzeDump("Main.CTRL=0x01A1", chip).rows), /SPLIT\[7:4,1:0\]/);

console.log("dump analyzer parsing, matching, decoding, comparison, and export checks passed");
