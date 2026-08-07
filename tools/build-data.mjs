import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { parse } from "yaml";

const root = resolve(import.meta.dirname, "..");
const dataDir = resolve(root, "data");
const jsMaxSafeInteger = BigInt(Number.MAX_SAFE_INTEGER);
const jsMinSafeInteger = BigInt(Number.MIN_SAFE_INTEGER);

function chipId(name, fallback) {
  const value = String(name || fallback)
    .replace(/[^0-9A-Za-z_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return value || fallback;
}

function preserveLargeIntegers(value) {
  if (typeof value === "bigint") {
    if (value >= jsMinSafeInteger && value <= jsMaxSafeInteger) return Number(value);
    return value >= 0n ? `0x${value.toString(16).toUpperCase()}` : value.toString();
  }
  if (Array.isArray(value)) return value.map(preserveLargeIntegers);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, preserveLargeIntegers(item)]));
  }
  return value;
}

async function loadChip(fileName) {
  const filePath = resolve(root, fileName);
  const yamlText = await readFile(filePath, "utf8");
  const data = preserveLargeIntegers(parse(yamlText, { intAsBigInt: true, uniqueKeys: true }));
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`${fileName}: YAML 根节点必须是对象`);
  }
  data._source = fileName;
  data._id = chipId(data.sensor, basename(fileName, extname(fileName)));
  return data;
}

const yamlFiles = (await readdir(root))
  .filter((fileName) => /\.ya?ml$/i.test(fileName))
  .sort();
const chips = await Promise.all(yamlFiles.map(loadChip));

await mkdir(dataDir, { recursive: true });
const outputPath = resolve(dataDir, "chips.data.js");
const output = `window.REGISTER_CHIPS = ${JSON.stringify(chips, null, 2)};\n`;
await writeFile(outputPath, output, "utf8");
console.log(`wrote ${outputPath} (${chips.length} chip files)`);
