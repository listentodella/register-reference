import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

const root = resolve(import.meta.dirname, "..");
const fixtureRoot = resolve(root, "tools", "validator-fixtures");

const sandbox = { window: {}, console };
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
for (const file of ["yaml-lite.js", "yaml-validator.js"]) {
  vm.runInContext(readFileSync(resolve(root, file), "utf8"), sandbox, { filename: file });
}

function verdictFor(text) {
  try {
    const document = sandbox.window.parseRegisterYaml(text);
    const report = sandbox.window.validateRegisterYaml(text, document);
    return { valid: report.valid, errors: report.errors, warnings: report.warnings };
  } catch (error) {
    return { valid: false, errors: [error.message], warnings: [] };
  }
}

for (const [directory, expected] of [["valid", true], ["invalid", false]]) {
  const fixtureDirectory = resolve(fixtureRoot, directory);
  const names = readdirSync(fixtureDirectory).filter((name) => name.endsWith(".yaml")).sort();
  assert.ok(names.length > 0, `tools/validator-fixtures/${directory} must contain at least one fixture`);
  for (const name of names) {
    const result = verdictFor(readFileSync(resolve(fixtureDirectory, name), "utf8"));
    assert.equal(
      result.valid,
      expected,
      `tools/validator-fixtures/${directory}/${name} must be ${expected ? "accepted" : "rejected"}; errors=${JSON.stringify(result.errors)} warnings=${JSON.stringify(result.warnings)}`,
    );
  }
  console.log(`yaml-validator.js classified ${names.length} ${directory} fixture(s) as expected`);
}

console.log("validator fixture checks passed for yaml-validator.js");
