import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import vm from "node:vm";
import * as tar from "tar";
import { stringify } from "yaml";
import { importArmSystemRegisters } from "./import-arm-mrs.mjs";

const root = resolve(import.meta.dirname, "..");
const temp = await mkdtemp(join(tmpdir(), "arm-mrs-import-test-"));
const packageDir = join(temp, "SysReg_xml_A_profile-test");

const registerXml = `<?xml version="1.0" encoding="utf-8"?>
<register_page>
  <registers>
    <register execution_state="AArch64" is_register="True" is_internal="True" is_stub_entry="False">
      <reg_short_name>TEST_EL1</reg_short_name>
      <reg_long_name>Test system register</reg_long_name>
      <reg_condition>when FEAT_TEST is implemented</reg_condition>
      <reg_mappings><reg_mapping><mapped_name>TEST_EL12</mapped_name></reg_mapping></reg_mappings>
      <reg_purpose><purpose_text><para>Synthetic importer fixture.</para></purpose_text></reg_purpose>
      <reg_groups><reg_group>Test Group</reg_group></reg_groups>
      <reg_fieldsets>
        <fields id="fieldset_narrow" length="64"><fields_condition>Legacy narrow view</fields_condition></fields>
        <fields id="fieldset_0" length="128">
          <field id="split" is_variable_length="False" reserved_type="RES0">
            <field_name>SPLIT</field_name><field_msb>87</field_msb><field_lsb>80</field_lsb>
            <field_rangesets>
              <field_rangeset><field_msb>87</field_msb><field_lsb>80</field_lsb></field_rangeset>
              <field_rangeset><field_msb>47</field_msb><field_lsb>40</field_lsb></field_rangeset>
            </field_rangesets>
            <field_description order="before"><para>Split field.</para></field_description>
            <field_values impdef="False">
              <field_value_instance><field_value>0b00xx</field_value><field_value_description><para>Pattern.</para></field_value_description><field_value_description><para>Additional detail.</para></field_value_description></field_value_instance>
              <field_value_instance><field_value>0b0000..0b0111</field_value><field_value_description><para>Range.</para></field_value_description></field_value_instance>
            </field_values>
          </field>
          <field id="split-expansion" is_variable_length="False" is_expansion="True"><field_name>SPLIT[0]</field_name><field_msb>40</field_msb><field_lsb>40</field_lsb><field_description order="before"><para>Expanded display copy.</para></field_description></field>
          <field id="conditional-a" is_variable_length="False"><field_name>MODE_A</field_name><field_msb>3</field_msb><field_lsb>0</field_lsb><field_description order="before"><para>Mode A.</para></field_description><fields_condition>When FEAT_A is implemented</fields_condition></field>
          <field id="conditional-b" is_variable_length="False"><field_name>MODE_B</field_name><field_msb>3</field_msb><field_lsb>0</field_lsb><field_description order="before"><para>Mode B.</para></field_description><fields_condition>Otherwise</fields_condition></field>
          <field id="full-width" is_variable_length="False"><field_name>FULL_WIDTH</field_name><field_msb>127</field_msb><field_lsb>0</field_lsb><field_description order="before"><para>Full-width reset test.</para></field_description><fields_condition>Alternate full-width layout</fields_condition><field_resets><field_reset reset_type="Warm"><field_reset_number>'0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF'</field_reset_number></field_reset></field_resets></field>
          <field id="partial-parent" has_partial_fieldset="True" is_variable_length="False">
            <field_name>DETAIL</field_name><field_msb>15</field_msb><field_lsb>8</field_lsb><field_description order="before"><para>Parent detail view.</para></field_description>
            <partial_fieldset><fields id="partial-one" length="8"><fields_instance>mode one</fields_instance><field id="part-a" is_variable_length="False"><field_name>PART_A</field_name><field_msb>7</field_msb><field_lsb>4</field_lsb><field_description order="before"><para>First layout.</para></field_description><field_resets><field_reset reset_type="Warm"><field_reset_conditions><field_reset_condition condition="when powered"><field_reset><field_reset_number>'0'</field_reset_number></field_reset></field_reset_condition><field_reset_condition><field_reset><field_reset_standard_text>AU</field_reset_standard_text></field_reset></field_reset_condition></field_reset_conditions></field_reset></field_resets></field></fields></partial_fieldset>
            <partial_fieldset><fields id="partial-two" length="8"><fields_instance>mode two</fields_instance><field id="part-b" is_variable_length="False" rwtype="UNKNOWN"><field_name>UNKNOWN</field_name><field_msb>7</field_msb><field_lsb>4</field_lsb><field_description order="before"><para>Second layout.</para></field_description></field><field id="part-res" is_variable_length="False" rwtype="RES0"><field_msb>3</field_msb><field_lsb>0</field_lsb><field_description order="before"><para>Reserved.</para></field_description></field></fields></partial_fieldset>
          </field>
        </fields>
      </reg_fieldsets>
      <reg_variables><reg_variable variable="n" min="0" max="3"/></reg_variables>
      <access_mechanisms>
        <access_mechanism accessor="MRRS TEST_EL1" type="SystemAccessor"><encoding><access_instruction>MRRS &lt;Xt&gt;, &lt;Xt2&gt;, TEST_EL1</access_instruction><enc n="op0" v="0b11"/><enc n="op1" v="0b000"/><enc n="CRn" v="0b0001"/><enc n="CRm" v="0b0010"/><enc n="op2" v="0b011"/></encoding></access_mechanism>
        <access_mechanism accessor="MSRR TEST_EL1" type="SystemAccessor"><encoding><access_instruction>MSRR TEST_EL1, &lt;Xt&gt;, &lt;Xt2&gt;</access_instruction><enc n="op0" v="0b11"/><enc n="op1" v="0b000"/><enc n="CRn" v="0b0001"/><enc n="CRm" v="0b0010"/><enc n="op2" v="0b011"/></encoding></access_mechanism>
      </access_mechanisms>
    </register>
  </registers>
  <timestamp>2026-06-01</timestamp><commit_id>test</commit_id>
</register_page>`;

try {
  await mkdir(packageDir);
  await writeFile(join(packageDir, "notice.xml"), "<textsection title=\"Proprietary Notice\"><para>LES-PRE-20349</para></textsection>");
  await writeFile(join(packageDir, "AArch64-test_el1.xml"), registerXml);

  const options = {
    input: packageDir,
    state: "AArch64",
    version: "test",
    revision: "test",
    document: "synthetic fixture",
    url: "https://example.invalid/arm-test",
    notice: "LES-PRE-20349",
    register: [],
  };
  const data = await importArmSystemRegisters(options);
  const register = data.pages["Test Group"].registers[0];
  assert.equal(data.schema_version, 2);
  assert.equal(data.register_space.kind, "arm_system");
  assert.equal(register.bit_width, 128);
  assert.equal("addr" in register, false);
  assert.deepEqual(register.encoding, { scheme: "aarch64_sysreg", op0: 3, op1: 0, crn: 1, crm: 2, op2: 3 });
  assert.equal(register.access, "RW");
  assert.equal(register.fields[0].bits, "87:80,47:40");
  assert.equal(register.fields[0].values[0].value, "0b00xx");
  assert.equal(register.fields[0].values[0].desc, "Pattern.\nAdditional detail.");
  assert.equal(register.fields[1].condition, "When FEAT_A is implemented");
  assert.equal(register.fields[2].condition, "Otherwise");
  assert.equal(register.fields.some((field) => field.name === "SPLIT[0]"), false);
  assert.equal(register.fields[3].reset, "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF");
  assert.equal(register.fields[4].reset, undefined);
  assert.equal(register.fields[4].reset_info, "Warm；when powered；'0'；Warm；Otherwise；AU");
  assert.deepEqual(
    register.fields.slice(4).map((field) => [field.name, field.bits, field.condition, field.reserved]),
    [
      ["PART_A", "15:12", "Layout: mode one", undefined],
      ["UNKNOWN", "15:12", "Layout: mode two", "UNKNOWN"],
      ["RES0", "11:8", "Layout: mode two", "RES0"],
    ],
  );

  const yamlText = stringify(data, { lineWidth: 0, defaultStringType: "QUOTE_DOUBLE", defaultKeyType: "PLAIN", doubleQuotedAsJSON: true });
  const context = { console };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(await readFile(join(root, "yaml-lite.js"), "utf8"), context);
  vm.runInContext(await readFile(join(root, "yaml-validator.js"), "utf8"), context);
  const parsed = context.parseRegisterYaml(yamlText);
  const report = context.validateRegisterYaml(yamlText, parsed);
  assert.equal(report.errors.length, 0);
  assert.equal(report.warnings.length, 0);
  assert.equal(report.valid, true);

  const quotedConditionYaml = `schema_version: 1
sensor: "quoted condition fixture"
who_am_i:
  reg: null
  values: []
pages:
  Test:
    page_id: 0
    access: "test"
    desc: "test"
    registers:
      - addr: 0
        name: "TEST"
        access: "RW"
        width: 4
        desc: "test"
        fields:
          - name: "FIELD"
            bits: "0"
            desc: "test"
            condition: "Layout: !IsFeatureImplemented(FEAT_TEST)"`;
  const quotedConditionData = context.parseRegisterYaml(quotedConditionYaml);
  const quotedConditionReport = context.validateRegisterYaml(quotedConditionYaml, quotedConditionData);
  assert.equal(quotedConditionReport.errors.length, 0, quotedConditionReport.errors.join("\n"));
  assert.equal(quotedConditionReport.warnings.length, 0);
  assert.equal(quotedConditionReport.valid, true);

  const taggedConditionYaml = quotedConditionYaml.replace(
    'condition: "Layout: !IsFeatureImplemented(FEAT_TEST)"',
    "condition: !unsupported-tag",
  );
  const taggedConditionData = context.parseRegisterYaml(taggedConditionYaml);
  const taggedConditionReport = context.validateRegisterYaml(taggedConditionYaml, taggedConditionData);
  assert.equal(taggedConditionReport.errors.some((message) => message.includes("浏览器解析器不支持")), true);

  const archive = join(temp, "arm-test.tar.gz");
  await tar.c({ gzip: true, cwd: temp, file: archive }, ["SysReg_xml_A_profile-test"]);
  const tempEntriesBefore = new Set((await readdir(tmpdir())).filter((name) => name.startsWith("arm-mrs-")));
  const archiveData = await importArmSystemRegisters({ ...options, input: archive });
  assert.equal(archiveData.pages["Test Group"].registers[0].name, "TEST_EL1");
  const leakedEntries = (await readdir(tmpdir())).filter((name) => name.startsWith("arm-mrs-") && !tempEntriesBefore.has(name));
  assert.deepEqual(leakedEntries, []);
  console.log("ARM MRS importer tests passed");
} finally {
  await rm(temp, { recursive: true, force: true });
}
