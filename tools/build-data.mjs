import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dataDir = resolve(root, "data");

await mkdir(dataDir, { recursive: true });
const outputPath = resolve(dataDir, "chips.data.js");
const output = "window.REGISTER_CHIPS = [];\n";
await writeFile(outputPath, output, "utf8");
console.log(`wrote ${outputPath} (clean library)`);
